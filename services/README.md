# Railway-side services

Standalone Node services that run _alongside_ the TanStack Start app. They share
all domain code with the app via the `#/*` subpath alias (`#/server/parks/*`,
`#/db/*`), so there's no duplicated logic and one schema/normalizer to maintain.

Builder: **Railpack** (`railpack.json` at the repo root). It auto-detects bun
from `bun.lock`, so bun is available at build and runtime for every service.

Deploy each as its own Railway service pointed at this same repo, with a distinct
**start command** (set the root in Railway → "Custom Start Command"):

| Service        | Start command          | Railway type        | Notes                                            |
| -------------- | ---------------------- | ------------------- | ------------------------------------------------ |
| `worker`       | `bun run worker`       | long-running, 1 rep | self-scheduling 60s poller; `/health` on `$PORT` |
| `cron-tickets` | `bun run cron:tickets` | Cron `0 8 * * *`    | single-shot, exits                               |

The web app (`bun run start`) is a third service with a public domain. DB/Redis
ride the Railway private network — only the app gets a public URL.

## Environment

All services need `DATABASE_URL` (Timescale-enabled Postgres). Optional knobs
(`src/server/parks/config.ts`): `POLL_INTERVAL_MS` (default 60000),
`POLL_CONCURRENCY` (4), `FETCH_TIMEOUT_MS` (9000), `THEMEPARKS_MAX_PER_MIN` (280),
`INGEST_USER_AGENT`, `TICKET_WINDOW_DAYS` (60).

## One-time bootstrap (in order)

```bash
bun run db:migrate   # tables + transaction-safe Timescale DDL (hypertables,
                     # compression, retention, index) — drizzle/ migrations
bun run db:cagg      # queue_hourly continuous aggregate + refresh policy
                     # (can't run in a migration's transaction; see cagg.sql)
bun run db:seed      # reference data + WDW & Universal Orlando parks
```

Use `db:migrate`, NOT `db:push` — push diffs the schema and never runs the
custom migration that carries the Timescale DDL. `db:cagg` is the only piece
outside migrations (a continuous aggregate can't be created in a transaction
block). `parks.history` is the only app code that needs `queue_hourly`;
everything else runs on plain tables.

Attractions self-populate on first ingest (auto-discovered from `/live` and
mapped through `external_ids`), so only parks need seeding.

## Scale path (not built yet)

The worker schedules itself in-process and uses an in-memory rate-limit bucket —
correct for a single replica. To scale out: introduce Redis + BullMQ, move the
token bucket to a Redis Lua `INCR`/`PEXPIRE` bucket, split `scheduler`
(repeatable jobs, replica=1, leader-leased) from `worker` (queue consumers,
replica=N), and add a circuit breaker (opossum) around each upstream. The
`ingestPark()` core stays unchanged — only what _drives_ it changes.

Additional cron services to add later (same pattern as `cron-tickets`):
`cron-rollups` (refresh `queue_hourly`), `cron-retention` (verify policies),
`cron-health` (per-source freshness audit).
