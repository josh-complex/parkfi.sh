# 01 — Vision & strategy

> **Theme:** We are not building a better screen. We are building a reactive
> world laid over a real place, with the phone as a lens onto it. The strategic
> wedge is that **only we can make that world genuinely alive**, because only we
> own the live operational feed of the physical park.

## The shift

parkfi today is a **data platform you check from your couch** — wait times,
forecasts, dining, stays, alerts. Excellent, defensible, _passive_. The Living
Layer flips the relationship:

| Today (lookback, passive)      | The Living Layer (live, two-way)                                              |
| ------------------------------ | ----------------------------------------------------------------------------- |
| "What are the waits today?"    | "What should I do _right now_ — and the park just changed, here's your move." |
| You read a table               | You move through a place that reacts to you                                   |
| Value at home, before the trip | Value _in the park_, during the trip                                          |
| The park is our subject        | The park is our **medium**                                                    |

## The moat: a world that's alive because reality is alive

Every competitor's world is static:

- **Niantic (Pokémon GO, etc.)** spawns content on timers and pre-placed
  anchors. The world doesn't know what's happening around it.
- **Disney's own apps** (Play Disney Parks, Genie+) script their content; they
  are not reactive game worlds, and Disney does not have a live cross-operator
  wait/status feed wired into a game engine.

We already ingest, every poll cycle, the **actual condition of the physical
park**: `queue_obs` (live waits per queue), `attraction_status_obs` (a ride
genuinely went DOWN / came back OPERATING), `park_schedule` (showtimes,
fireworks, ticketed events), `weather_obs`, and ML `queue_forecast`. Pointed at
a game, that feed becomes an **encounter engine no one else can build**:

- A ride **actually breaks** → darkness leaks from _that_ attraction → rare,
  stronger Heartless spawn _there, now_. Players feel the real park breaking.
- A land's **real waits surge** → the darkness is "massing" there → encounter
  density follows the _real_ crowd.
- **Fireworks fire** → a park-wide **Convergence** (raid) — every present
  player converges, synced to the real show.

This is the sentence that wins the pitch and anchors the product: **the game
world is alive because the real world is alive, and we are the only ones holding
the wire.**

## The product (and the moat that won the deal)

This initiative is a **licensed Kingdom Hearts product**. The data moat is what
made the partnership: Disney has _wanted_ exactly this (they shipped Play Disney
Parks; they monetize Genie+), and we bring the **live-data engine they don't
have** — a game world driven by the real park's actual condition in real time.
See [13 — Roadmap, risks & IP](13-roadmap-risks-ip.md).

We build the full _machine_ (mechanics, systems, the data engine) and ship it in
full Kingdom Hearts dress. **Build the machine; make the live-data hook real; the
working game is the product.**

## The design ethic: heads-up, not heads-down

An Imagineer's deepest objection to "an app in the park" is a plaza full of
people staring at phones instead of at the castle. The Living Layer is
explicitly designed to _fight_ that:

- **Wrist** for ambient awareness — _something is here, look up._
- **Ear** for continuous, hands-free story while walking — _eyes stay on the
  park._
- **Screen / AR** only for the _moment of interaction_ — the reveal, the battle
  — then back in the pocket.

The phone is **punctuation, not the paragraph.** Any feature that demands
sustained heads-down attention in a walkway is a design failure (and a physical
safety hazard — see [09](09-moderation-trust-safety.md)). Full channel design
is in [07 — AR & the multi-channel UX](07-ar-and-channels.md).

## What we reuse vs. what is genuinely new

Almost everything leans on infra we already operate (full mapping in
[11 — Architecture](11-architecture.md)):

| Capability                          | Already have                                           | Net-new                            |
| ----------------------------------- | ------------------------------------------------------ | ---------------------------------- |
| Live park state (the world engine)  | `queue_obs`, `attraction_status_obs`, worker poll loop | re-aim it at encounters            |
| "You are here" / geofences          | park `boundary` GeoJSON, attraction lat/lng            | client geolocation + geofence eval |
| Point-and-reveal AR                 | pin CLIP embeddings / image recognition                | landmark anchors, AR runtime       |
| Persistent identity & accounts      | Better-Auth                                            | game-save tables                   |
| Push / alerting pipeline            | worker alert-eval, Resend, notifications               | push to in-park devices            |
| Atoms↔bits collectible culture      | the pin trading system                                 | digital↔physical crossover         |
| ML forecasting (encounter planning) | `queue_forecast`, ml-train Python service              | spawn weighting                    |

The genuinely new building blocks are: a **client geolocation + geofence
layer**, an **AR runtime** (web-first — see [07](07-ar-and-channels.md) and
[12](12-demo-vertical-slice.md)), client **motion sensing** for verified
achievements, and the **game tables** ([10](10-data-model.md)). Everything
else is re-aiming.

## Strategic principles to lock in

- **The live-data hook is sacred — it is always real.** In the demo and in
  prod, everything else may be scoped or faked, but the reactive darkness is
  always wired to the genuine feed. It is the whole company in ten seconds.
- **Every core loop must be complete solo.** Multiplayer is icing, never the
  cake (see [08 cold-start](08-achievements-persistence-coldstart.md)). A
  feature that's dead with three players present is a broken feature.
- **Verified physical presence is the currency.** You can only _do_ things you
  were genuinely there to do. This is the anti-cheat, the anti-spam, the
  achievement integrity, and the moat, all at once (see
  [06](06-location-and-geofencing.md) and
  [08](08-achievements-persistence-coldstart.md)).
- **Web-first for the demo, native for the product.** Ship a QR-code link a
  skeptical exec can open without an install (see
  [12](12-demo-vertical-slice.md)).
- **Heads-up beats heads-down, always.**
