# Kingdom Hearts — Game Design Document (canon)

> **Status:** living canon. This is the **source of truth** for game concepts,
> the domain model, interaction schemes, and the (loose) story. If code or the
> `01–14` docs disagree with this, this wins — or this gets updated _first_,
> deliberately, with a note in the Canon Decision Log at the bottom. The point of
> this doc is to **stop the design from drifting** as we build.
>
> The `01–14` docs remain the deep dives (strategy, architecture, per-milestone
> plans). This GDD sits _above_ them and ties them together.

---

## 0. What Kingdom Hearts is, in one breath

You are a **Kingdom Hearts**: you move through a real theme park while a hidden layer
reacts to it. You're an original **Keyblade wielder** — not Sora, not Aqua, _your_
wielder — and when a ride actually breaks, **darkness leaks from that spot in
real time** and **Heartless** pour out. You find them on the map and **put them
down** — this is a _hunt_, never a catch — taking their **drops to forge
keychains and gear**, filling your **Journal**, and **ranking up toward
Mastery**. Wounds left untended draw **Nobodies**; and when the park itself
convulses — a headliner dead for an hour, a storm wave, a cancelled show — a
**cloaked Organization figure steps through** and every Kingdom Hearts in the park
feels the incursion. Along the way you **seal each World's Keyhole** (earning its
keychain) and **recruit Disney-character party members** native to each land.
The world is alive because it mirrors the _real_ park — and that live feed is
something only we have.

It is a **shippable product** built on **licensed Kingdom Hearts IP**. See §0.5
and [13 — Roadmap, risks & IP](13-roadmap-risks-ip.md).

---

## 0.5 Theming — the canon is Kingdom Hearts

**The creative canon of this game IS Kingdom Hearts, and the IP is licensed** —
Keyblades, Heartless, Worlds, Keyholes, and real Disney-character party members
ship directly. The one hard constraint inside that fantasy:

> **You play as an original, user-created Keyblade wielder — never a core
> character** (no Sora, Riku, Kairi, Aqua, Terra, Ventus, Roxas, etc.). Those
> are NPCs/mentors at most. This mirrors how Kingdom Hearts' own mobile titles
> work (_Union χ_, _Dark Road_): you're a new wielder in the KH universe.

The KH vocabulary is used verbatim throughout the GDD, UI, and copy; it maps to
neutral internal identifiers in code (`mark`, `darkness`, `world`, `companion`,
`wielder`) so the schema reads cleanly and the engine is decoupled from the
theming. `Living Layer` / `living` / `Lumen` stay as internal architecture
names. The glossary below is the term↔code mapping.

---

## 1. Design pillars (non-negotiable)

These are the constitution. Every feature is checked against them.

1. **The live-data hook is sacred.** The Darkness is driven by the _real_ park
   feed (`queue_obs` / `attraction_status_obs` / schedule / weather), never by a
   timer. This is the moat. It is always real, in demo and in prod.
2. **Every core loop is complete solo.** Multiplayer/social is icing, never the
   cake. A feature that's dead with 3 people present is broken. (Cold-start:
   [08](08-achievements-persistence-coldstart.md).) **And complete away
   (2026-07-30):** the game is whole for a wielder who never enters a park —
   the street game ([19](19-nationwide-hunt-and-synthesis-2026-07-30.md)) is
   a full arc; every rank band is reachable via away trial forms; no away
   door is locked by a park key. Park content is different-and-richer,
   never the missing half.
3. **Verified physical presence is the currency.** You can only _do_ things you
   were genuinely there to do. This is anti-cheat, anti-spam, achievement
   integrity, and moat in one. (Mechanics: [06](06-location-and-geofencing.md).)
   **Sharpened to the line (2026-07-30):** _park presence is the communal
   currency_ — only a wielder standing in a World changes what others see
   (seals, light, weaves, emblems); _personal growth is presence-weighted_ —
   park and street both feed the one save, the park faster and deeper.
   Nothing time-limited is ever power (the equity rule): time-limited things
   are cosmetic, memorial, or recurring.
4. **Heads-up beats heads-down.** The phone is punctuation, not the paragraph.
   Wrist/ear carry the 95%; screen/AR are the _moment_. Anything demanding
   sustained heads-down attention in a walkway is a design failure and a safety
   hazard. ([07](07-ar-and-channels.md), [09](09-moderation-trust-safety.md).)
5. **Additive & safe.** The game never degrades the existing ParkFi product. New
   tables only; flag-gated UI; engine off by default. (See "Build discipline".)
6. **The hunt, not the catch.** We never do creature capture. Collection lives
   in the **Journal** (defeat-collection), the **forge** (keychains/gear from
   drops), and the **roster** (party members) — and every battle must advance at
   least one of those tracks. A win whose only yield is XP is under-designed
   (§4).

---

## 2. Canonical glossary

Read left-to-right: **Kingdom Hearts** is the canonical term we design and ship
(the IP is licensed); **Code** is the identifier in the schema.

| Concept               | Kingdom Hearts                                                      | Code                                                |
| --------------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| the player            | **Keyblade wielder**                                                | `wielder`                                           |
| the weapon            | **Keyblade**                                                        | `keyblade` (future)                                 |
| the enemy             | **Heartless**                                                       | `ref_heartless_type`                                |
| the escalation tier   | **Nobodies** — Dusks (common), Berserker/Sorcerer-class (elite)     | `ref_heartless_type` tier _(future)_                |
| the antagonists       | **Organization XIII** (a cloaked member)                            | `mark type=incursion` _(future)_                    |
| the chaos event       | an **Organization incursion**                                       | incursion engine _(future)_                         |
| the threat            | **the darkness** encroaching                                        | `darkness` engine                                   |
| a land                | **World**                                                           | `world`                                             |
| clearing one spawn    | **closing a wound**                                                 | `mark.state=claimed`                                |
| clearing a whole land | **sealing the World's Keyhole** (first seal grants its keychain)    | world-clear check _(future)_                        |
| an ally               | **Disney-character party member**                                   | `companion`                                         |
| the bestiary          | **Jiminy's Journal**                                                | `encounter_log` + `journal_entry` _(future)_        |
| the weapon loot       | a **keychain** (transforms the Keyblade)                            | `keyblade`, `wielder_keyblade` _(future)_           |
| crafting              | **synthesis**                                                       | `material`, `wielder_material` _(future)_           |
| a rank-up gate        | a **Mark of Mastery** trial                                         | `rank_trial` _(future)_                             |
| atomic geo unit       | a mote/trace _(engineering term only — never user-facing)_          | `mark`                                              |
| spawn                 | a **Heartless** swarm                                               | `mark type=encounter`                               |
| a trace a player left | an **echo** — feeling lingering in a place (The Final World)        | `mark type=discovery` _(UI: echo)_                  |
| a private echo        | a **memory** — your own echo, kept for you                          | `mark` visibility flag _(absorbs `type=memory`)_    |
| async co-op sigil     | a **Trinity Mark** (KH1) — wakes when three hearts have stood on it | `mark type=trinity` + `mark_participant` _(future)_ |
| the park's own secret | a **Lucky Emblem** (KH3) — the King's sign                          | `mark type=emblem` + `mark_participant` _(future)_  |
| a message to a friend | the **bottle letter** (Kairi's)                                     | `mark type=letter` _(future, friend-gated)_         |
| communal vitality     | **the light of a World**                                            | derived aggregate _(future)_                        |
| park-wide live event  | a **World-wide darkness surge**                                     | future                                              |

> **Canon:** the player is a **Keyblade wielder**; **Kingdom Hearts** is the
> user-facing brand. Core KH characters are **never playable** — only
> NPCs/mentors.
>
> **Heartless types** map onto our three Heartless codes: **Shadow** ↔ `shade`
> (common), **Neoshadow/Soldier** ↔ `wisp` (fast/fragile), **Large Body /
> Darkside-spawn** ↔ `breaker` (born from a downed headliner — the big one).
> **Nobody types** (future codes): **Dusk** ↔ `husk` (common), **Berserker/
> Sorcerer-class** ↔ `sorcerer` (elite); an **Organization member** ↔ `organization`.
> (The elite code was `echo` before 2026-07-16; renamed to free **echo** for the
> social artifact above — the codes were never shipped. `sorcerer` chosen over
> an invented word: it passes the "what is this in KH?" test.) Heartless are the
> wound; Nobodies are the wound left untended (§3.4).

---

## 3. Domain model — the spaces

The world is decomposed into **spaces**: bounded domains of entities. Each space
lists its entities, key attributes, relationships, lifecycle, and the
tables/code that realize it. This is the model everything must conform to.

```
        EVENTSPACE  (the real park, as a stream of events)
              │ drives
              ▼
        ENEMYSPACE  ──spawns──▶  WORLDSPACE  ◀──authors/owns──  USERSPACE
        (the Darkness,            (places + Marks)               (the wielder,
         Heartless, spawns)                ▲                         party, history)
                                       │ recruits from
                                  COMPANIONSPACE
                                  (allies bound to Worlds)

        SOCIALSPACE spans Worldspace × Userspace (async marks, later co-op)
        INTERACTIONSPACE = how a wielder perceives/acts on all of the above
```

### 3.1 Userspace — _who the player is and what they own_

The Kingdom Hearts and everything attached to them. Persists across sessions/visits/
parks (the "save file"; the cross-park traveling identity is the long-term
differentiator — [08](08-achievements-persistence-coldstart.md)).

| Entity                 | Key attributes                                       | Realized by                               |
| ---------------------- | ---------------------------------------------------- | ----------------------------------------- |
| **Kingdom Hearts**     | rank, xp, home park, display name                    | `wielder`                                 |
| **Party / Roster**     | recruited companions, level, xp                      | `wielder_companion`                       |
| **Logbook**            | history of encounters, recruits, visits              | `encounter_log` (+ future)                |
| **Authored Marks**     | echoes the player left (their memories included)     | `mark` (author_user_id)                   |
| **Loadout** _(future)_ | equipped Keyblade (keychain), armor, accessories     | future `wielder_keyblade`, `wielder_gear` |
| **Satchel** _(future)_ | synthesis materials (element × tier, husks, threads) | future `wielder_material`                 |
| **Journal** _(future)_ | per-species defeat pages + condition entries         | `encounter_log` + future `journal_entry`  |

**Lifecycle:** created lazily on first progression (first battle win upserts the
`wielder` row). Never deleted; grows monotonically.

**Progression:** XP → rank via the banded curve + Mark of Mastery trials (§4.1). The
linear `floor(xp/100)+1` in code — with only two XP sources (seal +10, recruit
+50) — is an M5 **placeholder**; the canonical economy is §4.5. Rank gates
_capacity_ (party slots, gear slots, keychain tier, incursion objective), never
verbs.

### 3.2 Worldspace — _the place, mirrored from reality_

The physical park as a navigable, geo-anchored world, plus the content pinned
into it.

| Entity                       | Key attributes                          | Realized by                              |
| ---------------------------- | --------------------------------------- | ---------------------------------------- |
| **Operator → Resort → Park** | the place hierarchy, geo, hours         | `operators`/`resorts`/`parks` (existing) |
| **World** (land)             | boundary polygon, element, theme color  | `world`                                  |
| **Attraction**               | coords, category, land, signature flag  | `attractions` + `attraction_meta`        |
| **Mark**                     | the atomic geo-anchored unit (§3.3)     | `mark`                                   |
| **Geofence**                 | park/world/attraction/queue/micro tiers | `geofence.ts` (pure)                     |

**Geofence tiers (canonical):** Park → World → Attraction → Queue → Micro-spot.
Crossing a boundary is a _threshold moment_. ([06](06-location-and-geofencing.md).)

**Worldspace generalizes beyond the parks (2026-07-30,
[19](19-nationwide-hunt-and-synthesis-2026-07-30.md)):** the country's
streets are playable space — ambient Heartless, **fissures** (lowercase:
the small doors darkness slips through, sealed with the Keyblade's beam;
a World's **Keyhole** stays a park-scale concept, forever), and regional
Organization manifestations, spawned by a deterministic function of
(geohash, time, **real weather**, region events) with POI anchoring from a
curated open-data class allowlist (no UGC POI program, ever). The parks
remain **the only live-ops-driven, communal-state-bearing places** — the
living layer (darkness propagation from the real feed, beat events, seals,
World light) runs in-park only and street players never experience it.
One game, two textures of alive.

### 3.3 The Mark — the atomic unit (cross-space primitive)

Everything geo-anchored is one `mark` row; `type` selects the payload shape.
This is the most important modeling decision in the project
([03](03-marks-and-discovery.md)).

| Mark `type`   | Author | Lives in               | Meaning                                                         |
| ------------- | ------ | ---------------------- | --------------------------------------------------------------- |
| `encounter`   | system | Enemyspace             | a Heartless spawn to fight                                      |
| `world`       | system | Enemyspace/Worldspace  | narrative beacon of the Darkness                                |
| `collectible` | system | Worldspace             | a catchable (future)                                            |
| `discovery`   | player | Socialspace            | an **echo** — feeling left at a place (§3.7)                    |
| `trinity`     | player | Socialspace            | a **Trinity Mark** — dormant until three hearts (future)        |
| `emblem`      | player | Socialspace/Worldspace | a **Lucky Emblem** registration (future)                        |
| `letter`      | player | Socialspace            | a **bottle letter** to a named friend (future, friend-gated)    |
| `companion`   | system | Companionspace         | a recruit node (future surfacing)                               |
| `incursion`   | system | Enemyspace/Eventspace  | an incursion — an Organization member + Nobody escorts (future) |

> **2026-07-16:** `dare` is **cut** (fails the cosmology test, §3.7); `memory`
> folds into `discovery` as a **visibility flag** — an echo never fades for its
> author, for whom it is simply their memory at that spot. Participation in a
> shared mark (trinity weaves, emblem confirmations) is one table,
> `mark_participant` ([10](10-data-model.md)). **Naming rule:** "mark" is
> schema/engineering vocabulary only — the product speaks _breach, echo,
> Trinity, emblem, letter_; the types are the features.

**Lifecycle (canonical):** `bloom → active → decaying → faded` (or `claimed`).
**Decay is the master tuning knob** for how alive the world feels. Per-type TTL;
the Darkness spawn TTL is `LIVING_SPAWN_TTL_MS` (default 30m), refreshed while the
ride stays down, then lingers after recovery; an echo fades for others in ~4–6
weeks unless resonated (never for its author); a dormant Trinity fades in ~14
days, refreshed by each new weave. Player marks snap to the nearest **named
anchor** (`anchorKey`) within ~30 m — they attach to meanings, not coordinates.
**Integrity rule:** a player can only author a Mark where they're verifiably
present.

### 3.4 Enemyspace — _the antagonist_ (KH: the darkness / Heartless)

| Entity                           | Key attributes                                                                                      | Realized by                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------- |
| **the darkness**                 | the phenomenon; intensity tracks live park state                                                    | `darkness.ts` reconcile           |
| **Heartless**                    | archetype (Shadow/Neoshadow/Large-Body → shade/wisp/breaker), element, stats                        | `ref_heartless_type`, `battle.ts` |
| **swarm**                        | a Heartless spawn at a place/time, rarity, live snapshot                                            | `mark` (encounter)                |
| **Nobodies** _(future)_          | escalation tier — Dusks (common), Berserker/Sorcerer-class (elite); spawn from wounds left untended | future `ref_heartless_type` tier  |
| **Organization XIII** _(future)_ | cloaked bosses at Rifts; phased duel with Nobody escorts (§4.6)                                     | future `mark type=incursion`      |

**Spawn rule (canonical, current):** a ride going **DOWN** lets the darkness in →
**Heartless** pour from that spot; a downed _headliner_ (longer standby) births a
bigger one (a Large-Body/Darkside-class fight). Future inputs: World surges,
weather, forecast, schedule. The rule is a **pure function** of live state
(`spawnDecision` / `heartlessSpec`) so it's testable and tunable.
([04](04-game-design.md), [11](11-architecture.md).)

**Escalation rule (canonical, designed):** Heartless are the wound; **Nobodies
are the wound left untended.** Downtime crossing ~45 min — or a spawn expiring
unclaimed while the ride stays down — escalates the breach: **Dusks** join the
swarm, and elite Nobodies guard the deepest wounds. A headliner down ≥ ~90 min,
≥2 rides down in one World at once, a storm closure wave, or a cancelled show
rolls a **incursion** — an Organization incursion (§4.6). Like `spawnDecision`,
escalation is a pure, level-triggered function of _current_ live state
(downtime duration, world down-count, schedule anomalies) — testable, tunable,
self-healing. **The clock generalizes to the street (2026-07-30):**
fissure-age feeds the same escalation function off-park — a fissure left
untended breeds Dusks, and the regional Organization tier (§4.6) rides the
national weather feed. Same machine, different observation source.

**KH lore hook:** Heartless are drawn to hearts in distress. A ride breaking down
is, in-fiction, a small wound in a World's heart — exactly where they'd gather.
The mechanic and the mythology line up for free. The escalation ladder maps just
as cleanly: **Nobodies** are what remains when a heart is lost — a wound left
too long _hollows out_ — and the **Organization** goes where darkness is being
_used_, probing the Worlds' deepest wounds. The longer the real park hurts, the
higher the fiction climbs.

### 3.5 Eventspace — _time and the live world_

The stream of real-world happenings the game reacts to. **Eventspace is the
engine of Enemyspace** — it's where the moat lives.

| Event source                   | Becomes                                              | Realized by                        |
| ------------------------------ | ---------------------------------------------------- | ---------------------------------- |
| ride DOWN/OPERATING            | spawn / seal                                         | `attraction_status_obs` → darkness |
| downtime crosses ~45 / ~90 min | **escalation**: Dusks join / incursion roll (future) | `attraction_status_obs` duration   |
| ≥2 rides down in one World     | **incursion** risk — Organization incursion (future) | `attraction_status_obs`            |
| show/fireworks **cancelled**   | a **incursion** — the chaos beat (future)            | `park_schedule` diff               |
| queue surge in a World         | rising Darkness density (future)                     | `queue_obs`                        |
| weather (storm/rain)           | weather-gated Heartless (future)                     | `weather_obs`                      |
| fireworks/parade/event         | **Convergence** raid (future)                        | `park_schedule`                    |
| seasons (Halloween, holidays)  | seasonal overlays (future)                           | `park_schedule`                    |

**Reconcile model (canonical):** level-triggered, not edge-triggered. The engine
reads _current_ live state each tick and makes the Mark world match it — so it
self-heals and never strands state. (Why: [14](14-implementation-plan.md).)

### 3.6 Companionspace — _the party members_ (KH: Disney characters)

The collection hook, and the most KH-native idea in the whole design: just as
Sora parties with the Disney character native to each World, **your wielder
recruits the Disney character of each land** — and they fight at full strength
_in their home World_.

| Entity                                      | Key attributes                                                  | Realized by           |
| ------------------------------------------- | --------------------------------------------------------------- | --------------------- |
| **Party member** _(KH: a Disney character)_ | home World, signature ride, element, role, stats                | `companion`           |
| **Recruit condition**                       | close the breach at their signature ride (win the battle there) | `encounter_log` check |
| **Proximity tier**                          | home / guest / away (where the wielder physically is)           | `geofence.tierFor`    |
| **Roster entry**                            | level, xp, recruited-at                                         | `wielder_companion`   |

**Canonical proximity rule:** a party member is strongest in their **home World**,
reduced as a **guest** elsewhere in-park, benched/penalized when **away** (other
park). Geography _is_ the party-builder — repositioning your real body changes who
you can field. ([05](05-companions-and-proximity.md).)

**Party capacity is rank-gated** (1 slot at Dreamer → 3 at Guardian, §4.1), and
party members **act in battle**: one ally action per round plus a home-World
passive (§6; decided 2026-07-03).

**KH casting (canon target):** each land's party member is its iconic Disney
character (e.g. a pirate World → Jack Sparrow; a haunted World → its host; a
frontier World → Woody). Recruiting one = clearing the darkness at _their_ ride.
**Seed note:** the current seed uses placeholder companions (Ember/Tide/Quill)
until the Disney-character roster is authored — same mechanic, final names/art.

### 3.7 Socialspace — _other people_ (mostly future)

Spans Userspace × Worldspace. Async-first (cold-start: the "others" you feel are
people who _already left_ traces). **The cosmology test (canon, 2026-07-16):**
every community feature must be an expression of one of KH's four substances —
_hearts connect; memory is substance; light pushes back darkness; keys open and
close_ — or it doesn't ship. The artifacts:

- **Echoes** (`discovery`) — a heart's feeling left at a place (canon: The
  Final World). Authoring is **structured-first**: the required part is a
  picked resonance (~6 named feelings), free text/photo an optional, later (or
  trust-gated) attachment — so v1 ships with zero text-moderation surface. The
  find-verb is **resonate** ("12 hearts have touched this echo"), which extends
  the echo's decay. An echo never fades for its author — it is their **memory**
  (one row, visibility flag).
- **The light of a World** — communal vitality in [0,1]: raised by seals ≫
  Trinity awakenings > echoes left ≈ echoes resonated, decaying with time
  (τ ≈ 4 days, cold-start floor ~0.35, per-wielder daily caps). Dim Worlds
  spawn rarer Heartless and escalate faster; bright Worlds are calmer and
  recruit better — a self-balancing loop that steers wielders toward neglected
  Worlds. Derived aggregate over existing rows; five named bands (radiant /
  bright / dim / waning / dark) rendered as literal map brightness — on the
  stylized 3D living map (Canon Log 2026-07-30), as **volumetric per-World
  atmosphere**: radiant Worlds gleam, dark Worlds sit in visible gloom.
- **Trinity Marks** (`trinity`) — dormant sigils, placement-only (zero user
  text), that wake when **three hearts** have stood on them — hours or weeks
  apart; everyone woven gets the retroactive push. A woven wielder may instead
  **call on their party** (the KH1 image — Sora, Donald, Goofy): fielded
  companions stand in after ~72 h dormancy, at reduced XP and no bond credit.
  Waiting is the mechanic; co-op that works at low density.
- **Lucky Emblems** (`emblem`) — the real parks' hidden Mickeys as **the
  King's sign**: first finder registers (photo + presence), three wielders
  confirm, the registry is permanent with first-witness credit. UGC becomes
  curation of a bounded registry; the park itself is the content author.
- **Letters** (`letter`, with the tier-3 friend graph) — the bottle letter:
  left for a **named friend** at a place, found when they next stand there,
  even years later.
- Reactions (found/resonate/report) via `mark_reaction`; later Convergences
  (co-op) and trading (atoms↔bits w/ pins).

Delivery rides the five-tier ladder — read-only aggregates → async pushes →
presence rooms → friends → Convergences ([15 §4](15-state-of-the-game-2026-07-15.md)).
**Canon rules:** park-public events carry **aggregates, never identities**;
personal payloads ("your Trinity woke") ride FCM, never the park channel.
`dare` is cut — it fails the cosmology test and was the design's riskiest
safety surface; system-authored Trinity content absorbs its role. Moderation is
a day-one constraint, not a bolt-on ([09](09-moderation-trust-safety.md)).

### 3.8 Interactionspace — _how the wielder perceives & acts_

Not entities — **channels and schemes** (full detail §6). Channels: **map/screen**
(now), **AR** (M4b — native lite-AR in the Capacitor shell; see [07](07-ar-and-channels.md)),
**wrist/ear** (later). The rule: episodic, stand-still, heads-up.

The map/screen channel's canonical form is the **living map** (Canon Log
2026-07-30): a heavily stylized, KH-toned **3D world view** of the real park —
custom basemap style with tilt, stylized 3D park structures, animated 3D
Heartless loitering at breaches, the wielder's own **3D avatar** at their
position (equipped keychain rendered as the visible Keyblade), fielded
companions roaming alongside, and World light as per-World atmosphere (§3.7).
It is the game board, not AR — the screen channel's rules are unchanged
(glanceable, no walk-and-stare mechanics), the avatar is presentational
(server presence truth stays the M5b primitive), and the 2D pin view remains
the reduced-motion / low-end fallback. Build ladder in
[14](14-implementation-plan.md); channel fit in [07](07-ar-and-channels.md).

### 3.9 Dreamspace — _memory, rendered_ (2026-07-30)

The Realm of Sleep, deliberately small: **the Dive** (the Station of
Awakening — FTUE and character creation; a dream claims no presence and
grants identity, never progression) and **Memory Dives** — from any
Journal page, re-enter one of your own recorded fights: the stored move
list replays in the battle theater as a dream; watch or re-fight freely,
yielding nothing the World feels and no XP (its output is Journal
flourishes and fluency). Dream physics, canonical: a dream never touches
any World's state and never claims presence; the heart — the save —
crosses realms intact. The dream is for night; the street hunt (§3.2) is
for daylight; the park is the game at full volume.

---

## 4. Progression & the endgame — the rank, the Journal, the forge, the Organization

> This section answers "what does Pokémon GO run on, and what do we run on
> instead?" PoGo's retention engine is catch-collection plus a trainer level.
> Ours is **defeat-collection** (pillar 6): you never catch a Heartless — you
> put it down, log it, take what it drops, and forge. Four braided tracks:
> **Rank** (the wielder), **the Journal** (the hunt), **the Forge** (keychains
>
> - gear), and **the Organization** (the chaos endgame). The roster (§3.6) is
>   the fifth.

### 4.0 Retrospective — what the shipped placeholder gets wrong

An honest audit of M5-era progression, so the redesign is aimed at real
failures rather than novelty:

| Today (in code)                                                                    | Why it fails long-term                                                     | Redesign                                                                  |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| rank = `floor(xp/100)+1`: linear, unbounded                                        | rank inflates forever, has no identity, gates nothing                      | banded curve + named tiers + trials (§4.1)                                |
| two XP sources (seal +10, recruit +50)                                             | once a park's companions are recruited, battles are economically pointless | full defeat economy + Journal + live-gated bonuses (§4.5)                 |
| a win yields XP and nothing else                                                   | nothing persists between fights; no anticipation on the kill               | drops → materials → keychains & gear (§4.3–4.4)                           |
| collection = companions only                                                       | one-and-done per park; breadth with no depth axis                          | Journal condition pages, keychain sets, forging (§4.2)                    |
| player numbers are constants (`WIELDER_HP`, `MOVES`)                               | growth is a toast, never a felt power change                               | the loadout modifies the same three verbs (§6)                            |
| GDD/code drift (this doc said HP 30 / Strike 6 / Surge 14; code ships 42 / 9 / 22) | the "canon" lost track of the build                                        | corrected in §8; rule: balance changes update this doc in the same change |

### 4.1 Wielder rank — the road to Mastery

**XP is monotonic and never spent** (materials are the spendable resource; XP is
the permanent record). Rank derives from cumulative XP via a curve table, not an
inline formula:

**Curve (canonical):** rank _r_ → _r+1_ costs `100 × r` XP. Cumulative: rank 5 @
1,000 · rank 10 @ 4,500 · rank 15 @ 10,500 · rank 20 @ 19,000 · rank 25 @
30,000. A good park day under the §4.5 economy ≈ 400–700 XP, so the early band
turns over in a visit or two and the high bands are a season of visits — steep
like PoGo's 40+, but every point still comes from play, not grind loops.

**Bands + Mark of Mastery trials (KH: the Mark of Mastery):** crossing into a new
band requires the band's **trial** _in addition to_ the XP — XP alone never
crosses a boundary. Trials are verified-by-physics where possible
([08](08-achievements-persistence-coldstart.md)), each with a desk-testable v1
form; failing is repeatable and never punitive.

| Band                 | Ranks | Capacity unlocked                                               | Trial to enter the band                    |
| -------------------- | ----- | --------------------------------------------------------------- | ------------------------------------------ |
| **Dreamer**          | 1–4   | starter Key; 1 party slot                                       | — (the awakening: your first win)          |
| **Apprentice**       | 5–9   | 2nd party slot; accessory slot; Tier-2 keychains                | close 3 wounds in a single visit           |
| **Adept**            | 10–14 | armor slot; Nobody Journal pages; **defeat** objective at Rifts | defeat a Nobody                            |
| **Guardian**         | 15–19 | 3rd party slot; 2nd accessory; Tier-3 keychains                 | win an incursion duel                      |
| **Luminary**         | 20–24 | +3 forging; secret Journal pages appear as silhouettes          | complete any World's full Journal page set |
| **Master-candidate** | 25+   | prestige cosmetics, seasonal titles                             | —                                          |

**Away trial forms (2026-07-30, per pillar 2's completeness clause):** every
band trial has a **street form** beside its park form — same competency,
different stage (e.g. Apprentice: close 3 wounds in a visit ⇄ seal 3
fissures in a day; Guardian: win an incursion duel ⇄ defeat a regional
Organization manifestation). Bands are reachable by either road; the deed
is **realm-stamped**, and park-form regalia (titles, keychain cosmetics)
stay park-exclusive.

**Keyblade Master** is a _title_, never an XP threshold: awarded for the full
Mark of Mastery chain — every band trial plus a sealed World in ≥2 different
parks. The one thing money, spoofing, or grinding can't shortcut. (The
park requirement here is deliberate and survives the completeness clause:
Master is the park's regalia; the street road's summit is the **Ultima
line** (§4.4) and its own title.)

**Design rules:** gates open _capacity_, never verbs — a rank-1 Dreamer can
fight anything on the map (they'll just lose to a Berserker). No content is
hidden by rank; Rifts scale their _objective_ (survive vs defeat), not their
visibility.

### 4.2 The Journal — defeat-collection (KH: Jiminy's Journal)

The Pokédex analogue, but of _defeats_. One page per species — **one book**
(2026-07-30): park chapters and **street chapters** sit side by side, both
fully real; **condition pages remain live-park-mintable only** (they are
stamped from resolve-time snapshots of the real feed). The Journal's
at-home verb is the **Memory Dive** (§3.9). Street-chapter completion is
100 % reachable without a park visit, by rule.

- **First defeat** fills the silhouette (+25 XP).
- **Tally milestones** (10 / 50 / 200) decorate the page and grant materials.
- **Condition entries** are where the moat lives — each is live-gated, so only
  our feed can verify it: _defeated during a real ride-down_ (naturally earned),
  _in rain_ (`weather_obs`), _after dark_, _in its home World_, _flawless_ (no
  damage taken), _surge-less_.
- **Witness classes (canon, 2026-07-16):** every condition entry needs a
  server-held witness. **World-shaped** conditions (ride-down, rain, after
  dark, home World) are witnessed by live state at battle time;
  **battle-shaped** ones (flawless, surge-less) by the submitted move list
  under server replay. Verdicts are **stamped onto `encounter_log` at
  resolve** — transient witnesses (obs retention, the move list) are heavy or
  gone by evaluation time — while counts stay derived. Stamping ships ahead of
  the Journal itself: every unstamped battle is a trophy that can never be
  awarded retroactively.
- **Completing a page** grants a material cache + a title; **completing a
  World's page set** unlocks that World's keychain upgrade tier. **Secret
  pages** exist and are never checklisted (per [08](08-achievements-persistence-coldstart.md)).
- **Architecture (canon):** the Journal is built as the sibling of the shipped
  ParkFi achievements engine — catalog in code, pure aggregate over
  `encounter_log`, closed-set reconcile, sticky idempotent unlocks
  (`journal_entry`), shared ceremony funnel — never as a fork of it
  ([08](08-achievements-persistence-coldstart.md) Part A records the boundary).
  Emblem pages and Trinity ticks are Journal entry _types_ from day one, not
  retrofits.

Why defeat-collection beats catch-collection _for us_: no box/storage/CP
management to build or moderate; every single battle advances something; and
condition entries marry the live feed — "I beat a Large Body while Space
Mountain was really down, in the rain" is a trophy nobody can fake and no
competitor can even express.

### 4.3 Keyblades & keychains

- Every wielder starts with the **Traveler's Key** (Kingdom-Key class).
- **Sealing a World's Keyhole for the first time grants that World's keychain**
  — the KH1 loop (clear a world, earn its blade). _Sealing the Keyhole_ is now
  canonically **world-level**: clear every active wound in a World while
  darkness presses. Geography is the loot table — a keychain can never drop
  anywhere but its World.
- A keychain defines **Might** (added to Strike), **Surge power**, an element,
  and one signature perk (e.g. the frontier World's key raises material drops
  from its native Heartless).
- One equipped at a time; swap freely outside battle. The forge upgrades a
  keychain +1/+2/+3 using its own World's materials (§4.4), gated by band tier.
- Keychains travel cross-park — the save file gets sharper as it travels — and
  per-park keychain sets are the meta-collection axis.
- **Signature vs crafted (2026-07-30):** a World's keychain **is** that
  World's complete blade (the keychain defines the blade — the canonical
  transformation mechanic), and its **signature perk pool is disjoint from
  the craftable pool by rule** — no Moogle bench recipe can reproduce a
  signature perk. The street's crafted line (§4.4) is broad and deep; the
  park's signature line is irreplaceable.

### 4.4 The Forge — gear & synthesis

- **Slots** (rank-gated, §4.1): armor (flat damage reduction), accessory ×2
  (perks: +XP, +drop rate, Guard efficiency, Surge charge rate).
- **Materials** drop on every win: element × tier (shard →
  stone → gem → **crystal**, with **Orichalcum** as the capstone rarity —
  2026-07-30), plus Nobody-only **husks** and incursion-only **threads**. The drop
  is a **pure deterministic function of (mark seed, species, tier, live
  snapshot)** — the same anti-cheat/testability posture as `heartlessSpec`.
  Families use canonical synthesis names (Blaze, Frost, Thunder, Lucid,
  Power, Dark, Twilight, Mythril), element-keyed to the enemy. **Light
  materials come from tending places** (a sealed fissure exhales a Radiant
  Shard; park Worlds exhale windfalls); **Dark materials come from the
  hunt** — the moral texture lives in the acquisition verbs.
- **Recipes are known upfront** (no recipe RNG). Scarcity lives in materials,
  and the rarest materials sit behind the hardest-to-fake conditions
  (live-gated, presence-verified) — the §8 balance philosophy applied to loot.
- **The Moogle bench — component crafting (2026-07-30,
  [19 §4](19-nationwide-hunt-and-synthesis-2026-07-30.md)):** a crafted
  blade is assembled from three synthesized components — **the Blade**
  (base stats: Might, Guard weight; Power/Mythril line), **the Teeth**
  (the magical property; one elemental family, purity = tier), **the
  Keychain** (the special ability; rare + alignment materials — the slot
  park exclusives live in, see the disjoint rule §4.3). **Alignment** is a
  spectrum from the build's whole material ledger — majority-Light leans
  guard/support ("the road to dawn"), majority-Dark leans power/risk
  (Riku's bargain) — never a faction choice, always re-craftable. The
  bench levels with use (Moogle ranks unlock recipe tiers, never regions).
  The **Ultima line** is the crafting summit: multi-Crystal + Orichalcum,
  whose final catalyst has a park fast-road (a condition material) and a
  street long-road (a season of Organization threads) — both doors open,
  per pillar 2.
- **One forge, two doors:** the park forge (World-keychain upgrades) and
  the Moogle bench (component crafting) are one system — same inventory,
  same recipes engine, same deterministic-drop posture. A wielder's kit is
  one cabinet. Moogle posts on the street are POI-anchored _destinations_;
  the bench is always reachable from the pack after Moogle rank 2 (density
  must never lock crafting).
- **No currency in v1.** The forge barters materials only; munny is an open
  question (§11).

### 4.5 XP economy (canonical, tunable)

| Source                                     | XP                        | Notes                                                               |
| ------------------------------------------ | ------------------------- | ------------------------------------------------------------------- |
| Shadow-class (`shade`) defeat              | +5                        | +2 per rarity step above 1                                          |
| Soldier-class (`wisp`) defeat              | +8                        | 〃                                                                  |
| Large-Body-class (`breaker`) defeat        | +15                       | 〃                                                                  |
| Nobody: Dusk (`husk`)                      | +20                       | fills Adept-band Journal pages                                      |
| Nobody: elite (`sorcerer`)                 | +40                       |                                                                     |
| incursion: survive the duel                | +40                       | any rank                                                            |
| incursion: defeat the Organization member  | +120                      | Adept+ objective                                                    |
| Keyhole seal (first full clear of a World) | +25                       | on top of the battle XP                                             |
| Recruit a party member                     | +50                       | unchanged                                                           |
| Journal: first-of-species                  | +25                       | once per species                                                    |
| Journal: condition entry                   | +15                       | each                                                                |
| Daily first win                            | +20                       | a soft session hook — never a streak-guilt mechanic                 |
| **Street defeat** (any species, off-park)  | ×0.5 of the species value | the presence-weighted fraction (knob, §8); daily street cap applies |
| **Fissure seal**                           | +15                       | + a Radiant Shard; no Keyhole bonus (Keyholes are park-scale)       |
| **Regional Organization event**            | +30 survive / +80 defeat  | threads drop; below park-Rift values by design                      |

> Supersedes the flat "+10 per seal": a win now pays _species_ XP, and the
> Keyhole bonus pays once per World. The code's `10/50` values are the M5
> placeholder until this lands. **Street rows (2026-07-30):** street play
> feeds the same pool at the presence-weighted fraction — the park is
> always faster and deeper, and only the park touches communal state.

### 4.6 Rifts — Organization incursions (the chaos events)

The marquee live-data moment: **when the real park convulses, one of the
thirteen steps through.**

**The regional tier (2026-07-30):** below park Rifts, a member **manifests
regionally on the seasonal rotation** — one member haunting a region for a
window, its anomaly signature now a _weather_ signature (the storm-lover
walks in real storms — the same trigger philosophy, scaled up on the
national weather feed). Timed, phased (escort wave → duel), rank-scaled
objective, **threads** as the exclusive drop — identical reward grammar to
park Rifts with a lower ceiling (§4.5). Park Rifts remain the apex.

**Triggers (canonical; all level-triggered pure functions of live state):**

| Real-world anomaly                       | incursion behavior                                                    |
| ---------------------------------------- | --------------------------------------------------------------------- |
| a headliner down ≥ ~90 min               | the member appears _at the wound_                                     |
| ≥2 attractions down in one World         | the member roams that World                                           |
| storm closure wave                       | a weather-cloaked member, park-wide                                   |
| a scheduled show/fireworks **cancelled** | the boldest beat — the member appears where the show should have been |

**Anatomy of an incursion:** every present Kingdom Hearts gets one park-wide pulse (wrist
buzz / map flare — opt-in, never interrupting a queue). A roaming `incursion`
mark appears: a **cloaked figure** flanked by Nobody escorts, TTL ~45 min. The
fight is **phased** — an escort wave (Dusks), then the duel — same stand-still,
same three verbs.

**Rank-scaled objective, never rank-gated visibility:** below Adept the
objective is **survive** (the classic KH unwinnable-boss homage — surviving
logs the Journal page, pays +40 XP, and drops a thread); Adept and above may
**defeat** the member, who _withdraws_ — unhurried, promising to return (tone
rule §7: driven back, never killed).

**Seasonal rotation (forward):** the thirteen members rotate across a season,
each haunting a different anomaly signature (one favors storm waves, another
cancelled shows, another the dead headliners). A season's roster is a content
calendar that writes itself from weather and ops data. Rewards: threads (the
only source), a secret Journal page per member, seasonal titles/cosmetics.

**Solo-complete (pillar 2):** v1 Rifts are synchronized solo instances; merging
them with shared-anchor Convergences is the later co-op beat (§11 open
questions).

---

## 5. Core loops

Four nested loops; each must stand alone.

- **Moment-to-moment (seconds–minutes):** see a spawn on the map → reach/tap it →
  fight the Heartless (Strike/Guard/Surge, shaped by your loadout) → seal it → XP +
  **drops** + a Journal tick. _Echo variant:_ a place moves you → leave an
  echo / touch one and resonate. _Chaos variant:_ the park-wide incursion pulse → choose to converge →
  survive (or defeat) the duel.
- **Session (a park visit):** travel Worlds → seal breaches as the real park
  breaks → chase the **condition entries today makes possible** (rain pages,
  downtime pages) → recruit the World's Companion by clearing its signature
  ride → **seal the World's Keyhole for its keychain** → forge at day's end →
  leave echoes for the next wielder.
- **Away (any day, any street — 2026-07-30,
  [19](19-nationwide-hunt-and-synthesis-2026-07-30.md)):** walk → the radar
  stirs → fight ambient Heartless / seal a **fissure** / chase the regional
  Organization window → materials → the **Moogle bench** → a better blade →
  walk further. Street fights are solo by design (companions rest near
  their Worlds — the existing `fieldParty` benching falls out correctly);
  weather steers the elemental market. Feeds the one save at the
  presence-weighted fraction (§4.5); never touches communal state.
- **Meta (across visits/parks — retention):** the **trip cycle** — spark →
  journey → **afterglow** (the Chronicle: a guide-voiced per-trip story,
  assembled within ~48 h from rows we already write; M6 re-scoped
  per-trip, with annual Wrapped as its compilation) → the long dark
  (street hunt + Memory Dives + the Vigil: opt-in live spectating of a
  park evening, aggregates only) → **the call** (pinned promises composing
  a next-trip manifest; a received Wayfinder) → **return** (the world
  notices: one recognition beat after >30 days away, zero mechanical
  reward). Climb the rank bands via **Mark of Mastery trials** → complete
  Journal chapters and keychain sets → carry roster/rank/loadout to new
  parks → seasonal Organization rotations. The cross-park save file is
  the long-term hook; **re-trip attach rate is the north star metric**,
  and it guards the street-XP knob (if raising the fraction lowers
  re-trip, the knob turns back).

The **flywheel** ties them: presence → Mark/seal → achievement/arc → the Mark
persists → seeds the world for the next wielder → density grows → communal layer
activates. ([02](02-living-layer-and-flywheel.md).)

---

## 6. Interaction schemes

Per context — input, feedback, channel, and the heads-up/safety rule.

| Context                          | Input                                    | Feedback                                                                                                       | Channel                                    | Rule                                          |
| -------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------- |
| **Explore the map**              | pan/zoom/tilt/tap                        | the living map (§3.8): 3D Heartless at breaches, blue echo shimmers, your avatar + party (pin view = fallback) | screen                                     | glanceable                                    |
| **Encounter / battle**           | tap moves (Strike/Guard/Surge)           | 3D battle theater (2D panel under battery saver); HP bars, combat log                                          | screen now → **AR** (M4b), **stand-still** | short, stationary; speed-lockout in AR        |
| **Leave an echo**                | tap map → pick a resonance (text later)  | leave ceremony + "N hearts touched it" later                                                                   | screen                                     | presence-gated; feeling-first prompt          |
| **Find / resonate**              | tap echo → resonate/report               | resonance ring + counters (KH voice)                                                                           | screen                                     | one-tap                                       |
| **Recruit a companion**          | open Party → Recruit                     | roster + XP update                                                                                             | screen                                     | gated on signature-ride win (→ presence, M5b) |
| **Threshold crossing** _(later)_ | walk across a geofence                   | buzz + a line in your ear                                                                                      | wrist/ear                                  | eyes-up                                       |
| **incursion** _(later)_          | park-wide pulse → converge → phased duel | escort wave, then the duel; rank-scaled objective                                                              | screen now → wrist/AR                      | opt-in; never interrupts a queue; stand-still |
| **Convergence** _(later)_        | converge physically                      | shared finale                                                                                                  | wrist → AR                                 | communal                                      |

**Battle scheme (canonical, current):** turn-based; Wielder HP 42; **Strike** 9,
**Surge** 22 (once per fight), **Guard** halves the next incoming hit; the Heartless
counterattacks each turn. (Solo tuning: a rarity-3 Breaker is only winnable if
Surge is spent — Surge is the skill expression; see `battle.ts`.)

**Companions in battle (canonical, current — shipped):** each fielded party
member takes **one ally action per round** — an **attacker** damages the
Heartless, a **support** mends the Wielder — and enjoys its **home-World
passive**: at a breach in the companion's own World the action is amplified
(×1.5), a guest elsewhere in-park is at ×1.0, and away in another park is
benched. The fielded party is a pure function of `(roster, breach World, rank)`
resolved server-side in `startEncounter` (`fieldParty` in `battle.ts`), so the
client can't fake an off-World boost; capacity is rank-gated (1 slot Dreamer → 2
Apprentice → 3 Guardian, §4.1). With an empty roster this is a no-op, so the
solo tuning above still holds. Which ride broke decides who fights at full
strength — geography _is_ the party-builder (§3.6).

**Battle scheme (designed next):** the loadout modifies the _same three verbs_
— keychain Might adds to Strike, Surge power scales Surge, armor reduces
incoming (§4.3–4.4); **Nobodies warp** — after a telegraph they
dodge your next Strike unless you Guard first (new reads, no new verbs);
Organization duels are phased (escort wave → duel) with a rank-scaled objective
(§4.6). The screen battle renders as a **3D theater** by default (same low-poly
models as the living map; 2D panel under battery saver — Canon Log 2026-07-30);
AR (M4b) swaps the screen theater for a stand-still camera reveal — the _game
stays playable without AR_ (the screen battle is canonical, not throwaway).

---

## 7. Story bible (Kingdom Hearts canon — loose)

> Written in full KH language (per §0.5). Loose on purpose: enough fiction to
> give the systems meaning and a consistent tone, not a fixed plot.

- **Premise:** every theme-park land is a **World** with a heart. When a World's
  heart is wounded — **a ride breaks down**, the magic stalls — **darkness**
  seeps in and **Heartless** gather at the wound. Left alone, the darkness
  spreads toward the World's **Keyhole**.
- **You** are a newly-awakened **Keyblade wielder** — an ordinary guest who can
  suddenly see the layer and summon a Keyblade. _Not_ one of the famous wielders
  (they're legend, or distant mentors); your story is your own. (KH precedent:
  _Union χ_ / _Dark Road_ put you in exactly this seat.)
- **The darkness is weather, not a villain's plot** — it rises and falls with the
  _real_ park, so nothing is scripted. That's the moat dressed as mythology:
  Heartless gather where hearts are in distress, which is literally where rides
  go down.
- **Heartless** come in the classic shapes — **Shadows** (common), quick
  **Neoshadows/Soldiers**, and a hulking **Large-Body/Darkside-class** born when a
  _headliner_ falls.
- **Nobodies** are what remains when a heart is taken. A wound left untended
  _hollows out_, and **Dusks** slither in where the darkness sat too long;
  elite Nobodies guard the deepest wounds. They aren't angry — that's the
  unsettling part. They're _empty_.
- **The Organization** — thirteen cloaked figures — go where darkness is being
  _used_. When a World convulses (a headliner dead an hour, a storm wave, a
  show that never fires), one steps through to study the wound, Nobodies in
  tow. Driven back, they **withdraw** — unhurried, promising to return. Over a
  season, different members haunt different kinds of anomalies.
- **Party members are the Disney characters of each land**, just like Sora's
  journey. You win a character's trust — and their help in battle — by **sealing
  the Keyhole at their ride**. They fight at full power in their home World.
- **Sealing a Keyhole** is the heroic beat: clear _every_ wound in a World while
  the darkness presses, and the Keyblade's light locks the World's heart away
  from the dark again — the World, in thanks, yields its **keychain**.
- **Echoes:** strong feelings linger. When a heart is truly moved, it leaves
  an echo — a small warmth in the stone, invisible to everyone who isn't
  carrying a Key. Touch one, and for a moment two hearts meet across the days
  between them.
- **The light of a World:** a World's heart is kept not only by sealing its
  wounds. Every echo left, every Trinity woken, every breach closed kindles
  its light — and light left untended dims. The darkness always knows where
  no one has been keeping watch.
- **Trinities:** in the old stories, wielders traveled in threes. The sigils
  remember. Plant one and it waits — a promise that others will come. When
  three hearts have stood in the same place, even days apart, the promise
  keeps, and the Trinity wakes for all of them at once. A companion's heart
  counts — it always has — though the old magic burns brightest when all
  three carry Keys.
- **The King's sign:** the King walked these Worlds long before you, and left
  his mark where only the attentive would think to look. Every emblem you
  witness is proof — you saw what he saw.
- **Tone:** the heart of Kingdom Hearts — earnest, warm, lightly melancholic,
  friendship-forward. You **seal and protect**, you don't "kill"; the darkness is
  pushed back, not destroyed.
- **Arc (loose):** a wielder travels World to World, park to park, gathering
  friends and sealing Keyholes against a rising darkness — the _journey and the
  bonds_ are the story.

---

## 8. Economy & balance knobs (current values, all tunable)

| Knob                               | Current                                                                                       | Where                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------ |
| Spawn TTL (linger)                 | 30 min (`LIVING_SPAWN_TTL_MS`)                                                                | `config.ts`              |
| Spawn rule                         | DOWN → Breaker; rarity≥60min standby                                                          | `darkness.spawnDecision` |
| Heartless base stats               | Shade 20/4, Wisp 14/3, Breaker 30/6 (+10/+2 per rarity)                                       | `battle.ts`              |
| Wielder HP                         | 42                                                                                            | `battle.ts`              |
| Moves                              | Strike 9 / Surge 22 (1×) / Guard ½                                                            | `battle.ts`              |
| Companion ally action              | attacker → foe dmg = atk+(lvl−1); support → heal, same; ×1.5 home / ×1.0 guest / benched away | `battle.fieldParty`      |
| Party capacity                     | 1 (rank<5) / 2 (5–14) / 3 (≥15)                                                               | `battle.partyCapacity`   |
| XP economy                         | today: seal +10 / recruit +50 (placeholder); canonical table §4.5                             | `living` router          |
| Rank curve                         | today: `floor(xp/100)+1` (placeholder); canonical: `100×r` per rank + band trials §4.1        | `living` router          |
| Escalation thresholds _(designed)_ | ~45 min unsealed → Dusks; ~90 min headliner / 2-down World / cancellation → incursion roll    | §3.4                     |
| incursion TTL _(designed)_         | ~45 min, roaming                                                                              | §4.6                     |
| Drop table _(designed)_            | deterministic f(mark seed, species, tier, live snapshot)                                      | §4.4                     |
| World light _(designed)_           | τ ≈ 4 d half-life; floor ~0.35; seal ≫ trinity > echo left ≈ resonated; daily caps; 5 bands   | §3.7                     |
| Echo economy _(designed)_          | ~1/wielder/anchor/day, ~10/park-day; fades in ~4–6 wk unless resonated; never for author      | §3.3, §3.7               |
| Trinity lifecycle _(designed)_     | 3 hearts; ~14 d dormancy, refreshed per weave; companion stand-ins after ~72 h at reduced XP  | §3.7                     |
| Echo rate limit                    | 20 / hour (code; supersede with the designed economy above)                                   | `living` router          |
| Report auto-hide                   | 3 reports                                                                                     | `living` router          |

| Street XP fraction _(designed)_ | ×0.5 of species value; daily street cap (size at build) | §4.5, [19](19-nationwide-hunt-and-synthesis-2026-07-30.md) |
| Weather→element table _(designed)_ | rain→Frost/Thunder ↑, heat→Blaze ↑, clear night→Lucid ↑ (full table at build) | 19 §2 |
| Fissure clock _(designed)_ | re-tear after brief communal rest; untended-age feeds Dusk escalation | §3.4, 19 §2 |
| Moogle rank curve _(designed)_ | levels with synthesis; unlocks recipe tiers, never regions; bench-from-pack at rank 2 | §4.4 |
| Ultima dual road _(designed)_ | park condition catalyst (fast) ⇄ a season of Org threads (long) | §4.4 |
| Push budget _(designed)_ | phase-aware caps: afterglow rich; long-dark near-silent absent personal/trip signals | 17 §4.3/§8 |

Balance philosophy: keep the **best rewards behind the hardest-to-fake
conditions** (live-gated, presence-verified) so spoofing the easy stuff yields
little ([06](06-location-and-geofencing.md)).

**The refusals (2026-07-30 — retention anti-patterns, canon so they are
never relitigated piecemeal):** no daily streaks or login calendars; no
energy/stamina timers; no decay of anything personal; no guilt copy in any
notification or bark; no remote verbs against park communal state (gate
projection is sight/social only, and any future waking-World effect from a
non-present player requires its own Canon Log entry with an equity
analysis — the ratchet rule); no expiring power (the equity rule, pillar
3); no second daily-habit app (the game borrows ParkFi's civilian
attention via bounded read-only surfaces, aggregates only, behind the
flag).

---

## 9. Build discipline (so we don't regress the real app)

- **Additive only.** New tables; never alter/drop existing ones. Engine is a
  no-op unless `LIVING_ENABLED=1`; dev tools need `LIVING_DEV=1`; UI gated by the
  PostHog `living-layer` flag (default off).
- **Conventions:** hand-written timestamped migrations (no `drizzle-kit
generate`); run bins via `bun`; filter `category IS NOT NULL` on attractions;
  verify via `bun vp lint` / `bun vp test` (no dev-server boot).
- **Desk-testability is a design constraint.** Prefer mechanics testable without
  a park trip (the spawn injector, the battle, recruit-on-win). Genuinely
  location-bound work (sensor-fusion presence) is split into its own in-park pass.

---

## 10. Status traceability (what's real vs designed)

### Where we are right now (as of 2026-07-16)

> **Maintenance rule (same spirit as the balance canon rule):** any change
> that ships or re-orders a milestone updates this block in the same change.
> This block is the single "you are here"; the table below is the per-system
> detail.

**Shipped and live behind the flag:** the full solo loop — real ride-downs
spawn Heartless (the moat), tap-to-battle with the three-verb kit, companions
recruit off signature-ride wins and act in battle with home-World proximity
passives, echoes (as discovery pins) + reactions, XP/rank (linear
placeholder), all inside the park map behind the PostHog `living-layer` flag.

**Known gaps in what shipped:** battle outcomes are client-trusted (no
sessions, no replay — the §2/Canon-Log integrity hole); `encounter_log`
snapshots are spawn-time-only and thinner than their type (no rain/hour/status
witness at resolve); XP is the flat +10/+50 placeholder; the client is pure
30-second poll (no push channel); growth changes no verbs (no
Journal/drops/keychains yet).

**Actively next (the adopted 2026-07-16 order, amended 2026-07-30; detail in
[14](14-implementation-plan.md)):** ① integrity — sessions + server replay,
with resolve-time verdict stamping shipping first (the only
unrecoverable-if-delayed item); ② the feel workstream (event-queue
architecture: command menu, turn theater, audio/haptics, echo ceremony);
②b the stage — the stylized 3D living map (style/tilt rung first, 3D
Heartless models next, avatar + roaming party after, the 3D battle theater
on the same assets; the atmosphere rung lands with ④; battery saver drops
map→pins and battle→2D panel); ③ the SSE wire; ④ World light; ⑤ the progression spine;
⑥ Trinity Marks + tier-0/1 social; ⑦ emblem-viewfinder lite AR + M5b
presence, same in-park trip; ⑧ Nobodies/Rifts/rooms; **⑨ the trip cycle**
(the Chronicle = M6 re-scoped per-trip, Memory Dives off ①'s stored move
lists, the Vigil/seasonal light, pinned promises + the return beat —
[17](17-retention-and-the-away-game-2026-07-30.md)); **⑩ the nationwide
hunt** (N1 walk MVP → N2 Moogle bench → N3 escalation/regional Org → N4
spatial ceremonies + gates/Wayfinders —
[19 §8](19-nationwide-hunt-and-synthesis-2026-07-30.md); N1 hard-depends
on ① — street fights minting real XP cannot ship client-trusted).

| System                                                                | Space                      | Status                                                                                     |
| --------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| Worlds + geofence lib                                                 | Worldspace                 | ✅ M1                                                                                      |
| Mark primitive                                                        | cross-space                | ✅ M2                                                                                      |
| Darkness engine (DOWN→spawn)                                          | Enemyspace/Eventspace      | ✅ M2                                                                                      |
| Echoes (shipped as discovery pins; refiction ⏳) + react              | Socialspace                | ✅ M3                                                                                      |
| Map UI (Kingdom Hearts view)                                          | Interactionspace           | ✅ M3 (pin view — now the canonical fallback)                                              |
| The living map (stylized 3D: style, models, avatar, atmosphere)       | Interactionspace           | ⏳ designed §3.8 (Canon Log 2026-07-30; ladder in [14](14-implementation-plan.md))         |
| Encounter + 2D battle                                                 | Enemyspace/Interaction     | ✅ M4a (2D panel — now the battery-saver form)                                             |
| 3D battle theater (default screen battle)                             | Interactionspace           | ⏳ designed §6 (Canon Log 2026-07-30; rung 2b-e in [14](14-implementation-plan.md))        |
| Companions: catalog/recruit/roster/XP                                 | Companionspace/Userspace   | ✅ M5                                                                                      |
| Companions acting in battle (ally action + home-World passive)        | Companionspace/Interaction | ✅ M5a (`fieldParty`, §6)                                                                  |
| Companion proximity tiers wired into play (`tierFor` in `fieldParty`) | Companionspace             | ✅ M5a (battle only; roam/party UI still ⏳)                                               |
| Presence verification (sensor fusion)                                 | Userspace/Worldspace       | ⏳ M5b (in-park)                                                                           |
| AR reveal (camera-overlay lite AR → native ARKit/ARCore)              | Interactionspace           | ⏳ M4b                                                                                     |
| Logbook / Wrapped                                                     | Userspace                  | ⏳ M6                                                                                      |
| Rank curve + Mark of Mastery trials                                   | Userspace                  | ⏳ designed §4.1 (linear placeholder shipping)                                             |
| Journal / defeat-collection                                           | Userspace                  | ⏳ designed §4.2                                                                           |
| Keyblades & keychains                                                 | Userspace/Worldspace       | ⏳ designed §4.3                                                                           |
| Forge: gear, materials, synthesis                                     | Userspace                  | ⏳ designed §4.4                                                                           |
| Nobodies (escalation tier)                                            | Enemyspace                 | ⏳ designed §3.4                                                                           |
| Rifts / Organization incursions                                       | Eventspace/Enemyspace      | ⏳ designed §4.6                                                                           |
| Battle integrity (sessions, server replay, verdict stamping)          | Enemyspace/Userspace       | ⏳ designed ([15 §2/§3.10](15-state-of-the-game-2026-07-15.md))                            |
| Push channel (mark triggers → SSE; event vocabulary)                  | Eventspace/Interaction     | ⏳ designed ([11](11-architecture.md))                                                     |
| World light                                                           | Socialspace/Enemyspace     | ⏳ designed §3.7                                                                           |
| Trinity Marks, Lucky Emblems, letters                                 | Socialspace                | ⏳ designed §3.7                                                                           |
| Convergences, seasons, surges                                         | Eventspace                 | ⏳ later                                                                                   |
| Cross-park save, trading, co-op                                       | Socialspace                | ⏳ later                                                                                   |
| The nationwide hunt (streets, fissures, regional Org)                 | Worldspace/Enemyspace      | ⏳ designed §3.2/§4.6 ([19](19-nationwide-hunt-and-synthesis-2026-07-30.md); workstream ⑩) |
| Moogle bench: components, alignment, Ultima line                      | Userspace                  | ⏳ designed §4.4 (one forge, two doors)                                                    |
| The trip cycle: Chronicle, Memory Dives, Vigil, return beat           | Userspace/Interaction      | ⏳ designed §5 ([17](17-retention-and-the-away-game-2026-07-30.md); workstream ⑨)          |
| Gates & Wayfinders (park-minted projection)                           | Socialspace/Interaction    | ⏳ designed ([18 §6](18-realm-of-sleep-nationwide-2026-07-30.md); sight/social only)       |
| Dreamspace (the Dive, Memory Dives)                                   | Interactionspace           | ⏳ designed §3.9                                                                           |
| Away trial forms (street road to every band)                          | Userspace                  | ⏳ designed §4.1                                                                           |

---

## 11. Canon Decision Log (append-only; resolves drift)

- **2026-07-03 — Kingdom Hearts IP licensed; loose skin dropped.** The
  partnership is secured, so docs, UI, and code use canonical KH terms directly.
  Player-facing brand is **Kingdom Hearts**; the player is a **Keyblade wielder**.
  Renamed across the stack: Warden→`wielder`, Realm→`world`, Faded→`heartless`,
  Dimming→`darkness` (schema + a rename migration; the mark lifecycle state
  `faded` is unrelated and unchanged). `Living Layer` / `living` / `Lumen` stay
  as internal architecture names. (See §0.5, README glossary.)
- **2026-06-20 — Creative canon = Kingdom Hearts.** The GDD is themed in full KH
  language (Keyblade / Heartless / Worlds / Keyholes / Disney party members). The
  player is an **original Keyblade wielder** — core characters (Sora, Aqua, et
  al.) are never playable. (See §0.5.)
- **2026-06-20 — Player term.** The player is a **Keyblade wielder** (`wielder`
  in code); **Kingdom Hearts** is the user-facing brand.
- **2026-06-20 — Battle has a canonical 2D form.** AR (M4b) is an enhanced reveal
  layered on top, never a hard dependency.
- **2026-06-20 — Recruit gates on a signature-ride win** (desk-testable); full
  presence-gating deferred to M5b.
- **2026-06-20 — Darkness is level-triggered reconcile** (reads current state),
  so `ingest.ts` is untouched and the engine self-heals.
- **2026-07-03 — Pillar 6: the hunt, not the catch.** The game never does
  creature capture. Collection = the Journal (defeat-collection) + the forge
  (keychains/gear) + the roster. Every battle must advance at least one track.
- **2026-07-03 — Rank redesigned: banded curve + Mark of Mastery trials.** The linear
  `floor(xp/100)+1` is demoted to an M5 placeholder. Canonical: `100×r`-per-rank
  curve, named bands (Dreamer → Luminary), band boundaries gated by
  Mark-of-Mastery-style trials in addition to XP; **Keyblade Master** is a title
  from the full trial chain, never an XP threshold. Gates open capacity, never
  verbs. (§4.1)
- **2026-07-03 — Nobodies = escalation; the Organization = chaos.** Nobodies
  spawn from wounds left untended (downtime duration / unclaimed expiry);
  Organization incursions (Rifts) fire on multi-signal anomalies (2-down World,
  ~90-min headliner, storm wave, cancelled show). Both stay pure level-triggered
  functions of live state. Rifts scale their _objective_ by rank (survive →
  defeat), never their visibility. (§3.4, §4.6)
- **2026-07-03 — Keychains are the weapon loot; the Keyhole is world-level.**
  "Sealing the World's Keyhole" now canonically means clearing every active
  wound in a World; the first seal grants that World's keychain (the KH1 loop).
  Clearing a single spawn is "closing a wound." Recruit gate unchanged (win at
  the signature ride). (§4.3)
- **2026-07-03 — Party members act in battle** (resolves the prior open
  question): one ally action per round plus a home-World passive — not
  passive-only. (§6)
- **2026-07-03 — Balance canon rule.** `battle.ts` had drifted from this doc
  (code 42/9/22 vs a stale 30/6/14 here). Values corrected in §6/§8; henceforth
  any balance change updates the GDD in the same change.
- **2026-07-04 — Alignment pass (no canon change).** Docs 03/04/05/07/10/14
  re-aligned to this GDD: purged leftover pre-license framing ("legally-distinct
  skin", "loose skin"), `Lumen` in design prose, and catch/capture wording
  (pillar 6); doc 04 now points at §4 for the progression tracks and states the
  ally-action battle role; future gear tables unified as `keyblade` /
  `wielder_keyblade` (this glossary's `key_item` corrected to match §2 line for
  weapon loot). §10 gained explicit rows for the two shipped-adjacent gaps:
  companions do **not** yet act in battle, and `geofence.tierFor` (proximity
  tiers) is implemented but unwired.
- **2026-07-04 — Companions act in battle (M5a shipped).** Implements the
  2026-07-03 decision: a fielded party member takes one ally action per round
  (attacker damages the foe, support mends the Wielder) with a home-World
  passive amplifier (×1.5 home / ×1.0 guest / benched away). `fieldParty` +
  `partyCapacity` are pure functions in `battle.ts`; `startEncounter` resolves
  the breach's World from the attraction's land (encounter marks carry no
  `world_id`) and computes the party server-side. Balance note per the canon
  rule: this is additive — an empty roster preserves the solo tuning, but a
  fielded attacker meaningfully shortens a Breaker fight (intended felt power of
  recruiting), gated by rank capacity. Proximity tiers are wired into **battle
  only**; the roam map and party UI still ignore the Wielder's live location
  (that's M5b presence). Open follow-up: the ally-action magnitude is derived
  from `base_stats.atk` — when the Journal/forge land (§4.2–4.4), companion
  power should read from gear/level too, not just seed stats.

- **2026-07-15 — AR tech path revised; web AR is dead.** Facts on the ground:
  Niantic shut the hosted **8th Wall** platform down 2026-02-28 (engine core now
  MIT open source, but SLAM is binary-only and VPS/Maps were never released);
  **WebXR `immersive-ar` remains non-functional on iOS Safari**; and ParkFi now
  ships a **Capacitor native shell**. New canonical ladder (doc 07): rung 1
  camera-overlay "lite AR" (camera preview behind a transparent webview) → rung
  2 native ARKit/ARCore plane anchors via a thin Capacitor plugin → rung 3
  **ARCore Geospatial API** VPS (Niantic Lightship de-prioritized) → rung 4
  shared geospatial anchors for co-op. The demo vehicle is the Capacitor app
  (TestFlight/internal track), not a QR-code web-AR link; a QR web link still
  serves the 2D loop. Docs 01/07/11/12/13/14 re-aligned in the same change. No
  gameplay canon changes: the 2D battle stays canonical and AR stays the
  episodic, stand-still reveal (pillar 4) — a posture now also backed by market
  evidence (Pokémon GO players largely play AR-off; Monster Hunter Now ships
  combat AR-off by default).
- **2026-07-16 — State-of-the-game digest adopted.** Doc
  [15](15-state-of-the-game-2026-07-15.md)'s four research passes (combat feel,
  progression spine, social re-foundation, push channel) are canon; this GDD
  and docs 03/08/09/10/11/14 were re-aligned in the same pass. The build
  priority order is 15 §7: integrity (+ resolve-time verdict stamping +
  loadout pinning) → the feel workstream (one event-queue architecture, three
  consumers) → the wire → World light → the progression spine → social tiers
  and Trinity Marks → emblem-viewfinder lite-AR → escalation/rooms.
- **2026-07-16 — Two XP ledgers, permanently.** ParkFi levels (civilian
  identity, achievements engine) and Wielder rank (the game) are **never
  unified**: shared substrate (obs tables, pure `lib/` helpers), never shared
  modules; game→app crosstalk is a server-side allowlisted `user_stat` bump
  (gated on battle integrity); app→game crosstalk is a read of
  achievements-owned rows. The M5b presence primitive lands on the
  achievements side and is consumed by both. Do not merge the pools in a
  refactor. ([08](08-achievements-persistence-coldstart.md) Part A; 15 §3.11.)
- **2026-07-16 — Battle integrity via server replay; verdicts stamped at
  resolve.** `startEncounter` creates a session row that **pins the loadout**
  (keychain, upgrade level, party); the client submits its **move list**; the
  server replays the deterministic fight (`resolveRound(state, move) →
RoundEvent[]` — the same event list drives turn theater, the battle log, and
  aria-live). `resolveEncounter` stamps a resolve-time snapshot (attraction
  status, weather, park-local hour) and, once replay lands, battle-shaped
  verdict booleans onto `encounter_log` — condition trophies become a pure
  function of the log row forever. Stamping ships **first**; delay here is the
  only unrecoverable loss in the spine. (15 §2, §3.1, §3.10, §3.13.)
- **2026-07-16 — Socialspace re-founded on KH cosmology.** The **cosmology
  test** is canon (§3.7): every community feature expresses one of hearts /
  memory / light / keys, or it doesn't ship. `discovery` is refictioned as the
  **echo** (structured resonance first, UI-only rename — schema rename is a
  deferred, separate decision); `memory` folds into an echo **visibility
  flag**; **`dare` is cut** (cosmology fail + the design's riskiest safety
  surface). **Trinity Marks** wake at exactly **three hearts** — companion
  stand-ins allowed after ~72 h dormancy at reduced XP and no bond credit
  (waiting stays the premium path). **Lucky Emblems** are first-finder
  registration + 3-wielder confirmation into a permanent registry. **World
  light** is a derived per-World aggregate feeding spawn/escalation weights.
  Participation (weaves, confirmations) is one table, `mark_participant`. The
  never-shipped elite-Nobody code `echo` is renamed **`sorcerer`** to free the
  term. (15 §4.1–4.9.)
- **2026-07-16 — The push channel: vocabulary is canon, transports are not.**
  World events are typed, caused, park-scoped, and **simultaneous**:
  `eruption` / `incursion` / `fade` / `seal` / `echo`, growing `light` (band
  crossings only) and `trinity`. Emission is a property of the mark primitive
  (row-level triggers → `pg_notify`), delivery is tRPC v11 SSE
  (`httpSubscriptionLink`) on a public park-scoped subscription. Canon rules:
  **aggregates, never identities**, on the park channel; **personal payloads
  ride FCM only** — a permanent split; `seal` broadcasts are **gated on battle
  integrity**; presentation ships **before** transport (poll-diff feeds the
  same event queue first). (15 §6.1–6.6.)
- **2026-07-30 — The living map: the screen channel goes heavily stylized 3D.**
  The map/screen channel's canonical form is no longer "park basemap with
  pins" but the **living map** (§3.8): a KH-toned custom style with tilt and
  stylized 3D park structures; **animated 3D Heartless models at breaches**
  (replacing coral pins); a **full 3D wielder avatar** at the device position —
  the equipped keychain renders as the avatar's visible Keyblade (the loadout
  made visible; cosmetics become a future forge/drop surface, §4.4); **fielded
  companions roam alongside** the avatar (proximity tiers gain a presentation
  consumer, §3.6); and **World light renders as volumetric per-World
  atmosphere** (§3.7). Guardrails: this is the screen channel, not AR — the
  heads-up rules (pillar 4) are unchanged and no mechanic may require
  watching the map while walking; the avatar is presentational only (server
  presence truth remains the M5b primitive); the 2D battle stays canonical
  (the map is the board, never the fight); the M3 pin view is retained as the
  reduced-motion / low-end fallback, not deleted. Tech intent (detail in
  [14](14-implementation-plan.md)/[07](07-ar-and-channels.md)): MapLibre
  custom style + a three.js custom layer with low-poly glTF assets under an
  explicit battery/LOD budget. Build placement: new workstream **②b ("the
  stage")** — staged rungs behind the feel workstream's presentation queue
  (the queue is the choreography; this is the stage it plays on), with the
  atmosphere rung fused into workstream ④. IP note: stylized 3D renditions
  of park architecture and avatar/Keyblade cosmetics go through the same
  license/brand review as other licensed assets
  ([13](13-roadmap-risks-ip.md)).
- **2026-07-30 — Battles render in 3D by default; 2D is the battery-saver
  form.** Supersedes the "canonical 2D form" clause of 2026-06-20 and the
  "2D battle stays canonical" clauses restated 2026-07-15 and in the
  living-map entry above. The screen battle's default presentation is a **3D
  battle theater**: a three.js scene reusing the living map's low-poly glTF
  Heartless/companion models (one asset buy, both surfaces), driven by the
  same `RoundEvent[]` stream as the turn theater — **mechanics, verbs,
  balance, and server-replay integrity are untouched; this is presentation
  only.** The shipped 2D panel is retained as the **battery-saver** form: one
  client setting drops battle→2D panel and living map→pin view together, and
  the client auto-respects OS low-power mode, reduced-motion, and low-end
  device tiers by defaulting the setting on. What does _not_ change: AR
  (M4b) remains the episodic stand-still reveal layered on top, no loop may
  require the camera, and the screen battle (in either form) stays the
  complete canonical loop. Build placement: rung **(e)** of workstream ②b —
  after rung (b) lands the models and priority 2 lands the event queue.
- **2026-07-30 — The trip cycle adopted (doc 17).** Retention is modeled as
  the **trip cycle** (spark → journey → afterglow → long dark → call →
  return), not daily retention, segmented by visit cadence
  (local / regional / destination / never-visited). Adopted: the
  **Chronicle** (M6 re-scoped from annual Wrapped to per-trip afterglow,
  annual Wrapped as its compilation), **Memory Dives** (Journal fights
  replayed from priority ①'s stored move lists as dreams — watch or
  re-fight, no XP, nothing the World feels), the **Vigil** (opt-in live
  park spectating, aggregates only), **pinned promises** → the next-trip
  manifest, the **return beat** (recognition, zero mechanical reward),
  the phase-aware **push budget**, and the **refusals** block (§8). Letter
  notices carry existence + place, never contents
  ([09](09-moderation-trust-safety.md)). North star: re-trip attach rate.
  Workstream ⑨. (17 §1–§8.)
- **2026-07-30 — One heart, presence-weighted (doc 18's surviving core
  adopted).** The park game and the away game are **one game**: one
  wielder, one rank, one XP pool, one Journal, one forge, one roster.
  The line (pillar 3): **park presence is the communal currency** — only a
  wielder standing in a World changes what others see; **personal growth
  is presence-weighted** — both realms feed the one save, the park faster
  and deeper, under the equity rule (nothing time-limited is power).
  **Gates & Wayfinders** adopted: gates are a curated registry of real
  park landmarks; a present wielder can _open the way_ (a ~15-min live
  window for away players, aggregates only) or _send a Wayfinder_
  (presence-minted, ~1/day, to a named friend: bounded spectral
  projection — move/emote/lantern and live `RoundEvent[]` battle
  spectating; **no waking verbs, ever**), with the **ratchet rule**: any
  future waking-World effect from a non-present player needs its own
  Canon Log entry + equity analysis. **Dreamspace contracts** (§3.9) to
  the Dive + Memory Dives — the Realm-of-Sleep away-game spine (couch
  Dreamscape, depths, Spirits/Nightmares) is **not** adopted; doc 18's
  banner records the supersession by 19. Integrity consequence: away
  fights minting real XP inherit the full priority-① regime (sessions,
  replay, caps) — the away threat model is botting; nationwide, GPS
  spoofing returns (teleport detection moves up,
  [06](06-location-and-geofencing.md)).
- **2026-07-30 — The nationwide hunt & Moogle synthesis adopted (doc
  19).** The typical non-park loop is **get out and walk**: ambient
  Heartless, **fissures** (lowercase — the small doors darkness slips
  through; a World's Keyhole stays park-scale, and copy may never say
  "the Keyhole of \<suburb\>"), Nobody escalation off fissure-age, and a
  **regional Organization tier** on the seasonal rotation with weather
  signatures. Spawns are a deterministic function of (geohash, time,
  real weather, region events); POI anchoring from a curated open-data
  allowlist (Overture/OSM classes — **no UGC POI program, ever**);
  AR via **ARCore Geospatial** ceremonies where covered, screen-only
  everywhere (AR never required). **Synthesis expansion:** the material
  ladder gains **Crystal + Orichalcum**; canonical family names; Light
  materials from tending places / Dark from the hunt; the **Moogle
  bench** crafts component blades (Blade = base stats, Teeth = magical
  property, Keychain = special ability) with **alignment as a
  material-ledger spectrum** (never a faction); Moogle ranks unlock
  recipe tiers; **one forge, two doors** (same inventory/recipes engine
  as the park forge). **Park premium:** the signature-perk pool is
  disjoint from the craftable pool by rule; complete World blades come
  only from in-park Keyhole seals; condition materials are the park's
  Orichalcum; the **Ultima line's** catalyst has a park fast-road ⇄
  street long-road. The in-park living layer is untouched and park-only
  — the parks remain the only place the game world is driven by reality
  breaking in real time. Lore basis: the Ultima Weapon is
  Moogle-synthesized in KH1/2/3 (crafting the strongest blade is the
  series' own endgame loop); keychains are the canonical transformation
  mechanic; KHχ's worldwide wielders precedent; Riku precedents
  dark-aligned wielding. Safety: street annex in
  [09](09-moderation-trust-safety.md) (stand-still, speed lockout, POI
  allowlist). Strategy stated plainly: nationwide we play the Niantic
  shape better-themed (IP + weather-live spawns + one-save unity); **the
  moat lives in the parks**. License **gate zero precedes any build**
  (19 §7; [13](13-roadmap-risks-ip.md)). Workstream ⑩; N1 hard-depends
  on ①.

### Open questions (decide before the relevant build)

- Convergence resolution: synchronized solo instances vs true shared-anchor co-op
  for v1?
- Curated-vs-open split for the Socialspace UGC layer — narrowed by the
  2026-07-16 re-foundation (echoes ship structured-only; emblems are bounded
  curation): what remains is **when/how free-text echo attachments unlock**
  (trust-gated? rank-gated?) and whether they're emotionally necessary at all.
  ([09](09-moderation-trust-safety.md); 15 §4.9.)
- Trinity discount modeling: size the companion stand-in discount and the
  ~72 h delay jointly against realistic park-DAU so waiting dominates wherever
  human completion within ~a week is plausible. (15 §4.9.)
- World-light tuning: τ, band thresholds, contribution weights, cold-start
  floor — simulate against real `attraction_status_obs`; verify the negative
  feedback loop damps rather than oscillates; joint balancing pass with the
  §3.4 escalation clock. (15 §4.9.)
- Emblem photo pipeline: face-blur before storage, review-queue volume,
  spatial+visual dedupe — and the IP question (hidden-Mickey hunt vs Disney's
  own Hidden Mickeys lore/merch). (15 §4.9; [13](13-roadmap-risks-ip.md).)
- Dormant-sigil legibility outdoors: show weave progress (default) vs mystery.
- Schema rename strategy: `discovery`→`echo` UI alias forever vs a real
  migration; same for the `memory` fold — decide before Trinity Marks add
  adjacent code.
- Cross-park identity: when does the "traveling save file" unlock, and does it
  raise the IP question? ([13](13-roadmap-risks-ip.md).)
- **Munny:** does a currency ever join the forge, or does it stay barter-only
  (materials as the sole economy)? (§4.4)
- **incursion co-op:** v1 Rifts are solo-instanced — what density threshold merges
  them with shared-anchor Convergences? (§4.6)
- **Trial verification:** which Mark of Mastery trials demand in-park sensor fusion
  (M5b) vs shipping first in their desk-testable v1 form? (§4.1)
- **Drop seeding:** does the deterministic drop seed live in the mark payload at
  spawn time, or get derived server-side at resolve? (§4.4)
- **Keychain perks cross-park:** does a World-bound perk apply in another
  resort's analogous land (frontier ↔ frontier)? (§4.3)
