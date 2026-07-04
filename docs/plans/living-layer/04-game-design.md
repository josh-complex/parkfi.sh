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
was practically designed to be laid over a real park. We use it as the design
reference and ship an original, legally-distinct skin
([13](13-roadmap-risks-ip.md)).

## The mapping: KH systems → park systems

| KH system                            | Lumen system                                                                        | Powered by (existing)                                                |
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

This is what makes Lumen _more_ than Pokémon GO. PoGo's world is static (timers,
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
5. **Resolve** — win → drops (crafting mats, Key XP), a chance at a
   `collectible`, progress toward **Sealing** the World.
6. **Recruit** — completing a World's signature attraction quest unlocks its
   **Companion** ([05](05-companions-and-proximity.md)).
7. **Seal** — clear enough of a World's Darkness to seal it (control-point /
   daily-reset PvE; team-held in dense conditions).
8. **Leave a mark** — drop a `discovery`/`dare`, place your seal — feeding the
   flywheel ([02](02-living-layer-and-flywheel.md)).

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
  [05](05-companions-and-proximity.md)) does most of the work; you choose moves,
  time a **Surge** (limit break, charged by real activity), and target.

v1 battle (demo scope): turn-based, 2–3 moves, one active Companion, a Surge
meter. v2: combos, elemental affinities (Key element vs Heartless type), multi-
Companion synergy, co-op shared-anchor battles.

## Progression & collection (the retention engine)

Disney-grade IP makes collection nuclear-grade motivating. Pokémon GO runs on
"gotta catch 'em all"; Lumen runs on **"recruit every beloved character"** —
a far stronger pull.

- **Companion roster** — the core collection. Each bound to a World; stronger at
  home (affinity — see [05](05-companions-and-proximity.md)). Level via use.
- **The Key** — collect/upgrade Keys themed to Worlds/rides; **synthesis** from
  Heartless drops (KH crafting).
- **The ride is the charge mechanic** — survive Space Mountain's drops (motion
  sensors detect the real ride) and your Surge is charged on exit. Real motion,
  real reward, impossible to fake from a couch.
- **Sealing & World mastery** — depth, not just breadth: a World sealed across
  day/night/rain/crowds is "mastered."
- **Cross-park persistence** — your roster, Keys, and rank travel between parks.
  A new park = new Worlds to seal and new Companions to recruit. This turns a
  day-trip app into a **lifelong save file** — the single biggest differentiator
  ([08](08-achievements-persistence-coldstart.md)).

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
