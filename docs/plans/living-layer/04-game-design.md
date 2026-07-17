# 04 — Game design (the machine)

> **Theme:** A Pokémon-GO-scale, location-native AR game with a Kingdom-Hearts
> shape. You are a **Keyblade wielder**; you travel between **Worlds**
> (the park's themed lands); you recruit **Companions** bound to those Worlds;
> you fight the **Heartless** in XR battles; and the darkness you fight **is the
> real park breaking, surging, and celebrating, in real time.** The mechanics
> are ours; the Kingdom Hearts IP is licensed (see [README](README.md)).

## Why Kingdom Hearts is the perfect north star

Kingdom Hearts is _already_ "Disney parks reimagined as RPG worlds you travel
between, recruiting characters and fighting encroaching darkness." The premise
was practically designed to be laid over a real park. The IP is **licensed**
(canon decision 2026-07-03 — [GDD §0.5, §11](GDD.md)), so we ship the KH
vocabulary directly; guardrails and license terms live in
[13](13-roadmap-risks-ip.md).

## The mapping: KH systems → park systems

| KH system                            | In our game                                                                         | Powered by (existing)                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Worlds                               | **Worlds** — each themed _land_ is a World with its own look, Companions, Heartless | park geo + land geofences ([06](06-location-and-geofencing.md))      |
| Party members                        | **Companions** — recruited by physically reaching the land they belong to           | attraction geofence + quest ([05](05-companions-and-proximity.md))   |
| Heartless / Nobody encounters        | **the Heartless** — geofenced XR battles                                            | geofence + AR + live state                                           |
| The darkness rising                  | **the Darkness** — _the live feed itself_                                           | `queue_obs`, `attraction_status_obs`                                 |
| Keyholes / sealing a world           | **Sealing a World** — per-land control point                                        | geofence + multiplayer                                               |
| Keyblades + synthesis                | **the Keyblade** + crafting from drops                                              | persistence / collection                                             |
| Gummi-ship travel                    | the **cross-park meta-map** — your save travels WDW → DL → Tokyo                    | persistent identity ([08](08-achievements-persistence-coldstart.md)) |
| Drive forms / summons / limit breaks | **Surges** — charged by real activity (riding a coaster powers your party)          | motion sensors ([06](06-location-and-geofencing.md))                 |

Every right-hand column is something we already have the data for.

## The Darkness — the live-state darkness engine (the moat)

This is what makes the game _more_ than Pokémon GO. PoGo's world is static (timers,
pre-placed stops). Ours is **genuinely reactive**, because the live feed is the
encounter engine:

| Real-world event (from our feed)                   | In-game consequence                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| A ride's `attraction_status_obs` flips to **DOWN** | darkness leaks from that attraction → rare/stronger Heartless spawn _there, now_; a `world` mark blooms |
| A land's `queue_obs` waits **surge**               | the Darkness is "massing" there → encounter density follows the _real_ crowd                            |
| `queue_forecast` predicts a quiet window           | a "calm" — fewer spawns, better for recruiting/exploration                                              |
| `park_schedule` **fireworks/parade** fires         | a park-wide **Convergence** (raid) — see below                                                          |
| `weather_obs` storm / rain                         | weather-gated Heartless and rare conditions                                                             |
| Ride comes back **OPERATING**                      | the breach seals; a brief reward window                                                                 |

The encounter spawn table is a **function of (location, time-of-day, live state,
forecast)** — not a timer. Nobody else can compute it, because nobody else holds
the wire. Spawn weighting detail in [11 — Architecture](11-architecture.md).

## The core gameplay loop

1. **Travel** into a World (land) — geofence crossing is a _threshold moment_
   (wrist buzz, ear cue).
2. **Sense** the Darkness — the wrist/ear tells you where darkness is rising
   (driven by live state). Optionally raise the phone for the AR overview of the
   World's "energy."
3. **Encounter** — reach a spawn; a Heartless appears in **AR** on the ground in
   front of you, stand-still.
4. **Battle** — turn-based, your active Companion(s) fight alongside you (see
   Battle system).
5. **Resolve** — win → XP + material drops + a Journal tick (every battle
   advances at least one collection track — pillar 6, [GDD §4](GDD.md)).
6. **Recruit** — completing a World's signature attraction quest unlocks its
   **Companion** ([05](05-companions-and-proximity.md)).
7. **Seal the Keyhole** — clear **every active wound** in a World while the
   darkness presses; the first seal grants that World's **keychain**
   ([GDD §4.3](GDD.md)).
8. **Leave an echo** — a trace of feeling at the place that moved you, place
   your seal — feeding the flywheel and the World's light
   ([02](02-living-layer-and-flywheel.md), GDD §3.7).

Every step is **complete solo**; density only _adds_ (Convergences, contested
seals).

## The battle system

Design constraints first, because they dominate (see
[09](09-moderation-trust-safety.md) for safety):

- **Stand-still and stationary.** You plant your feet; the Heartless appears on a
  detected ground plane in front of you; combat is **turn-based or tap/aim**,
  _never_ flailing around a packed walkway. Designed _for_ the reality of a
  crowded queue line.
- **Short.** A battle is a punchy moment, not a ten-minute heads-down session.
  The phone goes back in the pocket fast.
- **Companion-driven.** Your active party (gated by which World you're in — see
  [05](05-companions-and-proximity.md)) fights with you: each fielded party
  member takes **one ally action per round** plus a **home-World passive**,
  amplified at a breach in their own World (shipped M5a — `fieldParty` in
  `battle.ts`, [GDD §6](GDD.md)). You choose moves, time a **Surge** (limit
  break, charged by real activity), and target.

Shipped battle (M4a/M5a): turn-based, three verbs — **Strike / Guard / Surge**
(canonical numbers in [GDD §6/§8](GDD.md); balance changes update the GDD in the
same change). Next: the loadout modifying the same three verbs, ally actions,
Nobody warp reads; later: elemental affinities, co-op shared-anchor battles.

## Progression & collection (the retention engine)

Disney-grade IP makes collection nuclear-grade motivating. Pokémon GO runs on
"gotta catch 'em all"; we run on **defeat-collection plus "recruit every beloved
character"** — never capture (pillar 6). The canonical progression design —
five braided tracks — lives in [GDD §4](GDD.md); the summary:

- **Wielder rank** — banded `100×r` XP curve with named bands
  (Dreamer → Master-candidate) gated by **Mark of Mastery trials**; the shipped
  linear `floor(xp/100)+1` is the M5 placeholder ([GDD §4.1](GDD.md)).
- **The Journal** — defeat-collection: per-species pages, tally milestones, and
  **live-gated condition entries** (beaten during a real ride-down, in rain, in
  its home World) that only our feed can verify ([GDD §4.2](GDD.md)).
- **Keychains** — sealing a World's Keyhole first grants that World's keychain
  (the KH1 loop); per-park keychain sets are the meta-collection axis
  ([GDD §4.3](GDD.md)).
- **The Forge** — rank-gated gear slots + **synthesis** from deterministic
  Heartless drops (element × tier, Nobody husks, incursion threads)
  ([GDD §4.4](GDD.md)).
- **Companion roster** — each bound to a World; stronger at home (affinity —
  see [05](05-companions-and-proximity.md)). Level via use.
- **The ride is the charge mechanic** — survive Space Mountain's drops (motion
  sensors detect the real ride) and your Surge is charged on exit. Real motion,
  real reward, impossible to fake from a couch.
- **Sealing & World mastery** — depth, not just breadth: a World sealed across
  day/night/rain/crowds is "mastered."
- **Cross-park persistence** — your roster, keychains, and rank travel between
  parks. A new park = new Worlds to seal and new Companions to recruit. This
  turns a day-trip app into a **lifelong save file** — the single biggest
  differentiator ([08](08-achievements-persistence-coldstart.md)).

Escalation belongs to the same engine: wounds left untended draw **Nobodies**,
and multi-signal anomalies roll an **Organization incursion** — the chaos
endgame ([GDD §3.4, §4.6](GDD.md)).

## Convergences (the communal raid)

When the live feed crosses a communal threshold — **fireworks**, a parade, a
major ride-down event, a scheduled "Community Day" tied to a _real_ park event
(Halloween party, holiday overlay) — a **Convergence** fires:

- Every present player's wrist buzzes at once.
- A shared boss / mega-Darkness appears (shared-anchor AR is the v2 dream;
  v1 = synchronized solo instances contributing to one communal bar).
- The crowd converges physically; the resolution is a _collective_ finale,
  synced to the real show.

This is the "fireworks-finale" energy of [02](02-living-layer-and-flywheel.md)
made literal — and it only works because we know the _real_ show is starting.

## Anti-cheat is a game-design pillar, not an afterthought

Because progression is gated on **verified physical presence + real motion +
live-state agreement**, the prestige items (rare collectibles, mastery seals,
live-gated achievements) are things a GPS-spoofer _cannot fabricate_. The
integrity is the moat; the moat is the integrity. See
[06](06-location-and-geofencing.md) for the sensor-fusion mechanics.
