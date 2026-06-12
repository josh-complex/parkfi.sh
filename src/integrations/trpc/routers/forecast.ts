import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { publicProcedure } from "../init.ts";

import type { TRPCRouterRecord } from "@trpc/server";

/**
 * Reads the wait-time forecasting tables the Python model service + cron-eval
 * write (Postgres is the only contract — see docs/plans + schema.ts § "Wait-time
 * forecasting"). Mirrors parks.ts conventions: publicProcedure, raw SQL via
 * `db.execute`, zod input, camelCase row mapping.
 */

const STANDBY = 1;

/**
 * Cold-start honesty gate: don't surface public accuracy tiles until a window
 * has at least this many verified predictions, so an early "0.3% coverage"
 * can't masquerade as a real "56%". (docs/plans §4b)
 */
const ACCURACY_MIN_N = 50_000;

export const forecastRouter = {
  /**
   * Latest forecast curve for one attraction/queue type from the newest model
   * version (predicted standby wait + p10/p90 band). Powers the inline
   * "predicted vs live" band on attraction views and the per-ride forecast.
   */
  attraction: publicProcedure
    .input(
      z.object({
        attractionId: z.number().int().positive(),
        queueType: z.number().int().min(1).max(6).default(STANDBY),
        horizon: z.number().int().positive().optional(),
      }),
    )
    .query(async ({ input }) => {
      const result = await db.execute<{
        target_ts: string;
        horizon_min: number;
        predicted_wait: number;
        lower: number | null;
        upper: number | null;
        model_version: string;
        generated_at: string;
      }>(sql`
        WITH newest AS (
          SELECT model_version
          FROM queue_forecast
          WHERE attraction_id = ${input.attractionId} AND queue_type = ${input.queueType}
          ORDER BY generated_at DESC
          LIMIT 1
        )
        SELECT target_ts, horizon_min, predicted_wait, lower, upper, model_version, generated_at
        FROM queue_forecast
        WHERE attraction_id = ${input.attractionId}
          AND queue_type = ${input.queueType}
          AND model_version = (SELECT model_version FROM newest)
          ${input.horizon != null ? sql`AND horizon_min = ${input.horizon}` : sql``}
          AND target_ts >= now()
        ORDER BY target_ts
      `);
      const rows = result.rows.map((r) => ({
        targetTs: r.target_ts,
        horizonMin: r.horizon_min,
        predictedWait: r.predicted_wait,
        lower: r.lower,
        upper: r.upper,
        generatedAt: r.generated_at,
      }));
      return {
        modelVersion: result.rows[0]?.model_version ?? null,
        points: rows,
      };
    }),

  /**
   * Next-day (or any date) hourly curve for a whole park from the active model:
   * the park-average predicted standby wait + band per hour, plus a derived 1–10
   * crowd index (the parkgoer-facing "how busy will it be"). (docs/plans §4c)
   *
   * Crowd index normalization: the park's predicted daily-average standby wait,
   * percentile-ranked against the distribution of its own historical daily-avg
   * standby waits over the last 90 days of `queue_15min`, mapped onto 1–10.
   * Documented + returned (`percentile`, `basisDays`) so the number is auditable.
   */
  parkCurve: publicProcedure
    .input(
      z.object({
        parkSlug: z.string(),
        // ISO date (park-local). Default handled client-side (tomorrow).
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .query(async ({ input }) => {
      const ptsP = db.execute<{
        target_ts: string;
        predicted_wait: number;
        lower: number | null;
        upper: number | null;
        rides: number;
        model_version: string;
      }>(sql`
        WITH park AS (SELECT id, timezone FROM parks WHERE slug = ${input.parkSlug}),
        active AS (
          SELECT model_version FROM model_run WHERE status = 'active'
          ORDER BY trained_at DESC LIMIT 1
        ),
        fc AS (
          SELECT qf.target_ts, qf.predicted_wait, qf.lower, qf.upper, qf.model_version
          FROM queue_forecast qf
          JOIN attractions a ON a.id = qf.attraction_id
          WHERE a.park_id = (SELECT id FROM park)
            AND qf.queue_type = ${STANDBY}
            AND qf.model_version = (SELECT model_version FROM active)
            AND (qf.target_ts AT TIME ZONE (SELECT timezone FROM park))::date = ${input.date}::date
        )
        SELECT target_ts,
               avg(predicted_wait)::real AS predicted_wait,
               avg(lower)::real AS lower,
               avg(upper)::real AS upper,
               count(*) AS rides,
               max(model_version) AS model_version
        FROM fc GROUP BY target_ts ORDER BY target_ts
      `);

      const crowdP = db.execute<{ percentile: number | null; basis_days: number }>(sql`
        WITH park AS (SELECT id, timezone FROM parks WHERE slug = ${input.parkSlug}),
        active AS (
          SELECT model_version FROM model_run WHERE status = 'active'
          ORDER BY trained_at DESC LIMIT 1
        ),
        pred AS (
          SELECT avg(qf.predicted_wait) AS v
          FROM queue_forecast qf
          JOIN attractions a ON a.id = qf.attraction_id
          WHERE a.park_id = (SELECT id FROM park)
            AND qf.queue_type = ${STANDBY}
            AND qf.model_version = (SELECT model_version FROM active)
            AND (qf.target_ts AT TIME ZONE (SELECT timezone FROM park))::date = ${input.date}::date
        ),
        hist AS (
          SELECT (q.bucket AT TIME ZONE (SELECT timezone FROM park))::date AS d,
                 avg(q.avg_wait) AS day_avg
          FROM queue_15min q
          JOIN attractions a ON a.id = q.attraction_id
          WHERE a.park_id = (SELECT id FROM park)
            AND q.queue_type = ${STANDBY}
            AND q.avg_wait IS NOT NULL
            AND q.bucket >= now() - INTERVAL '90 days'
          GROUP BY d
        )
        SELECT
          CASE WHEN count(*) = 0 OR (SELECT v FROM pred) IS NULL THEN NULL
               ELSE (count(*) FILTER (WHERE day_avg <= (SELECT v FROM pred)))::float
                    / count(*) END AS percentile,
          count(*) AS basis_days
        FROM hist
      `);

      const [pts, crowd] = await Promise.all([ptsP, crowdP]);
      const c = crowd.rows[0];
      const percentile = c?.percentile ?? null;
      const crowdIndex =
        percentile == null ? null : Math.max(1, Math.min(10, Math.round(1 + 9 * percentile)));

      return {
        parkSlug: input.parkSlug,
        date: input.date,
        modelVersion: pts.rows[0]?.model_version ?? null,
        points: pts.rows.map((r) => ({
          targetTs: r.target_ts,
          predictedWait: r.predicted_wait,
          lower: r.lower,
          upper: r.upper,
          rides: Number(r.rides),
        })),
        crowd: {
          index: crowdIndex,
          percentile,
          basisDays: Number(c?.basis_days ?? 0),
        },
      };
    }),

  /**
   * Per-date crowd index + daily weather summary for a park over a date range.
   * Runs one SQL round-trip for crowd (vs N × parkCurve) by computing the
   * historical percentile distribution once and scoring all prediction dates
   * against it in a single pass. Powers the pricing-calendar overlay.
   */
  parkCalendar: publicProcedure
    .input(
      z.object({
        parkSlug: z.string(),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .query(async ({ input }) => {
      const crowdP = db.execute<{ date: string; percentile: number | null }>(sql`
        WITH park AS (SELECT id, timezone FROM parks WHERE slug = ${input.parkSlug}),
        active AS (
          SELECT model_version FROM model_run WHERE status = 'active'
          ORDER BY trained_at DESC LIMIT 1
        ),
        pred AS (
          SELECT (qf.target_ts AT TIME ZONE (SELECT timezone FROM park))::date AS d,
                 avg(qf.predicted_wait) AS v
          FROM queue_forecast qf
          JOIN attractions a ON a.id = qf.attraction_id
          WHERE a.park_id = (SELECT id FROM park)
            AND qf.queue_type = ${STANDBY}
            AND qf.model_version = (SELECT model_version FROM active)
            AND (qf.target_ts AT TIME ZONE (SELECT timezone FROM park))::date
                BETWEEN ${input.startDate}::date AND ${input.endDate}::date
          GROUP BY d
        ),
        hist AS (
          SELECT (q.bucket AT TIME ZONE (SELECT timezone FROM park))::date AS d,
                 avg(q.avg_wait) AS day_avg
          FROM queue_15min q
          JOIN attractions a ON a.id = q.attraction_id
          WHERE a.park_id = (SELECT id FROM park)
            AND q.queue_type = ${STANDBY}
            AND q.avg_wait IS NOT NULL
            AND q.bucket >= now() - INTERVAL '90 days'
          GROUP BY d
        ),
        hist_n AS (SELECT count(*)::float AS n FROM hist)
        SELECT pred.d::text AS date,
               CASE WHEN (SELECT n FROM hist_n) = 0 OR pred.v IS NULL THEN NULL
                    ELSE (SELECT count(*)::float FROM hist WHERE day_avg <= pred.v)
                         / (SELECT n FROM hist_n)
               END AS percentile
        FROM pred
        ORDER BY pred.d
      `);

      const weatherP = db.execute<{
        date: string;
        high_c: number | null;
        precip_prob: number | null;
        condition: string | null;
      }>(sql`
        WITH park AS (SELECT id, timezone FROM parks WHERE slug = ${input.parkSlug}),
        hourly AS (
          SELECT
            (wo.observed_at AT TIME ZONE (SELECT timezone FROM park))::date AS d,
            wo.temp_c,
            wo.precip_prob,
            wo.condition,
            abs(extract(hour from wo.observed_at AT TIME ZONE (SELECT timezone FROM park)) - 13)
              AS noon_dist
          FROM weather_obs wo
          WHERE wo.park_id = (SELECT id FROM park)
            AND wo.kind = 'FORECAST'
            AND (wo.observed_at AT TIME ZONE (SELECT timezone FROM park))::date
                BETWEEN ${input.startDate}::date AND ${input.endDate}::date
        ),
        daily_max AS (
          SELECT d, max(temp_c) AS high_c, max(precip_prob) AS precip_prob
          FROM hourly GROUP BY d
        ),
        noon_cond AS (
          SELECT DISTINCT ON (d) d, condition
          FROM hourly ORDER BY d, noon_dist
        )
        SELECT dm.d::text AS date, dm.high_c, dm.precip_prob, nc.condition
        FROM daily_max dm
        LEFT JOIN noon_cond nc ON nc.d = dm.d
        ORDER BY dm.d
      `);

      const [crowd, weather] = await Promise.all([crowdP, weatherP]);

      const crowdByDate = new Map(crowd.rows.map((r) => [r.date, r.percentile]));
      const weatherByDate = new Map(
        weather.rows.map((r) => [
          r.date,
          {
            highF: r.high_c != null ? Math.round((r.high_c * 9) / 5 + 32) : null,
            precipProb: r.precip_prob,
            condition: r.condition,
          },
        ]),
      );

      // Union of all dates from either source — weather data shouldn't be
      // gated on the ML model having a forecast for that day.
      const allDates = [...new Set([...crowdByDate.keys(), ...weatherByDate.keys()])].sort();

      return {
        days: allDates.map((date) => {
          const pct = crowdByDate.get(date) ?? null;
          const crowdIndex =
            pct == null ? null : Math.max(1, Math.min(10, Math.round(1 + 9 * pct)));
          return {
            date,
            crowdIndex,
            weather: weatherByDate.get(date) ?? null,
          };
        }),
      };
    }),

  /**
   * Accuracy tiles for the active model, per rolling window. Numbers come from
   * `model_metrics` (recomputed by cron-eval). `ready` enforces the cold-start
   * gate: false ⇒ the window hasn't cleared the `ACCURACY_MIN_N` floor and the
   * page should hide its public tiles.
   */
  accuracy: publicProcedure.query(async () => {
    const result = await db.execute<{
      model_version: string;
      trained_at: string;
      status: string;
      metrics_json: string | null;
      window: string;
      mae: number | null;
      rmse: number | null;
      mape: number | null;
      r2: number | null;
      n_predictions: number | null;
      coverage_pct: number | null;
    }>(sql`
      WITH active AS (
        SELECT model_version, trained_at, status, metrics_json FROM model_run
        WHERE status = 'active' ORDER BY trained_at DESC LIMIT 1
      )
      SELECT a.model_version, a.trained_at, a.status, a.metrics_json,
             m.window, m.mae, m.rmse, m.mape, m.r2, m.n_predictions, m.coverage_pct
      FROM active a
      LEFT JOIN model_metrics m ON m.model_version = a.model_version
      ORDER BY m.window
    `);

    const head = result.rows[0];
    if (!head) return { model: null, windows: [] as Array<never> };

    // `cold_start` is written into metrics_json by train.py when < 50k training rows.
    let coldStart = false;
    try {
      const mj = head.metrics_json ? JSON.parse(head.metrics_json) : null;
      coldStart = mj?.cold_start === true;
    } catch {
      /* malformed json — treat as unknown */
    }

    const windows = result.rows
      .filter((r) => r.window != null)
      .map((r) => ({
        window: r.window,
        mae: r.mae,
        rmse: r.rmse,
        mape: r.mape,
        r2: r.r2,
        nPredictions: Number(r.n_predictions ?? 0),
        coveragePct: r.coverage_pct,
        ready: Number(r.n_predictions ?? 0) >= ACCURACY_MIN_N,
      }));

    return {
      model: {
        version: head.model_version,
        trainedAt: head.trained_at,
        status: head.status,
        coldStart,
      },
      windows,
    };
  }),
} satisfies TRPCRouterRecord;
