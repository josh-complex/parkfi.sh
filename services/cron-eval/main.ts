/**
 * Forecast backtest / metrics cron (Railway cron, hourly — "0 * * * *").
 * Single-shot, per-step isolated (`runStep`), keyless (needs only DATABASE_URL).
 * Pure SQL — no model needed, so it stays in TS alongside the other crons rather
 * than in the Python ml-train service.
 *
 * This is what makes every /predictions number HONEST. Two steps:
 *   1. Backfill `forecast_eval`: every `queue_forecast` row whose `target_ts` is
 *      now safely in the past joins the ACTUAL standby wait from `queue_15min`
 *      (the bucket containing `target_ts`). abs_err = |predicted − actual|.
 *   2. Recompute `model_metrics` per window {24h, 7d, 30d, all} from
 *      `forecast_eval` — MAE/RMSE/MAPE/R²/n + verified coverage — and upsert.
 *
 * `EVAL_GRACE` (2h) lets the 15-min continuous aggregate materialize the actual
 * bucket before we try to join it (the cagg refresh policy lags ~1h). Without
 * the grace, recent forecasts would evaluate against a not-yet-filled bucket and
 * look falsely uncovered.
 *
 * Run:  bun run cron:eval
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";

import type { SQL } from "drizzle-orm";

// How long after target_ts to wait before evaluating, so the 15-min cagg has
// materialized the actual bucket (refresh end_offset 1h + ~1h schedule).
const EVAL_GRACE = sql`INTERVAL '2 hours'`;

const WINDOWS: Array<{ label: string; lower: SQL }> = [
  { label: "24h", lower: sql`now() - INTERVAL '24 hours'` },
  { label: "7d", lower: sql`now() - INTERVAL '7 days'` },
  { label: "30d", lower: sql`now() - INTERVAL '30 days'` },
  { label: "all", lower: sql`NULL` },
];

async function runStep(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[cron-eval] ${label} failed:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Step 1: join past-due forecasts to their actual wait and append to the
 * backtest ledger. Idempotent — `ON CONFLICT DO NOTHING` skips already-evaluated
 * (model_version, attraction, queue_type, horizon, target_ts) rows.
 */
async function backfillEval(): Promise<void> {
  const res = await db.execute(sql`
    INSERT INTO forecast_eval
      (model_version, attraction_id, queue_type, target_ts, horizon_min,
       predicted_wait, actual_wait, abs_err, generated_at, evaluated_at)
    SELECT qf.model_version, qf.attraction_id, qf.queue_type, qf.target_ts, qf.horizon_min,
           qf.predicted_wait,
           q.avg_wait AS actual_wait,
           abs(qf.predicted_wait - q.avg_wait) AS abs_err,
           qf.generated_at,
           now() AS evaluated_at
    FROM queue_forecast qf
    JOIN queue_15min q
      ON q.attraction_id = qf.attraction_id
     AND q.queue_type = qf.queue_type
     AND q.bucket = time_bucket('15 minutes', qf.target_ts)
    WHERE qf.target_ts < now() - ${EVAL_GRACE}
      AND q.avg_wait IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM forecast_eval fe
        WHERE fe.model_version = qf.model_version
          AND fe.attraction_id = qf.attraction_id
          AND fe.queue_type = qf.queue_type
          AND fe.horizon_min = qf.horizon_min
          AND fe.target_ts = qf.target_ts
      )
    ON CONFLICT (model_version, attraction_id, queue_type, horizon_min, target_ts) DO NOTHING
  `);
  console.log(`[cron-eval] backfill: +${res.rowCount ?? 0} forecast_eval rows`);
}

/**
 * Step 2: roll `forecast_eval` up into `model_metrics` for one window. `lower`
 * is the target_ts floor (NULL ⇒ 'all'). coverage_pct = evaluated / evaluable
 * (forecasts whose target_ts is in the window and past the grace).
 */
async function recomputeWindow(label: string, lower: SQL): Promise<void> {
  const res = await db.execute(sql`
    WITH ev AS (
      SELECT model_version, actual_wait, abs_err
      FROM forecast_eval
      WHERE actual_wait IS NOT NULL
        AND (${lower}::timestamptz IS NULL OR target_ts >= ${lower}::timestamptz)
    ),
    agg AS (
      SELECT model_version,
             avg(abs_err)                          AS mae,
             sqrt(avg(abs_err * abs_err))          AS rmse,
             avg(abs_err / nullif(actual_wait, 0)) AS mape,
             avg(actual_wait)                      AS mean_a,
             sum(abs_err * abs_err)                AS ss_res,
             count(*)                              AS n
      FROM ev GROUP BY model_version
    ),
    tot AS (
      SELECT e.model_version,
             sum(power(e.actual_wait - a.mean_a, 2)) AS ss_tot
      FROM ev e JOIN agg a USING (model_version)
      GROUP BY e.model_version
    ),
    gen AS (
      SELECT model_version, count(*) AS generated
      FROM queue_forecast
      WHERE target_ts < now() - ${EVAL_GRACE}
        AND (${lower}::timestamptz IS NULL OR target_ts >= ${lower}::timestamptz)
      GROUP BY model_version
    )
    INSERT INTO model_metrics
      (model_version, window, computed_at, mae, rmse, mape, r2, n_predictions, coverage_pct)
    SELECT a.model_version, ${label}, now(),
           a.mae, a.rmse, a.mape,
           CASE WHEN t.ss_tot > 0 THEN 1 - a.ss_res / t.ss_tot ELSE NULL END,
           a.n,
           CASE WHEN g.generated > 0 THEN a.n::float / g.generated ELSE NULL END
    FROM agg a
    JOIN tot t USING (model_version)
    LEFT JOIN gen g USING (model_version)
    ON CONFLICT (model_version, window) DO UPDATE SET
      computed_at    = excluded.computed_at,
      mae            = excluded.mae,
      rmse           = excluded.rmse,
      mape           = excluded.mape,
      r2             = excluded.r2,
      n_predictions  = excluded.n_predictions,
      coverage_pct   = excluded.coverage_pct
  `);
  console.log(`[cron-eval] metrics[${label}]: ${res.rowCount ?? 0} model rows`);
}

async function main() {
  await runStep("backfill", backfillEval);
  for (const w of WINDOWS) {
    await runStep(`metrics:${w.label}`, () => recomputeWindow(w.label, w.lower));
  }
  console.log("[cron-eval] done");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
