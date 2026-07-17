# 08 — Achievements, persistence & cold-start

> **Theme:** Three deeply linked systems. **Achievements** are verified-by-
> physics — things a couch app literally cannot produce. **Persistence** is your
> theme-park _life_, recorded — the save file you protect for years. **Cold-
> start** is the empty-world problem, and the flywheel turns it from a bug into
> the engine: your persistent marks _are_ what makes the world alive for the
> next Wielder.

## Part A — Achievements (the part a couch app cannot copy)

### Core insight

Make achievements **verified-by-physics** and you've built a moat. The value
isn't the badge; it's that the badge is _unfakeable_ — it certifies you were
genuinely _there, doing that, then_. That certification is only possible because
of sensor fusion + the live feed ([06](06-location-and-geofencing.md)).

### Categories

| Category                               | Example                                                                                                                         | Why it's unfakeable                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Motion-verified**                    | "rope-drop to close" full day; first-ride-of-the-morning; rode every coaster in the park                                        | geofence + motion + dwell prove presence and the real ride   |
| **Live-state-gated** (rare/surprising) | "rode it in the final 10 min before it went down for the night"; "experienced a hard ride-down event"; "rode in a thunderstorm" | only our feed knows these conditions occurred                |
| **Depth / mastery**                    | "knows this ride" = rode it across day/night/rain/crowds                                                                        | requires repeated real presence under varied real conditions |
| **Discovery**                          | found N hidden details; recognized a landmark; completed a `discovery` chain                                                    | requires being at each spot                                  |
| **Collection**                         | recruited a full World's Companions; completed a keychain set                                                                   | the recruit loop ([05](05-companions-and-proximity.md))      |
| **Social**                             | rode together with N friends; met a stranger in a Convergence                                                                   | co-presence verification                                     |
| **Secret**                             | _unlisted_ — discovered, not checklisted                                                                                        | rewards genuine exploration, the most Imagineering of all    |

### Design rules

- **Earned and surprising, never grindy.** Surface quietly (a wrist buzz, a
  logbook stamp) — never nag with notification spam. Avoid the Xbox-cheevo
  treadmill.
- **Secret achievements are a headline feature**, not an edge case — discovery
  over a visible to-do list is the whole spirit of the layer.
- **Server-authoritative, validated against the live feed.** The client proposes;
  the server confirms with the data it holds.

### The shipped engine, and the boundary (canon, 2026-07-16)

Much of Part A is no longer aspiration: **ParkFi ships a mature civilian
achievements engine** (`src/lib/achievements.ts` +
`src/server/achievements/engine.ts`) — 28 families / 97 tiers as a **catalog
in code** (the DB stores only sticky unlocked tier ids), a location-ping
pipeline folding GPS into `user_park_day` rollups, a queue-dwell state machine
(≥8 min anchored ⇒ a ride), sensor-verified coaster traces, and per-day
condition flags (`rainy`, `rope_drop`, `night_owl`) — precisely the
verified-by-physics checks this doc demands. Its evaluation shape (rows → pure
aggregate → closed-set reconcile → sticky idempotent insert → ceremony delta)
is the **architectural donor for the game's Journal** (GDD §4.2).

The boundary rules (GDD Canon Log 2026-07-16 — _two XP ledgers, permanently_):

1. **Steal the architecture, share the substrate, never merge the systems.**
   ParkFi levels are the civilian identity (works for users who never arm play
   mode, store-review-safe, the app's stablest code); Wielder rank is the game
   (volatile, flagged, IP-entangled). Both consume the same observation tables
   and may share pure helpers lifted into `lib/` (`localParts`, the rain
   query, `pointInPolygon`); **neither server module imports the other, ever**
   (the boundary comment in both files is load-bearing).
2. **Game→app crosstalk is a server-side stat bump** — an allowlisted
   `user_stat` counter (e.g. `breaches_sealed`) the achievements catalog can
   celebrate without knowing the game exists. **Gated on battle integrity**:
   until seals are server-verified, a couch script would farm civilian XP too.
3. **App→game crosstalk is a read** of achievements-owned rows
   (`user_park_day` day flags, `user_attraction`, presence). The **M5b
   presence primitive lands on the achievements side** — that engine already
   owns geo state and the dwell machine — and is consumed by both.

Mark of Mastery trials (GDD §4.1) are achievements-shaped predicates — pure,
unit-tested functions over `encounter_log`/journal rows, built in the same
idiom from day one.

## Part B — Persistence (your theme-park life, recorded)

### Three tiers, increasingly emotional

1. **The logbook / passport** — every visit, every ride, stamped; lifetime
   stats. This is the sentimental core and the most shareable thing we will ever
   ship. A **"Park Wrapped"** year-in-review is a viral inevitability (Spotify
   Wrapped for your theme-park life).
2. **The traveling identity** — _one_ Wielder / roster / rank that persists
   **across parks**: WDW → Disneyland → Universal → Tokyo. The single biggest
   differentiator — it turns a day-trip utility into a **lifelong save file** —
   and the place the IP tension peaks ([13](13-roadmap-risks-ip.md)).
3. **The world contribution** — the `marks` _you_ leave persist for future
   Wielders. **Your past self is literally part of the cold-start solution.**
   Persistence and cold-start are the same mechanism viewed from two ends.

### Seasons

Layer rotating **seasonal overlays** tied to the park's _real_ seasonal events
(detectable from `park_schedule` — Halloween parties, holiday overlays, special
ticketed events). Seasons give a reason to return → returning grows density →
density activates the communal layer → the flywheel again. They also map onto
real Disney seasonal marketing (a pitch point).

## Part C — Cold-start (the empty-world problem)

### Core insight

A "solo-in-social" world is magical with 500 people present and _dead_ with 3.
But we have an unfair advantage and a structural one:

### 1. The real crowd is free density

The most important point: **we don't need many _players_ to feel alive, because
the real park is already full of real people and live-changing data.** Our
`queue_obs` feed makes the world _visibly kinetic_ — lands glow busy, rides go
dark when they break — with **zero** other players online. Reality is our NPC
population. No competitor launching a location game has this; their empty map is
_actually_ empty.

### 2. Async presence, not live raids

The "other players" texture comes from **traces**, not concurrency:

- **Echoes left** by past Wielders ([03](03-marks-and-discovery.md)) — "the
  castle steps hold 4,812 echoes."
- **Dormant Trinity Marks** — cold-start's weakness (nobody's here _right
  now_) converted into anticipation (someone will be); waiting is the
  mechanic, and the awakening push makes last Tuesday matter today.
- "1,204 explorers sealed this World before you."
- Ghost paths / aggregated "how others played here."

Asynchronous presence reads as a living world _without_ requiring people online
right now. (A geocache feels alive when you're alone — because of the logbook.)

### 3. Density-gating

Detect how many players are _actually_ present and **scale the promise**:

- **Sparse** → personal / async / discovery mode (fully satisfying solo).
- **Dense** → unlock true communal events (contested seals, shared-anchor
  Convergences).
- **Never promise a raid to an empty plaza.**

And **pool players across all parks** into shared global state / leaderboards so
the numbers feel big from day one even if any single park is sparse.

### The cardinal rule

> **Every core loop must be complete solo. Multiplayer is icing, never the
> cake.**

Catching, recruiting, sealing, discovering — all satisfying alone. Convergences,
contested seals, and trading _enhance_ but never _gate_ the core experience.

### The decay knob

Recall from [03](03-marks-and-discovery.md): mark **decay rate is the master
volume knob for aliveness.** At launch (sparse), slow decay so marks linger and
the world stays populated; as density grows, speed decay so it stays fresh.
Cold-start is, mechanically, a decay-tuning problem.
