/**
 * Hourly-profile refresh (Railway cron, daily — "30 7 * * *").
 * Single-shot, keyless (needs only DATABASE_URL).
 *
 * Rebuilds `attraction_hour_profile`, the 30-day average standby per attraction
 * per park-local hour that the Waits board reads for "35 under its usual for
 * 3 PM" and the "Shortest later" column (docs/plans/waits-redesign §5.2, W5).
 *
 * It is one statement, but it earns its own service rather than a tail call on
 * `cron-eval`: that cron is the forecast backtest, and a failure there would
 * otherwise silently stale the board's headline panel with nothing in the logs
 * to connect the two.
 *
 * CONCURRENTLY, so the board keeps reading the previous generation for the
 * couple of seconds the rebuild takes instead of blocking on an
 * ACCESS EXCLUSIVE lock. That needs the view to have been populated at least
 * once — a never-refreshed matview can only be refreshed non-concurrently — so
 * the first run falls back automatically.
 *
 * Run:  bun run cron:profiles
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

// Imported after loadEnv so the module-level PostHog client sees POSTHOG_KEY.
import { flushTelemetry, reportServiceError } from "../shared/telemetry.ts";

import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";

/** Has the view ever been populated? CONCURRENTLY refuses it if not. */
async function isPopulated(): Promise<boolean> {
  const r = await db.execute<{ populated: boolean }>(
    sql`SELECT relispopulated AS populated FROM pg_class WHERE relname = 'attraction_hour_profile'`,
  );
  return r.rows[0]?.populated === true;
}

async function main() {
  const started = Date.now();
  const concurrent = await isPopulated();
  await db.execute(
    concurrent
      ? sql`REFRESH MATERIALIZED VIEW CONCURRENTLY attraction_hour_profile`
      : sql`REFRESH MATERIALIZED VIEW attraction_hour_profile`,
  );
  const counted = await db.execute<{ rows: number; rides: number }>(
    sql`SELECT count(*)::int AS rows, count(DISTINCT attraction_id)::int AS rides
        FROM attraction_hour_profile`,
  );
  const counts = counted.rows[0];
  console.log(
    `[cron-profiles] refreshed${concurrent ? " concurrently" : " (first run)"}: ` +
      `${counts?.rows ?? 0} hour rows across ${counts?.rides ?? 0} attractions ` +
      `in ${Date.now() - started}ms`,
  );
}

main()
  .catch((err) => {
    reportServiceError("cron-profiles", "main", err);
    process.exitCode = 1;
  })
  // Flush queued PostHog events BEFORE exiting — process.exit would drop them.
  .finally(async () => {
    await flushTelemetry();
    process.exit(process.exitCode ?? 0);
  });
