/**
 * Shared crowd-calendar logic — the single source of truth for the per-date
 * crowd index a park shows. Both the tRPC `forecast.parkCalendar` procedure and
 * the R2 edge-publish cron call `loadParkCalendar`, so the JSON served from the
 * edge can never drift from what the site renders.
 */
import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";

const STANDBY = 1;

// Day-of-week base scores (0=Sun … 6=Sat). Parks are busiest on weekends and
// lightest mid-week; school-break/holiday boosts push into the busy range.
const DOW_BASE = [5, 3, 3, 3, 3, 4, 6] as const;

/**
 * Rules-based crowd index (1–10) for dates beyond the ML model's horizon.
 * Uses day-of-week, federal holidays, and school-break labels from calendarDay.
 * `calendar_day` is sparse (holidays/breaks only), so a missing row just means
 * an ordinary day — score it on day-of-week alone rather than returning null,
 * so every date in a range gets at least an estimate.
 */
export function heuristicCrowdIndex(
  date: string,
  cal?: { isFedHoliday: boolean; isSchoolBreak: boolean; breakLabel: string | null },
): number {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  let score = DOW_BASE[dow];
  if (cal?.isFedHoliday) score += 2;
  if (cal?.isSchoolBreak) {
    const label = cal.breakLabel?.toLowerCase() ?? "";
    if (label.includes("summer")) score += 4;
    else if (label.includes("winter") || label.includes("christmas")) score += 3;
    else if (label.includes("spring") || label.includes("thanksgiving")) score += 3;
    else score += 2;
  }
  return Math.max(1, Math.min(10, score));
}

export interface CalendarDay {
  date: string;
  crowdIndex: number | null;
  crowdIsEstimate: boolean;
  weather: { highF: number | null; precipProb: number | null; condition: string | null } | null;
}

export interface ParkCalendar {
  days: Array<CalendarDay>;
}

// Upper bound on generated calendar days per request — the UI asks for
// -90..+150; this only guards the public procedure against absurd ranges.
const MAX_RANGE_DAYS = 400;

/**
 * Per-date crowd index + daily weather summary for a park over a date range.
 * Past dates score the *actual* daily-average standby wait; today/future use
 * the ML prediction — both percentile-ranked against the park's own
 * last-90-days distribution and mapped to 1–10. Actual/historical daily
 * averages count only buckets inside the day's regular OPERATING window. Dates with neither (beyond the
 * model's horizon, or past days with no wait data) fall back to the
 * day-of-week/holiday heuristic, flagged via `crowdIsEstimate`.
 */
export async function loadParkCalendar(
  parkSlug: string,
  startDate: string,
  endDate: string,
): Promise<ParkCalendar> {
  const crowdP = db.execute<{
    date: string;
    pred_percentile: number | null;
    actual_percentile: number | null;
  }>(sql`
    WITH park AS (SELECT id, timezone FROM parks WHERE slug = ${parkSlug}),
    active AS (
      SELECT model_version FROM model_run WHERE status = 'active'
      ORDER BY trained_at DESC LIMIT 1
    ),
    -- Only attractions that actually report standby waits: Universal lists
    -- "Single Rider" queues + character meets as their own active ATTRACTION
    -- rows with no queue_15min data, and their low forecasts diluted the
    -- predicted park average vs a history built from reporting rides only.
    reporting AS (
      SELECT q.attraction_id
      FROM queue_15min q
      JOIN attractions ra ON ra.id = q.attraction_id
      WHERE ra.park_id = (SELECT id FROM park)
        AND q.queue_type = ${STANDBY}
        AND q.avg_wait IS NOT NULL
        AND q.bucket >= now() - INTERVAL '90 days'
      GROUP BY 1
      -- >= 100 buckets (~25h reporting) in 90 days: phantom entities emit a
      -- couple dozen stray 0-wait buckets, so a bare EXISTS would re-admit them.
      HAVING count(*) >= 100
    ),
    -- Recent long-horizon model bias (actual − predicted, matched backtest
    -- rows, ≥100 pairs else 0) — re-centers the predicted average before
    -- percentile-ranking so systematic bias can't pin the index at 1 or 10.
    bias AS (
      SELECT CASE WHEN count(*) >= 100
                  THEN avg(fe.actual_wait - fe.predicted_wait) ELSE 0 END AS b
      FROM forecast_eval fe
      JOIN attractions ba ON ba.id = fe.attraction_id
      WHERE ba.park_id = (SELECT id FROM park)
        AND fe.queue_type = ${STANDBY}
        AND fe.horizon_min > 180
        AND fe.actual_wait IS NOT NULL
        AND fe.target_ts >= now() - INTERVAL '14 days'
    ),
    pred AS (
      SELECT (qf.target_ts AT TIME ZONE (SELECT timezone FROM park))::date AS d,
             avg(qf.predicted_wait) + (SELECT b FROM bias) AS v
      FROM queue_forecast qf
      JOIN attractions a ON a.id = qf.attraction_id
      JOIN reporting rp ON rp.attraction_id = qf.attraction_id
      WHERE a.park_id = (SELECT id FROM park)
        AND qf.queue_type = ${STANDBY}
        AND qf.model_version = (SELECT model_version FROM active)
        AND (qf.target_ts AT TIME ZONE (SELECT timezone FROM park))::date
            BETWEEN ${startDate}::date AND ${endDate}::date
      GROUP BY d
    ),
    -- Regular OPERATING window per service date (latest snapshot). Daily
    -- averages clip to it so early entry, dead post-close buckets, and
    -- near-empty ticketed-event evenings (e.g. Halloween-party nights that
    -- close to day guests at 6p) don't drag a day's average.
    op_latest AS (
      SELECT s.service_date, max(s.snapshot_date) AS snap
      FROM park_schedule s
      WHERE s.park_id = (SELECT id FROM park) AND s.type = 'OPERATING'
      GROUP BY s.service_date
    ),
    op AS (
      SELECT s.service_date AS d, min(s.opening_time) AS o, max(s.closing_time) AS c
      FROM park_schedule s
      JOIN op_latest ol ON ol.service_date = s.service_date AND ol.snap = s.snapshot_date
      WHERE s.park_id = (SELECT id FROM park) AND s.type = 'OPERATING'
      GROUP BY s.service_date
    ),
    hist AS (
      SELECT (q.bucket AT TIME ZONE (SELECT timezone FROM park))::date AS d,
             avg(q.avg_wait) AS day_avg
      FROM queue_15min q
      JOIN attractions a ON a.id = q.attraction_id
      LEFT JOIN op ON op.d = (q.bucket AT TIME ZONE (SELECT timezone FROM park))::date
      WHERE a.park_id = (SELECT id FROM park)
        AND q.queue_type = ${STANDBY}
        AND q.avg_wait IS NOT NULL
        AND q.bucket >= now() - INTERVAL '90 days'
        -- No schedule row (older/missing dates) -> keep the whole day.
        AND (op.d IS NULL OR (q.bucket >= op.o AND (op.c IS NULL OR q.bucket < op.c)))
      GROUP BY 1
    ),
    hist_n AS (SELECT count(*)::float AS n FROM hist),
    actual AS (
      SELECT (q.bucket AT TIME ZONE (SELECT timezone FROM park))::date AS d,
             avg(q.avg_wait) AS v
      FROM queue_15min q
      JOIN attractions a ON a.id = q.attraction_id
      LEFT JOIN op ON op.d = (q.bucket AT TIME ZONE (SELECT timezone FROM park))::date
      WHERE a.park_id = (SELECT id FROM park)
        AND q.queue_type = ${STANDBY}
        AND q.avg_wait IS NOT NULL
        AND q.bucket >= ${startDate}::date::timestamptz - INTERVAL '1 day'
        AND q.bucket < ${endDate}::date::timestamptz + INTERVAL '2 days'
        AND (q.bucket AT TIME ZONE (SELECT timezone FROM park))::date
            BETWEEN ${startDate}::date AND ${endDate}::date
        AND (q.bucket AT TIME ZONE (SELECT timezone FROM park))::date
            < (now() AT TIME ZONE (SELECT timezone FROM park))::date
        AND (op.d IS NULL OR (q.bucket >= op.o AND (op.c IS NULL OR q.bucket < op.c)))
      GROUP BY 1
    )
    SELECT COALESCE(pred.d, act.d)::text AS date,
           CASE WHEN (SELECT n FROM hist_n) = 0 OR pred.v IS NULL THEN NULL
                ELSE (SELECT count(*)::float FROM hist WHERE day_avg <= pred.v)
                     / (SELECT n FROM hist_n)
           END AS pred_percentile,
           CASE WHEN (SELECT n FROM hist_n) = 0 OR act.v IS NULL THEN NULL
                ELSE (SELECT count(*)::float FROM hist WHERE day_avg <= act.v)
                     / (SELECT n FROM hist_n)
           END AS actual_percentile
    FROM pred
    FULL OUTER JOIN actual act ON act.d = pred.d
    ORDER BY 1
  `);

  const weatherP = db.execute<{
    date: string;
    high_c: number | null;
    precip_prob: number | null;
    condition: string | null;
  }>(sql`
    WITH park AS (SELECT id, timezone FROM parks WHERE slug = ${parkSlug}),
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
        AND wo.kind IN ('FORECAST', 'ACTUAL')
        AND (wo.observed_at AT TIME ZONE (SELECT timezone FROM park))::date
            BETWEEN ${startDate}::date AND ${endDate}::date
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

  const calendarP = db.execute<{
    date: string;
    is_federal_holiday: boolean;
    is_school_break: boolean;
    break_label: string | null;
  }>(sql`
    SELECT cd.date::text, cd.is_us_federal_holiday AS is_federal_holiday,
           cd.is_school_break, cd.break_label
    FROM calendar_day cd
    JOIN park_calendar_map pcm ON pcm.region = cd.region
    JOIN parks p ON p.id = pcm.park_id
    WHERE p.slug = ${parkSlug}
      AND cd.date BETWEEN ${startDate}::date AND ${endDate}::date
    ORDER BY cd.date
  `);

  const [crowd, weather, calendar] = await Promise.all([crowdP, weatherP, calendarP]);

  const crowdByDate = new Map(
    crowd.rows.map((r) => [r.date, { pred: r.pred_percentile, actual: r.actual_percentile }]),
  );
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
  const calByDate = new Map(
    calendar.rows.map((r) => [
      r.date,
      {
        isFedHoliday: r.is_federal_holiday,
        isSchoolBreak: r.is_school_break,
        breakLabel: r.break_label,
      },
    ]),
  );

  // Every date in the requested range gets a day — the heuristic covers dates
  // no data source mentions, so the calendar has no unexplained holes.
  const allDates: Array<string> = [];
  const from = Date.parse(`${startDate}T00:00:00Z`);
  const to = Date.parse(`${endDate}T00:00:00Z`);
  for (let t = from; t <= to && allDates.length < MAX_RANGE_DAYS; t += 86_400_000) {
    allDates.push(new Date(t).toISOString().slice(0, 10));
  }

  const toIndex = (pct: number | null | undefined): number | null =>
    pct == null ? null : Math.max(1, Math.min(10, Math.round(1 + 9 * pct)));

  return {
    days: allDates.map((date) => {
      const pcts = crowdByDate.get(date);
      const actualIndex = toIndex(pcts?.actual);
      const mlCrowdIndex = toIndex(pcts?.pred);
      const cal = calByDate.get(date);
      const heuristic = heuristicCrowdIndex(date, cal);
      let crowdIndex: number;
      let crowdIsEstimate = false;
      if (actualIndex != null) {
        // Past date with observed waits — ground truth, no floor.
        crowdIndex = actualIndex;
      } else if (mlCrowdIndex != null) {
        // On holidays/breaks the heuristic acts as a floor: prevents
        // partially-elapsed days from showing an artificially low ML score.
        // Ordinary days trust the model outright.
        crowdIndex = cal ? Math.max(mlCrowdIndex, heuristic) : mlCrowdIndex;
      } else {
        crowdIndex = heuristic;
        crowdIsEstimate = true;
      }
      return {
        date,
        crowdIndex,
        crowdIsEstimate,
        weather: weatherByDate.get(date) ?? null,
      };
    }),
  };
}
