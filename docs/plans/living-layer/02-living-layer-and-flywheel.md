# 02 — The living layer & the flywheel

> **Theme:** There is one mental model under everything: an invisible **second
> layer** laid over the physical park, mirroring and reacting to the real one.
> It has a personal thread and a communal thread, and the seam between them is
> where the magic lives. All of it runs on one self-reinforcing loop.

## The second layer

Picture an invisible layer over the real park — a world that _mirrors and
reacts to_ reality because it's wired to our live feed. It has two threads, and
they are designed to feed each other:

- **The personal thread** — solo, intimate, persistent. Something _you_ carry
  and grow across every visit and every park: your Wielder, your Companion
  roster, your Key, your rank, your logbook. Lives mostly in your **ear and on
  your wrist**. It is _yours_.
- **The communal thread** — live, shared, ambient. The park-wide state. Real
  ride-downs, crowd surges, showtimes, weather, fireworks all become **world
  events every present player feels at once.** This is the fireworks-finale
  energy: a thing happening _to all of us, here, now_.

**The magic is the seam:** your solo actions nudge the communal state, and
communal events change what's possible for you solo. You can play entirely
alone — but the world around you is unmistakably populated by other real humans,
and the biggest moments only resolve when the crowd moves together. That is
"solo aspects inside an inherently social experience," expressed structurally,
not as a bolted-on multiplayer mode.

## "Whose story is it?" — both

A deliberate dual narrative:

- **Park-wide (communal, live):** the world is under threat; the darkness rises
  and falls with the real park; Convergences are shared finales.
- **Personal (solo, persistent):** your Wielder's arc — who you've recruited,
  what you've sealed, where you've been, what you carry between parks.

Neither is subordinate. The personal arc is the _retention_ engine (a save file
you protect for years); the communal layer is the _aliveness_ and the
_virality_ engine (the thing you tell friends about).

## The flywheel

The five systems people think of as separate features — location, achievements,
persistence, geofencing, AR — are not five features. They are **one loop**, and
once it's a loop, the empty-world problem stops being a bug and becomes the
engine.

```
  geofence trigger  ──▶  wrist + ear cue  ──▶  AR reveal
  (you cross a            (eyes up,             (the layer
   threshold)             not down)              appears)
        ▲                                            │
        │                                            ▼
  world stays alive  ◀──  achievement + arc  ◀──  you leave a mark
  (marks seed the         (verified by           (capture or
   next arrival)          physics)               place it)
```

Read it as a sentence:

> You are verifiably **there** (geofence) → the **wrist/ear** pulls your eyes up
> → you raise the phone and **AR reveals** the layer → you interact and **leave
> a mark** (capture something, recruit a companion, place a pin) → that grants
> an **achievement** and feeds your **persistent arc** → your left-behind mark
> **persists in place** → the next person finds _your_ mark → **the world feels
> alive** for them → they leave theirs.

Every node hands off to the next. Two consequences fall straight out:

1. **Cold-start is solved by the loop itself.** The "other players" you feel are
   mostly people who _already left their marks_. The world is populated
   asynchronously, so it feels alive even at low live concurrency (full
   treatment in [08](08-achievements-persistence-coldstart.md)).
2. **Persistence and cold-start are the same mechanism** viewed from two ends —
   the marks _you_ leave are _exactly_ what makes the world alive for the next
   Wielder.

## The two halves of the loop

The flywheel cleaves into two natures, which is also how we color and reason
about it:

- **"In the moment"** (teal in the diagram): geofence → cue → AR reveal. These
  are ephemeral, location-bound, battery-and-attention-expensive. They happen
  _only_ when you're physically standing somewhere meaningful.
- **"Lasting"** (purple): leave a mark → achievement + arc → world stays alive.
  These persist in the database and across sessions, parks, and years. They are
  the asset.

A healthy design keeps "in the moment" _short and punchy_ (you don't stare at
your phone for ten minutes) and makes "lasting" _deep_ (the save file is rich
enough to protect for years).

## Why this is more than the sum of its parts

Any one of these features built alone is a commodity:

- A live map with dots → every wait-time app has one.
- A location game → Niantic owns that genre.
- User pins → that's just geocaching.
- AR → a tech demo.

Wired into the loop, anchored to Disney-grade IP, and **driven by a live feed no
one else holds**, they become a category of one. The loop is the product; the
features are its nodes.
