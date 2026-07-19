# Load bottlenecks — edge-cache the live read path, then shrink the queries behind it

> **Status (2026-07-19): all plan code is shipped and deployed.** Phase 1 (edge cache),
> Phase 2 (pg pool + cookieCache, incl. the bot-avatar→URL rework that unblocked it),
> Phase 3 (`attraction_live` current-state table + reader rewrites), the `allRides`
> extension, and Phase 5 (Valhalla quantize + cache) are all live. Phase-1 edge caching
> was verified HIT in prod on `parks.board` / `parks.overview` / `parks.ticker`.
> **What's left is deferred/manual only** — nothing to build:
>
> - `PG_POOL_MAX` env vars (Phase 2a follow-through) → [load-followups.md](./load-followups.md) §1, deferred (low user count).
> - Phase 4 scale-out (web/Valhalla replicas, PgBouncer) → only when CPU/latency demands it.
> - Phase 6 load test → optional, quantifies the win.
> - 3d (`reconcileDarkness` / `evaluateAlerts`) → audited, intentionally **not** migrated.
> - Remaining verification: confirm `routing.route` HITs at the edge (first variable-input
>   GET on the CF tRPC rule; widen the rule if it shows BYPASS).

> **Theme:** Under load, the first thing to fall over is Postgres serving the live-board
> read path. `parks.board` / `parks.overview` / `parks.ticker` are heavy multi-CTE
> time-series queries, they are **not** in the tRPC edge-cache allowlist, and every open
> map/board polls them every 60 s — so read load scales linearly with concurrent users,
> funneled through a default node-postgres pool of 10 connections and a per-request
> session lookup. The data itself only changes once per worker tick (60 s) and is
> identical for every user. Fix order: make read load independent of user count first
> (edge cache — one small diff, ~an order of magnitude of headroom), then remove the
> per-request multipliers (pool size, session cookie cache), then make the queries
> themselves O(1) (current-state table), then scale-out knobs (replicas, Valhalla).

## Diagnosis

Ranked by how soon each bites:

1. **Uncached live reads × per-client polling.** `parks.board`
   (`src/integrations/trpc/routers/parks.ts` ~line 177) runs a 5-CTE query per request:
   three `DISTINCT ON` passes over `queue_obs` / `attraction_status_obs` plus a `hist`
   CTE averaging the full 24–48 h standby window. `parks.overview` (~line 976) is the
   cross-park version. The map polls at 60 s (`src/components/park-map/map-stage.tsx`
   `refetchInterval: 60_000`), the blog ticker too. None of these are in
   `CACHEABLE_TRPC_PATHS` (`src/lib/cache.ts`), so they travel as batched POSTs and hit
   origin + Postgres on every poll from every client. 1 000 concurrent in-park users ≈
   20–30 of these queries/sec, all identical per park.
2. **Default connection pool.** `src/db/index.ts` creates
   `drizzle(process.env.DATABASE_URL!)` with no pool config — node-postgres defaults to
   `max: 10`. Requests queue on the pool inside the Node process long before Postgres
   saturates; p99 cliffs. ~17 separate Railway services each hold their own pool
   against the same instance, so the global `max_connections` budget matters the moment
   web replicas appear. No PgBouncer in the stack.
3. **Session lookup per authed request.** `createTRPCContext`
   (`src/integrations/trpc/init.ts:17`) calls `auth.api.getSession()` on every request
   and better-auth's `cookieCache` is not enabled (`src/lib/auth.ts`) — a session+user
   DB read per request, multiplying (1) and (2).
4. **Single Node process for SSR + API.** Nitro runs as one
   `node .output/server/index.mjs`. HTML is deliberately `no-cache` (stale-chunk safety
   net), so every page view is a full React SSR render plus superjson serialization of
   fat board payloads. CPU saturation = event-loop lag on all routes at once. Stateless,
   so Railway replicas fix it — but each replica adds another pool (feeds back into 2).
5. **Unbounded `latest_status` scan.** `overview`'s `latest_status` CTE does
   `DISTINCT ON` over the **entire** `attraction_status_obs` change-log — deliberately
   unbounded (carry-forward semantics), no retention, compression after 30 d. Postgres
   has no loose index scan, so this degrades as the table grows. Slow-burn, not acute.
6. **Valhalla routing.** One self-hosted container serves every pedestrian route.
   `routing.route` is a query but raw lat/lng inputs are near-unique, so edge cache hit
   rate ≈ 0. Route computation is milliseconds; throughput ceiling is the single
   container.

Explicitly **not** bottlenecks: ingestion writes (fixed 60 s cadence regardless of
users; Timescale compression + retention healthy), dining/stays catalog reads (already
edge-cached), static assets/images (CF + R2 + transforms).

## Phase 1 — edge-cache the live read path (the biggest lever)

All code; reuses the machinery from the 2026-07-15 tRPC edge-cache work (splitLink GET
in `root-provider.tsx` + `responseMeta` stamping in `src/routes/api.trpc.$.tsx`).

- [x] **1a. Restructure `src/lib/cache.ts`**: turn `CACHEABLE_TRPC_PATHS` from a
      `Set<string>` into a `Map<string, string>` of path → cache-control value, and add
      a `CACHE.TRPC_LIVE` policy for worker-tick-fresh data:
      `public, s-maxage=30, stale-while-revalidate=300`. (Worker tick is 60 s, so
      s-maxage=30 bounds worst-case staleness at ~90 s — same freshness class users get
      today from their own 60 s poll cadence.) Existing catalog paths keep
      `CACHE.TRPC_DATA`.
- [x] **1b. Add the live paths**: `parks.board`, `parks.overview`, `parks.ticker` with
      `TRPC_LIVE`. All three are `publicProcedure`, zero per-user variation (verified:
      the whole parks router has no `ctx` reference — output depends only on DB state +
      `now()`). Audit deferred: `parks.hours` is public+identical and eligible but is
      not a 60 s poller (schedule data, low value); left out to keep Phase 1 tight. No
      other 60 s public poller found.
- [x] **1c. Update both consumers of the allowlist**: the client splitLink condition
      (`root-provider.tsx:63`, `has(op.path)` → `Map.has`, unchanged semantics) and the
      server `responseMeta` (`api.trpc.$.tsx`) — since cacheable paths travel on the
      non-batched GET `httpLink`, each request has exactly one path; when a batch
      somehow contains several, emit the **minimum** TTL among them (or nothing if any
      path is unlisted — current fail-closed behavior stays).
- [ ] **1d. Verify at the edge** (see "What you need to do", step 1): two curls to a
      board GET URL must show `cf-cache-status: MISS` then `HIT`, and a logged-in
      browser session must still see fresh board data. The client keeps its 60 s
      `refetchInterval` — polls now terminate at Cloudflare instead of origin.

Result: origin sees ~1 board query per park per 30 s and ~2 overview/ticker queries per
minute, **regardless of user count**. This alone moves the ceiling by roughly an order
of magnitude.

## Phase 2 — remove the per-request multipliers

- [x] **2a. Explicit pg pool** in `src/db/index.ts`: construct the pool with
      `max: Number(process.env.PG_POOL_MAX ?? 10)` (node-postgres `Pool` passed to
      drizzle, or drizzle's connection options — keep the single shared `db` export).
      Every service picks up a sane default; the web service gets a bigger budget via
      env var. **Code done; the env-var sizing is deferred** (low user count) to
      [`load-followups.md`](./load-followups.md) §1 — `max_connections` measured at 100.
- [x] **2b. better-auth `cookieCache`** — enabled, after first removing the blocker.
      First attempt 431'd every request in prod: `cookieCache` serializes the full
      session+user into the signed cookie, and `user.image` held a ~27 KB **data-URI**
      avatar, blowing past the request-header limit. Fixed at the source by moving bot
      avatars off inline data URIs onto a deterministic, edge-cached
      `/api/avatar/:seed` route (`src/routes/api/avatar/$seed.ts` +
      `botAvatarUrl`/`generateBotAvatarSvg` in `src/lib/avatar.ts`, `CACHE.AVATAR`),
      so `user.image` is now a ~40-byte URL everywhere (DB rows, SSR payloads, cookie).
      Create hook + profile picker updated; migration
      `drizzle/20260719170000_bot_avatar_urls` rewrites existing `data:%` rows. Then
      re-enabled `session: { cookieCache: { enabled: true, maxAge: 300 } }`. Caveats
      documented in `src/lib/auth.ts`: (i) revocation propagates to other devices in
      ≤ 5 min; (ii) native (Capacitor) bearer clients aren't covered by the cookie.

## Phase 3 — make the live queries O(1): current-state table

Removes diagnosis items 1 (residual origin cost), 5 (unbounded scan), and most of the
native-auth residual from 2b. The worker already computes status changes per tick — it
just doesn't persist a "current state" anywhere, forcing every reader to re-derive it
from time-series scans.

- [x] **3a. Schema**: new `attraction_live` table (`src/db/schema.ts` `attractionLive`)
      — `attraction_id` PK, `status`, `standby_wait`, LL fields (`ll_state`,
      `ll_price_cents`, `ll_currency`, `ll_return_start/end`), `return_state`,
      `return_start/end`, `boarding_group`, `source`, `observed_at`. Hand-written
      migration `drizzle/20260719180000_attraction_live` (FK → `attractions` ON DELETE
      CASCADE).
- [x] **3b. Worker upsert**: `ingestPark` (`src/server/parks/ingest.ts`) section (D)
      upserts this tick's full per-attraction snapshot into `attraction_live` (batched
      `INSERT … ON CONFLICT (attraction_id) DO UPDATE`, all columns ← excluded). Full
      snapshot each tick: a queue type not reported this tick lands null. Self-backfills
      within one tick. **Deploy the worker before the web tier flips its queries.**
- [x] **3c. Rewrite readers**: `parks.board` and `parks.overview` now read a `live` CTE
      over `attraction_live` (status carries forward unbounded; wait/LL/return gated to
      a 24 h `observed_at` staleness bound, matching the old `latest_q`/`latest_standby`
      windows) instead of the `latest_status`/`latest_q` `DISTINCT ON` CTEs. Board's
      `hist` baseline moved off raw `queue_obs` onto the `queue_hourly` cagg
      (samples-weighted mean; window is >24 h old so the cagg is fully materialized).
      `attraction_status_obs` keeps its full change-log for history pages.
- [~] **3d. Audit other latest-state readers — audited, deferred.** Two re-derive
  "latest per attraction": `reconcileDarkness` (`src/server/living/darkness.ts`,
  full `DISTINCT ON` scan each reconcile) and `evaluateAlerts`
  (`src/server/notifications/alerts.ts`, per-alert LATERAL lookups). **Not migrated:**
  both are worker-internal (once per tick, bounded by active-alert count / not
  client-polled) so neither is the scaling bottleneck, and both depend on
  carry-forward semantics `attraction_live`'s full-snapshot model doesn't preserve
  (darkness wants the _pre-breakdown_ standby of a DOWN ride; alerts' `ll_state` uses
  cross-queue-type recency). Revisit only if worker-tick DB cost shows up.
  Achievements ride detection: no latest-per-attraction time-series read found.

## Phase 4 — scale-out knobs (manual, your side — see checklist below)

- [ ] **4a. Web replicas on Railway** once CPU (not DB) shows as the limit. Safe:
      sessions live in Postgres/cookie, no in-process state, no SSE. Each replica adds
      its own `PG_POOL_MAX` connections — recheck the arithmetic from manual step 2.
- [ ] **4b. Valhalla replicas** when routing latency climbs — the container is
      stateless (tiles baked into the image), so Railway replicas just work.
- [ ] **4c. PgBouncer — deferred.** Only worth it when
      (web replicas × pool) + Σ(service pools) approaches `max_connections`. Revisit
      after 4a; don't build it preemptively.

## Phase 5 — Valhalla cacheability (smallest lever, do last)

- [x] **5a. Quantize route endpoints client-side** — `roundCoord`
      (`src/components/park-map/nav-geometry.ts`) now rounds to 4 decimals (~11 m)
      instead of 6 (~11 cm). It's used exclusively as the `from`/`to` input to
      `routing.route` (all four map callers), so the one change covers every route
      request; unit test updated. (`coarseCoord`/3 dp stays as-is for walk-_time_
      estimates, which deliberately want a coarser, flicker-free key.)
- [x] **5b. Add `routing.route` to the cacheable map** — new `CACHE.ROUTE`
      (`public, s-maxage=3600, stale-while-revalidate=86400`) and
      `["routing.route", CACHE.ROUTE]` in `CACHEABLE_TRPC_PATHS`. It now travels on the
      non-batched GET link and is edge-cacheable by URL (input includes
      `from`/`to`/`units`/`language` — locale variants key separately, correctly).
- [x] Reroutes from a walking user's live position still mostly miss (position keeps
      moving) — expected; that residual is what 4b (Valhalla replicas) is for.

## `allRides` extension (adjacent to Phases 1 & 3, done alongside Phase 5)

`parks.allRides` (dashboard cross-park waits shelf) used the same cross-park
`DISTINCT ON` pattern as `overview` and wasn't edge-cached, so it got both fixes:

- Migrated to the `attraction_live` `live` CTE (identical shape to board/overview).
- Added `["parks.allRides", CACHE.TRPC_LIVE]` to the cacheable map — public, identical
  per user. Now edge-cached like the other live boards. (`attraction` detail is a
  single-attraction index seek — cheap — left on the change-logs.)

## Phase 6 — verification & guardrails

- [ ] **Load-test the board path before and after Phase 1** (autocannon/k6 against a
      board GET URL — against the CF edge for the "after" number, and with
      `cache-control: no-cache` bypass or a direct-origin URL for "before"). Record
      req/s at p99 < 500 ms in this doc.
- [ ] **Watch connections**: during the test, `SELECT count(*) FROM pg_stat_activity`
      (manual step 2 gives access) — confirm the pool ceiling behaves.
- [ ] Consider enabling `pg_stat_statements` on the Railway Postgres for an ongoing
      top-queries view (manual step 4, optional).

---

## What you need to do (manual steps, in order)

**Step 1 — after Phase 1 lands: confirm the Cloudflare cache rule covers the new paths.**
The 2026-07-15 dashboard rule already edge-caches `/api/trpc` GETs that carry an origin
`cache-control` header. To confirm it picks up the new paths:

1. Deploy Phase 1.
2. Open a park page (map view) in your browser, DevTools → Network, filter `board`.
   Copy the full GET URL of the `parks.board` request (it's a
   `/api/trpc/parks.board?input=…` URL).
3. In a terminal: `curl -sI '<that URL>' | grep -i 'cf-cache-status\|cache-control'` —
   run it **twice**. Expected: first `MISS` (or `EXPIRED`), second `HIT`, and
   `cache-control: public, s-maxage=30, stale-while-revalidate=300`.
4. If both show `BYPASS`/`DYNAMIC`: the dashboard rule's expression is filtering paths
   more narrowly than "has cache-control". Cloudflare dashboard → parkfi.sh zone →
   Caching → Cache Rules → open the tRPC rule → widen the expression to cover
   `/api/trpc/*` GETs (keep the "only when origin sends cache-control" condition — that
   is what keeps mutations and auth-scoped queries uncached).

**Step 2 — before Phase 2 lands: find the Postgres connection budget.**

1. Railway dashboard → the Postgres service → **Data** tab (or connect with `psql` using
   the `DATABASE_URL` from the service's Variables tab).
2. Run: `SHOW max_connections;` and note the number (Railway defaults vary by plan;
   often 100).
3. Budget arithmetic — keep total ≤ ~80 % of max_connections:
   `web replicas × PG_POOL_MAX(web)` + `worker (10)` + `~15 cron/one-off services × 5`
   - Timescale background workers (~10) + headroom for psql/Studio.
     With max_connections = 100 and 1 web replica, `PG_POOL_MAX=25` on web and `5` on the
     cron-style services fits comfortably.
4. Set the env vars in Railway: web service → Variables → `PG_POOL_MAX=25`; leave other
   services on the code default (or set `PG_POOL_MAX=5` explicitly on the chatty ones:
   worker, notifications, dining-availability).

**Step 3 — when CPU becomes the limit (Phase 4): add replicas.**

1. Railway dashboard → web service → **Settings** → **Deploy** section → **Replicas** →
   set to 2. (Railway load-balances automatically; no config change needed in the app.)
2. Redo the Step 2 arithmetic with the new replica count before saving.
3. Same procedure for the Valhalla service if `routing.route` p99 climbs.
4. Signals to watch for "CPU is now the limit": Railway service metrics show sustained
   CPU near 1 vCPU while Postgres CPU/connections are healthy, and latency is uniform
   across cheap and expensive routes (event-loop lag).

**Step 4 — optional: `pg_stat_statements`.**
In psql: `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` — if Railway's image
doesn't have it preloaded (`ERROR: pg_stat_statements must be loaded via
shared_preload_libraries`), skip it; Phase 6's load test covers the acute question.

Everything else in this plan is code I can do without you.
