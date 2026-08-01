# 07 — AR & the multi-channel UX

> **Theme:** Four channels — **wrist, ear, screen, AR** — choreographed so the
> phone is _punctuation, not the paragraph_. The wrist says "look up," the ear
> narrates hands-free, the screen/AR delivers the _reveal_, then it goes back in
> the pocket. AR is the punchline, never the wallpaper. The AR runtime is
> **native, inside the Capacitor shell** — the web-AR path this doc originally
> planned around died with 8th Wall (see the revised tech path below).

## Core insight

The deepest Imagineering objection to "an app in the park" is people staring at
phones instead of at the castle. We defeat that by **distributing the experience
across channels by their nature**, reserving the screen for moments that _earn_
it. Get this choreography right and the product feels like magic; get it wrong
and it's another heads-down time-sink (and a safety hazard —
[09](09-moderation-trust-safety.md)).

## The four channels and their jobs

| Channel                 | Job                                                                   | Attention cost                | When                                                |
| ----------------------- | --------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------- |
| **Wrist** (haptic)      | "something is here — look up"                                         | near-zero, eyes-up            | threshold crossings, nudges, Convergence alerts     |
| **Ear** (spatial audio) | continuous story / guidance while walking                             | low, hands-free, eyes-on-park | navigation, lore, a Companion talking to you        |
| **Screen**              | the living map (stylized 3D world view), roster, the moment of choice | medium, heads-down            | interactions, party management, the logbook         |
| **AR**                  | the _reveal_ — the layer made visible in place                        | high, heads-down              | encounters, mark finds, the data-made-physical view |

The choreography of a typical beat:

> **wrist** buzz (_here_) → **ear** cue (_"the Darkness's rising by the
> mansion"_) → raise phone, **AR reveal** (the Heartless appears) → resolve →
> **screen** confirm (drop, roster) → phone back in pocket.

## The living map is the screen channel, not AR (2026-07-30)

The screen channel's canonical form is the **living map** (GDD §3.8): a
heavily stylized KH-toned 3D world view — custom style + tilt, stylized 3D
park structures, animated Heartless models at breaches, the wielder's 3D
avatar (equipped keychain = visible Keyblade) with fielded companions
roaming alongside, and World light as volumetric atmosphere. Two boundaries
keep it honest:

- **It is not AR.** The living map is the game board you glance at; AR stays
  the episodic, stand-still reveal. The AR ladder below is unchanged by it.
- **It does not loosen pillar 4.** No mechanic may require watching the map
  while walking; the avatar mirrors your position, it never demands your
  eyes. Attention cost stays "medium, heads-down, for moments."

Build ladder and tech (MapLibre custom style + three.js custom layer,
low-poly glTF, battery/LOD budget) live in
[14 §2b](14-implementation-plan.md); the M3 pin view remains the
reduced-motion / low-end fallback.

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

## The AR tech path (revised 2026-07-15 — the landscape moved)

> **What changed since this doc was written.** The original plan bet on
> **8th Wall web AR**. That bet is dead: Niantic shut the hosted 8th Wall
> platform down on **2026-02-28** (hosted campaigns die 2027-02-28). The engine
> core was open-sourced (MIT, at 8thwall.org) — but **SLAM ships only as a
> binary-only "Distributed Engine Binary,"** and VPS / Maps / hand-tracking were
> never released at all. Meanwhile **WebXR `immersive-ar` still does not work on
> iOS Safari** in 2026 (the feature flag exists but is non-functional), and
> WebXR is generally unavailable inside webviews. Finally, the product itself
> changed shape: ParkFi now ships a **Capacitor native shell** on iOS/Android,
> so "no install" is no longer the binding constraint and native AR APIs are one
> plugin away. **Web AR is dead as our path; the ladder below replaces it.**

Climb the ladder; do not start at the top.

| Rung | Technique                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Robustness                 | When               |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------ |
| 1    | **Camera-overlay "lite AR"** — a native camera preview rendered _behind_ a transparent webview (e.g. a Capacitor camera-preview plugin with `toBack: true`); the Heartless is an animated DOM/canvas/WebGL overlay with device-orientation parallax. No tracking — but for a **stand-still, seconds-long reveal** it reads as AR, and it ships entirely in the existing web UI.                                                                                                                                                                                                                                                                                                              | High                       | **v1**             |
| 2    | **Plane-anchored native AR** — a thin Capacitor plugin hosting **ARKit/RealityKit** (iOS) and **ARCore/SceneView** (Android); drop the Heartless on a detected ground plane in front of a stationary Wielder. Plugin surface stays tiny: `showEncounter(spec) → outcome`.                                                                                                                                                                                                                                                                                                                                                                                                                    | High                       | v1.5               |
| 3    | **VPS (visual positioning)** — the **ARCore Geospatial API** (actively maintained on _both_ Android and iOS): sub-meter world anchors by lat/lng/alt wherever Street View coverage exists, plus Streetscape Geometry for occlusion and Rooftop anchors. Probe park coverage in-app with `checkVpsAvailability`. Niantic Lightship VPS is **de-prioritized** — post-Scopely, Niantic Spatial pivoted to enterprise geospatial AI. Nationwide, this rung also carries the **street fissure-seal ceremonies** (Canon Log 2026-07-30, [19 §3](19-nationwide-hunt-and-synthesis-2026-07-30.md)) — Street View coverage is exactly where street players are; screen-only fallback everywhere else. | Medium                     | v2                 |
| 4    | **Shared-anchor co-op** — two Wielders pointing at the same spot see the _same_ boss. Via rung 3 this is far cheaper than classic cloud anchors: both clients simply resolve the **same geospatial anchor** (identical lat/lng/alt) — no session pairing, no anchor hosting.                                                                                                                                                                                                                                                                                                                                                                                                                 | Hard → Medium (via rung 3) | v2+ (Convergences) |

Raw GPS will **not** hold a virtual object on a real statue — that's why we start
at overlay/plane anchors, not world-scale GPS placement. The original ladder's
image-anchored idea (recognize a landmark via the **pin CLIP embedding** service,
overlay relative to it) survives as an optional _enhancer_ at rungs 1–2, not a
rung of its own.

### AR posture: the market data backs pillar 4

Most Pokémon GO players play with AR **off**, and Monster Hunter Now — the best
location-game combat shipped to date — runs its battles AR-off by default (AR is
an opt-in flourish). This is evidence for what was already canon: the **screen
battle is canonical** (3D theater by default, the 2D panel under battery saver —
Canon Log 2026-07-30), the AR reveal is an _earned peak moment_, and no loop may
require the camera.

## The Capacitor-native path (replaces "web AR first")

The stack is still web (TanStack Start + tRPC) — it just runs inside the
**Capacitor** shell we now ship:

- **The webview stays the game.** Map, battle, roster, Journal remain web UI
  reusing tRPC + the live feed directly; iterate at web speed.
- **AR is a native moment.** Rung 1 needs only a camera-preview plugin + a
  transparent webview; rung 2+ is a small native plugin the web UI invokes for
  the seconds the reveal lasts, then control returns to the web layer.
- **Rung 1 debuts as the Lucky-Emblem registration viewfinder** (2026-07-16,
  15 §7): the KH3 Gummiphone framing, literally — a circular reticle over the
  camera preview for photographing real hidden Mickeys (GDD §3.7), rather
  than a generic battle reveal. It gives the first AR ship a purpose the 2D
  loop can't serve. Run the `checkVpsAvailability` coverage probe (rung 3
  de-risk) on the same in-park trip as M5b presence validation.
- **Demo distribution:** TestFlight / Play internal track (the native app
  already exists — it is no longer a "roadmap slide"). A QR code can still open
  the _web_ app for a no-install audience — they get the full screen-canonical
  loop (3D theater or battery-saver 2D, never AR), which is complete by design.
- The open-sourced 8th Wall engine (MIT) is worth _watching_ as a fallback, but
  its binary-only SLAM and dead hosted infrastructure make it a foundation
  risk, not a plan.

Native advantages the shell already unlocks as the game needs them: background
geofencing, battery control, haptics, audio session management
([06](06-location-and-geofencing.md)).

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
