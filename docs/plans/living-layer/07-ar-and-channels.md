# 07 — AR & the multi-channel UX

> **Theme:** Four channels — **wrist, ear, screen, AR** — choreographed so the
> phone is _punctuation, not the paragraph_. The wrist says "look up," the ear
> narrates hands-free, the screen/AR delivers the _reveal_, then it goes back in
> the pocket. AR is the punchline, never the wallpaper. And the demo is **web
> AR**, so an exec can open it from a QR code with no install.

## Core insight

The deepest Imagineering objection to "an app in the park" is people staring at
phones instead of at the castle. We defeat that by **distributing the experience
across channels by their nature**, reserving the screen for moments that _earn_
it. Get this choreography right and the product feels like magic; get it wrong
and it's another heads-down time-sink (and a safety hazard —
[09](09-moderation-trust-safety.md)).

## The four channels and their jobs

| Channel                 | Job                                            | Attention cost                | When                                                |
| ----------------------- | ---------------------------------------------- | ----------------------------- | --------------------------------------------------- |
| **Wrist** (haptic)      | "something is here — look up"                  | near-zero, eyes-up            | threshold crossings, nudges, Convergence alerts     |
| **Ear** (spatial audio) | continuous story / guidance while walking      | low, hands-free, eyes-on-park | navigation, lore, a Companion talking to you        |
| **Screen**              | maps, roster, the moment of choice             | medium, heads-down            | interactions, party management, the logbook         |
| **AR**                  | the _reveal_ — the layer made visible in place | high, heads-down              | encounters, mark finds, the data-made-physical view |

The choreography of a typical beat:

> **wrist** buzz (_here_) → **ear** cue (_"the Darkness's rising by the
> mansion"_) → raise phone, **AR reveal** (the Heartless appears) → resolve →
> **screen** confirm (drop, roster) → phone back in pocket.

## AR is the punchline, not the paragraph

Rules of engagement for AR:

- **Episodic, not ambient.** AR fires for _moments_ (a battle, a mark find, a
  reveal), then ends. We never ask a Wielder to walk-and-stare.
- **Stand-still.** Encounters are stationary by design (see battle constraints,
  [04](04-game-design.md), and safety, [09](09-moderation-trust-safety.md)).
- **Short.** Seconds-to-a-minute interactions.

### Two AR ideas worth more than the tech

1. **Make the live data physically visible, in place.** Point at a broken ride →
   in AR it's visibly dark/breached. Point at a busy land → it _glows_ with
   "energy." We turn our data feed into **environmental storytelling, on
   location** — and nobody else has the data to do it. This is the single most
   distinctive AR moment we can show.
2. **AR is how you find _and_ leave marks.** The find/leave loop runs through
   the AR viewport — which is exactly what feeds persistence and cold-start
   ([02](02-living-layer-and-flywheel.md), [03](03-marks-and-discovery.md)).

## The AR tech path (ship, don't stall)

Climb the ladder; do not start at the top.

| Rung | Technique                                                                                                                                                                                               | Robustness | When               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------ |
| 1    | **Image-anchored AR** — recognize a known landmark/sign, overlay relative to it. Re-aim the **pin CLIP embedding** tech we already run.                                                                 | High       | **demo / v1**      |
| 2    | **Plane-anchored AR** — drop the Heartless on a detected ground plane in front of a stationary Wielder.                                                                                                 | High       | **demo / v1**      |
| 3    | **VPS (visual positioning)** — Niantic Lightship / Google Geospatial (ARCore) / 8th Wall anchor to a _visually-scanned_ location with sub-meter precision. Google has already mapped much public space. | Medium     | v2                 |
| 4    | **Shared-anchor co-op** — two Wielders pointing at the same spot see the _same_ boss. The magic, and the hard part.                                                                                     | Hard       | v2+ (Convergences) |

Raw GPS will **not** hold a virtual object on a real statue — that's why we start
at image/plane anchors, not world-scale GPS placement.

## Web AR first (the demo's secret weapon)

Our entire stack is web (TanStack Start + tRPC). **8th Wall / WebXR** do
plane-, image-, and location-AR _in the browser_. For the demo this is enormous
(full plan in [12 — Demo](12-demo-vertical-slice.md)):

- **"Scan this QR code at the park and it just works"** — no app store, no
  TestFlight invite for a skeptical exec.
- Reuse existing tRPC + the live feed directly; the Darkness hook is just another
  subscription.
- Ship a _link_; iterate in minutes.

**Native is the eventual product** (better sensors, background geofencing,
battery control, AR fidelity, haptics, audio session management) — but native is
the _wrong_ call for the demo. Build the demo on web AR; pitch the native
roadmap.

## Channel availability & graceful degradation

Not every Wielder has every channel — design down gracefully:

- **No smartwatch?** Wrist cues fall back to phone haptics + a glanceable lock-
  screen widget.
- **No headphones?** Ear narration falls back to short on-screen captions +
  haptics (and we never _require_ audio in public).
- **Weak AR device / declined camera?** Encounters fall back to a 2D "screen"
  battle anchored to the map pin — the loop still completes, just without the
  reveal. (Critical: the _game_ must be playable without AR; AR is the peak, not
  the gate.)
- **Accessibility** is a first-class concern, not a degradation path: audio-first
  play, haptic cues, captions, and high-contrast modes make the layer usable for
  more people, and map cleanly onto the multi-channel design.
