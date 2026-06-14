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
 * Returns null when no calendar row exists for the date.
 */
export function heuristicCrowdIndex(
  date: string,
  cal: { isFedHoliday: boolean; isSchoolBreak: boolean; breakLabel: string | null } | undefined,
): number | null {
  if (!cal) return null;
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  let score = DOW_BASE[dow];
  if (cal.isFedHoliday) score += 2;
  if (cal.isSchoolBreak) {
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

/**
 * Per-date crowd index + daily weather summary for a park over a date range.
 * Crowd index = the predicted daily-average standby wait percentile-ranked
 * against the park's own last-90-days distribution, mapped to 1–10, with the
 * day-of-week/holiday heuristic acting as a floor.
 */
export async function loadParkCalendar(
  parkSlug: string,
  startDate: string,
  endDate: string,
): Promise<ParkCalendar> {
  const crowdP = db.execute<{ date: string; percentile: number | null }>(sql`
    WITH park AS (SELECT id, timezone FROM parks WHERE slug = ${parkSlug}),
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
            BETWEEN ${startDate}::date AND ${endDate}::date
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

  // Union of all dates from any source.
  const allDates = [
    ...new Set([...crowdByDate.keys(), ...weatherByDate.keys(), ...calByDate.keys()]),
  ].sort();

  return {
    days: allDates.map((date) => {
      const pct = crowdByDate.get(date) ?? null;
      const mlCrowdIndex = pct == null ? null : Math.max(1, Math.min(10, Math.round(1 + 9 * pct)));
      const heuristic = heuristicCrowdIndex(date, calByDate.get(date));
      // Heuristic acts as a floor: prevents partially-elapsed days from showing
      // an artificially low ML score.
      const crowdIndex =
        mlCrowdIndex == null
          ? heuristic
          : heuristic == null
            ? mlCrowdIndex
            : Math.max(mlCrowdIndex, heuristic);
      return {
        date,
        crowdIndex,
        crowdIsEstimate: mlCrowdIndex == null && crowdIndex != null,
        weather: weatherByDate.get(date) ?? null,
      };
    }),
  };
}
