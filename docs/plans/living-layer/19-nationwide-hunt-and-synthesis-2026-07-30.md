# 19 — The nationwide hunt: streets, synthesis & the Moogle economy (2026-07-30)

> **Status: FROZEN RECORD — adopted into canon 2026-07-30** (GDD Canon
> Decision Log "The nationwide hunt & Moogle synthesis adopted"; §3.2
> worldspace, §4.3–§4.6 synthesis/trials/Org tiers, §5 away loop, §8
> knobs + refusals, workstream ⑩ in [14](14-implementation-plan.md);
> street annexes in [06](06-location-and-geofencing.md) and
> [09](09-moderation-trust-safety.md)). This doc is now rationale, not a
> build order — the GDD wins where they differ. **License gate zero still
> precedes any N-workstream build** (§7).
>
> **Supersedes [18](18-realm-of-sleep-nationwide-2026-07-30.md) in part.**
> Doc 18's _couch_ model — the Realm of Sleep as the away game's spine — is
> replaced by this doc: **the typical non-park loop is get out and walk.**
> Real streets, real Heartless, the Niantic-shaped hunt. What survives from
> 18 unchanged: the **one-heart / presence-weighted economy** (18 §5), the
> **completeness principle** (18 §5b, recast §6 below), **gates &
> Wayfinders** (18 §6), and **gate zero — the license conversation** (18
> §1). The Realm of Sleep contracts to its natural niches: the Dive/FTUE
> (16 §1) and at-home Memory Dives (17 §4.2) — the dream is for night;
> the hunt is for daylight.
>
> **The ask (verbatim intent):** non-park guests get a walk-and-find loop —
> Heartless / Nobodies / Organization XIII events, keyholes, "the Niantic
> thing (spatial probably?)"; fight drops feed **Keyblade crafting** (Moogle
> synthesis, component slots, Light-vs-Dark alignment); park guests get
> unique keychains / fully-built Keyblades / bonuses; **it must fit KH vibe
> and never break released canon**; and the in-park living layer (live-data
> darkness propagation, beat events) continues exactly as is, park-only.

---

## 1. The lore foundation (why none of this breaks canon)

The user-supplied justifications, formalized against released canon:

1. **Crafting Keyblades is precedented — the Ultima Weapon.** In KH1, KH2,
   and KH3 the game's _strongest Keyblade_ is not found or gifted: it is
   **synthesized at a Moogle shop** from materials dropped by Heartless
   (Shards / Stones / Gems / Crystals, Orichalcum+ as the capstone). A
   synthesis economy that culminates in forging a blade is not a liberty —
   it's the series' own endgame loop.
2. **Keyblades are manifestations of the heart.** Canon holds that a
   Keyblade's form flows from its wielder's heart; materials steeped in
   light, darkness, or elemental energy shaping that manifestation is a
   natural extension, not a contradiction.
3. **The keychain is the canonical transformation mechanic.** Swapping a
   keychain changes a Keyblade's form and power — released canon since
   KH1. Crafted output can therefore be expressed as **keychains and
   components** without ever claiming to "blacksmith" the blade itself.
4. **Heartless appear wherever hearts and darkness are** — every world,
   every street. KHχ/Union χ showed _hundreds of ordinary wielders_
   spread across the world hunting Heartless. A nationwide player base of
   original wielders is that image, modernized.
5. **Darkness-aligned wielding is canon** (Riku; "the road to dawn").
   A Light/Dark crafting axis breaks nothing — it _is_ the series' central
   axis.

**Canon-compliance rules (standing, for every feature below):**

- Core characters are never playable (existing canon, §0.5); Moogles are
  vendors/craftsmen — exactly their canonical job — never party members.
- **A World's Keyhole stays a park-scale concept.** The nationwide
  street objects are **fissures** (lowercase; the small doors darkness
  slips through), sealed with the Keyblade's beam — the beloved beat,
  without claiming every cul-de-sac hides a World's heart. (Player-facing
  copy may say "seal it" freely; it may never say "the Keyhole of
  \<suburb\>.")
- Canonical material vocabulary only: Blaze/Frost/Thunder/Lucid/Power/
  Dark/Mythril… × Shard/Stone/Gem/Crystal. The GDD's existing
  element × tier ladder (§4.4) already matches — this doc extends it,
  it does not fork it.

---

## 2. The nationwide loop (the "typical game loop for non-park guests")

> Walk → the radar stirs → reach it → fight / seal / gather → materials →
> the Moogle bench → a better blade → walk further.

- **Ambient Heartless** spawn around the player as they move (Shadow-class
  pests up to Large-Body-class threats; §3 spawn model). Same three verbs,
  same battle theater, same `RoundEvent[]` machinery — one game.
- **Fissures** — the walk's landmark beat: a visible tear at a real
  location (park benches, trailheads, plazas — POI-anchored, §3). Clear
  its guard wave, then the seal ceremony (beam, lock-click, the chime).
  Sealed fissures rest for all players briefly (a communal micro-note),
  then re-tear — the street's renewable "raid-lite."
- **Nobodies** escalate exactly as in-park canon (§3.4): fissures left
  untended in an area breed Dusks; the escalation clock generalizes from
  ride-downtime to fissure-age. The machine is the same pure function of
  observed state — only the observation source differs.
- **Organization XIII events** — the nationwide chase: a member
  **manifests regionally on a schedule** (the §4.6 seasonal-rotation
  canon, scaled up: one member "haunting" the Northeast this week, its
  anomaly signature now a _weather_ signature — the storm-lover walks in
  real storms). Timed windows, phased duel (escort wave → duel),
  rank-scaled objective, **threads** as the exclusive drop — identical
  reward grammar to park Rifts, lower ceiling (§5).
- **Moogle posts** — sparse, POI-anchored synthesis benches ("Moogle
  set up shop by the fountain, kupo"). Any post serves the full bench UI;
  posts exist to give walks a _destination_, not to gate the feature
  (the bench is always reachable from the pack after rank 2 — density
  in rural America must never lock crafting).
- **Weather is the nationwide moat-echo.** We already ingest weather
  nationally: real rain raises Frost/Thunder families, heat waves raise
  Blaze, clear nights raise Lucid — the elemental _market_ shifts with
  the actual sky, so material hunting has a live, regional texture no
  timer-clone has. (The full live-ops moat stays park-only, §7 — but the
  weather layer proves the "driven by reality" pillar nationwide.)

**Safety posture generalizes, unchanged in kind:** stand-still encounters,
speed lockout (no play above walking speed), no rewards for trespass-bait
locations (fissure anchors come from a curated POI class list), heads-up
rules (pillar 4) apply on a sidewalk more than anywhere. Doc
[09](09-moderation-trust-safety.md)'s park rules were written strictly
enough to survive the street.

---

## 3. The spawn & spatial model ("the Niantic thing — spatial probably?")

What the Niantic stack actually decomposes into, and our answer per layer:

| Layer            | Niantic's                           | Ours                                                                                                                                                                                                                                                                                               |
| ---------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Location**     | GPS + activity                      | same (foreground-only; our existing privacy posture — no background harvesting)                                                                                                                                                                                                                    |
| **POI graph**    | Wayfarer (crowdsourced, decade-old) | **no UGC POI program** — Overture/OSM open data, filtered to a curated class allowlist (plazas, parks, monuments, transit); procedural geohash spawns fill the gaps so rural players aren't POI-starved                                                                                            |
| **Spawn engine** | timers + POI + events               | deterministic function of (geohash, time-bucket, **real weather**, region event table) — same testability posture as `heartlessSpec`; no per-player RNG server round-trip                                                                                                                          |
| **AR anchoring** | Lightship VPS                       | **ARCore Geospatial API** (canon pick, 07 — Street View coverage is exactly where nationwide players are); fissure seals get VPS-anchored ceremonies where coverage exists, graceful 2D/screen fallback everywhere else. Niantic Spatial stays de-prioritized (post-Scopely enterprise pivot, 07). |

AR remains **the punchline, never the requirement** (pillar 4 / 07): the
street game is fully playable screen-only; the VPS-anchored seal ceremony
is the earned flourish, not the loop.

## 4. Synthesis — the Moogle economy (fleshing out the user's skeleton)

Extends GDD §4.4 (element × tier materials, deterministic drops, recipes
known upfront) — nothing existing is forked.

### 4.1 Materials

- **Taxonomy:** element family × tier — _Shard → Stone → Gem → Crystal_
  (the canonical ladder; §4.4's shard→stone→gem gains its Crystal cap).
  Families use canonical names: **Blaze, Frost, Thunder, Lucid, Power,
  Dark, Twilight, Mythril**; **Orichalcum** is the capstone rarity.
- **Drops are element-keyed to the enemy** (the user's "Searing Shard"
  instinct, in canonical vocabulary): fire-family Heartless drop Blaze,
  aerial drop Thunder, phantom drop Lucid, Nobodies drop **husks** and
  (Org events) **threads** — identical to park grammar.
- **Light vs Dark is a material axis, not a menu toggle:** _Dark_ materials
  come from Heartless; **Light materials come from the world itself** —
  sealed fissures exhale a **Radiant Shard**; dawn/clear-sky windows raise
  Lucid/light families; park Worlds exhale Light windfalls (§5). Hunting
  darkness yields Dark; _tending places_ yields Light. The moral texture
  is in the acquisition verbs, which is very KH.

### 4.2 The bench — component crafting (the user's three slots)

A crafted blade is assembled at the Moogle bench from three components,
each itself synthesized from materials:

| Component                   | Governs                                                     | Made from                                                                     |
| --------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **The Blade** (haft & form) | base stats — Might, Guard weight                            | Power/Mythril line + tier materials                                           |
| **The Teeth**               | the magical property — element of Strike/Surge interactions | one elemental family, purity = tier                                           |
| **The Keychain**            | the signature ability (the canon transformation locus)      | rare + alignment materials; **this is the slot park exclusives live in** (§5) |

- **Alignment** emerges from the material ledger of the whole build:
  majority-Light builds lean guard/support properties ("the road to
  dawn"), majority-Dark lean power/risk (higher Might, thinner Guard —
  Riku's bargain). Alignment is a _spectrum stat_ on the finished blade,
  never a faction choice — canon-safe and re-craftable.
- **Moogle ranks:** the bench levels as you synthesize (canonical Moogle
  behavior) — rank unlocks recipe _tiers_, never region-locked content.
- **Recipes known upfront** (existing canon §4.4) — scarcity lives in
  materials; the **Ultima line** sits at the top as the multi-Crystal +
  Orichalcum long-arc project, exactly as the series does it.
- **No munny in v1** (§4.4's open question unchanged); the bench barters.

### 4.3 One forge, two doors

The park forge (§4.4) and the Moogle bench are **one system with two
fronts**: same inventory, same recipes engine, same deterministic-drop
posture. The park door upgrades signature keychains with World materials
(existing canon); the street door crafts component blades from nationwide
materials. A wielder's kit is one cabinet.

## 5. The park premium (what being there buys, in this economy)

The presence-weighted line (18 §5) applied to loot — the park is the
**exclusive top of every ladder**, while the street game stays whole:

1. **Signature keychains stay geography-locked** (existing canon §4.3: a
   World's keychain can _never_ drop anywhere but that World). Crafted
   keychains cannot reproduce a signature perk — the perk pool is
   disjoint by rule. The street's crafted line is broad and deep; the
   park's signature line is _irreplaceable_.
2. **Fully-built Keyblades as park milestones:** sealing a World's Keyhole
   (the real, capital-K, in-park act) grants that World's **complete
   blade** — no bench, no materials, the KH1 "clear the world, earn its
   blade" loop, whole. The only fully-built blades in the game come from
   standing in a World and sealing it.
3. **Condition materials are the park's Orichalcum.** The rarest crafting
   inputs remain live-gated and presence-verified (§4.4 canon): sealed-
   in-real-rain, during-the-real-fireworks, the Rift thread. The Ultima
   line is _craftable_ nationwide but its **final catalyst is a park
   material** — with a nationwide long-road alternative (a season of Org
   threads) per the completeness rule (§6): the park is the fast,
   storied route; the street is the long one. Both doors open.
4. **Windfalls & the workshop's respect:** park visits shower Light
   materials (Worlds exhale near real magic), grant a temporary Moogle
   rank surge, and stamp the visit into crafted-blade provenance (a
   blade remembers where its parts were won — Chronicle/Journal hooks,
   17 §4.1).
5. **The living layer is untouched and park-only.** Live darkness
   propagation from real ops data, beat events, seals, World light, the
   communal map — none of it runs on streets, none of it is felt by
   street players, exactly per the directive. The street hunt runs on
   weather/time/geography; **the park remains the only place the game
   world is driven by reality breaking in real time.** One game, two
   textures of alive.

## 6. Completeness, recast (the never-visitor, on foot)

18 §5b's promise survives translation: a wielder who never enters a park
plays a **whole game on their own streets** — full loop (hunt/seal/
craft), every rank band reachable (street trial forms), the Journal's
street chapters + full crafted-blade catalog completable, Org XIII
seasonal chases as the endgame cadence, and the Ultima long road as the
true-ending-grade project. Park exclusives are _different and better in
kind_ (signature perks, complete World blades, condition catalysts'
fast road) — never the missing half. The §5b.3 fulfillment-audit
discipline carries over as-is.

## 7. What this does to the moat story (said plainly)

Doc 18 §3 rejected the street model partly to protect the moat. The
directive overrides, so the honest restatement: **nationwide, we are
playing Niantic's game better-themed** — the differentiators there are
the IP, weather-live spawns, and one-save unity with the parks. **The
moat lives in the parks** and is untouched: live ops-driven darkness,
communal state, presence-verified loot. Strategically the street game is
the _reach_ and the parks are the _depth_; the risk register (18 §8)
gains: head-on Niantic competition, POI/geodata maintenance, national
safety exposure (mitigated §2), and a **bigger** license conversation
(this is now unambiguously a consumer location game — gate zero grows).

## 8. Phasing (replaces 18 §9's D-ladder where it concerned the dream)

- **N1 — the walk MVP:** ambient spawns (geohash + weather engine),
  fissures with seal ceremony (screen-only), materials into the one
  inventory. Hard-depends on priority ① (desk/street fights minting real
  XP need sessions + replay + caps — 18 §5's integrity consequence,
  unchanged).
- **N2 — the bench:** Moogle posts + component crafting + alignment.
- **N3 — escalation:** Nobodies on the fissure clock; regional Org XIII
  event calendar (threads).
- **N4 — spatial:** ARCore Geospatial seal ceremonies where covered;
  Wayfinder/gate integration (18 §6 unchanged); park provenance/windfall
  systems.
- Dream content (Dive, Memory Dives) proceeds independently per 16/17 —
  it no longer blocks or carries the away game.

## 9. Canon deltas (if adopted — GDD-first, one Canon Log entry each)

1. **§3.2 worldspace generalizes:** the world outside parks becomes
   playable space (streets = fissure/ambient hunt); parks remain the only
   live-ops-driven, communal-state-bearing places (the living layer
   clause, verbatim from the directive).
2. **§4.3/§4.4 — the synthesis expansion:** Crystal tier + Orichalcum
   capstone; component crafting (Blade/Teeth/Keychain) at the Moogle
   bench; alignment as a material-ledger spectrum; one-forge-two-doors;
   signature-perk pool disjoint from craftable pool; complete World
   blades as in-park Keyhole-seal rewards.
3. **§3.4 — escalation source generalized** (fissure-age feeds the same
   Nobody clock); **§4.6 — Org rotation gains the regional/weather
   manifestation** tier below park Rifts.
4. **Fissures** defined (lowercase-keyhole rule; POI class allowlist;
   seal ceremony; brief communal rest note).
5. **§8 — new knobs:** street XP rate (the presence-weighted fraction now
   applies to street play), weather→element spawn table, fissure re-tear
   clock, Moogle rank curve, Ultima catalyst dual-road costs.
6. **09 — the street safety annex:** speed lockout, POI allowlist,
   stand-still rule restated for sidewalks; **06** gains the
   street anti-cheat note (replay + caps; GPS-spoof risk returns
   nationwide — teleport-detection heuristics move up in priority).
7. **18's banner** gains the superseded-in-part pointer to this doc.

## 10. Open questions

- **POI source of truth:** Overture/OSM allowlist quality in practice —
  does v1 ship procedural-only and add POI anchoring after an audit?
- **Fissure communal note:** how much shared state can street fissures
  carry before we've rebuilt Niantic's gym-contention moderation surface?
  (Lean: rest-timer only, no ownership, ever.)
- **The Ultima dual road:** is a season of Org threads the right
  nationwide price for the park catalyst's alternative, and does the
  park route need to stay strictly faster by rule?
- **Org XIII regional calendar:** hand-authored per season vs derived
  from national weather anomalies (the park Rift trigger philosophy,
  scaled up)?
- **Does street play need its own daily cap** separate from the dream/
  away XP fraction, given walking effort is real (unlike couch play)?
  (Lean: higher fraction than the couch ever had — effort is honest —
  but still below park rate.)
- **Battery/data budget** for a walk session (GPS + map + battle theater)
  on mid-tier Android — the 06 treatment, applied to the street.
