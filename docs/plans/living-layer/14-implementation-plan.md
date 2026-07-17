# 14 — Implementation plan: the vertical slice

> **Theme:** A concrete, file-by-file build plan for the Phase-0 demo defined in
> [12 — Demo / vertical slice](12-demo-vertical-slice.md), grounded in the actual
> repo. Eight milestones (M0–M7), each independently demoable, each with the
> exact files to touch and an acceptance check. The mic-drop (the live-data
> Darkness hook) is wired for real against the existing ingest path; everything
> else is scoped per [12](12-demo-vertical-slice.md).

## Build status — M0–M3 shipped (2026-06-20); M4a/M5/M5a since (see GDD §10)

> **2026-07-16 update:** the 2D battle (M4a), companions
> (catalog/recruit/roster/XP, M5) and companions-acting-in-battle with
> proximity tiers (M5a) have shipped since this section was written — GDD §10
> is the authoritative status table. The remaining tail is M4b (lite AR), M5b
> (presence), M6 (logbook), M7 (packaging) — **re-ordered by the adopted
> priority list below** (doc [15 §7](15-state-of-the-game-2026-07-15.md)).

### The adopted workstream order (2026-07-16 — supersedes plain M-order)

1. **Integrity** — encounter **session row** at `startEncounter` (pinning
   keychain/level/party), client submits its **move list**, server **replays**
   the deterministic fight; minimum-duration check. Rides along:
   **resolve-time snapshot stamping** on `encounter_log` (the only
   unrecoverable-if-delayed work — ship it first, even before replay) and the
   `resolveRound(state, move) → RoundEvent[]` refactor in `battle.ts` (shared
   with priority 2). ([10](10-data-model.md); GDD Canon Log 2026-07-16.)
2. **The feel workstream** — one event-queue/presentation architecture, three
   consumers: combat theater (KH command menu, turn beats, timing verbs, Web
   Audio buses, haptics — 15 §3.1–3.7), the **map presentation queue** driven
   by poll-diff (15 §6.4 rung A), and the **echo refiction** + leave/find
   ceremony (which also deletes the free-text moderation surface).
3. **The wire** — mark triggers → LISTEN/NOTIFY → `httpSubscriptionLink`
   ([11 §5](11-architecture.md)), vocabulary v1 minus `seal` until priority 1
   lands.
4. **World light** — derived aggregate → map brightness → spawn-weight input →
   `light` band events (GDD §3.7).
5. **The progression spine** — Journal (`journal_entry`, catalog-in-code,
   sibling of the achievements engine) → XP economy (GDD §4.5 replaces the
   flat +10) → rank bands + trials → drops (`wielder_material`) → keychains +
   loadout-aware battle + `seal_state`; forge UI last. Two-ledger boundary
   per [08](08-achievements-persistence-coldstart.md) Part A.
6. **Tier 0/1 social + Trinity Marks** — honest aggregates, echo-touched FCM
   push, then `trinity` + `mark_participant` with the retroactive awakening
   push (FCM's marquee payload).
7. **Lite AR debuts as the Lucky-Emblem registration viewfinder** (not a
   generic reveal); run the VPS coverage probe on the same in-park trip as
   M5b presence validation (M5b also upgrades trinity weaving from dwell to
   the real presence primitive, landing on the achievements side).
8. **Nobodies → solo Rifts → DO presence rooms → shared-anchor Convergences**
   — after the joint balancing pass (escalation clock × World light).

M0 (dev mode), M1 (world + geofence), M2 (mark + Darkness engine — the mic-drop),
and M3 (public `living` router + discovery pins + the gated play map) are
**built and green** (`bun tsc --noEmit` clean repo-wide; `bun vp lint` clean on
all new files; 18/18 unit tests pass in `src/server/living/`).

**M3 adds:** `src/integrations/trpc/routers/living.ts` (`worlds`, `marks`,
`leaveMark`, `reactMark` — public reads + presence-/rate-gated discovery loop),
`src/components/living/play-map.tsx` (self-contained maplibre map rendering
Darkness spawns + discovery pins, tap-to-drop, react-via-popup),
`src/routes/play.$slug.tsx` (gated by `useLivingLayerEnabled()` — the PostHog
flag now gates a real screen at `/play/$slug`). The route tree
(`src/routeTree.gen.ts`) was regenerated via `@tanstack/router-generator`; the
diff only **adds** the new route. Still additive + flag-off-by-default.

> **SAFETY — this work does not affect the existing application.** Everything
> added is **additive and dark by default**:
>
> - The migration `drizzle/20260620120000_living_layer/` only `CREATE`s new
>   tables (`world`, `mark`, `mark_reaction`, three `ref_*`). It never alters,
>   drops, or touches an existing table/column/index. No current code reads
>   these tables.
> - The worker's Darkness reconcile is a **hard no-op unless `LIVING_ENABLED=1`**,
>   runs in its own isolated `try/catch` after `evaluateAlerts`, and **requires
>   zero changes to `ingest.ts`** (see the design change below).
> - The dev tRPC procedures (`livingDev.*`) throw `FORBIDDEN` unless
>   `LIVING_DEV=1` — inert in production.
> - The UI switch is the PostHog `living-layer` flag
>   (`src/integrations/posthog/feature-flags.ts`), default **off**. A flag gates
>   only the client; it cannot gate the schema, hence the additive-and-dark
>   design above. No existing page reads the flag.

### Design change vs. the original M2 sketch (level-triggered reconcile)

The original sketch had us modify `ingestPark` to **return** its status
transitions and feed them to an edge-triggered `onStatusTransitions`. The
**built** design is better and was chosen to honor "don't touch existing work":
`reconcileDarkness()` is **level-triggered** — it reads the _current_ status of
every attraction (rows ingest already wrote) and makes the `mark` world match.
Net effect: **`src/server/parks/ingest.ts` is unchanged**, the reconcile
self-heals on a missed tick, and it's idempotent (a partial unique index keeps
at most one active system mark per `(attraction, type)`).

### Files added / changed by M0–M2

| File                                                | New?           | Role                                                      |
| --------------------------------------------------- | -------------- | --------------------------------------------------------- |
| `drizzle/20260620120000_living_layer/migration.sql` | new            | additive DDL + `ref_*` seeds                              |
| `src/db/schema.ts`                                  | **appended**   | `world`, `mark`, `mark_reaction`, `ref_*` + payload types |
| `src/server/living/config.ts`                       | new            | `LIVING_ENABLED` / `LIVING_DEV` kill switches             |
| `src/server/living/codes.ts`                        | new            | mark/state/faded string codes                             |
| `src/server/living/geofence.ts` (+ `.test.ts`)      | new            | pure geometry: point-in-polygon, tier, hull               |
| `src/server/living/worlds.ts`                       | new            | `seedWorldsForPark` (M1)                                  |
| `src/server/living/darkness.ts` (+ `.test.ts`)      | new            | the Darkness engine (M2, the mic-drop)                    |
| `src/server/living/dev.ts`                          | new            | guarded inject/reconcile helpers (M0)                     |
| `src/integrations/trpc/routers/livingDev.ts`        | new            | dev-only tRPC procedures (M0)                             |
| `src/integrations/trpc/router.ts`                   | **+2 lines**   | register `livingDev`                                      |
| `services/worker/main.ts`                           | **+~12 lines** | isolated, flag-gated reconcile call                       |
| `src/integrations/posthog/feature-flags.ts`         | new            | `living-layer` flag + `useLivingLayerEnabled()`           |

### How to turn it on (when ready)

1. Apply the migration (via `bun`, per convention) — or just run
   `bun run living:smoke`, which applies it idempotently and validates the loop.
2. Seed worlds for every active park: `bun run living:seed-worlds`
   (`seedAllWorlds()` — reuses the worker's `activeParkIds()`; later wired into
   `services/geo`).
3. Set `LIVING_ENABLED=1` on the worker → the Darkness reconcile begins.
4. Drive it from the desk with `livingDev.injectStatus({ attractionId, status:
2 })` then `livingDev.reconcile()` (needs `LIVING_DEV=1`), and assert with
   `livingDev.activeMarks({ parkId })`.
5. Create the PostHog `living-layer` flag and roll it out to gate the UI
   (M3+).

### The per-milestone sections below are build history + remaining scope

M0–M3 (and since, M4a/M5/M5a) document what shipped and how; M4b/M5b/M6/M7
remain, sequenced by the adopted workstream order above rather than by their
original M-numbers.

## Repo conventions this plan follows

Confirmed by reading the codebase + project memory — adhere to all of these:

- **Path alias:** `#/*` → `src/*` (tsconfig + package.json `imports`).
- **tRPC:** routers are plain objects typed `TRPCRouterRecord`, registered in
  [src/integrations/trpc/router.ts](../../../src/integrations/trpc/router.ts).
  Data access is `db.execute<Row>(sql\`…\`)`(raw SQL, snake_case rows mapped to
camelCase) **or** the drizzle query builder (ingest uses`db.insert(...).values(...)`). Auth via `publicProcedure`/`protectedProcedure` from [init.ts](../../../src/integrations/trpc/init.ts).
- **Migrations:** hand-write `drizzle/<UTCstamp>_<name>/migration.sql`, plain
  SQL, **no `_journal.json`, no `drizzle-kit generate`** (memory:
  `drizzle-migration-convention`). Hypertables/retention go in the SQL, like
  `drizzle/20260604032023_timescale_hypertables`.
- **Run bins via bun:** `node` isn't on PATH — use `bun <bin>` (memory:
  `no-node-run-bins-via-bun`). So `bun vp check`, `bun vp test`,
  `bun drizzle-kit ...` (we don't use generate, but apply/push via bun).
- **Ghost dup attractions:** filter `category IS NOT NULL` whenever deriving
  World membership / signature attractions (memory:
  `ghost-duplicate-attractions`).
- **Worker on Railway binds `::` not `0.0.0.0`** for any internal calls
  (memory: `railway-private-network-ipv6`).
- **Never start a dev server** as part of this work unless explicitly asked
  (memory: `feedback-no-dev-servers`); verify with `bun vp test` /
  `bun vp check` and unit tests, not by booting the app.
- **Never commit** — the user handles all git (memory: `never-commit-changes`).

## The integration point we already have (the mic-drop)

Status transitions are _already detected_ in
[src/server/parks/ingest.ts](../../../src/server/parks/ingest.ts): around
line 211–231 it builds `statusRows` only on genuine transitions
(`prev.status !== e.status`) and inserts into `attractionStatusObs`. **That is
the exact seam for the Darkness engine** — when a ride transitions to
`AttractionStatus.DOWN`, we emit a `world`/`encounter` mark. We hook it as a
post-tick step in [services/worker/main.ts](../../../services/worker/main.ts)
right next to `evaluateAlerts`, so a failure can't break ingestion (same
isolation pattern the worker already uses).

---

## M0 — Dev / armchair mode (build this first)

You cannot iterate on a location game from your desk without it
([12](12-demo-vertical-slice.md)).

**New files**

- `src/server/living/dev.ts` — guarded helpers (`assertDevEnabled()` reading a
  `LIVING_DEV=1` env flag; **hard-fails in production**).
- `src/integrations/trpc/routers/livingDev.ts` — dev-only tRPC procedures:
  - `injectStatus({ attractionId, status })` — insert a synthetic
    `attraction_status_obs` row (drives the Darkness engine deterministically).
  - `setPosition({ lat, lng })` — store a spoofed position in dev state.
  - `overrideConditions({ night?, rain?, fireworks? })`.
- Client: a `<DevPanel/>` under `src/components/living/dev-panel.tsx` (rendered
  only when `import.meta.env.DEV` or a `?dev=1` flag).

**Modify**

- Register `livingDev` in [router.ts](../../../src/integrations/trpc/router.ts)
  **behind the env guard** (procedures throw `FORBIDDEN` unless `LIVING_DEV=1`).

**Acceptance:** from a unit test (no dev server), calling `injectStatus` writes
an `attraction_status_obs` row; `setPosition` round-trips. Guard throws when
`LIVING_DEV` unset.

---

## M1 — `world` table + geofence engine

**New migration** `drizzle/<stamp>_living_world_and_marks/migration.sql`
(combine M1+M2 DDL — see [10 — Data model](10-data-model.md) for the full
shape). M1 portion:

```sql
CREATE TABLE IF NOT EXISTS "world" (
  "id" bigserial PRIMARY KEY,
  "park_id" bigint NOT NULL REFERENCES "parks"("id"),
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "boundary" jsonb,
  "element" text,
  "theme_color" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "world_park_slug_idx" ON "world" ("park_id","slug");
```

**New files**

- Add `world` (+ `MarkPayload`/`GeoPolygon`-style types) to
  [src/db/schema.ts](../../../src/db/schema.ts), matching the `parks`/`attractions`
  style.
- `src/server/living/worlds.ts` — `seedWorldsForPark(parkId)`: read distinct
  `attraction_meta.land` for the park (joined to `attractions`, **filter
  `category IS NOT NULL`**), compute a convex-hull `boundary` from each land's
  attraction `lat/lng`, upsert `world` rows.
- `src/server/living/geofence.ts` — pure functions: `pointInPolygon`,
  `nearestWorld(lat,lng,worlds)`, `tierFor(homeWorldId, currentWorldId, samePark)`
  → `home | guest | away` ([05](05-companions-and-proximity.md)). **Pure +
  unit-tested**, no I/O.
- `src/server/living/geofence.test.ts`.

**Modify**

- `services/geo` (the monthly geo cron): call `seedWorldsForPark` after attraction
  geo enrichment so Worlds refresh with the rest of the geo data.

**Acceptance:** unit tests for point-in-polygon and tier logic pass
(`bun vp test`). A seed script run against a dev DB produces one `world` row per
land for a test park.

---

## M2 — the `mark` primitive + the Darkness engine (THE MIC-DROP)

**Migration (same folder as M1)** — `mark`, `ref_mark_type`, `ref_mark_state`,
`ref_heartless_type`, `mark_reaction` exactly as in [10](10-data-model.md), with the
spatial/state indexes. Seed the `ref_*` rows in the migration.

**New files**

- Add the tables to [schema.ts](../../../src/db/schema.ts).
- `src/server/living/darkness.ts` — the engine:
  - `onStatusTransitions(transitions)` — given the transitions ingest just wrote,
    for each → `DOWN` emit an `encounter` + `world` mark at that attraction with
    `expires_at` = while-down (cleared on the → `OPERATING` transition) and a
    `live_state_snapshot`. For World `queue_obs` surges, raise spawn weight
    (start simple: a `collectible` mark when a World's avg standby crosses a
    threshold).
  - `spawnWeight({ liveState, timeOfDay, forecast })` — the pure spawn function
    ([11 — Architecture](11-architecture.md)); unit-tested.
  - `expireMarks()` — sweep `mark` where `expires_at < now()` → `state='faded'`
    (or delete); run each tick.
- `src/server/living/darkness.test.ts`.

**Modify**

- [src/server/parks/ingest.ts](../../../src/server/parks/ingest.ts): have
  `ingestPark` **return the transition list** it already computes (the
  `statusRows`), so the worker can feed the Darkness engine. (Minimal change — the
  data is already in scope at line ~211.)
- [services/worker/main.ts](../../../services/worker/main.ts): after
  `evaluateAlerts`, add an isolated `try { await onStatusTransitions(...) ;
await expireMarks() } catch …` block (mirror the existing alert isolation).

**Acceptance:** unit test — feed a synthetic `DOWN` transition →
`onStatusTransitions` writes an `encounter` mark anchored to that attraction with
a populated `live_state_snapshot`; a subsequent `OPERATING` transition clears it.
End-to-end (dev): `livingDev.injectStatus` → next worker tick → mark appears
near that attraction. **This is the demo's ten-second moment.**

---

## M3 — discovery marks (lowest-risk real feature)

The user-defined pins ([03 — Marks & discovery](03-marks-and-discovery.md)).
No AR, no game balance — pure UGC loop + the flywheel made visible.

**New file** `src/integrations/trpc/routers/living.ts` (the main router; grows
through M6):

- `living.worlds({ parkSlug })` → world catalog + boundaries (raw SQL, like
  `parks.list`).
- `living.nearbyMarks({ parkId, lat, lng, types? })` → live marks
  (`state='active'`) within a bbox of the point.
- `living.proposePresence(...)` → **stub in M3** (returns `verified:true` in dev;
  real verification lands in M5/[06](06-location-and-geofencing.md)).
- `living.leaveMark({ type:'discovery', payload, lat, lng })` —
  `protectedProcedure`, **gated on verified presence**, rate-limited (reuse
  [src/server/parks/ratelimit.ts](../../../src/server/parks/ratelimit.ts)).
- `living.reactMark({ markId, kind })` — found/upvote/report; bump counters;
  auto-hide on report threshold ([09 — Moderation](09-moderation-trust-safety.md)).

**Modify**

- Register `living` in [router.ts](../../../src/integrations/trpc/router.ts).

**New route + UI**

- `src/routes/_dash/$slug.play.tsx` (or `src/routes/play.$slug.tsx`) — the demo
  surface. Reuse [src/components/park-map](../../../src/components/park-map) +
  `maplibre-gl`/`leaflet` (already installed) to render the park with live marks
  as pins; "drop a discovery pin" CTA gated on (dev-spoofed) presence.
- `src/components/living/` — `play-map.tsx`, `mark-sheet.tsx`,
  `leave-mark-dialog.tsx`.

**Acceptance:** in dev, set position inside a World → drop a discovery mark →
it appears in `nearbyMarks` for a second client → react "found" increments the
counter. Router unit tests for `leaveMark` (presence gate) + `reactMark`
(report auto-hide).

---

## M4 — AR encounter + scoped battle

> **⚠ Superseded ordering.** M-numbers are build history / scope reference,
> not the sequence. The live build order is the **adopted workstream list at
> the top of this doc** (2026-07-16). M4a shipped; M4b (lite AR) now lands at
> workstream 7 as the emblem viewfinder.

**Add dependency (revised 2026-07-15):** no web-AR vendor — 8th Wall's hosted
platform is gone and WebXR `immersive-ar` still doesn't work on iOS Safari
([07](07-ar-and-channels.md)). M4b is **rung-1 camera-overlay lite AR** inside
the Capacitor shell: a camera-preview plugin (`toBack: true`) + a transparent
webview, with the Heartless as an animated overlay (DOM/canvas, or
`@react-three/fiber` if 3D is wanted) and device-orientation parallax. The
native ARKit/ARCore plane-anchor plugin is the rung-2 upgrade path.

**New files**

- `src/components/living/ar/encounter-canvas.tsx` — plane-/image-anchored AR
  scene; spawns the Heartless model on a detected ground plane, **stand-still**
  ([07](07-ar-and-channels.md), [09](09-moderation-trust-safety.md) safety:
  speed-lockout + stationary).
- `src/components/living/battle/` — turn-based UI (2–3 moves, one Companion, a
  Surge meter). _(Shipped as M4a. **2026-07-16 canon revision:** the client
  state machine becomes a **presentation** layer over
  `resolveRound(state, move) → RoundEvent[]`; `resolve` takes the **move
  list**, not an outcome, and the server replays it against the pinned
  session — GDD Canon Log.)_
- Extend `living.ts`: `encounter.start({ markId })` → creates the session row
  (pinned loadout) + returns Heartless spec; `encounter.resolve({ markId,
moves })` → **server-replay-authoritative**, stamps resolve
  snapshot/verdicts, writes `encounter_log`, grants drops/XP/Journal ticks,
  advances `seal_state` ([10](10-data-model.md)).

**Migration** — add `encounter_log` (hypertable + retention),
`seal_state` per [10](10-data-model.md).

**Acceptance:** on an AR-capable device (one in-park or local test), an
`encounter` mark → tap → AR Heartless renders anchored to the ground → battle
resolves → `encounter_log` row written. **2D fallback** path works when camera is
declined (the loop must complete without AR — [07](07-ar-and-channels.md)).

---

## M5 — presence verification (real anti-cheat) + companion recruit

> **⚠ Superseded ordering** (see the adopted workstream list at top). M5/M5a
> shipped; M5b (presence) rides workstream 7's in-park trip, landing on the
> achievements side per the two-ledger boundary.

**Presence verification** ([06 — Location & geofencing](06-location-and-geofencing.md))

- `src/server/living/presence.ts` — `verifyPresence({ userId, claim })`:
  fuse GPS + dwell + motion + **live-feed agreement** (does `queue_obs`/status
  corroborate?), write `presence_event`, return a confidence verdict. Server is
  the only writer of progression.
- Migration: `presence_event` (hypertable + retention).
- Swap the M3 `proposePresence` stub for the real call; gate `leaveMark`,
  `recruit`, `encounter.resolve` on it.

**Companion recruit (one World)** ([05](05-companions-and-proximity.md))

- Migration: `companion`, `wielder`, `wielder_companion`, `keyblade`,
  `wielder_keyblade` per [10](10-data-model.md). Seed 3–4 placeholder Companions
  bound to one demo World (signature attractions, **`category IS NOT NULL`**;
  final Disney-character roster per [GDD §3.6](GDD.md)).
- `living.party()` → fieldable party from `(roster, current world, rank)`
  (compute client-side, validate server-side).
- `living.recruit({ companionId })` → verified-presence-gated; adds to
  `wielder_companion`.

**Acceptance:** completing the demo World's recruit quest (clear N Heartless +
verified presence) adds the Companion to the roster; fielding rules reflect
home/guest/away tiers. Presence verification rejects a spoofed claim that
contradicts the live feed (unit test).

---

## M6 — the logbook (persistence made visible)

> **⚠ Superseded ordering** (see the adopted workstream list at top). The
> Journal portion of this section belongs to workstream 5 (the progression
> spine).

The shareable artifact ([08 — Achievements, persistence & cold-start](08-achievements-persistence-coldstart.md)).

**New files / migration**

- `journal_entry` ([10](10-data-model.md)) — **catalog-in-code** per the
  2026-07-16 canon (no `achievement_def` table; the earlier sketch is
  superseded — the shipped civilian achievements engine proved the pattern).
- `src/server/living/journal.ts` — `computeJournalStats(logRows)` (pure,
  DB-free) + `evaluateAndUnlockJournal` (closed-set reconcile, sticky
  inserts, ceremony delta), run inside `resolveEncounter`; mirrors
  `src/server/achievements/engine.ts` without importing it.
- `living.profile()` → wielder, roster, logbook timeline, achievements.
- `src/routes/_dash/$slug.play.logbook.tsx` + `src/components/living/logbook/`.

**Acceptance:** a verified ride/encounter produces a logbook entry and unlocks
its achievement (with evidence provenance). Profile query renders the timeline.

---

## M7 — package the pitch

> **⚠ Superseded ordering** (see the adopted workstream list at top).

- Package the pitch build: **TestFlight / Play internal track** of the
  Capacitor app, plus a **QR-code web link** (a clean play entry) for the
  no-install 2D loop.
- A 3-minute scripted walkthrough ending on a **real ride-down** mic-drop;
  `livingDev.injectStatus` is the in-meeting fallback ([12](12-demo-vertical-slice.md)).
- Capture the genuine reactive moment on video (the asset for Path-1 pitch,
  [13](13-roadmap-risks-ip.md)).

**Acceptance:** a fresh device installs the TestFlight build and runs the full
loop including the lite-AR reveal; a second device opens the QR web link with no
install and completes the 2D-canonical loop ([07](07-ar-and-channels.md)).

---

## Build dependency graph

```
M0 dev mode ─┬─▶ M1 world+geofence ─▶ M2 mark + DARKNESS (mic-drop) ─┬─▶ M3 discovery
             │                                                       ├─▶ M4 AR + battle ─▶ M5 presence + recruit ─▶ M6 logbook ─▶ M7 pitch
             └───────────────────────────────────────────────────────┘
```

M0→M2 is the critical path to the mic-drop; **M3 (discovery) can ship to real
users independently** of the game (it's pure utility), so it's the lowest-risk
first public release ([13](13-roadmap-risks-ip.md) Phase 1).

## Verification & tooling (no dev server)

- `bun vp check` — format + lint + types after each milestone.
- `bun vp test` — unit tests; the pure modules (`geofence`, `darkness.spawnWeight`,
  `presence` fusion, tier logic) are all unit-testable with no DB or device.
- DB-touching logic: small integration tests against a dev DB, following the
  existing `*.test.ts` pattern (e.g.
  [src/server/notifications/alerts.test.ts](../../../src/server/notifications/alerts.test.ts)).
- Migrations apply via `bun` (per memory), not `drizzle-kit generate`.
- **No app-server boot** for verification (memory); the in-park device test in
  M4/M7 is the only on-device step, done deliberately on the validation trip
  ([12](12-demo-vertical-slice.md)).

## What this plan deliberately defers (narrated, not built)

Per [12](12-demo-vertical-slice.md) / [13](13-roadmap-risks-ip.md): Convergences

- shared-anchor co-op AR, synthesis, the full Companion dex, cross-park travel,
  native app + background geofencing + watch/haptics, VPS-anchored AR. All are
  roadmap, not Phase 0.

## First commit

Start at **M0** + the **M1/M2 migration**, because the mic-drop is the whole
pitch and M0 is what lets you build it from your desk. Concretely, the first PR:
the dev panel + `livingDev` router (guarded), the `world`+`mark` migration and
schema, and `darkness.ts` wired into the worker — provable end-to-end via
`livingDev.injectStatus` with a unit test, no park trip required.
