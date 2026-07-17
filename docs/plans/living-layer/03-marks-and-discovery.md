# 03 — Marks & discovery (the atomic unit)

> **Theme:** There is one primitive under the entire layer: the **mark**. An
> echo a wielder left is a mark. A claimed collectible is a mark. A dormant
> Trinity is a mark. A registered Lucky Emblem is a mark. A live darkness
> surge is a system-authored mark. Your logbook is a timeline of marks. We
> build _one_ thing, not a dozen.
>
> **Naming rule (canon, 2026-07-16):** "mark" is schema/engineering vocabulary
> only — it is never a user-facing noun. The types are the features, and each
> must be a fiction-first KH artifact (the GDD §3.7 cosmology test) or it
> doesn't ship. The product speaks _breach, echo, Trinity, emblem, letter_.

## Core insight

Everything in the Living Layer is geo-anchored content with an author, a moment,
a type, and a lifecycle. If we model that primitive once, well, then echoes,
collectibles, the darkness, Trinities, and emblems are all the **same table
with a different `type`**. This is the single most important modeling decision
in the project.

## Anatomy of a mark

Six fields; the magic is in the combination (concrete schema in
[10 — Data model](10-data-model.md)):

| Field         | Meaning                                | Notes                                                                                                                                                              |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **anchor**    | _where_                                | a coordinate, an attraction, a land, a queue, or a recognized landmark; player marks **snap to the nearest named anchor** within ~30 m — meanings, not coordinates |
| **author**    | _who/what_ left it                     | a `user`, or `SYSTEM` (the world reacting to the live feed)                                                                                                        |
| **moment**    | _when_ + under what live conditions    | timestamp + a snapshot of park state at creation                                                                                                                   |
| **type**      | _what kind_                            | see taxonomy below                                                                                                                                                 |
| **payload**   | _the content_                          | resonance, note, photo, creature spec, reward table — typed by `type`                                                                                              |
| **lifecycle** | bloom → persist → decay → fade/claimed | the master tuning knob (see Decay)                                                                                                                                 |

### The integrity rule (binds the whole system)

> **You can only leave a mark somewhere you were verifiably present.**

Creation requires geofence + motion + live-data agreement (see
[06](06-location-and-geofencing.md)). Consequently _every_ mark in the world is
**real by construction**. This single rule is simultaneously our spam defense,
our anti-cheat, the reason an achievement _means_ something, and a core piece of
the moat. It is non-negotiable.

## The taxonomy (one primitive, many `type`s)

| Type          | Author | What it is                                                                                                                            | Threads it serves       |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `discovery`   | user   | an **echo** — a heart's feeling left at a place (canon: The Final World); a picked resonance, with text/photo as optional attachments | async-social, sentiment |
| `trinity`     | user   | a **Trinity Mark** — a placement-only sigil, dormant until three hearts have stood on it (weaves via `mark_participant`)              | async co-op, retention  |
| `emblem`      | user   | a **Lucky Emblem** registration — first finder photographs a real hidden Mickey; three confirmations make it permanent registry       | curation, the hunt      |
| `letter`      | user   | a **bottle letter** left for a _named friend_ at a place (future; ships with the friend graph)                                        | friendship, sentiment   |
| `collectible` | system | a "spark"/token the world seeds at a real place, reactive to live state (never a creature — pillar 6)                                 | the collect loop        |
| `world`       | system | narrative beacon driven by the live feed — the ride-down "Darkness," the crowd "surge"                                                | how the park _speaks_   |
| `companion`   | system | a recruitable Companion bound to a land (see [05](05-companions-and-proximity.md))                                                    | the party system        |
| `encounter`   | system | a spawned Heartless battle (see [04](04-game-design.md))                                                                              | the game core           |

> **2026-07-16 taxonomy revision:** `dare` is **cut** — it fails the cosmology
> test and anonymous strangers instructing guests to _do things_ in a physical
> park is a [09](09-moderation-trust-safety.md) surface we decline to build;
> system-authored Trinity content absorbs its role. `memory` is no longer a
> separate type: an echo **never fades for its author**, for whom it is simply
> their memory at that spot — memory and echo are **one row with a visibility
> flag** ([10](10-data-model.md)). `discovery` remains the storage type; the
> rename to `echo` is UI-only for now (schema rename is a deferred decision,
> GDD open questions).

Echoes are the cleanest, lowest-risk thing to ship first: no AR, no game
balance, only the mark primitive + geofencing + (structured-first) moderation.

### One primitive, applied twice more

- **Participation** — trinity weaves and emblem confirmations are the same
  shape: `mark_participant (mark_id, wielder_id, role:
planter|woven|witness|confirmer|companion, at, verification)`. One table
  answers "who touched this shared mark, and how" for every current and future
  participatory type ([10](10-data-model.md)).
- **Events** — the mark's pulse is a property of the primitive itself:
  row-level triggers on `mark` (`AFTER INSERT`, `AFTER UPDATE OF state`) fire
  `pg_notify`, so **every writer, current and future, emits world events with
  zero app-code discipline**. The event vocabulary and the wire live in
  [11](11-architecture.md).

## The key design lever: decay

Marks must **not** live forever — that's the difference between a living world
and a littered one. Give every mark a lifecycle: **bloom → persist → decay →
fade (or claimed).** Decay does three jobs at once:

1. **Freshness** — the world self-cleans; stale content disappears instead of
   accumulating into graffiti.
2. **Urgency & scarcity** — "claim it before it fades" creates pull; rarity
   becomes real.
3. **Cold-start tuning** — decay rate is the **master volume knob for how alive
   the world feels.** Few players → slow decay so marks linger and the world
   stays populated. Crowded → speed it up so it stays fresh. (See
   [08](08-achievements-persistence-coldstart.md).)

Decay is per-`type`:

| Type          | Typical lifecycle                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discovery`   | an echo fades _for others_ in ~4–6 weeks unless resonated (good content lives longer) — and **never for its author**, for whom it is their memory (the logbook) |
| `trinity`     | dormant ~14 days, refreshed by each new weave; near expiry, woven wielders get one "it's fading" push; expires quietly (self-cleaning placements)               |
| `emblem`      | pending until 3 confirmations, then **permanent registry** (first-witness credit forever)                                                                       |
| `companion`   | persistent while the recruit window/condition holds                                                                                                             |
| `collectible` | short — minutes to hours; despawns                                                                                                                              |
| `world`       | tied to the live condition — exists _only_ while the ride is down / the surge holds                                                                             |
| `encounter`   | short, single-resolution                                                                                                                                        |

## The echo layer, in detail

The first shipped slice of the whole initiative (live as discovery pins; the
echo refiction is the priority-2 feel workstream) — pure utility, no game
balance:

- **Leave:** standing at a real spot (verified), a wielder's heart leaves an
  **echo**. The prompt is feeling-first — _"what did this place make you
  feel?"_ — never "add a note." The **required** part is a picked
  **resonance** (~6 named feelings: wonder, joy, calm, thrill, nostalgia,
  mischief); free text and photo are **optional attachments**, unlockable
  later or trust-gated — so v1 ships with **zero text-moderation surface**
  and stays emotionally legible. ~1 per wielder per anchor per day, ~10 per
  park-day. Creation is **gated by verified presence** — you cannot leave an
  echo where you aren't.
- **Find:** inside the anchor's geofence the wrist/ear cues resonance; reveal
  shows the nearest echoes. Echoes **bin by anchor** — the map shows _places
  that hold echoes_ ("the castle steps hold 4,812 echoes — 37 today"), so
  density is ambience, never clutter, and a heavily-echoed spot glowing on
  the map is the tier-0 aliveness signal.
- **Resonate:** touching an echo reads it and offers **resonate** (the
  upvote, refictioned) — resonance extends the echo's decay; bad content
  decays fast and is reportable ([09](09-moderation-trust-safety.md)).
  Counters speak KH: _"12 hearts have touched this echo."_
- **Author feedback:** the echo-touched push (FCM) — the asynchronous social
  signal that makes a sparse world feel populated _and_ rewards good
  authoring. Echoes left and resonated also kindle the **World's light**
  (GDD §3.7), so leaving one is a defensive act in the same war as battle.

Echoes double as a **ground-truth and content flywheel**: the same
confirmation pattern we already run for `pin_scan` in pin-trading — every
resonance is a quality signal we can rank and learn from; emblem
confirmations reuse the pattern verbatim.

## Rarity, scarcity & the atoms↔bits hook

Live-state-gated rarity is the unique move: a `collectible` that **only** spawns
during a real ride-down, or in the final 10 minutes before fireworks, is
genuinely scarce because the conditions were real and fleeting. That prestige
feeds achievements ([08](08-achievements-persistence-coldstart.md)).

And it crosses over into a business we already run: a rare-enough digital mark
could **relate to, or mint, a physical collectible pin** in the existing pin
system. Atoms ↔ bits, both directions — a moat we're already halfway into.

## How the mark closes the flywheel

> verifiably there → leave an echo → it persists (a while) → the next person
> touches _your_ echo → the world feels alive for them → they leave theirs.

The "other players" a Wielder feels are mostly **people who already left** —
and Trinity Marks convert that same low-density reality into anticipation:
waiting for the third heart _is_ the mechanic. That is precisely why the world
works at low density, and it is the same machinery as persistence
([08](08-achievements-persistence-coldstart.md)). Moderation is the hard
constraint that comes free-riding with UGC — designed for from commit #1 in
[09](09-moderation-trust-safety.md), and deliberately shrunk by this taxonomy
(structured-first echoes, zero-text trinities, bounded emblem curation).
