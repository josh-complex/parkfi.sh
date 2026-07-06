/**
 * Calendar ingestion cron (Railway cron, e.g. "0 6 * * 1" — weekly Monday).
 * Single-shot, keyless (needs only DATABASE_URL). A feature feed for wait-time
 * forecasting: holidays and school breaks shift park demand hard.
 *
 * Two sources, region 'US':
 *   - US federal holidays  -> Nager.Date (date.nager.at), authoritative + free.
 *   - School breaks        -> a COARSE national heuristic (summer/winter/spring/
 *     Thanksgiving windows). Real per-district calendars need a richer source;
 *     this is the honest v1 placeholder the plan calls out as initially weak.
 *
 * Seeds `calendarYearsBack`..`calendarYearsAhead` around the current year (back
 * gives history for backtesting). Also ensures every active park has a
 * `park_calendar_map` row (defaulting to 'US') so the feature join resolves.
 *
 * Run:  bun run cron:calendar
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

// Imported after loadEnv so the module-level PostHog client sees POSTHOG_KEY.
import { flushTelemetry, reportServiceError } from "../shared/telemetry.ts";

import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { calendarDay, parkCalendarMap } from "#/db/schema.ts";
import { config } from "#/server/parks/config.ts";

const DEFAULT_REGION = "US";

type CalRow = typeof calendarDay.$inferInsert;

interface NagerHoliday {
  date: string; // YYYY-MM-DD
  localName: string;
  name: string;
}

/** Inclusive list of ISO dates spanning a window within a single year. */
function datesInWindow(
  year: number,
  start: [number, number],
  end: [number, number],
): Array<string> {
  const out: Array<string> = [];
  const from = Date.UTC(year, start[0] - 1, start[1]);
  const to = Date.UTC(year, end[0] - 1, end[1]);
  for (let t = from; t <= to; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Coarse national school-break windows for a year. Heuristic, NOT authoritative
 * — labeled as such in `break_label`. Tune or replace with a real source later.
 */
function schoolBreaks(year: number): Array<{ date: string; label: string }> {
  const windows: Array<{ label: string; dates: Array<string> }> = [
    { label: "Summer break", dates: datesInWindow(year, [6, 10], [8, 15]) },
    {
      label: "Winter break",
      dates: [...datesInWindow(year, [12, 21], [12, 31]), ...datesInWindow(year, [1, 1], [1, 3])],
    },
    { label: "Spring break", dates: datesInWindow(year, [3, 11], [3, 18]) },
    { label: "Thanksgiving break", dates: datesInWindow(year, [11, 22], [11, 28]) },
  ];
  return windows.flatMap((w) => w.dates.map((date) => ({ date, label: w.label })));
}

async function fetchHolidays(year: number): Promise<Array<NagerHoliday>> {
  const url = `${config.nagerBase}/PublicHolidays/${year}/US`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(config.fetchTimeoutMs),
    headers: { "user-agent": config.userAgent, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return (await res.json()) as Array<NagerHoliday>;
}

/** Merge holidays + breaks for a year into one row per date (region 'US'). */
async function buildYear(year: number): Promise<Array<CalRow>> {
  const byDate = new Map<string, CalRow>();
  const get = (date: string): CalRow => {
    let r = byDate.get(date);
    if (!r) {
      r = {
        region: DEFAULT_REGION,
        date,
        isUsFederalHoliday: false,
        isSchoolBreak: false,
        breakLabel: null,
      };
      byDate.set(date, r);
    }
    return r;
  };

  for (const h of await fetchHolidays(year)) {
    const r = get(h.date);
    r.isUsFederalHoliday = true;
    r.breakLabel = r.breakLabel ?? h.localName;
  }
  for (const b of schoolBreaks(year)) {
    const r = get(b.date);
    r.isSchoolBreak = true;
    // a holiday name (set above) is more specific; only label if still empty
    r.breakLabel = r.breakLabel ?? b.label;
  }
  return [...byDate.values()];
}

async function upsertCalendar(rows: Array<CalRow>): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(calendarDay)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [calendarDay.region, calendarDay.date],
        set: {
          isUsFederalHoliday: sql`excluded.is_us_federal_holiday`,
          isSchoolBreak: sql`excluded.is_school_break`,
          breakLabel: sql`excluded.break_label`,
        },
      });
  }
}

/** Map every active park to a region (default 'US') if it has none yet. */
async function ensureParkMap(): Promise<void> {
  await db.execute(sql`
    INSERT INTO park_calendar_map (park_id, region)
    SELECT id, ${DEFAULT_REGION} FROM parks WHERE active = true
    ON CONFLICT (park_id) DO NOTHING
  `);
  const regions = await db.selectDistinct({ region: parkCalendarMap.region }).from(parkCalendarMap);
  const unsupported = regions.map((r) => r.region).filter((r) => r !== DEFAULT_REGION);
  if (unsupported.length > 0) {
    console.warn(
      `[cron-calendar] no data source for regions ${unsupported.join(", ")} — only '${DEFAULT_REGION}' is populated`,
    );
  }
}

async function main() {
  await ensureParkMap();

  const thisYear = new Date().getUTCFullYear();
  const from = thisYear - config.calendarYearsBack;
  const to = thisYear + config.calendarYearsAhead;
  let total = 0;
  for (let year = from; year <= to; year++) {
    try {
      const rows = await buildYear(year);
      await upsertCalendar(rows);
      total += rows.length;
      console.log(`[cron-calendar] ${year}: ${rows.length} dated rows (region ${DEFAULT_REGION})`);
    } catch (err) {
      console.error(`[cron-calendar] ${year} failed:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`[cron-calendar] done — ${total} rows across ${from}..${to}`);
}

main()
  .catch((err) => {
    reportServiceError("cron-calendar", "main", err);
    process.exitCode = 1;
  })
  // Flush queued PostHog events BEFORE exiting — process.exit would drop them.
  .finally(async () => {
    await flushTelemetry();
    process.exit(process.exitCode ?? 0);
  });
