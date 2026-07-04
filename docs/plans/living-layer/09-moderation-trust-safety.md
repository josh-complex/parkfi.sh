# 09 — Moderation, trust & safety

> **Theme:** Two hazards come _free-riding_ with this product and must be
> designed for from commit #1, not bolted on: **user-generated geo-pinned
> content** (a moderation problem) and **people moving through a crowded physical
> space while looking at a phone** (a physical-safety problem). Neither is
> optional; both have clean design answers that mostly fall out of decisions
> we've already made.

## Part A — UGC moderation (the `discovery`/`dare` marks)

### Core insight

User-generated, geo-pinned content is _inherently_ a moderation surface —
graffiti, harassment, spam, and inappropriate content at emotionally sensitive
real-world spots. The good news: most of the defenses are **already in the mark
model** ([03](03-marks-and-discovery.md)). The bad news: if we don't design for
it from the first commit, it becomes unmanageable fast.

### Defenses (defense in depth)

| Defense                       | Mechanism                                                                                                         | Already in the model?    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Verified-presence-to-post** | you can only leave a mark where you were _verifiably present_ ([06](06-location-and-geofencing.md))               | yes — the integrity rule |
| **Aggressive decay**          | nothing stays long; bad content fades fast, good content (upvoted/found) lives longer                             | yes — the decay knob     |
| **Rate limits**               | per-Wielder caps on marks/hour, escalating with trust/rank                                                        | new, simple              |
| **Reporting + fast takedown** | one-tap report; auto-hide on threshold; human review queue                                                        | new, standard            |
| **Reputation / trust tiers**  | new accounts post to a quarantined layer; trust unlocks reach                                                     | new                      |
| **Automated pre-screen**      | text/image classification (reuse the Claude-API cron pattern, plus an image classifier) before a mark goes public | reuse infra              |
| **Sensitive-zone rules**      | geofenced "no UGC" / curated-only zones (memorials, first-aid, backstage edges)                                   | new, geo-driven          |

### The decision to lock in early: two layers

Split the world into:

- **A curated/system layer** everyone sees by default — `world`, `collectible`,
  `companion`, `encounter` marks. Fully under our control. Safe, always-on.
- **An open player layer** (`discovery`, `dare`) that a Wielder **opts into**,
  governed by all the defenses above.

This bounds the blast radius: the default experience is never at the mercy of
UGC, and the social layer is a deliberate, governable opt-in. **Decide the
curated-vs-open split before writing the first UGC feature** — it shapes
everything downstream.

## Part B — Physical safety (the heads-down hazard)

### Core insight

Pokémon GO caused real injuries from people walking-and-staring (and trespassing,
and crowding). We are operating in **dense, crowded walkways and queue lines** —
the hazard is higher, and a single bad incident is an existential PR/legal risk.
Safety is a _design pillar_, enforced mechanically, not a warning screen.

### Mechanical safety rules

- **Stand-still encounters.** AR battles are stationary by design
  ([04](04-game-design.md), [07](07-ar-and-channels.md)) — you plant your feet;
  nothing requires moving-while-staring.
- **Speed lockout.** If motion sensors detect you're moving fast (walking
  briskly, on a vehicle, on a ride), AR/interactions are _suppressed_ — the
  layer waits until you've stopped. (Also doubles as anti-spoof and an
  in-vehicle courtesy.)
- **Heads-up channel priority.** Wrist + ear carry the 95%; the screen is
  reserved for stationary moments ([07](07-ar-and-channels.md)). The product is
  _designed_ to keep eyes up.
- **No interaction in hazardous zones.** Geofence out interactions on/near ride
  vehicles, escalators, crowded choke points, and water edges.
- **Crowd-aware nudges.** Use the live `queue_obs` surge data to _avoid_
  funneling players into already-packed areas — we have the crowd data, so we can
  be the rare location game that actively _reduces_ congestion (a strong pitch
  point for Disney operations).
- **Gentle session hygiene.** Encourage breaks; never punish putting the phone
  away; design the loop so the _reward_ is the real park, not screen time.

### Trespass / boundary respect

Geofence interactions strictly _inside_ legitimate guest areas (use
`parks.boundary` and World polygons). Never place a mark, spawn, or objective
that induces a Wielder to enter backstage, restricted, or unsafe areas.

## Part C — Why this is also a pitch asset

Framed for Disney: we are the location-game design that is **safety-first and
congestion-aware by construction**, using the live crowd feed to _spread_ foot
traffic and keep players heads-up. That's the opposite of the
guest-experience/liability headache an unsanctioned location game would
represent — and it's only possible because we already hold the operational data.
