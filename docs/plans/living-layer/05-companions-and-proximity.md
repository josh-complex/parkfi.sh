# 05 — Companions & land-proximity (the party system)

> **Theme:** The party system is the heart of the collection loop, and it is
> **gated by physical geography**. Like a Square Enix RPG, you assemble a party —
> but _which Companions you can field is determined by which land you're
> physically standing in._ Agrabah's hero fights at full strength in the
> desert World and is a guest elsewhere. Geography _is_ the party-builder.

## Core insight

In a normal RPG you pick any party member anywhere. Our twist — the thing
that makes it _location-native_ rather than a normal game with a map skin — is
that **the real park decides your roster.** Companions belong to Worlds (themed
lands); proximity to a land defines who you can recruit there and who fights at
full power. This:

1. makes the **physical act of traveling the park** the core mechanic (you move
   to change your party — exactly the Pokémon-GO "you must go there" pull);
2. gives each land a **distinct identity and reason to visit**;
3. makes the collection loop legible — "to get the pirate, go to the pirate
   land and clear its quest";
4. is **Square-Enix-flavored**: party composition, affinities, and synergy
   matter, but they're spatially constrained.

## Companions are bound to Worlds

Every Companion has a **home World** (a themed land). A Companion is:

- **Recruited** by physically reaching its home World and completing that land's
  signature attraction quest (verified presence — [06](06-location-and-geofencing.md)).
- **Strongest at home** (affinity, below), usable as a _guest_ elsewhere at
  reduced strength.
- **Persistent** once recruited — it's in your roster across sessions and parks
  ([08](08-achievements-persistence-coldstart.md)).

Lands are _not_ yet first-class in the schema — today "land" lives as a text
field on `attraction_meta.land`. The Living Layer promotes **World** to a real
entity with a geofence polygon. See `world` in [10 — Data model](10-data-model.md).

## The three proximity tiers

How "proximity to land" concretely gates the party:

| Tier      | Where you are                              | Effect on a Companion                                                                             |
| --------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **Home**  | inside the Companion's home World geofence | full power + World-only abilities unlocked; eligible for recruit                                  |
| **Guest** | elsewhere in the same park                 | reduced power; core abilities only                                                                |
| **Away**  | a different park entirely                  | benched by default, fieldable at a further penalty (so cross-park travel still _means_ something) |

This is what "use proximity to land to define what party members you can have"
becomes mechanically: **a live, location-derived party-eligibility filter.** The
active party you can field is recomputed every time you cross a World boundary —
another _threshold moment_ (wrist cue: "Jack is at full strength here").

## Affinity & synergy (the Square Enix layer)

- **World affinity** — a Companion's element/role matches its home World's
  Darkness type; in-World, that affinity is a multiplier.
- **Party synergy** — certain Companion _pairs_ unlock combo Surges (KH-style
  team limit breaks). Some pairs are only fieldable when you're in a World where
  _both_ are at least Guest tier — creating spatial puzzles ("to run this combo,
  stand here").
- **Active-party size** grows with Wielder rank; choosing _who_ to field given
  where you are is the moment-to-moment strategy.

## The recruit loop (the collection hook)

1. **Travel** to a World you haven't cleared.
2. **Sense** its signature Companion is recruitable (wrist/ear + a `companion`
   mark blooms at the signature attraction).
3. **Quest** — complete the land's signature challenge: clear N Heartless in the
   World, _and/or_ a ride-as-controller beat (motion-verified ride completion —
   [06](06-location-and-geofencing.md)), _and/or_ find a `discovery` chain.
4. **Recruit** — the Companion joins your roster, permanently.
5. **Deepen** — re-running the World under different conditions (night, rain,
   ride-down) levels and "masters" the Companion.

Disney IP makes this loop unusually sticky: "I'm three Companions away from the
full Fantasyland set" is a _vacation-planning-grade_ motivator. (With the KH
license secured — [GDD §0.5](GDD.md) — Companions ship as real Disney
characters; the current Ember/Tide/Quill seed is placeholder art/names only.)

## Why proximity-gating is strategically right

- It converts the **physical park into the game board** in the most direct
  possible way — you reposition your real body to reposition your party.
- It gives **every land equal pull**, distributing foot traffic (a thing Disney
  _operationally cares about_ — a pitch point).
- It makes **cross-park travel meaningful** (Away tier), powering the lifelong
  save-file differentiator.
- It is **legible**: players always understand _why_ they can/can't field a
  Companion — they can see the World they're standing in.

## Data & eval notes

- A Wielder's **fieldable party** is a pure function of `(roster, current World,
rank)` — computed client-side from a `world` lookup + the roster, validated
  server-side on any action that consumes party state (anti-spoof).
- World geofences come from promoting `attraction_meta.land` into a `world`
  table with a `boundary` polygon (derive initial polygons from the convex hull
  of each land's attraction coordinates; refine later). See
  [10](10-data-model.md).
- Beware the **ghost-duplicate-attractions** gotcha from project memory:
  un-enriched duplicate attraction rows have `category IS NULL`; filter
  `category IS NOT NULL` when deriving World membership and signature
  attractions so phantom rows don't pollute the party logic.
