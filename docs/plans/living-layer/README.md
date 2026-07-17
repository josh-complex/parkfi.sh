# The Living Layer — an in-park, location-native, AR experience

> **Theme:** Turn parkfi from _a dashboard you check from your couch_ into _a
> companion you hold in your hand while standing in the park._ The park stops
> being a subject we report on and becomes the **medium we play on**. The phone
> is a lens, an ear, and a buzz on the wrist — the real physical environment is
> the console, and our **live operational feed is the world engine**.
>
> The flagship expression of this is a Pokémon-GO-scale, location-native AR
> game with a Kingdom-Hearts-shaped design: you are a wielder of light, you
> **hunt the darkness rather than catch it** — defeating enemies for drops,
> forging keys and gear, ranking toward Mastery — you **recruit companions by
> physically reaching the lands they belong to**, and when the park itself
> convulses, cloaked antagonists step through for time-limited chaos battles.
> All of it driven by the _real_ park breaking, surging, and celebrating in
> real time.

This directory is the end-to-end design record for that initiative — the
deliberately exhaustive **build spec** for the product. The Kingdom Hearts IP is
licensed, so the docs, code, and UI use the canonical KH vocabulary directly
(Keyblade wielder, Worlds, Heartless, and so on).

## The one-paragraph thesis

Every location game on earth has a static world — Niantic spawns things on a
timer, Disney's own apps script their content. **We have something none of them
have: a real-time feed of the physical park's actual condition** (`queue_obs`,
`attraction_status_obs`, schedules, weather). That means our game world can be
_genuinely reactive_ — a ride that really goes down leaks darkness _right there,
right now_; a land whose real wait times surge is where the enemies mass; the
real fireworks are the raid finale. That reactivity, layered on the strongest
character IP on earth, is the moat. It falls out of infrastructure **we already
run**.

## Document map

> **Start here: [GDD.md](GDD.md) — the game design canon.** Source of truth for
> concepts, the domain model (userspace / enemyspace / worldspace / eventspace /
> companionspace / socialspace / interactionspace), interaction schemes, balance
> knobs, and the loose story. The numbered docs are deep dives it sits above; if
> they disagree, the GDD wins.
>
> **For build status, go straight to [GDD §10](GDD.md)** — the "where we are
> right now" block (shipped / known gaps / actively next) plus the per-system
> real-vs-designed table. It is required to be updated in the same change as
> any milestone that ships.

| #   | Doc                                                                                | What it covers                                                                                       |
| --- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| ★   | [GDD.md](GDD.md)                                                                   | **Game design canon** — pillars, glossary, the spaces, loops, interaction, story, balance, decisions |
| 01  | [Vision & strategy](01-vision-and-strategy.md)                                     | Why, the moat, the design ethic                                                                      |
| 02  | [The living layer & the flywheel](02-living-layer-and-flywheel.md)                 | The core mental model; the self-reinforcing loop                                                     |
| 03  | [Marks & discovery](03-marks-and-discovery.md)                                     | The atomic unit; echoes, Trinity Marks, Lucky Emblems, letters; decay                                |
| 04  | [Game design — the machine](04-game-design.md)                                     | Worlds, encounters, the darkness engine, battles, progression                                        |
| 05  | [Companions & land-proximity](05-companions-and-proximity.md)                      | Square-Enix-style party system gated by physical land proximity                                      |
| 06  | [Location & geofencing](06-location-and-geofencing.md)                             | Tracking, sensor fusion, battery, anti-spoof, privacy                                                |
| 07  | [AR & the multi-channel UX](07-ar-and-channels.md)                                 | Screen / ear / wrist / AR; the reveal; web-AR tech path                                              |
| 08  | [Achievements, persistence & cold-start](08-achievements-persistence-coldstart.md) | Verified-by-physics, the save file, the empty-world problem                                          |
| 09  | [Moderation, trust & safety](09-moderation-trust-safety.md)                        | The (deliberately shrunken) UGC surface, physical safety, the two-layer model                        |
| 10  | [Data model](10-data-model.md)                                                     | New Drizzle tables; how they hang off the existing schema                                            |
| 11  | [Architecture](11-architecture.md)                                                 | How every piece reuses infra we already operate                                                      |
| 12  | [The demo / vertical slice](12-demo-vertical-slice.md)                             | What to build first; the in-app lite-AR demo; the dev/armchair mode                                  |
| 13  | [Roadmap, risks & IP](13-roadmap-risks-ip.md)                                      | Phasing, the IP fork, the kill-risks                                                                 |
| 14  | [Implementation plan](14-implementation-plan.md)                                   | File-by-file build plan for the Phase-0 demo (M0–M7)                                                 |
| 15  | [State of the game (2026-07-15)](15-state-of-the-game-2026-07-15.md)               | Audit + research digest — **folded into canon 2026-07-16**; kept as the deep rationale record        |

## Reading order

- **Executives / pitch:** 01 → 02 → 04 → 13.
- **Engineers / build:** 02 → 10 → 11 → 12, then the deep dives (03, 05, 06, 07).
- **Everyone:** start at 01.

## Player-facing brand: **Kingdom Hearts**

The name users see is **Kingdom Hearts**. "Living Layer" stays the _internal_
architecture term — the `living-layer` PostHog flag key, the `living` tRPC
router, and the `Lumen` engine codename are infrastructure names and remain
unchanged. User-facing copy uses **Kingdom Hearts** and its canonical terms.

## Glossary (canonical KH terms)

The game uses Kingdom Hearts vocabulary throughout code, UI, and docs:

| Term                | Meaning (and code identifier)                               |
| ------------------- | ----------------------------------------------------------- |
| **Wielder**         | the player, a Keyblade wielder (`wielder` table / profile)  |
| **Keyblade**        | the player's weapon                                         |
| **Companions**      | party members, recruited by reaching their home World       |
| **Worlds**          | themed lands (`world` table)                                |
| **Heartless**       | the darkness-born enemies (`ref_heartless_type`)            |
| **the Darkness**    | the live spawn phenomenon — a downed ride leaks it          |
| **Sealing a World** | clearing a World's Heartless breach (sealing its keyhole)   |
| **Echo**            | a feeling a wielder left at a place (`mark type=discovery`) |
| **Trinity Mark**    | a dormant sigil that wakes when three hearts stand on it    |
| **Lucky Emblem**    | a registered real hidden Mickey — the King's sign           |
| **World light**     | communal vitality; dim Worlds darken faster                 |
| **Convergence**     | a live raid / world-event boss                              |

Deeper design tiers in the numbered docs still use working codenames for
not-yet-built concepts — **Nobodies** (Nobodies), **Organization XIII** (Organization XIII),
**incursion** (an Organization incursion), **Journal** (Jiminy's Journal),
**Mark of Mastery** (Mark of Mastery). These map to canonical KH terms and can
be swept once they reach code.
