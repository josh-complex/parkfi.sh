# 03 — Marks & discovery (the atomic unit)

> **Theme:** There is one primitive under the entire layer: the **mark**. A
> user-defined discovery pin is a mark. A captured collectible is a mark. An
> achievement is a mark you earned at a place. A live darkness surge is a
> system-authored mark. Your logbook is a timeline of marks. We build _one_
> thing, not a dozen.

## Core insight

Everything in the Living Layer is geo-anchored content with an author, a moment,
a type, and a lifecycle. If we model that primitive once, well, then "user pins
for discovery," "collectibles," "the darkness," "memories," and "dares" are all
the **same table with a different `type`**. This is the single most important
modeling decision in the project.

## Anatomy of a mark

Six fields; the magic is in the combination (concrete schema in
[10 — Data model](10-data-model.md)):

| Field         | Meaning                                | Notes                                                                  |
| ------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| **anchor**    | _where_                                | a coordinate, an attraction, a land, a queue, or a recognized landmark |
| **author**    | _who/what_ left it                     | a `user`, or `SYSTEM` (the world reacting to the live feed)            |
| **moment**    | _when_ + under what live conditions    | timestamp + a snapshot of park state at creation                       |
| **type**      | _what kind_                            | see taxonomy below                                                     |
| **payload**   | _the content_                          | note, photo, creature spec, clue, dare, reward table — typed by `type` |
| **lifecycle** | bloom → persist → decay → fade/claimed | the master tuning knob (see Decay)                                     |

### The integrity rule (binds the whole system)

> **You can only leave a mark somewhere you were verifiably present.**

Creation requires geofence + motion + live-data agreement (see
[06](06-location-and-geofencing.md)). Consequently _every_ mark in the world is
**real by construction**. This single rule is simultaneously our spam defense,
our anti-cheat, the reason an achievement _means_ something, and a core piece of
the moat. It is non-negotiable.

## The taxonomy (one primitive, many `type`s)

| Type          | Author     | What it is                                                                             | Threads it serves            |
| ------------- | ---------- | -------------------------------------------------------------------------------------- | ---------------------------- |
| `discovery`   | user       | a user-defined pin: a note, doodle, or photo left at a spot — the geocaching logbook   | UGC, async-social, sentiment |
| `collectible` | system     | a "spark"/creature/token the world seeds at a real place, reactive to live state       | the catch loop               |
| `world`       | system     | narrative beacon driven by the live feed — the ride-down "Darkness," the crowd "surge" | how the park _speaks_        |
| `dare`        | user       | a micro-challenge left for whoever comes next ("do this, here")                        | solo-in-social               |
| `memory`      | user (you) | _your own_ past, pinned in place — re-experience your last visit                       | persistence, sentiment       |
| `companion`   | system     | a recruitable Companion bound to a land (see [05](05-companions-and-proximity.md))     | the party system             |
| `encounter`   | system     | a spawned Heartless battle (see [04](04-game-design.md))                               | the game core                |

The user explicitly wants **in-park, user-defined pins for discovery** — that is
the `discovery` type, and it is the cleanest, lowest-risk thing to ship first
because it needs no AR and no game balance, only the mark primitive + geofencing

- moderation.

## The key design lever: decay

Marks must **not** live forever — that's the difference between a living world
and a littered one. Give every mark a lifecycle: **bloom → persist → decay →
fade (or claimed).** Decay does three jobs at once:

1. **Freshness** — the world self-cleans; stale content disappears instead of
   accumulating into graffiti.
2. **Urgency & scarcity** — "catch it before it fades" creates pull; rarity
   becomes real.
3. **Cold-start tuning** — decay rate is the **master volume knob for how alive
   the world feels.** Few players → slow decay so marks linger and the world
   stays populated. Crowded → speed it up so it stays fresh. (See
   [08](08-achievements-persistence-coldstart.md).)

Decay is per-`type`:

| Type          | Typical lifecycle                                                                   |
| ------------- | ----------------------------------------------------------------------------------- |
| `memory`      | permanent (your logbook)                                                            |
| `discovery`   | long but finite; extended by upvotes/finds (good content lives longer)              |
| `companion`   | persistent while the recruit window/condition holds                                 |
| `collectible` | short — minutes to hours; despawns                                                  |
| `world`       | tied to the live condition — exists _only_ while the ride is down / the surge holds |
| `encounter`   | short, single-resolution                                                            |

## The discovery layer (user-defined pins), in detail

This is the first shippable slice of the whole initiative — pure utility, no
game balance:

- **Create:** standing at a real spot (verified), a Wielder drops a `discovery`
  mark — a tip ("best photo angle of the castle is from _here_"), a hidden
  detail ("find the hidden Mickey on the third lamppost"), a short note, a
  photo. Creation is **gated by verified presence** — you cannot pin a place
  you aren't at.
- **Find:** other Wielders within the geofence get a wrist/ear cue and can reveal
  nearby discovery marks (list first; AR reveal as the upgrade).
- **React:** finders can upvote / "found it" / report. Good marks earn longer
  decay and surface higher; bad marks decay fast and are reportable (see
  [09](09-moderation-trust-safety.md)).
- **Author feedback:** "your mark was found 47 times" — the asynchronous social
  signal that makes a sparse world feel populated _and_ rewards good authoring.

Discovery marks double as a **ground-truth and content flywheel**: the same
confirmation pattern we already run for `pin_scan` in pin-trading — every
find/upvote is a quality signal we can rank and learn from.

## Rarity, scarcity & the atoms↔bits hook

Live-state-gated rarity is the unique move: a `collectible` that **only** spawns
during a real ride-down, or in the final 10 minutes before fireworks, is
genuinely scarce because the conditions were real and fleeting. That prestige
feeds achievements ([08](08-achievements-persistence-coldstart.md)).

And it crosses over into a business we already run: a rare-enough digital mark
could **relate to, or mint, a physical collectible pin** in the existing pin
system. Atoms ↔ bits, both directions — a moat we're already halfway into.

## How the mark closes the flywheel

> verifiably there → leave a mark → it persists (a while) → the next person
> finds _your_ mark → the world feels alive for them → they leave theirs.

The "other players" a Wielder feels are mostly **people who already left**. That
is precisely why the world works at low density, and it is the same machinery as
persistence ([08](08-achievements-persistence-coldstart.md)). Moderation is the
hard constraint that comes free-riding with UGC marks — designed for from commit
#1 in [09](09-moderation-trust-safety.md).
