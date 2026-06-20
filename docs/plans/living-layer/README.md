# The Living Layer — an in-park, location-native, AR experience

> **Theme:** Turn parkfi from _a dashboard you check from your couch_ into _a
> companion you hold in your hand while standing in the park._ The park stops
> being a subject we report on and becomes the **medium we play on**. The phone
> is a lens, an ear, and a buzz on the wrist — the real physical environment is
> the console, and our **live operational feed is the world engine**.
>
> The flagship expression of this is a Pokémon-GO-scale, location-native AR
> game with a Kingdom-Hearts-shaped design: you are a wielder of light, you
> **recruit companions by physically reaching the lands they belong to**, and
> you fight back the darkness in XR battles — where the darkness is driven by
> the _real_ park breaking, surging, and celebrating in real time.

This directory is the end-to-end design record for that initiative. It is
deliberately exhaustive: it is both the **build spec** for the actual product
and the **pitch artifact** for Disney. (We build the machine; we keep the skin
loose and legally distinct; Disney knows where to find us.)

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

| #   | Doc                                                                                | What it covers                                                  |
| --- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 01  | [Vision & strategy](01-vision-and-strategy.md)                                     | Why, the pitch-vs-product duality, the moat, design ethic       |
| 02  | [The living layer & the flywheel](02-living-layer-and-flywheel.md)                 | The core mental model; the self-reinforcing loop                |
| 03  | [Marks & discovery](03-marks-and-discovery.md)                                     | The atomic unit; user-defined pins; the discovery layer         |
| 04  | [Game design — the machine](04-game-design.md)                                     | Worlds, encounters, the darkness engine, battles, progression   |
| 05  | [Companions & land-proximity](05-companions-and-proximity.md)                      | Square-Enix-style party system gated by physical land proximity |
| 06  | [Location & geofencing](06-location-and-geofencing.md)                             | Tracking, sensor fusion, battery, anti-spoof, privacy           |
| 07  | [AR & the multi-channel UX](07-ar-and-channels.md)                                 | Screen / ear / wrist / AR; the reveal; web-AR tech path         |
| 08  | [Achievements, persistence & cold-start](08-achievements-persistence-coldstart.md) | Verified-by-physics, the save file, the empty-world problem     |
| 09  | [Moderation, trust & safety](09-moderation-trust-safety.md)                        | UGC pins, physical safety, the two-layer model                  |
| 10  | [Data model](10-data-model.md)                                                     | New Drizzle tables; how they hang off the existing schema       |
| 11  | [Architecture](11-architecture.md)                                                 | How every piece reuses infra we already operate                 |
| 12  | [The demo / vertical slice](12-demo-vertical-slice.md)                             | What to build first; web AR; the dev/armchair mode              |
| 13  | [Roadmap, risks & IP](13-roadmap-risks-ip.md)                                      | Phasing, the IP fork, the kill-risks                            |
| 14  | [Implementation plan](14-implementation-plan.md)                                   | File-by-file build plan for the Phase-0 demo (M0–M7)            |

## Reading order

- **Executives / pitch:** 01 → 02 → 04 → 13.
- **Engineers / build:** 02 → 10 → 11 → 12, then the deep dives (03, 05, 06, 07).
- **Everyone:** start at 01.

## Player-facing brand: **Wayfarer**

The name users see is **Wayfarer** (explorer/adventurer energy — travel the
realms, gather your party). "Living Layer" stays the _internal_ architecture
term (and the `living-layer` PostHog flag key + `living` router/`Lumen`
codename remain unchanged) to avoid churn. When writing user-facing copy, use
**Wayfarer**; in code/docs, the internal names persist.

## Naming note (the loose skin)

Throughout these docs the game is referred to by the codename **Lumen**, with
original placeholder nouns for the Kingdom-Hearts-shaped pieces:

| Loose skin (ours, shippable)    | KH reference (the north star) |
| ------------------------------- | ----------------------------- |
| a **Warden** (the player)       | a Keyblade wielder            |
| the **Key** / a Lightkey        | the Keyblade                  |
| **Companions**                  | party members                 |
| **Realms** (themed lands)       | Worlds                        |
| the **Faded** / the **Dimming** | Heartless / Nobodies          |
| **Sealing a Realm**             | sealing a keyhole             |
| **Convergence** (live raid)     | a boss / world event          |

The mechanics are the asset and are entirely ours. The skin is a five-minute
reskin if the pitch lands. Names are placeholders — do not bikeshed them.
