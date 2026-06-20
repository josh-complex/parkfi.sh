# 13 — Roadmap, risks & IP

> **Theme:** The phasing from "QR-code demo" to "lifelong cross-park save file,"
> the honest IP fork that governs _how loud we can be_, and the kill-risks to
> stare at directly. The strategy: **build the machine, keep the skin loose, let
> the working demo be the pitch.**

## The IP fork (the decision that governs everything)

Kingdom Hearts is **Disney + Square Enix**, layered on **Disney's** physical
property. An unsanctioned third party cannot ship a commercial KH-branded AR
game on Disney parks — that's a wall, not a manageable risk. There are three
honest paths, and they are genuinely different products:

| Path                                              | What it is                                                                   | Pros                                                            | Cons                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| **1. Pitch to Disney**                            | bring our data-moat + this design as a partnership                           | highest ceiling; official IP; sanctioned in-park                | BD play, not a build-it-now play; long, uncertain |
| **2. Original skin, ship now** _(the build path)_ | keep the entire _machine_; original characters/names/story; legally distinct | shippable independently; works at _any_ park; proves the engine | weaker IP pull than Disney characters             |
| **3. License a smaller IP / venue-neutral**       | run the same engine where we can get rights                                  | real IP, lower bar than Disney                                  | smaller pull; per-venue deals                     |

**Resolution (already the user's call): it's a pitch — and we still build the
real product.** So: **design with KH as the north star, build Path 2 so we can
actually ship, keep Path 1 as the dream exit.** The mechanics are the asset; the
skin is a five-minute reskin if Disney says yes. (Disney knows where to find
us — and the existing site disclaimers already say so.)

### IP guardrails for Path 2 (so the demo stays defensible)

- **Original characters, names, story, art** — no Disney/Square Enix marks,
  likenesses, or protected names anywhere in shipped builds.
- The **park data layer** (wait times, geo, status) is the existing, already-
  defensible utility; the _game_ sits beside it with original IP.
- Keep a clean line between "utility informed by public/park data" and
  "immersive game" — the louder/more-immersive it gets, the more the original-IP
  hygiene matters.
- The cross-park _traveling save file_ is the highest-tension feature
  ([08](08-achievements-persistence-coldstart.md)) — fine with original IP;
  becomes a partnership question only under Path 1.

## Roadmap (phased)

### Phase 0 — Demo / vertical slice (the pitch artifact)

Everything in [12](12-demo-vertical-slice.md): dev/armchair mode → `realm` +
geofences → the `mark` primitive + Dimming engine (**the mic-drop**) → discovery
marks → a scoped AR encounter + one-Realm recruit → the logbook → wrapped as a
QR-code link. **Web AR, original skin.** Outcome: a 3-minute walkthrough that
ends on a _real_ reactive ride-down.

### Phase 1 — Standalone product v1 (ship to real users, web)

- Discovery marks live across a full park (the lowest-risk, highest-utility
  feature — useful even to non-gamers).
- The Dimming engine running continuously off the live feed, parkwide.
- Full one-park Companion dex + recruit loop; the logbook + "Park Wrapped."
- Verified-by-physics achievements ([08](08-achievements-persistence-coldstart.md)).
- Moderation + two-layer model live from day one ([09](09-moderation-trust-safety.md)).

### Phase 2 — Native app + depth

- Native (ARKit/ARCore) for AR fidelity, **background geofencing**, battery
  control, watch/haptics, audio sessions ([06](06-location-and-geofencing.md),
  [07](07-ar-and-channels.md)).
- Battle depth (affinities, combos, synthesis), seals as real control points.
- VPS-anchored AR (rung 3) for world-locked reveals.

### Phase 3 — Communal & cross-park

- Convergences with **shared-anchor co-op AR** (rung 4) tied to real fireworks
  ([04](04-game-design.md)).
- Contested seals; density-gated multiplayer ([08](08-achievements-persistence-coldstart.md)).
- The **cross-park traveling save file** across multiple parks/operators — the
  lifelong-engagement differentiator.
- Atoms↔bits: rare digital marks ↔ physical pins ([03](03-marks-and-discovery.md)).

### Phase 4 — Partnership (Path 1, if it lands)

Reskin to official IP; sanctioned in-park placement; deeper integration (official
ride telemetry, sanctioned anchors, operations-level congestion features). The
machine is unchanged; the skin and the access change.

## Risks & how each is mitigated

| Risk                                       | Severity                       | Mitigation                                                                                                                                            |
| ------------------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IP / legal** (Disney property + KH)      | existential                    | Path 2 original skin; strict IP hygiene; pitch, don't infringe                                                                                        |
| **Physical safety** (heads-down in crowds) | existential (one bad incident) | stand-still encounters, speed lockout, heads-up channels, hazardous-zone geofencing ([09](09-moderation-trust-safety.md))                             |
| **Battery drain**                          | product-killing                | region monitoring for coarse triggers, high-accuracy only in active moments, push-not-poll ([06](06-location-and-geofencing.md))                      |
| **GPS accuracy in the park**               | core-loop quality              | sensor fusion + live-feed corroboration + dwell confirmation ([06](06-location-and-geofencing.md))                                                    |
| **Spoofing / cheating**                    | economy integrity              | multi-signal verification, server-authoritative, attestation, hardest rewards behind hardest-to-fake conditions ([06](06-location-and-geofencing.md)) |
| **Cold-start / empty world**               | engagement                     | real crowd as free density, async marks, density-gating, decay tuning ([08](08-achievements-persistence-coldstart.md))                                |
| **UGC moderation**                         | trust/legal                    | verified-presence-to-post, decay, two-layer model, pre-screen, reporting ([09](09-moderation-trust-safety.md))                                        |
| **AR maturity / device variance**          | feature scope                  | AR ladder (image→plane→VPS→shared); 2D fallback so the game never _requires_ AR ([07](07-ar-and-channels.md))                                         |
| **Scope creep**                            | schedule                       | the vertical slice discipline — build the machine, narrate the rest ([12](12-demo-vertical-slice.md))                                                 |

## The one-line strategy

> **Build the machine, keep the skin loose, make the live-data hook real, ship
> it as a QR-code web-AR demo — which is simultaneously the product v1 and the
> most persuasive thing we could ever put in front of Disney.**
