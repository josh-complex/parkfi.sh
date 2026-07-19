# Load — deferred followups (low urgency at current user count)

Split out of [`load-bottlenecks.md`](./load-bottlenecks.md). All plan code is shipped and
deployed (2026-07-19). These are safe to defer while the user base is small — the code
defaults already behave correctly; these steps only _realize_ extra headroom, quantify
it, or are one-off post-deploy checks. Revisit when concurrent usage climbs (busy in-park
days, a launch, or the first web replica).

## 0. Confirm `routing.route` edge-caches (one-off post-deploy check)

Phase 5 added `routing.route` to the CF-cached tRPC GETs — the first _variable-input_ GET
on that rule. Verify it actually HITs: open the map, tap Directions, copy the
`/api/trpc/routing.route?input=…` GET URL from DevTools → Network, then
`curl -sI '<url>'` **twice** — expect `cache-control: public, s-maxage=3600` and the 2nd
call `cf-cache-status: HIT`. If both show `BYPASS`/`DYNAMIC`, widen the Cloudflare tRPC
cache rule to cover `/api/trpc/*` GETs (keep the "only when origin sends cache-control"
condition). The board/overview/ticker/allRides paths were already verified HIT.

## 1. Set the Postgres connection budget (Phase 2a follow-through)

The explicit pg pool (`src/db/index.ts`) reads `PG_POOL_MAX` and defaults to `10` —
identical to node-postgres's old implicit ceiling, so nothing is set today and nothing
is broken. Setting these gives the web tier room to grow while keeping the worst-case
connection ceiling under Postgres's `max_connections`.

**Measured:** `SHOW max_connections;` → **100** (Railway, 2026-07-19).

Pools are **lazy**: `max` is a ceiling, not a reservation — connections open on demand.
That's why ~17 services each defaulting to 10 (170 ceiling) has never broken anything;
real concurrent use is dominated by web + worker + a couple always-on loops.

Budget target ≤ ~80 (80% of 100). Reserve ~10 for Timescale/Postgres background
workers and ~5 for psql/Studio/migrations → ~85 for app pools.

Set in Railway → each service → Variables:

| Service                             | `PG_POOL_MAX`      | Why                       |
| ----------------------------------- | ------------------ | ------------------------- |
| **web**                             | **25**             | Hot path; 1 replica today |
| **worker**                          | **5**              | Always-on, 60 s cadence   |
| **notifications**                   | **5**              | Always-on background loop |
| **dining-availability**             | **5**              | Always-on background loop |
| everything else (short-lived crons) | leave default (10) | Rarely concurrent         |

Realistic steady state ≈ web(25) + worker(5) + notifications(5) + dining(5) +
Timescale(10) + headroom(5) ≈ **55**, comfortably under 80. Each additional web replica
adds another 25 — redo this arithmetic before scaling past ~2 replicas.

**Verify** during a busy window or load test, on the Postgres:

```sql
SELECT count(*) FROM pg_stat_activity;
SELECT application_name, count(*) FROM pg_stat_activity GROUP BY 1 ORDER BY 2 DESC;
```

Total should sit well under 100 with no single service pinned at its ceiling (that
shows as pool-queue latency, not errors).

## 2. Before/after load number (Phase 6, optional)

Quantify the Phase 1 edge-cache win: autocannon/k6 against a board GET URL — against
the Cloudflare edge for the "after" number, and with `cache-control: no-cache` (or a
direct-origin URL) for "before". Record req/s at p99 < 500 ms. Not a gate for anything;
purely evidence.

## 3. `pg_stat_statements` (optional, ongoing visibility)

`CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` on the Railway Postgres for a
top-queries view. If the image doesn't preload it
(`ERROR: ... must be loaded via shared_preload_libraries`), skip — not worth a config
change at this scale.
