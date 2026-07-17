# 11 — Architecture

> **Theme:** The Living Layer is mostly **re-aimed infrastructure we already
> operate**, plus a handful of genuinely new pieces. This doc maps every system
> to the existing stack (TanStack Start + tRPC + Nitro + Drizzle/Timescale +
> Better-Auth + the worker + cron pattern + the ml-train Python service + R2 +
> Resend) and specifies the net-new components.

## System diagram (logical)

```
        ┌──────────────────────── client (web-first, then native) ───────────────────────┐
        │  geofence + motion engine · AR (native, via Capacitor plugin) · channels (wrist/ear) │
        └───────────────┬───────────────────────────────────────────────┬─────────────────┘
                        │ tRPC (presence, marks, encounters, roster)     │ push
        ┌───────────────▼───────────────┐                  ┌─────────────▼──────────────┐
        │   tRPC routers (NEW)          │                  │  push pipeline (REUSE)     │
        │  living.* — presence, marks,  │                  │  worker alert-eval + Resend│
        │  encounters, party, seals     │                  │  + web push / APNs/FCM     │
        └───────────────┬───────────────┘                  └─────────────▲──────────────┘
                        │                                                 │
        ┌───────────────▼─────────────────────────────────────────────── ┴───────────────┐
        │  Nitro SSR server · Better-Auth (REUSE) · presence-verification service (NEW)    │
        └───────────────┬─────────────────────────────────────────────────────────────────┘
                        │
        ┌───────────────▼───────────────┐     ┌──────────────────────────────────────────┐
        │ Postgres / Timescale (REUSE)  │◀────│  the DARKNESS engine (NEW worker job)       │
        │ existing + new game tables    │     │  subscribes to queue_obs / status_obs →    │
        │ ([10])                        │     │  computes spawn table → writes `world` /   │
        └───────────────▲───────────────┘     │  `collectible` / `encounter` marks         │
                        │                      └──────────────────────────▲────────────────┘
        ┌───────────────┴───────────────┐                                 │
        │  the live feed (REUSE)        │─────────────────────────────────┘
        │  worker poll → queue_obs,     │   the moat: the encounter engine is a function
        │  attraction_status_obs        │   of the REAL park state nobody else holds
        └───────────────────────────────┘
```

## What we reuse (the bulk of it)

| Existing system                                       | Role in the Living Layer                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Worker poll loop** (`services/worker/main.ts`)      | already produces `queue_obs` / `attraction_status_obs` every cycle — the raw input to the Darkness engine                                   |
| **Alert-eval + Resend + notifications**               | the push backbone; extend to in-park, geofenced Go-Now / Convergence pushes                                                                 |
| **Postgres / Timescale + Drizzle**                    | game tables + hypertables for presence/encounter logs ([10](10-data-model.md))                                                              |
| **Better-Auth**                                       | `wielder` and all game-save tables key straight off `user`                                                                                  |
| **tRPC + TanStack Start**                             | new `living.*` router; web client reuses the app shell                                                                                      |
| **pin CLIP embedding service**                        | re-aimed for **landmark image-anchored AR** ([07](07-ar-and-channels.md))                                                                   |
| **ml-train Python service + `queue_forecast`**        | forecast-weighted spawn planning (quiet windows, predicted surges)                                                                          |
| **R2 + uploads router**                               | echo/emblem photos, companion art, mark media                                                                                               |
| **cron + Claude-API pattern** (`cron-park-news`)      | UGC pre-screen moderation ([09](09-moderation-trust-safety.md)); narrative/lore at scale (Journal flavor, recruit barks, world-voice lines) |
| **edge-cache discipline** (`lib/cache.ts`, splitLink) | cache read-only catalog reads (worlds, companion dex) like we cache forecast data — and **bypass the SSE subscription path** (§5)           |
| **A4 FCM push (code-complete)**                       | personal payloads only: echo-touched, Trinity awakening — the permanent complement to the park-public SSE channel (§5)                      |

## What's genuinely new

### 1. The Darkness engine (new worker job)

The heart of the moat. A worker job that **subscribes to the live feed and emits
game state**:

- **Input:** `attraction_status_obs` transitions (DOWN/OPERATING), `queue_obs`
  surges per World, `park_schedule` events (fireworks → Convergence),
  `weather_obs`, `queue_forecast` — and the derived **World light** level
  (GDD §3.7): dim Worlds weight rarer spawns and a faster escalation clock, a
  self-balancing loop that steers wielders toward neglected Worlds.
- **Logic:** a **spawn function** `f(location, time-of-day, live state,
forecast) → spawn table`. Ride goes DOWN → write rare/strong `world` +
  `encounter` marks at that attraction; World surge → raise `collectible`/
  `encounter` density there; fireworks → schedule a Convergence.
- **Output:** writes `mark` rows ([10](10-data-model.md)) with appropriate
  `expiresAt` (decay) and `liveStateSnapshot` (provenance).
- **Co-locates** with the existing worker (same Railway service shape, same DB).
  Note the project's IPv6 binding gotcha (`railway-private-network-ipv6` in
  memory): bind `::`, not `0.0.0.0`, for any internal service calls.

### 2. Presence-verification service (server-side)

The anti-cheat authority ([06](06-location-and-geofencing.md)). The client
_proposes_ presence; this service **validates against the live feed** (does the
claim agree with `queue_obs`/status? is the movement physically possible?) and is
the **only writer** of `presence_event` and any progression it gates.

### 3. Client geofence + motion + AR engine

- **Geofence/motion:** web (Geolocation + DeviceMotion / Generic Sensor APIs)
  for the demo; native (Core Location region monitoring + Core Motion / the
  Android equivalents) for the product, for background + battery control.
- **AR runtime:** native, inside the Capacitor shell — rung-1 camera-overlay
  lite AR first, then a thin ARKit/ARCore plugin, then the ARCore Geospatial
  API for VPS/shared anchors. (Revised 2026-07-15; the original WebXR/8th Wall
  path is dead — full ladder in [07](07-ar-and-channels.md).)

### 4. The `living.*` tRPC router

New procedures, mirroring the existing router style:

| Procedure                             | Purpose                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| `living.worlds`                       | world catalog + boundaries for a park                    |
| `living.nearbyMarks`                  | live marks near a verified position                      |
| `living.proposePresence`              | client → server presence claim (verified)                |
| `living.leaveMark`                    | leave an echo (verified-presence gated)                  |
| `living.reactMark`                    | found/resonate/report                                    |
| `living.encounter.start` / `.resolve` | begin/resolve a battle (server-authoritative)            |
| `living.party`                        | fieldable party for `(roster, current world, rank)`      |
| `living.recruit`                      | complete a recruit quest → add to roster                 |
| `living.seal`                         | contribute to a World seal                               |
| `living.profile`                      | wielder, roster, logbook, achievements                   |
| `living.onParkEvents`                 | **subscription** — the park's world-event stream (below) |

### 5. The world-event wire (SSE — canon 2026-07-16)

The layer's nervous system: every rung of the social ladder (darkness meter,
sealed tickers, incursion pulses, light bands, Rift countdowns) presupposes a
server→client event path, and the communal thread — world events every present
player feels **at once** — is not implementable on polling at all. The durable
contract is the **event vocabulary**, not the transport: typed, timestamped,
_caused_ events — `eruption` / `incursion` (a collapsed burst of ≥3) / `fade` /
`seal` / `echo`, growing `light` (band crossings only) and `trinity`.

**The wire, end to end:** mark writers → row-level Postgres triggers on `mark`
(`AFTER INSERT`; `AFTER UPDATE OF state WHEN (OLD.state IS DISTINCT FROM
NEW.state)` — the worker's per-tick TTL re-stamp must not re-erupt) →
`pg_notify('living_marks', json)` → one dedicated LISTEN `pg.Client` per web
process (session-pinned; cannot ride the pool; reconnect loop with a `resync`
signal since LISTEN/NOTIFY has no replay) → in-process emitter keyed by park →
tRPC v11 async-generator subscription (`httpSubscriptionLink`, SSE ping
~15–25 s) → client `setQueryData` + the presentation queue. Emitting at the
data layer makes the pulse a property of the mark primitive itself
([03](03-marks-and-discovery.md)) — every writer, current and future, emits
correctly with zero app-code discipline. NOTIFY fires on commit (no phantom
events); payloads stay dumb (ids + enums, hydrate server-side; ~8 KB cap).

**Canon rules:**

- **Public and park-scoped.** World events are identical for everyone —
  `publicProcedure`, which sidesteps the EventSource auth problem entirely.
  **Aggregates, never identities**: `seal` carries no user id, no name, no
  person's coordinates.
- **Personal payloads never ride SSE** ("your echo was touched", "your Trinity
  woke") — they are FCM pushes. This split is permanent.
- **`seal` is gated on battle integrity** (server replay) — broadcasting seals
  amplifies the cheat incentive; the rest of the vocabulary claims no player
  achievement and ships first.
- **Presentation before transport.** The client derives events by diffing
  polls first (rung A) and feeds a map presentation queue; the wire (rung B)
  then replaces inference with truth. A pin appearing via push with no
  ceremony is invisible.
- **Edge realities:** the stream response needs `Cache-Control: no-cache,
no-transform` + `X-Accel-Buffering: no` (Cloudflare buffers
  `text/event-stream` otherwise), Nitro compression must skip event-streams,
  and the `lib/cache.ts` allowlist must never match the subscription path.
  Verify with `curl -N` **through the edge**, not localhost. Client-side, the
  30 s play-map poll demotes to a slow belt-and-braces reconcile (120 s+).
- **Foreground only** — SSE lives while play mode is armed; app-closed reach
  is FCM's job. Ingest cadence (≤60 s worker tick) is now the latency floor;
  the wire's promise is that any future ingest speedup reaches every phone
  instantly.

Tier-2 presence rooms (Durable Objects per park, partyserver, hibernation
economics) can publish the **same vocabulary** later; Colyseus/Nakama are
rejected — battles are turn-based and replay-verifiable, and our irreplaceable
state lives in Timescale. **Never introduce a second stateful backend.**

## Data flow: a single encounter, end to end

1. Worker poll writes `attraction_status_obs` = **DOWN** for ride X (existing).
2. **Darkness engine** sees the transition → writes a rare `encounter` mark at X
   with `expiresAt` = while-down and a `liveStateSnapshot` (new).
3. The mark INSERT trigger fires the wire (§5) — every armed phone in the park
   receives the `eruption` in the same second; the map stages darkness pooling
   out of the ground, a haptic thrum, the ambience bus darkening one beat.
4. Client wrist/ear cue → Wielder walks over; client geofence + motion confirm
   presence → `living.proposePresence` (new).
5. Presence-verification service validates against the feed → writes
   `presence_event` (new).
6. `living.encounter.start` → server returns the Heartless spec; client renders the
   AR battle (new).
7. `living.encounter.resolve` → server **replays the submitted move list**
   against the pinned session (integrity), stamps the resolve-time snapshot +
   verdicts onto `encounter_log`, grants drops/XP/Journal ticks, advances
   `seal_state` (new) — and the state-change trigger broadcasts the `seal`
   (post-integrity).
8. Wielder may `living.leaveMark` an echo → kindles the World's light, feeds
   the flywheel (new).

Every "existing" step is infrastructure already running in production today; the
"new" steps are the thin reactive layer on top.

## Deployment shape

- **No new datastore.** Game tables live in the existing Timescale Postgres;
  hypertables + retention follow the `queue_obs` pattern.
- **New worker job** co-deployed with the existing worker on Railway.
- **Web client** ships inside the existing TanStack Start app; the same web UI
  runs in the **Capacitor shell we already distribute**, which is the demo
  vehicle ([12](12-demo-vertical-slice.md)). A QR-code web link still serves the
  2D-canonical loop.
- **Deep native** (background geofencing, watch, AR fidelity) grows inside that
  shell over time, sharing the same tRPC API and DB.
