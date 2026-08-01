# 13 — Roadmap, risks & IP

> **Theme:** The phasing from "QR-code demo" to "lifelong cross-park save file,"
> the IP position now that the Kingdom Hearts license is secured, and the
> kill-risks to stare at directly. The strategy: **build the machine, make the
> live-data hook real, ship it in full Kingdom Hearts dress.**

## IP position (secured)

Kingdom Hearts is **Disney + Square Enix**, layered on **Disney's** physical
property — so a KH-branded AR game on Disney parks was only ever possible as a
sanctioned partnership. **That partnership is in place: the Kingdom Hearts IP is
licensed and in-park placement is sanctioned.** What won the deal was the moat —
our live operational feed, the reactive world engine no one else can build.

The engine is decoupled from the theming (neutral internal identifiers; see the
[GDD](GDD.md) glossary), so the same machine powers the licensed KH product and
could run under any future IP or venue without a rebuild.

### IP guardrails (what still applies under license)

- **You play an original Keyblade wielder — never a core character** (no Sora,
  Riku, Kairi, Aqua, et al.); those are NPCs/mentors. Mirrors how KH's own
  mobile titles work (see [GDD §0.5](GDD.md)).
- Use of Disney/Square Enix marks, characters, names, and art follows the terms
  of the license and Disney brand guidelines.
- The **park data layer** (wait times, geo, status) remains the existing utility;
  the _game_ sits beside it.

## Roadmap (phased)

### Phase 0 — Demo / vertical slice (the pitch artifact)

Everything in [12](12-demo-vertical-slice.md): dev/armchair mode → `world` +
geofences → the `mark` primitive + Darkness engine (**the mic-drop**) → echoes
→ a scoped AR encounter + one-World recruit → the logbook → packaged as a
TestFlight/internal build (+ a QR web link for the 2D loop). **In-app lite AR,
full Kingdom Hearts dress.** _(Revised 2026-07-15: was "web AR behind a QR
code" — that path died with 8th Wall; see [07](07-ar-and-channels.md).)_
Outcome: a 3-minute walkthrough that ends on a _real_ reactive ride-down.

### Phase 1 — Standalone product v1 (ship to real users, web)

- Discovery marks live across a full park (the lowest-risk, highest-utility
  feature — useful even to non-gamers).
- The Darkness engine running continuously off the live feed, parkwide.
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

### Phase 4 — Deep Disney integration

Sanctioned in-park placement and deeper integration: official ride telemetry,
sanctioned AR anchors, operations-level congestion features. The machine is
unchanged; the depth of access grows.

## Risks & how each is mitigated

| Risk                                        | Severity                       | Mitigation                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IP / legal** (Disney property + KH)       | managed                        | licensed IP + sanctioned placement; adhere to license terms & Disney brand guidelines; stylized 3D park architecture + avatar/Keyblade cosmetics on the living map go through the same review (Canon Log 2026-07-30)                                                             |
| **Physical safety** (heads-down in crowds)  | existential (one bad incident) | stand-still encounters, speed lockout, heads-up channels, hazardous-zone geofencing ([09](09-moderation-trust-safety.md))                                                                                                                                                        |
| **Battery drain**                           | product-killing                | region monitoring for coarse triggers, high-accuracy only in active moments, push-not-poll ([06](06-location-and-geofencing.md))                                                                                                                                                 |
| **GPS accuracy in the park**                | core-loop quality              | sensor fusion + live-feed corroboration + dwell confirmation ([06](06-location-and-geofencing.md))                                                                                                                                                                               |
| **Spoofing / cheating**                     | economy integrity              | multi-signal verification, server-authoritative, attestation, hardest rewards behind hardest-to-fake conditions ([06](06-location-and-geofencing.md))                                                                                                                            |
| **Cold-start / empty world**                | engagement                     | real crowd as free density, async marks, density-gating, decay tuning ([08](08-achievements-persistence-coldstart.md))                                                                                                                                                           |
| **UGC moderation**                          | trust/legal                    | verified-presence-to-post, decay, two-layer model, pre-screen, reporting ([09](09-moderation-trust-safety.md))                                                                                                                                                                   |
| **AR maturity / device variance**           | feature scope                  | AR ladder (image→plane→VPS→shared); screen battle canonical (3D theater default, 2D battery saver) so the game never _requires_ AR ([07](07-ar-and-channels.md))                                                                                                                 |
| **Scope creep**                             | schedule                       | the vertical slice discipline — build the machine, narrate the rest ([12](12-demo-vertical-slice.md))                                                                                                                                                                            |
| **License scope — nationwide** (2026-07-30) | gate zero                      | the nationwide hunt makes this a consumer location game to both licensors; **the license conversation precedes any N-workstream build** ([19 §7](19-nationwide-hunt-and-synthesis-2026-07-30.md)); pitch: the street game is promotional-by-construction, the moat stays in-park |
| **Niantic competition** (2026-07-30)        | strategic                      | off-park we play their shape; differentiators are the IP, weather-live spawns, and one-save unity with the parks; no UGC POI program (never compete on Wayfarer) ([19](19-nationwide-hunt-and-synthesis-2026-07-30.md))                                                          |
| **POI / geodata maintenance** (2026-07-30)  | operational                    | curated Overture/OSM class allowlist + procedural geohash fill; audit before anchoring ships (19 §3)                                                                                                                                                                             |

## The one-line strategy

> **Build the machine, make the live-data hook real, ship it in full Kingdom
> Hearts dress — a reactive in-park game no one else can build, because no one
> else holds the live operational wire.**
