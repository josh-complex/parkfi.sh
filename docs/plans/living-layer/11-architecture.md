# 11 — Architecture

> **Theme:** The Living Layer is mostly **re-aimed infrastructure we already
> operate**, plus a handful of genuinely new pieces. This doc maps every system
> to the existing stack (TanStack Start + tRPC + Nitro + Drizzle/Timescale +
> Better-Auth + the worker + cron pattern + the ml-train Python service + R2 +
> Resend) and specifies the net-new components.

## System diagram (logical)

```
        ┌──────────────────────── client (web-first, then native) ───────────────────────┐
        │  geofence + motion engine · AR runtime (WebXR/8th Wall) · channels (wrist/ear)   │
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
        │ Postgres / Timescale (REUSE)  │◀────│  the DIMMING engine (NEW worker job)       │
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

| Existing system                                       | Role in the Living Layer                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Worker poll loop** (`services/worker/main.ts`)      | already produces `queue_obs` / `attraction_status_obs` every cycle — the raw input to the Dimming engine |
| **Alert-eval + Resend + notifications**               | the push backbone; extend to in-park, geofenced Go-Now / Convergence pushes                              |
| **Postgres / Timescale + Drizzle**                    | game tables + hypertables for presence/encounter logs ([10](10-data-model.md))                           |
| **Better-Auth**                                       | `warden` and all game-save tables key straight off `user`                                                |
| **tRPC + TanStack Start**                             | new `living.*` router; web client reuses the app shell                                                   |
| **pin CLIP embedding service**                        | re-aimed for **landmark image-anchored AR** ([07](07-ar-and-channels.md))                                |
| **ml-train Python service + `queue_forecast`**        | forecast-weighted spawn planning (quiet windows, predicted surges)                                       |
| **R2 + uploads router**                               | `discovery` photos, companion art, mark media                                                            |
| **cron + Claude-API pattern** (`cron-park-news`)      | UGC pre-screen moderation ([09](09-moderation-trust-safety.md)); narrative/lore generation               |
| **edge-cache discipline** (`lib/cache.ts`, splitLink) | cache read-only catalog reads (realms, companion dex) like we cache forecast data                        |

## What's genuinely new

### 1. The Dimming engine (new worker job)

The heart of the moat. A worker job that **subscribes to the live feed and emits
game state**:

- **Input:** `attraction_status_obs` transitions (DOWN/OPERATING), `queue_obs`
  surges per Realm, `park_schedule` events (fireworks → Convergence),
  `weather_obs`, `queue_forecast`.
- **Logic:** a **spawn function** `f(location, time-of-day, live state,
forecast) → spawn table`. Ride goes DOWN → write rare/strong `world` +
  `encounter` marks at that attraction; Realm surge → raise `collectible`/
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
- **AR runtime:** **WebXR / 8th Wall** for the demo (no install); native ARKit/
  ARCore later for fidelity. AR ladder in [07](07-ar-and-channels.md).

### 4. The `living.*` tRPC router

New procedures, mirroring the existing router style:

| Procedure                             | Purpose                                               |
| ------------------------------------- | ----------------------------------------------------- |
| `living.realms`                       | realm catalog + boundaries for a park                 |
| `living.nearbyMarks`                  | live marks near a verified position                   |
| `living.proposePresence`              | client → server presence claim (verified)             |
| `living.leaveMark`                    | create a `discovery`/`dare` (verified-presence gated) |
| `living.reactMark`                    | found/upvote/report                                   |
| `living.encounter.start` / `.resolve` | begin/resolve a battle (server-authoritative)         |
| `living.party`                        | fieldable party for `(roster, current realm, rank)`   |
| `living.recruit`                      | complete a recruit quest → add to roster              |
| `living.seal`                         | contribute to a Realm seal                            |
| `living.profile`                      | warden, roster, logbook, achievements                 |

## Data flow: a single encounter, end to end

1. Worker poll writes `attraction_status_obs` = **DOWN** for ride X (existing).
2. **Dimming engine** sees the transition → writes a rare `encounter` mark at X
   with `expiresAt` = while-down and a `liveStateSnapshot` (new).
3. Push pipeline notifies in-park Wardens within X's geofence (reused).
4. Client wrist/ear cue → Warden walks over; client geofence + motion confirm
   presence → `living.proposePresence` (new).
5. Presence-verification service validates against the feed → writes
   `presence_event` (new).
6. `living.encounter.start` → server returns the Faded spec; client renders the
   AR battle (new).
7. `living.encounter.resolve` → server validates, writes `encounter_log`, grants
   drops/XP/achievements, advances `seal_state` (new).
8. Warden may `living.leaveMark` a `discovery` → feeds the flywheel (new).

Every "existing" step is infrastructure already running in production today; the
"new" steps are the thin reactive layer on top.

## Deployment shape

- **No new datastore.** Game tables live in the existing Timescale Postgres;
  hypertables + retention follow the `queue_obs` pattern.
- **New worker job** co-deployed with the existing worker on Railway.
- **Web client** ships inside the existing TanStack Start app (a new route +
  the AR runtime), deployable as a **QR-code link** for the demo
  ([12](12-demo-vertical-slice.md)).
- **Native app** is a later phase, sharing the same tRPC API and DB.
