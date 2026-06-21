import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { ALL_PARKS, type ParkEntry } from "#/lib/parks.ts";
import { heuristicCrowdIndex, loadParkCalendar } from "#/server/forecast/parkCalendar.ts";
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

      const calP = db.execute<{
        is_federal_holiday: boolean;
        is_school_break: boolean;
        break_label: string | null;
      }>(sql`
        SELECT cd.is_us_federal_holiday AS is_federal_holiday,
               cd.is_school_break, cd.break_label
        FROM calendar_day cd
        JOIN park_calendar_map pcm ON pcm.region = cd.region
        JOIN parks p ON p.id = pcm.park_id
        WHERE p.slug = ${input.parkSlug}
          AND cd.date = ${input.date}::date
        LIMIT 1
      `);

      const [pts, crowd, cal] = await Promise.all([ptsP, crowdP, calP]);
      const c = crowd.rows[0];
      const percentile = c?.percentile ?? null;
      const mlCrowdIndex =
        percentile == null ? null : Math.max(1, Math.min(10, Math.round(1 + 9 * percentile)));
      const calRow = cal.rows[0];
      const heuristic = heuristicCrowdIndex(
        input.date,
        calRow
          ? {
              isFedHoliday: calRow.is_federal_holiday,
              isSchoolBreak: calRow.is_school_break,
              breakLabel: calRow.break_label,
            }
          : undefined,
      );
      const crowdIndex =
        mlCrowdIndex == null
          ? heuristic
          : heuristic == null
            ? mlCrowdIndex
            : Math.max(mlCrowdIndex, heuristic);

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
    .query(({ input }) => loadParkCalendar(input.parkSlug, input.startDate, input.endDate)),

  /**
   * The park with the highest crowd index on a given date (default: today, ET).
   * Scores every park through `loadParkCalendar` — the same source of truth the
   * calendar overlay uses — so the picker's default can never drift from the
   * crowd numbers shown on the page. Used to preselect the pricing-bar park.
   */
  busiestPark: publicProcedure
    .input(
      z
        .object({
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const date =
        input?.date ??
        new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
      const candidates = ALL_PARKS.filter((p) => p.slug);
      const scored = await Promise.all(
        candidates.map(async (p) => {
          const cal = await loadParkCalendar(p.slug as string, date, date);
          return { park: p, crowdIndex: cal.days.find((d) => d.date === date)?.crowdIndex ?? null };
        }),
      );
      // Highest crowd index wins; ties resolve to listing order (WDW first).
      let best: { park: ParkEntry; crowdIndex: number } | null = null;
      for (const s of scored) {
        if (s.crowdIndex == null) continue;
        if (!best || s.crowdIndex > best.crowdIndex)
          best = { park: s.park, crowdIndex: s.crowdIndex };
      }
      const chosen = best?.park ?? candidates[0] ?? null;
      if (!chosen) return null;
      return {
        date,
        resort: chosen.resort,
        code: chosen.code,
        slug: chosen.slug,
        crowdIndex: best?.crowdIndex ?? null,
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
