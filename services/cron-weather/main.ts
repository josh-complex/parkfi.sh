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

/** Minimal shape of the One Call 3.0 fields we read (metric units). */
interface OneCallBlock {
  dt: number;
  temp?: number;
  humidity?: number;
  wind_speed?: number;
  pop?: number;
  rain?: { "1h"?: number };
  weather?: Array<{ main?: string }>;
}
interface OneCallResponse {
  current?: OneCallBlock;
  hourly?: Array<OneCallBlock>;
}

type WeatherRow = typeof weatherObs.$inferInsert;

const MS_PER_HOUR = 3_600_000;
/** Floor a unix-seconds timestamp to the top of its hour (UTC). */
function hourBucket(dtSeconds: number): Date {
  return new Date(Math.floor((dtSeconds * 1000) / MS_PER_HOUR) * MS_PER_HOUR);
}

function row(parkId: number, kind: "FORECAST" | "ACTUAL", b: OneCallBlock): WeatherRow {
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

async function fetchOneCall(park: ParkLoc): Promise<OneCallResponse> {
  const url =
    `${config.openweatherBase}/onecall?lat=${park.lat}&lon=${park.lng}` +
    `&exclude=minutely,daily,alerts&units=metric&appid=${config.openweatherApiKey}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(config.fetchTimeoutMs),
    headers: { "user-agent": config.userAgent, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GET onecall ${park.slug} -> ${res.status}`);
  return (await res.json()) as OneCallResponse;
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
  const data = await fetchOneCall(park);
  const rows: Array<WeatherRow> = [];
  if (data.current) rows.push(row(park.id, "ACTUAL", data.current));
  for (const h of data.hourly ?? []) rows.push(row(park.id, "FORECAST", h));
  if (rows.length === 0) {
    console.warn(`[cron-weather] ${park.slug}: empty One Call response`);
    return;
  }
  await upsert(rows);
  console.log(
    `[cron-weather] ${park.slug}: ${data.hourly?.length ?? 0} forecast + ${data.current ? 1 : 0} actual`,
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
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
