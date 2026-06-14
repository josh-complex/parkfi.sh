/**
 * Forecast → R2 edge publish (Railway cron, e.g. "*&#47;15 * * * *", shortly after
 * ml-infer).
 *
 * Serializes each active park's crowd calendar (next N days) and writes it to
 * R2 at `forecast/<slug>.json`. Cloudflare serves that object straight from the
 * edge (public R2 custom domain), so the predictions/park read path can fetch a
 * static JSON instead of recomputing the percentile query in Postgres on every
 * request. Uses the exact same `loadParkCalendar` the tRPC API uses, so the
 * edge JSON can never drift from what the site renders.
 *
 * No-ops cleanly when R2 isn't configured, so it's safe to deploy before the
 * bucket/credentials exist.
 *
 * Run:  bun run forecast:publish
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { isR2Configured, putJson } from "#/server/edge/r2.ts";
import { loadParkCalendar } from "#/server/forecast/parkCalendar.ts";

const DAYS = Number(process.env.FORECAST_PUBLISH_DAYS ?? 60);

/** Park-local YYYY-MM-DD `offset` days from now (Intl avoids a TZ lib). */
function localDate(timezone: string, offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

async function activeParks(): Promise<Array<{ slug: string; timezone: string }>> {
  const result = await db.execute<{ slug: string; timezone: string }>(
    sql`SELECT slug, timezone FROM parks WHERE active = true ORDER BY slug`,
  );
  return result.rows;
}

async function publishPark(park: { slug: string; timezone: string }): Promise<boolean> {
  const start = localDate(park.timezone, 0);
  const end = localDate(park.timezone, DAYS);
  const calendar = await loadParkCalendar(park.slug, start, end);
  const payload = {
    parkSlug: park.slug,
    // Caller stamps generation time; scripts can't call Date.now() in workflows,
    // but this is a plain service so a fresh ISO string is fine here.
    generatedAt: new Date().toISOString(),
    range: { start, end },
    ...calendar,
  };
  return putJson(`forecast/${park.slug}.json`, payload);
}

async function main() {
  if (!isR2Configured()) {
    console.warn("[forecast-publish] R2_* env unset — skipping edge publish");
    return;
  }
  const parks = await activeParks();
  if (parks.length === 0) {
    console.warn("[forecast-publish] no active parks — run db:seed first");
    return;
  }
  let ok = 0;
  for (const park of parks) {
    try {
      if (await publishPark(park)) ok++;
      else console.error(`[forecast-publish] ${park.slug}: put failed`);
    } catch (err) {
      console.error(`[forecast-publish] ${park.slug} failed`, err);
    }
  }
  console.log(`[forecast-publish] done — ${ok}/${parks.length} parks published (${DAYS}d)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
