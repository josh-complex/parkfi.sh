# 17 — Retention & the away game (2026-07-30)

> **Status: FROZEN RECORD — adopted into canon 2026-07-30** (GDD Canon
> Decision Log "The trip cycle adopted"; §5 meta loop, §8 refusals/push
> budget, workstream ⑨ in [14](14-implementation-plan.md)). This doc is
> now rationale, not a build order — the GDD wins where they differ.
> It **builds on** 16 §1 (the Dive), §2 (the guide), and §5 (the at-home
> surface / the Vestibule), which remain unadopted proposals except where
> the GDD explicitly absorbed them (the Dive's presence exemption, §3.9).
>
> **Theme:** The game's players cannot be in the park. Not "sometimes" —
> **structurally, almost always.** A destination guest is inside a park
> perhaps four days a year; the game exists for them the other 361. Every
> retention instinct imported from Pokémon GO (daily habit, streaks,
> neighborhood spawns) is wrong here, because our board is a place people
> _travel to_. The correct model is not a daily loop. It is a **trip
> cycle** — and the whole away game is the art of keeping a save file
> warm between two visits without ever letting absence feel like loss.

---

## 1. The problem, honestly sized

### 1.1 The cadence segments

Retention design must be segment-first, because visit cadence varies by
two orders of magnitude:

| Segment        | Who                                    | Park cadence            | Familiar analogue                  |
| -------------- | -------------------------------------- | ----------------------- | ---------------------------------- |
| **Keyholders** | annual passholders / locals            | weekly–monthly          | closest to the PoGo player         |
| **Wayfarers**  | regional, drivable                     | 2–4 trips / year        | season-ticket sports fan           |
| **Pilgrims**   | destination vacationers                | ~1 trip / year or less  | the KH fan between mainline titles |
| **Dreamers**   | ParkFi users who haven't visited (yet) | 0 — planning or wishing | the pre-order audience             |

The design trap is building for Keyholders (they look like "engaged
users" in any dashboard) while the population — and the emotional core
of the IP — is Pilgrims. **A retention system that only works at weekly
cadence is a locals-only game wearing a Disney license.**

### 1.2 What "retention" even means here

Daily retention (D1/D7/D30) is the wrong primary lens for three of the
four segments. The lens that fits is the **trip cycle**:

> **Spark** (install / first play) → **Journey** (in park, the canon
> loops) → **Afterglow** (the ~2 weeks after) → **the Long Dark**
> (dormancy, weeks–months) → **the Call** (re-engagement moment) →
> **Return** (next trip — the cycle closes).

Retention is _surviving each transition_. The game already owns the
Journey; almost everything else is unbuilt or unadopted. The failure
mode isn't "players stop opening the app daily" — it's that the save
file goes cold in the Long Dark and the next trip starts from
emotional zero (or worse, in a competitor's planning app).

### 1.3 Why the IP is on our side

Kingdom Hearts fans famously wait — years, contentedly — between
mainline titles, sustained by memory, speculation, and anticipation.
**Longing is native to this IP.** The fiction already wrote it (GDD §7:
"the light you tended fades if no one keeps it… the park needs you
back"). The away game's job is to make longing _pleasant and pointed at
a date_, never guilty. Doc 16 §2.4's guilt-free guide rule is
load-bearing for everything below.

---

## 2. Inventory — what already serves each phase

What canon (✅), the adopted build order (🔜), and doc 16's proposals
(💡) already give each phase — and where the holes are:

| Phase         | Already designed                                                                                   | The hole                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Spark**     | 💡 the Dive (16 §1); dev/armchair mode ✅                                                          | fine — 16 §1 covers it                                                       |
| **Journey**   | the entire canon game ✅🔜                                                                         | not this doc's subject                                                       |
| **Afterglow** | 🔜 Logbook / Wrapped (M6, unscheduled)                                                             | **the largest hole** — the highest-emotion window has no designed experience |
| **Long Dark** | ✅ FCM personal payloads (echo touched, Trinity woke); 💡 Vestibule, starmap, forge intent (16 §5) | no memory surface; no seasonal pulse; push policy sketched but unbudgeted    |
| **The Call**  | 💡 trip-signal countdown (16 §5.3); ✅ trinity retroactive push                                    | nothing designed to _create_ trip intent, only to decorate existing intent   |
| **Return**    | ✅ save file permanence (pillar; 08); ✅ World light cold-start floor                              | nothing marks _the world noticing you came back_                             |

Two standing canon facts do quiet heavy lifting and must be named as
retention infrastructure so nobody "optimizes" them away:

- **Personal progress never decays** (the save file, [08](08-achievements-persistence-coldstart.md)).
  Only communal state (World light) decays — and the cold-start floor +
  guilt-free rule keep even that from reading as punishment.
- **The FCM/park-channel split** (GDD Canon Log 2026-07-16): personal
  payloads always deliver, ambient state is opt-in/trip-gated. The away
  game rides the personal channel; it must never leak onto the ambient
  one.

---

## 3. The frame — two currencies, one held breath

The economy rule (extends 16 §5.2's "verbs need presence; sight needs
love"):

> **Presence mints power. Absence mints memory and anticipation.**
> Nothing done at home may produce anything the World feels — no XP, no
> light, no seals, no drops. What home produces is _readiness_: intent,
> knowledge, memory made vivid, and a date on the calendar.

Corollary — the **equity rule** across segments: **nothing time-limited
is power.** A Pilgrim must never watch power expire that they had no
physical chance to reach. Time-limited things are cosmetic, memorial,
or recurring (a seasonal keychain returns every season; a Convergence
grants a memento, not a stat). This single rule is what lets Keyholders
and Pilgrims share one game without a resentment economy.

---

## 4. The away game, phase by phase (the new proposals)

### 4.1 Afterglow — the Chronicle (the biggest single lever)

The two weeks after a trip are the emotional peak of the entire cycle —
photos get relived, family retells the stories — and we currently ship
_nothing_ there (Wrapped is an annual artifact, M6 is unscheduled).
Propose the **Chronicle**: a guide-voiced, auto-assembled story of the
trip, generated within ~48h of the trip's end from rows we already
write (`encounter_log`, marks, recruit events, seals, steps/achievements
from the civilian side via the allowlisted read):

- **Journal pages "ink in."** During the trip, Journal entries are
  functional; the Chronicle pass renders them illustrated and annotated
  ("the Berserker that nearly ended you outside Space Mountain — Surge
  on turn 4 turned it"). The replay data (§4.2) makes every line true.
- **One shareable artifact.** The Chronicle's cover — trip stats, Worlds
  sealed, companions recruited, the starmap route — is the game's
  organic-growth surface (Wrapped-shaped, but per-trip, when the emotion
  is hot, not in December).
- **The last page is the Call** (§4.4): "the door is still open" — a
  soft, dated hook toward the next trip if any signal exists, and a
  quiet one if not.

Build note: the Chronicle **is** M6 (logbook/Wrapped) re-scoped from
"annual recap" to "per-trip afterglow, with the annual Wrapped as its
year-end compilation." One system, two outputs.

### 4.2 The Long Dark I — Memory Dives (the integrity dividend)

Priority ① (battle integrity) stores every fight's **move list** for
server replay. That same data is a perfect at-home cinema reel:

- From any Journal page, **re-enter the memory**: the fight replays in
  the battle theater (3D or 2D per battery saver) as a _dream_ — the
  Dive framing from 16 §1, which canon already exempts from presence
  ("a dream claims no presence").
- **Watch or re-fight.** Watching is free. Re-fighting the memory with
  different moves ("what if I'd Guarded?") is allowed and yields
  **nothing the World feels** — no XP, no drops. Its output is Journal
  flourishes only (a page border, a "mastered memory" mark) and
  _practice_ — a Pilgrim lands next trip already fluent in Nobody
  telegraphs they've only met in dreams.
- Cosmology: **memory is substance** — this is the most KH-native
  feature in the entire away game, and it costs almost nothing: the
  replayer is priority ①'s `resolveRound` loop pointed at a stored
  move list, rendered by workstream ②'s theater.

### 4.3 The Long Dark II — the pulse of a living world

Sight-only surfaces that make the Vestibule (16 §5.3) worth reopening
weekly rather than once:

- **Seasonal light.** The real parks re-theme constantly (Halloween,
  festivals, holidays) — our ingest already sees the schedule and
  entity changes. Render seasons on the living map and starmap:
  returning players see a _changed world_, and the park's own marketing
  calendar becomes our content cadence, free, forever. (Rides workstream
  ④/②b-d; zero new game systems.)
- **The Vigil.** Opt-in "watch this park tonight": the living map,
  spectator-grade, during real fireworks/Convergence windows —
  darkness surging and being beaten back by wielders who _are_ there.
  Strictly the park channel's aggregates (never identities). The Vigil
  is how a Pilgrim tastes the moat from their couch — and it converts:
  nothing sells the next trip like watching the board be alive.
- **Letters as anticipation** (canon tier-3, promoted here): when a
  friend leaves you a letter, the away notice says **that** a letter
  waits and **where** — never what it says. A sealed envelope on your
  starmap is a physical pull toward a specific place on a future date.

### 4.4 The Call — creating trip intent, not just decorating it

- **The pinned promise.** Forge intent (16 §5.3) generalized: pin any
  target — a recipe, an unrecruited companion, an unsealed World, a
  waiting letter — and the Vestibule composes them into a visible
  **next-trip manifest** ("three reasons the door is open"). When a
  ParkFi trip signal appears, the manifest attaches to it; when none
  exists, the manifest _is_ the seed the civilian trip-planner can
  offer to turn into one. This is the one sanctioned game→app pointer
  (both read their own rows; the 16 §5.3 boundary holds).
- **Companion warmth, never guilt.** Companions in the Vestibule
  reference absence only as fondness or anticipation ("Goofy's saving
  you a seat") — an explicit bark-set rule in the guide's guilt-free
  register (16 §2.4). No companion ever "misses you sadly," no light
  ever "went out because you left."

### 4.5 Return — the world notices

The first geofence entry after >30 days away triggers one beat: the
guide marks the return ("the light remembers you"), the Journal opens a
new chapter, and any dormant pinned promises surface on the living map.
Zero mechanical reward (equity rule) — the payoff is _recognition_.
Cheap (one flag on the trip manifest, 16 §15.3) and it closes the loop
the Chronicle's last page opened.

---

## 5. What we refuse (the anti-pattern list, made explicit)

Each of these is a proven retention lever elsewhere and is **rejected**
here, on the record, so future passes don't relitigate them piecemeal:

1. **Daily streaks / login calendars.** Punishes the exact cadence our
   core segment cannot change. (The Vestibule may _notice_ a visit
   streak of trips-per-year in Wrapped as celebration; it never gates.)
2. **Energy / stamina timers.** Manufactured scarcity in a game whose
   scarcity — being there — is real and absolute.
3. **Decay of anything personal.** Canon already (08); restated because
   retention passes are historically where save-file decay sneaks in.
4. **Guilt copy.** Canon via 16 §2.4's rule, extended here to
   notification copy and companion barks (§4.4).
5. **Remote verbs.** No remote seals, remote raids, "send your
   companion to fight for you" idle mechanics. The moment the World can
   be touched from home, presence stops being the currency and the
   entire integrity/anti-spoof edifice (06, priority ①) protects
   nothing worth protecting. _(Revisited by
   [18 §6.4](18-realm-of-sleep-nationwide-2026-07-30.md) and
   [19](19-nationwide-hunt-and-synthesis-2026-07-30.md): the refusal
   stands for the park World — its communal state is touchable only
   from within it. Doc 19's street hunt adds verbs *outside* parks that
   never touch park state; gate projection stays sight/social-only,
   with 18 §6.4's ratchet rule against drift.)_
6. **Expiring power** (the equity rule, §3). Time-limited = cosmetic,
   memorial, or recurring. Never stats, never verbs, never Journal
   completion required for a trial.
7. **A second daily-habit app.** ParkFi's civilian surfaces (waits,
   dining, alerts) already own daily habit. The game borrows that
   attention with one bounded, read-only presence inside civilian
   screens (a World-light chip on a park page, aggregates only, flag
   behind `living-layer`) rather than competing for its own daily slot.
   The two-ledger boundary (GDD Canon Log 2026-07-16) is untouched:
   read-only, aggregate, no module imports.

---

## 6. Measuring it (so "deep pass" means numbers, not vibes)

New PostHog vocabulary (stable names, per the park-tracking convention):
`away_vestibule_opened`, `away_chronicle_viewed`, `away_chronicle_shared`,
`away_memory_dive` (`{mode: watch|refight}`), `away_vigil_session`,
`away_promise_pinned`, `return_recognized`. Segment every funnel by
**home-distance band** (derived, coarse: local / regional / destination
— never store precise home location; the band is computable from trip
patterns we already infer).

The KPIs that matter, per transition:

- **Afterglow:** Chronicle open rate within 14 days of trip end (the
  single most important number in this doc); share rate.
- **Long Dark survival:** Vestibule MAU among users >30 days post-trip;
  push opt-out rate (the guardrail — a rising opt-out means §4.3's
  policy failed regardless of MAU).
- **The Call:** pinned-promise → trip-signal conversion; Vigil session →
  trip-signal conversion (lagged).
- **Return:** re-trip attach rate (of users with a prior game trip, what
  share play again next trip — **the north star**); days-to-reactivation.
- **Guard metrics:** in-park heads-down time must not rise (pillar 4);
  civilian-app engagement must not dip where game chips appear.

---

## 7. Build-order impact (where this lands, if adopted)

Almost everything rides existing workstreams — this pass adds one new
box and re-scopes one old one:

- **Memory Dives** = priority ①'s stored move lists + ②'s theater. A
  thin consumer; schedule _after_ both, before or alongside ⑤.
- **The Chronicle** = M6 re-scoped (per-trip, not annual). Its data
  dependencies (verdict stamping, resolve snapshots) are exactly
  priority ①'s "ship first" items — one more reason stamping cannot
  slip.
- **Seasonal light / the Vigil** = workstreams ④ and ②b-d plus the SSE
  wire ③; spectator mode is the park channel read-only.
- **Vestibule + starmap + promises** = 16 §5's placement (16 §15.2)
  unchanged; this doc adds the manifest/Call composition on top.
- **Return beat** = a flag on the in-park trip manifest (16 §15.3).

Nothing here precedes priority ① — the away game is largely a
_dividend_ of the integrity and feel work already adopted, which is the
strongest argument that the adopted order was right.

## 8. Canon deltas (if adopted — GDD-first, one Canon Log entry each)

1. GDD §5 gains the **away loop** (supersedes/absorbs 16 §5.5's
   version): spark → journey → afterglow → long dark → call → return,
   with the two-currency rule (§3) and the equity rule as canon text.
2. Pillar 3 gains the sight/love sentence (16 §5.5) **and** the
   expiring-power prohibition.
3. §4.2 (Journal): Memory Dives as the Journal's at-home verb; dream
   exemption language imported from 16 §1.
4. §10: Chronicle row (M6 re-scoped), Memory Dive row, seasonal-light
   note on the World-light row.
5. §8 (balance knobs): the push budget — hard caps per phase (afterglow
   rich, long dark near-silent absent personal/trip signals).
6. [09](09-moderation-trust-safety.md): letter-notice contents rule
   (existence + place, never contents, in any notification).

## 9. Open questions raised by this pass

- Does the Chronicle need an editorial pass (LLM-composed guide lines)
  or is template composition enough for v1? (Cost/latency/brand risk.)
- Can a Dreamer (never visited) receive a degraded Vestibule — starmap
  of _possible_ worlds, the Dive, Vigil — without the game feeling like
  an ad? Where's the line between anticipation and marketing?
  _(Answered by [18 §5b](18-realm-of-sleep-nationwide-2026-07-30.md):
  the Dreamer's game is made whole, so anticipation is a gift on top of
  a complete arc, not the product.)_
- Memory Dive re-fights: is "practice fluency" itself a power grant
  that erodes the presence currency at the margin? (Lean: no — fluency
  is the player getting better, not the save file; same as reading a
  wiki.)
- Household/family accounts (16 §7): the Chronicle is naturally a
  _family_ artifact — does it compose across a traveling party?
