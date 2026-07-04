# 06 — Location & geofencing

> **Theme:** Verified physical presence is the currency of the entire system —
> the anti-cheat, the anti-spam, the achievement integrity, and a piece of the
> moat. This doc is the engineering reality of _knowing where a Wielder is_,
> cheaply, accurately enough, without killing the battery, and without being
> fooled by a fake-GPS app.

## Core insight

Three hard constraints dominate every location decision, and they pull against
each other:

1. **Accuracy** — raw GPS is ~5–20 m, and _worse_ exactly where our set pieces
   are (tall structures, dense crowds, urban-canyon multipath). Raw GPS alone
   cannot tell "in the Space Mountain queue" from "next to it."
2. **Battery** — continuous high-accuracy GPS _murders_ an all-day park visit. A
   battery-killer dies on the store and in word-of-mouth.
3. **Spoofing** — players _will_ fake GPS to farm progression. If presence isn't
   trustworthy, the currency is counterfeit and the moat is gone.

The answer to all three is the same: **sensor fusion + tiered geofences + dwell
confirmation**, never a single raw GPS read.

## Nested geofence tiers (the trigger engine)

Design location as nested **thresholds**, coarsest to finest. Crossing one is a
_dramatic moment_ (the wrist buzz) — Imagineers obsess over thresholds (the
tunnel under the train station = "you've left the real world").

| Tier             | Boundary source                                   | Used for                                                                 |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| **Park**         | `parks.boundary` GeoJSON (already enriched)       | "you entered" — wake the layer                                           |
| **World** (land) | new `world.boundary` (see [10](10-data-model.md)) | party eligibility ([05](05-companions-and-proximity.md)), World identity |
| **Attraction**   | `attractions.lat/lng` + radius                    | encounters, recruit quests                                               |
| **Queue**        | attraction + motion/dwell heuristic               | queue-time experiences, ride detection                                   |
| **Micro-spot**   | a precise coordinate or recognized landmark       | a specific `discovery`/`world` mark, AR anchor                           |

Coarse tiers use the OS's **low-power region monitoring**; fine tiers spin up
high-accuracy only _transiently_ (see Battery).

## Sensor fusion (accuracy + anti-spoof, same mechanism)

Combine many weak signals into one confident, hard-to-fake verdict:

- **GPS** — coarse position + accuracy radius.
- **Live park data** — _our unique signal_. If GPS says you're near Space
  Mountain **and** `queue_obs` says its standby is 60 min **and** your dwell +
  motion pattern matches a slow-shuffling snake, you're almost certainly _in the
  line_. No competitor has this corroborating layer.
- **Motion sensors** (accelerometer/gyro) — walking vs standing vs _riding_. A
  coaster has a distinct g-force/airtime signature; detecting it both confirms
  presence and powers ride-as-controller / motion-verified achievements.
- **Barometer** — relative elevation (multi-level queues, parking structures).
- **Audio fingerprint** (optional, later) — each land has a distinct background
  music loop; the mic can place you _without_ GPS and detect parade/fireworks
  onset.
- **Wi-Fi/BLE fingerprinting** (later) — coarse indoor positioning where GPS
  fails.
- **Dwell time** — presence is confirmed by _staying_, not a single ping; defeats
  drive-by and teleport spoofs.

**A "verified" event requires multiple independent signals to agree.** A
fake-location app can move the GPS dot but cannot fabricate a coherent
motion+dwell+live-state story. This is why verified-by-physics achievements
([08](08-achievements-persistence-coldstart.md)) are a moat: the integrity is
structural, not a server-side guess.

## Battery strategy (non-negotiable)

An all-day game cannot run high-accuracy GPS continuously. The discipline:

- **Region monitoring for coarse triggers.** OS geofence/region APIs are
  low-power and run even when the app is backgrounded. Use them for Park/World
  tier crossings.
- **High-accuracy only in active moments.** Spin up precise GPS + motion + AR
  _only_ during an encounter, a recruit quest, or a mark interaction — then spin
  back down.
- **Push, don't poll.** Reuse the worker + push pipeline ([11](11-architecture.md))
  so the _server_ tells an in-park device "a Darkness surged near you" rather than
  the device burning battery polling.
- **Budget explicitly.** Treat battery as a first-class metric in testing
  (target: a full park day on one charge with normal use). A great experience
  that drains a phone by noon is a failed experience.

## Anti-spoofing (defense in depth)

- **Multi-signal verification** (above) is the primary defense.
- **Plausibility checks** — server rejects impossible movement (teleports,
  superhuman speed), presence that contradicts the live feed (claiming to ride a
  ride that's `DOWN`), and motion that doesn't match the claimed activity.
- **Platform attestation** — App Attest / Play Integrity to detect rooted /
  hooked devices and emulators (native phase).
- **Soft economy design** — keep the _highest-value_ rewards behind the
  hardest-to-fake conditions (live-gated, motion-verified), so spoofing the easy
  stuff yields little.
- **Server is authoritative.** The client _proposes_ presence; the server, with
  the live feed in hand, _validates_ and is the only writer of progression.

## Privacy & consent (do this right from day one)

All-day location is sensitive. The contract must be explicit and honest:

- **Foreground-first.** Default to location only while the app is in use;
  background/region monitoring is a clear, separate opt-in tied to a concrete
  benefit (Go-Now nudges, Convergence alerts).
- **On-device where possible.** Geofence evaluation and motion classification run
  client-side; we send the _server_ derived events ("entered World X",
  "verified ride of Y"), not a raw breadcrumb trail, unless the user opts into
  features that need it.
- **Minimize & retain briefly.** Store the _events_ the game needs, not a
  perpetual location history. Short retention on any raw traces (mirrors our
  existing Timescale retention discipline).
- **Transparent controls.** Clear in-app explanation, easy off switch, and an
  obvious indicator when location is active.

## What's net-new vs. reused

- **Reused:** `parks.boundary`, `attractions.lat/lng`, the live feed (as a
  corroborating signal), the worker + push pipeline.
- **Net-new:** the `world` table + polygons ([10](10-data-model.md)), a
  client-side geofence/motion engine, the verification service (server-side
  presence validation against the live feed), platform attestation.
