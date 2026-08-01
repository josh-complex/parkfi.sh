# 12 — The demo / vertical slice

> **Theme:** Build the smallest thing that makes a Disney exec lean forward — and
> the same thing is the v1 of the product. The demo's mic-drop is the **live-data
> hook**, so that part is _real_; everything else is scoped or Wizard-of-Oz'd.
> Ship it **inside the Capacitor app we already distribute** (TestFlight/Play
> internal track); a QR code can still open the web app's screen-canonical loop
> for a no-install audience. _(Revised 2026-07-15: the original "web AR behind a QR
> code" framing died with 8th Wall — see [07](07-ar-and-channels.md).)_ The
> first thing to build is the **dev/armchair mode**, because you can't live in
> the park.

## Core insight

A demo and the product v1 are the same artifact here, which means **no throwaway
work**. The art is choosing the _one_ vertical slice that proves the whole thesis
end-to-end with the least build — and making the irreplaceable part (the
reactive Darkness) genuinely real while faking the expensive parts (full combat,
multiplayer, the full character roster).

## The mic-drop (must be real)

> An exec is standing in the park. A ride **actually goes down** in real life.
> Seconds later their phone buzzes — _"the Darkness is leaking from \[that
> ride]"_ — and an encounter surges at that exact spot, because the worker
> already ingested the status change.

That is the entire company in ten seconds, and it falls out of infra we already
run. **Wire it for real.** (And wire a _simulated_ trigger too, for when no ride
obligingly breaks during the meeting — see Dev mode.)

## The vertical slice (one World, the full loop)

One land, a few spots, the loop end to end ([04](04-game-design.md)):

1. **Geofence trigger** — reach a spot → wrist/screen cue.
2. **Encounter** — a Heartless appears in **AR** on the ground, stand-still.
3. **Battle** — turn-based, 2–3 moves, one Companion, a Surge meter.
4. **Recruit / reward** — clear it → unlock a Companion bound to that World
   ([05](05-companions-and-proximity.md)).
5. **The live hook** — trigger a real (or simulated) ride-down and watch the
   world react.
6. **Leave an echo** — a feeling left at the spot → the flywheel, made visible.

Complete, legible, shippable. Everything past it — Convergences, synthesis,
cross-park travel, the full dex — is _narrated_ over this working core.

## Build vs. fake, for the demo

| System                               | Demo version                                                         | Rationale                                                   |
| ------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Live-data Darkness hook**          | **Real**                                                             | the moat — the whole point                                  |
| **Geofencing**                       | **Real** (+ dev spoofer)                                             | proves "it knows where you are"                             |
| **AR encounter**                     | Real but **simple** — camera-overlay "lite AR" (rung 1), stand-still | impressive without tracking or multiplayer                  |
| **Battle**                           | **Scoped** — turn-based, 2–3 moves                                   | full combat is a v2 problem                                 |
| **Companion roster**                 | **Real but tiny** — 3–4 characters, one World                        | shows the collection hook                                   |
| **Discovery marks**                  | **Real** — create + find + react                                     | low-risk, no game balance, proves UGC loop                  |
| **Cross-park / raids / synthesis**   | **Narrated**, not built                                              | "here's where it goes"                                      |
| **Background geofencing, watch app** | **Roadmap slide**                                                    | the Capacitor shell already exists; deep native comes later |

## The Capacitor app is the demo vehicle (revised 2026-07-15)

The original secret weapon — 8th Wall web AR behind a QR code — no longer
exists: the 8th Wall hosted platform shut down 2026-02-28, and WebXR
`immersive-ar` still doesn't work on iOS Safari ([07](07-ar-and-channels.md)).
The good news is we no longer need it:

- **The native shell already ships.** The demo is a TestFlight / Play internal
  build of the app the exec would actually use — arguably a _stronger_ pitch
  than a web toy.
- **The web game is unchanged** — map, battle, roster all reuse tRPC + the live
  feed inside the webview; iterate at web speed right up to the meeting.
- **The AR reveal is rung-1 "lite AR"** (camera preview behind a transparent
  webview + device-orientation parallax) — no tracking dependency, no vendor,
  works on every phone in the room.
- A QR code still works for the no-install audience: it opens the web app's
  **screen-canonical loop** (3D theater by default, 2D under battery saver —
  Canon Log 2026-07-30), which is complete by design (pillar: the game never
  _requires_ AR).

## Build the dev / armchair mode FIRST

You cannot develop a location game by standing in Magic Kingdom all day. The
**substrate** that makes building everything else possible:

- **GPS spoofer** — a debug panel to set the client's position to any park
  coordinate (and walk a path) without leaving your desk.
- **Live-event injector** — fake an `attraction_status_obs` DOWN/OPERATING
  transition or a `queue_obs` surge on demand, so you can trigger the Darkness
  engine deterministically (also the in-meeting fallback for the mic-drop).
- **Time/condition overrides** — force night, rain, fireworks, a Convergence.
- **Presence bypass (dev only)** — short-circuit verification so you can test the
  loop without faking every sensor (gated to non-prod, never shipped).

This is not polish — it's the first commit. Without it, every subsequent feature
requires a theme-park trip to test.

## Suggested build order (each step demoable on its own)

1. **Dev/armchair mode** — spoofer + event injector + condition overrides.
2. **`world` table + geofence engine** — seed Worlds from `attraction_meta.land`
   ([10](10-data-model.md)); detect Park/World/attraction crossings; wrist/screen
   cue on threshold.
3. **The `mark` primitive + Darkness engine** — the worker job that turns a
   (real or injected) ride-down into a `world`/`encounter` mark
   ([11](11-architecture.md)). **This is the mic-drop; do it early.**
4. **Echoes** — leave/find/resonate ([03](03-marks-and-discovery.md)).
   Lowest-risk real feature; proves the UGC + flywheel loop with no AR.
5. **AR encounter + scoped battle** — rung-1 camera-overlay lite AR
   ([07](07-ar-and-channels.md)); turn-based.
6. **Companion recruit (one World)** — the collection hook
   ([05](05-companions-and-proximity.md)).
7. **The logbook** — persistence made visible ([08](08-achievements-persistence-coldstart.md));
   the shareable artifact.
8. **Package the pitch build** — TestFlight/internal-track install plus a
   QR-code web link (2D loop) — + a 3-minute scripted walkthrough.

## Validation plan

- **At-desk:** the entire loop runs via dev mode; the Darkness engine fires on an
  injected event.
- **In-park (one trip):** validate real geofence accuracy, battery over a
  half-day, AR anchoring on real landmarks, and the _real_ ride-down mic-drop.
  Capture it on video for the pitch — the genuine reactive moment is the asset.
- **Metrics to watch:** geofence false-positive/negative rate, battery drain per
  hour, AR anchor stability, time-to-first-"whoa".
