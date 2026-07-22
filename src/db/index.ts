import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.ts";

// Worker/seed/cron entrypoints load dotenv themselves, but the web server
// (nitro/vite dev) does not — so without this the tRPC API has no DATABASE_URL
// and node-postgres silently falls back to localhost defaults. No-op in prod,
// where the platform injects env and the .env files are absent.
if (!process.env.DATABASE_URL) loadEnv({ path: [".env.local", ".env"] });

// Explicit pool so the connection budget is a tunable, not node-postgres's
// implicit `max: 10`. Every service (~17 of them) holds its own pool against the
// shared instance, so the sum matters against `max_connections`; the chatty web
// tier gets a larger budget via `PG_POOL_MAX` while cron/one-off services stay
// on the modest default. Behaviourally identical to before when the env var is
// unset (still 10). See docs/plans/load-bottlenecks.md manual step 2 for the
// sizing arithmetic.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
  max: Number(process.env.PG_POOL_MAX ?? 10),
  // Long single-shot crons (e.g. dining:facilities) leave a checked-out client
  // idle across slow serial HTTP fetches; without TCP keepalive the server/
  // pooler silently reaps that socket and the next query throws "Connection
  // terminated unexpectedly". Keepalive probes hold the socket open.
  keepAlive: true,
});

// A dead IDLE client emits 'error' on the pool, not on any awaited query. With
// no listener node-postgres rethrows it at the process level and takes the whole
// service down; swallowing it lets the pool discard the client and hand out a
// fresh one on the next acquire. (Errors on an in-flight query still surface to
// that query's await — see the caller-side retry in the dining cron.)
pool.on("error", (err) => {
  console.error("[db] idle client error (discarded):", err.message);
});

export const db = drizzle({ client: pool, schema });
