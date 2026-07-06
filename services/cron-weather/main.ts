/**
 * Weather ingestion cron (Railway cron, every ~2h — e.g. "0 0,2,4,...").
 * Single-shot, per-park isolated (`runStep` — a failing park logs and is
 * skipped, never fails the run). A feature feed for wait-time forecasting:
 * weather is a first-order driver of park demand.
 *
 * One OpenWeather One Call 3.0 request per distinct active park lat/lng covers
 * BOTH sides we need in a single call:
 *   - `hourly[]` (next ~48h)  -> FORECAST rows (what we'll have at inference)
 *   - `current`               -> one ACTUAL row at the current hour (backtest)
 * Running every couple of hours, the ACTUAL rows densify into a real hourly
 * history without any timemachine calls. Train on FORECAST, evaluate against
 * ACTUAL — see weather_obs in src/db/schema.ts.
 *
 * Requires OPENWEATHER_API_KEY; unset ⇒ the run logs and exits cleanly (no
 * rows), mirroring the Browserless gate in services/geo.
 *
 * Run:  bun run cron:weather
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

// Imported after loadEnv so the module-level PostHog client sees POSTHOG_KEY.
import { flushTelemetry, reportServiceError } from "../shared/telemetry.ts";

import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { weatherObs } from "#/db/schema.ts";
import { Source } from "#/server/parks/codes.ts";
import { config } from "#/server/parks/config.ts";

interface ParkLoc {
  id: number;
  slug: string;
  lat: number;
  lng: number;
}

/** Active parks with geo populated (geo cron fills lat/lng). */
async function parksWithGeo(): Promise<Array<ParkLoc>> {
  const result = await db.execute<{
    id: string;
    slug: string;
    latitude: number;
    longitude: number;
  }>(sql`
    SELECT id, slug, latitude, longitude
    FROM parks
    WHERE active = true AND latitude IS NOT NULL AND longitude IS NOT NULL
    ORDER BY id
  `);
  return result.rows.map((r) => ({
    id: Number(r.id),
    slug: r.slug,
    lat: Number(r.latitude),
    lng: Number(r.longitude),
  }));
}

/** Minimal shape of the One Call 3.0 hourly/current fields we read (metric units). */
interface HourlyBlock {
  dt: number;
  temp?: number;
  humidity?: number;
  wind_speed?: number;
  pop?: number;
  rain?: { "1h"?: number };
  weather?: Array<{ main?: string }>;
}

/** One Call 3.0 daily block — temp is an object, rain is total mm for the day. */
interface DailyBlock {
  dt: number;
  temp?: { max?: number };
  humidity?: number;
  wind_speed?: number;
  pop?: number;
  rain?: number;
  weather?: Array<{ main?: string }>;
}

/**
 * /data/2.5/forecast/daily block — same shape as DailyBlock but wind field is
 * `speed` (m/s) not `wind_speed`, matching the older Forecast API convention.
 */
interface ForecastDailyBlock {
  dt: number;
  temp?: { max?: number };
  humidity?: number;
  speed?: number;
  pop?: number;
  rain?: number;
  weather?: Array<{ main?: string }>;
}
interface ForecastDailyResponse {
  list?: Array<ForecastDailyBlock>;
}

interface OneCallResponse {
  current?: HourlyBlock;
  hourly?: Array<HourlyBlock>;
  daily?: Array<DailyBlock>;
}

type WeatherRow = typeof weatherObs.$inferInsert;

const MS_PER_HOUR = 3_600_000;
/** Floor a unix-seconds timestamp to the top of its hour (UTC). */
function hourBucket(dtSeconds: number): Date {
  return new Date(Math.floor((dtSeconds * 1000) / MS_PER_HOUR) * MS_PER_HOUR);
}

/**
 * Pin a daily entry to 13:00 UTC on its calendar day so the calendar-overlay
 * query (`ORDER BY noon_dist`) always prefers a real hourly reading (days 1–2)
 * and falls back to the daily summary cleanly for days 3–8.
 */
function noonBucket(dtSeconds: number): Date {
  const d = new Date(dtSeconds * 1000);
  d.setUTCHours(13, 0, 0, 0);
  return d;
}

function hourlyRow(parkId: number, kind: "FORECAST" | "ACTUAL", b: HourlyBlock): WeatherRow {
  return {
    parkId,
    observedAt: hourBucket(b.dt),
    kind,
    tempC: b.temp ?? null,
    precipMm: b.rain?.["1h"] ?? 0,
    // pop is a forecast-only field; null it on actuals so the column stays honest
    precipProb: kind === "FORECAST" ? (b.pop ?? null) : null,
    windKph: b.wind_speed == null ? null : Math.round(b.wind_speed * 3.6 * 10) / 10,
    humidity: b.humidity ?? null,
    condition: b.weather?.[0]?.main ?? null,
    source: Source.OPENWEATHER,
  };
}

function dailyRow(parkId: number, b: DailyBlock): WeatherRow {
  return {
    parkId,
    observedAt: noonBucket(b.dt),
    kind: "FORECAST",
    tempC: b.temp?.max ?? null,
    precipMm: b.rain ?? 0,
    precipProb: b.pop ?? null,
    windKph: b.wind_speed == null ? null : Math.round(b.wind_speed * 3.6 * 10) / 10,
    humidity: b.humidity ?? null,
    condition: b.weather?.[0]?.main ?? null,
    source: Source.OPENWEATHER,
  };
}

function forecastDailyRow(parkId: number, b: ForecastDailyBlock): WeatherRow {
  return {
    parkId,
    observedAt: noonBucket(b.dt),
    kind: "FORECAST",
    tempC: b.temp?.max ?? null,
    precipMm: b.rain ?? 0,
    precipProb: b.pop ?? null,
    windKph: b.speed == null ? null : Math.round(b.speed * 3.6 * 10) / 10,
    humidity: b.humidity ?? null,
    condition: b.weather?.[0]?.main ?? null,
    source: Source.OPENWEATHER,
  };
}

async function fetchOneCall(park: ParkLoc): Promise<OneCallResponse> {
  const url =
    `${config.openweatherBase}/onecall?lat=${park.lat}&lon=${park.lng}` +
    `&exclude=minutely,alerts&units=metric&appid=${config.openweatherApiKey}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(config.fetchTimeoutMs),
    headers: { "user-agent": config.userAgent, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GET onecall ${park.slug} -> ${res.status}`);
  return (await res.json()) as OneCallResponse;
}

/** 16-day daily forecast from the standard Forecast API (days 9–16 extend One Call). */
async function fetchDailyForecast(park: ParkLoc): Promise<ForecastDailyResponse> {
  const base = config.openweatherBase.replace("/data/3.0", "/data/2.5");
  const url =
    `${base}/forecast/daily?lat=${park.lat}&lon=${park.lng}` +
    `&cnt=16&units=metric&appid=${config.openweatherApiKey}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(config.fetchTimeoutMs),
    headers: { "user-agent": config.userAgent, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GET forecast/daily ${park.slug} -> ${res.status}`);
  return (await res.json()) as ForecastDailyResponse;
}

/** Upsert: latest forecast wins; the newest reading wins for an actual hour. */
async function upsert(rows: Array<WeatherRow>): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(weatherObs)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [weatherObs.parkId, weatherObs.kind, weatherObs.observedAt],
        set: {
          tempC: sql`excluded.temp_c`,
          precipMm: sql`excluded.precip_mm`,
          precipProb: sql`excluded.precip_prob`,
          windKph: sql`excluded.wind_kph`,
          humidity: sql`excluded.humidity`,
          condition: sql`excluded.condition`,
          source: sql`excluded.source`,
        },
      });
  }
}

async function runStep(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[cron-weather] ${label} failed:`, err instanceof Error ? err.message : err);
  }
}

async function ingestPark(park: ParkLoc): Promise<void> {
  // Fetch both APIs concurrently; 16-day failure is non-fatal (plan gate).
  const [data, extended] = await Promise.all([
    fetchOneCall(park),
    fetchDailyForecast(park).catch((err: unknown) => {
      console.warn(
        `[cron-weather] ${park.slug} forecast/daily skipped:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }),
  ]);

  // Hourly rows (current + forecast) — upsert first so hourly data wins
  // over the daily summary for overlapping noon timestamps.
  const hourlyRows: Array<WeatherRow> = [];
  if (data.current) hourlyRows.push(hourlyRow(park.id, "ACTUAL", data.current));
  for (const h of data.hourly ?? []) hourlyRows.push(hourlyRow(park.id, "FORECAST", h));

  // One Call daily rows (days 1–8) — separate batch to avoid same-PK collisions
  // with hourly rows at 13:00 UTC within a single INSERT.
  const oneCallDailyRows = (data.daily ?? []).map((d) => dailyRow(park.id, d));

  // 16-day forecast rows (days 1–16); days 1–8 overlap with One Call daily and
  // will simply overwrite via onConflictDoUpdate — that's fine.
  const extendedRows = (extended?.list ?? []).map((d) => forecastDailyRow(park.id, d));

  if (hourlyRows.length === 0 && oneCallDailyRows.length === 0 && extendedRows.length === 0) {
    console.warn(`[cron-weather] ${park.slug}: empty One Call response`);
    return;
  }
  if (hourlyRows.length > 0) await upsert(hourlyRows);
  if (oneCallDailyRows.length > 0) await upsert(oneCallDailyRows);
  if (extendedRows.length > 0) await upsert(extendedRows);
  console.log(
    `[cron-weather] ${park.slug}: ${data.hourly?.length ?? 0} hourly + ${data.daily?.length ?? 0} daily + ${extendedRows.length} extended + ${data.current ? 1 : 0} actual`,
  );
}

async function main() {
  if (!config.openweatherApiKey) {
    console.warn("[cron-weather] OPENWEATHER_API_KEY unset — skipping weather ingest");
    return;
  }
  const parks = await parksWithGeo();
  if (parks.length === 0) {
    console.warn("[cron-weather] no active parks with geo — run db:seed + cron:geo first");
    return;
  }
  for (const park of parks) {
    await runStep(park.slug, () => ingestPark(park));
  }
  console.log(`[cron-weather] done — ${parks.length} parks`);
}

main()
  .catch((err) => {
    reportServiceError("cron-weather", "main", err);
    process.exitCode = 1;
  })
  // Flush queued PostHog events BEFORE exiting — process.exit would drop them.
  .finally(async () => {
    await flushTelemetry();
    process.exit(process.exitCode ?? 0);
  });
