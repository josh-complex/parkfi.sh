# 15 — State of the game & research digest (2026-07-15)

> **Status: folded into canon 2026-07-16 — historical record.** This digest's
> recommendations were adopted and folded into the [GDD](GDD.md) (glossary,
> §3.3/§3.7, §4.2, §7, §8, §10, five Canon Decision Log entries) and docs
> 03/05/07/08/09/10/11/13/14 in the same-day canon-alignment pass. The GDD is
> once again the source of truth; this doc is kept as the deep rationale and
> research record behind those decisions — if it disagrees with the GDD, the
> GDD wins. It summarizes a full audit of the
> shipped build (code, not just docs), the gaps between "systems that work"
> and "feels like Kingdom Hearts," external research on connection, AR, and
> realtime sync, and the 2026-07-15 docs re-alignment (the 8th Wall purge).
> Four deepening passes (2026-07-15/16) are folded in: combat feel and the
> battle UX (§3.1–3.7); the progression spine and its relationship to the
> shipped achievements engine (§3.8–3.14); the mark-as-community
> re-foundation — cosmology test, echoes, World light, Trinity Marks, Lucky
> Emblems (§4.1–4.9); and the push channel — case, vocabulary, wire spec
> (§6.1–6.6). All external sources are collected at the bottom.

## 1. Where the build is

Shipped and verified in source (GDD §10 is accurate):

- **The moat works.** `src/server/living/darkness.ts` reconciles real
  `attraction_status_obs` DOWN states into encounter marks (level-triggered,
  idempotent, TTL-refreshed, unit-tested). A real ride-down spawns a Breaker at
  that spot.
- **Battle + party.** `battle.ts` has deterministic Heartless specs, the
  three-verb kit (Strike 9 / Surge 22×1 / Guard ½, Wielder HP 42), and
  `fieldParty` with home/guest/away proximity tiers resolved server-side in
  `startEncounter`.
- **Companions, recruiting, XP, discovery pins, reactions, moderation floor**
  all live in the `living` tRPC router; play mode renders inside the park map
  (`map-stage.tsx`) behind the PostHog `living-layer` flag.

Placeholder / not built: linear rank curve with two XP sources (the GDD §4.0
retrospective's dead-end), no Journal, no keychains/forge/materials, no
Nobodies/escalation, no Organization Rifts, no presence verification (M5b), no
AR (M4b), no logbook (M6). Socialspace = discovery pins only. The client is
pure request/response: the play map polls `living.marks` every 30s
(`park-map.tsx`); there is no push channel anywhere.

## 2. The integrity gap (now the critical path)

The battle turn loop runs entirely in client React state
(`battle-panel.tsx`); `resolveEncounter` accepts whatever outcome the client
reports. Nothing ties a resolve to a start, there is no session, no timing
floor, and **no presence check on battles at all** (only `leaveMark` checks the
park boundary). Anyone can seal every breach in a park from a couch with one
tRPC call per mark.

This is a known M5 deferral, but it re-orders the roadmap: social features
that _attribute or reward_ seals multiply the incentive to cheat. The later
passes narrowed exactly what integrity blocks — `seal` attribution on the
event channel (§6.3), an honest World-light economy (§4.6), and game→app
achievement crosstalk (§3.11) — everything else in the social ladder ships
without it (§7 priority 1). The cheap,
elegant fix: because the battle is a pure deterministic function, have the
client submit its **move list** and let the server **replay the fight** with
the same `heartlessSpec`/`fieldParty`/turn rules; add a server-side encounter
session row at `startEncounter` plus a minimum-duration check. Same code, no
new design, outcomes become server-verified — and a submitted move list
future-proofs timed combat (below).

## 3. What "feels like Kingdom Hearts" decomposes into

The systems are KH-shaped; the sensation isn't. Cheapest-first ladder — none
of it is AR:

1. **The command menu** — replace the three flat buttons with the iconic
   bottom-left stacked command menu. One component, instant genre recognition.
2. **Turn theater** — staged per-turn animation: swing flash, hit shake, damage
   pops, and the Heartless dissolving into dark wisps **with a heart floating
   up** on the kill (the signature KH death beat; ~20 lines of CSS/canvas).
3. **Timing as skill** — tap-timing bonus on Strike; Guard becomes reactive
   against a telegraphed wind-up (the already-designed Nobody-warp read, pulled
   forward); a hold-to-fill Surge gauge. Same three verbs, still
   server-replayable.
4. **Reaction Commands** — the rare green-triangle prompt with a tight window
   for a spectacular counter; one more entry in the move list.
5. **Audio identity** — map ambience, battle loop, victory fanfare, the
   "obtained!" jingle, menu ticks. Web Audio works fine in the Capacitor
   webview; this is asset work. Pillar 4's ear channel starts here.
6. **Ceremony** — World-entry splash cards on geofence crossing, a
   Keyhole-seal light-beam-and-click sequence, recruit vignettes with one line
   of dialogue (the cron+Claude lore pattern in [11](11-architecture.md) can
   draft barks and Journal flavor at scale).
7. **The progression spine** (GDD §4.1–4.5) — Journal → drops/materials →
   keychains, in that order. Without it every battle economically dead-ends
   once a park's companions are recruited; the Journal's **live-gated condition
   entries** are also the most defensible content expression of the moat.
8. **Moogle forge** — when synthesis lands it's a Moogle, kupo.

The ladder is the index; §3.1–3.7 below (added later on 2026-07-15) are the
implementation-grade spec for rungs 1–6 — what the research says about how to
actually build each one on this stack. §3.8–3.14 (added 2026-07-16) do the
same for rungs 7–8: the progression spine, designed against the achievements
engine the app already ships.

### 3.1 One data structure serves feel, integrity, and accessibility

The deepest finding of this pass: the §2 server-replay fix, the turn theater,
and screen-reader support all want the **same refactor**. Today `play()` in
`battle-panel.tsx` resolves an entire round synchronously in one click and
dumps the result as log strings — there is no time axis to hang feel on, no
structured record to replay, and no semantics for assistive tech. The standard
turn-based architecture (command pattern for actions, an event queue feeding a
small presentation state machine) separates **resolution** from
**presentation**: a pure `resolveRound(state, move) → RoundEvent[]` in
`battle.ts` returns typed events (`playerHit {dmg, timing}`,
`allyHit {companionId, dmg, home}`, `foeHit {dmg, guarded}`, `heal {…}`,
`victory`, `defeat`), and the client plays them back one beat at a time.

- The same function replays the submitted move list on the server (§2).
- The event list _is_ the battle log — and the aria-live feed (§3.7).
- Every juice hook (§3.2), sound (§3.3), and haptic (§3.4) keys off an event
  type. No effect ever needs to re-derive game state.

Pacing from the research: each event beat 300–600 ms, a full round under ~3 s,
and always tap-to-skip/fast-forward — a player sealing 30 breaches a day will
hate a mandatory theater, and skippability is an accessibility guideline, not
just a courtesy.

### 3.2 The juice stack, mapped to web tech

Ranked by feel-per-line, with the right web primitive for each. The rule from
the animation-performance literature: **WAAPI/CSS on `transform` + `opacity`
for UI elements, one rAF canvas for particles, and never drive animation
through React state re-renders** — juice is imperative (refs + WAAPI); React
owns game state only.

- **Hitstop** — freeze the presentation queue 60–150 ms on connect, longer for
  Surge and the kill. In the §3.1 architecture this is literally a delay before
  the next event; the cheapest high-impact trick in the whole stack.
- **Damage numbers** — pooled absolutely-positioned spans animated with WAAPI
  (`translateY` + `opacity`, slight random x-drift, type size scaled to
  damage).
- **Hit shake** — `transform: translate` on the battle panel only (never the
  map canvas behind it), 0.1–0.3 s, randomized direction, eased decay,
  amplitude scaled to damage (the "trauma" model from the screen-shake
  literature).
- **Swing/impact flashes** — CSS keyframes on compositor-only properties.
- **Dissolve-into-wisps + the rising heart** — one small `<canvas>` overlay,
  ~30 particles under rAF (which auto-pauses when backgrounded). The signature
  KH beat earns the canvas; nothing else needs it.
- **Deliberately skipped:** FOV punch, chromatic aberration, damage vignettes —
  that's shooter juice. The over-juicing literature is blunt: feedback
  intensity must encode _meaning_, and if every Strike fires the full stack,
  Surge has nowhere to go. Plain Strike = number + flash + tick; the
  hitstop + shake + heavy-haptic combo is reserved for Surge, reaction
  commands, and kills.

### 3.3 Audio in the Capacitor webview

Web Audio API, not `<audio>` elements — precise scheduling, polyphony,
low-latency one-shots; howler.js is the battle-tested wrapper (audio sprites,
pooling, auto-unlock). The practices that matter here:

- **Unlock:** an AudioContext starts suspended until a user gesture. The
  "Engage" tap on the encounter sheet is the natural unlock — resume the context
  there, never at page load.
- **The silent-switch gotcha (load-bearing):** WKWebView runs its own audio
  session, ignoring the app's `AVAudioSession` category. Pure Web Audio output
  rides an Ambient-style session — it **respects the ring/silent switch** —
  while `<audio>`/`<video>` elements flip the session to Playback and ignore
  the switch. For a game played in a crowded park, respecting the switch is
  the socially correct default, so Web-Audio-only is right both technically
  and behaviorally. Don't add a native-audio plugin until something genuinely
  needs background/lock-screen playback (nothing does).
- **Bus architecture:** three `GainNode` buses — map ambience, battle loop,
  one-shots — so ambience ducks under battle with a gain ramp and the <1 s
  battle crossfade lands the KH "battle music interrupts field music" beat.
  Master volume/mute is then one node.
- **Assets:** one-shots in a single audio sprite, decoded when play mode arms;
  loops need gapless-format care (OGG/M4A/CAF — MP3 pads silence, a seam every
  bar). Identity anchors to commission first: battle-start sting, hit tick,
  Surge swell, victory fanfare, the "obtained!" jingle, menu tick. Sound _is_
  state feedback — every transition in §3.1's machine gets an ear-channel
  signature. Pillar 4 starts here, not in AR.

### 3.4 Haptics — the channel the park can't wash out

Sunlight kills visuals and crowd noise kills audio; the hand channel survives
both. `navigator.vibrate` doesn't exist in the iOS webview — use the Capacitor
Haptics plugin (Taptic generators on iOS with no permission; Vibrator on
Android behind the install-time `VIBRATE` permission; safe no-op elsewhere).
The v1 mapping keys straight off §3.1's events:

| Event                            | Haptic                   |
| -------------------------------- | ------------------------ |
| command menu focus change        | `selectionChanged`       |
| landed Strike                    | impact **light**         |
| timed-Strike bonus / Guard catch | impact **medium**        |
| Surge / killing blow             | impact **heavy**         |
| breach sealed                    | notification **success** |
| overwhelmed / retreat            | notification **error**   |

The built-in generator presets cover the entire table; custom CoreHaptics
AHAP / Android composed-waveform patterns (a signature "seal click") are a
later polish rung via community plugins. Two rules: haptics are always
redundant with a visual + audio cue (never the sole carrier), and there's a
settings toggle.

### 3.5 Timing verbs under real latency

The ladder's timing mechanics (tap-timed Strike, reactive Guard, reaction
commands) run into physics: touch-to-screen latency in mobile webviews is
roughly 50–100 ms and device-variable, and audio output adds its own variable
latency (low on iOS, historically poor on Android). Rhythm-game practice
translates directly:

- **Anchor timing visually, not audibly.** Judge the tap against an on-screen
  anchor (a closing ring, the keyblade wind-up frame) driven by the same frame
  clock as the input handler. Visual anchoring sidesteps audio latency
  entirely — no calibration screen needed at these stakes.
- **Generous windows, bonus-only stakes.** "Good" ≥ ±150 ms, "perfect" ~±70 ms
  — and a miss is just a base Strike, never a whiff. Timing adds damage; it
  never gates success. That keeps every fight winnable untimed (accessibility)
  and keeps server validation trivial: the move-list entry carries a timing
  grade the replay clamps against the session's timestamps.
- **Telegraphs are multi-channel and slow:** Guard's wind-up cue ≥600 ms with
  visual + audio + haptic pre-cue; reaction-command windows ≥800 ms.
- **Assist is a checkbox, not a fork:** a setting that doubles all windows,
  plus quiet adaptive widening after N consecutive misses. The accessibility
  guidelines are explicit that timed inputs need adjustable or auto-complete
  paths — and equally explicit that button-mash verbs should never exist.

### 3.6 The battle flow, end to end

The loop a guest actually walks, with the load-bearing UX facts:

1. **Discover** — the breach erupts on the map (§6 SSE) → tap pin → bottom
   sheet: foe silhouette + name, fielded-party preview (who's home ★), one
   primary button. That button is simultaneously the audio unlock, the
   `startEncounter` call, and consent to a ~60-second commitment — label it
   like one ("Engage").
2. **Enter** — the `startEncounter` round trip hides inside a ~1 s
   darkness-closes-in transition with the battle-music crossfade. Latency
   becomes ceremony; the current "Approaching the Darkness…" spinner was
   already reaching for this.
3. **Fight** — the KH stacked command menu goes bottom-left, which is not just
   genre iconography: it lands exactly in the thumb-zone research's green zone
   (bottom-center reach with zero strain; top corners are the do-not-interact
   zone). Park reality is one-handed play — the other hand holds a churro. Foe
   - HP bars top (display only), log/theater middle, **all interaction in the
     bottom third**, rows ≥48 px, no long-press or multi-touch anywhere.
4. **Survive interruption** — someone will talk to you mid-fight and the phone
   will lock. Deterministic state (spec + move list) makes resume trivial:
   persist the in-progress move list keyed by the §2 session row; reopening
   within the session TTL offers "Resume the fight"; an expired session counts
   as flee, not loss. Never punish the pocket.
5. **Resolve** — win ceremony 3–5 s, skippable: dissolve → heart → fanfare →
   XP tick-up → drops. Loss stays cheap and blame-free ("You retreat to
   regroup" is already the right voice) — instant retry, no penalty beyond the
   walk.
6. **Exit** — back to the map with the sealed breach visibly changed (proof the
   world moved), plus a one-tap chain into the next breach ("Another Darkness
   stirs nearby →"). Park sessions are interstitial — queue lines, waiting on
   the group — so the whole loop targets 30–90 s and chains willingly.

Outdoor legibility is a real constraint the location-game literature keeps
confirming (players literally seek shade to read the screen): thick HP bars,
big damage type, a high-contrast battle palette, and never a low-alpha effect
as the only carrier of information.

### 3.7 Accessibility — protect what turn-based gives for free

A turn-based battle is one of the most accessible genres in games; the feel
work must not spend that. The checklist, mapped to this battle:

- **Motion:** gate shake/flash/particles behind `prefers-reduced-motion` (the
  webview reflects the OS Reduce Motion setting) and swap in opacity/scale
  cues; expose an in-app toggle too.
- **Photosensitivity (WCAG 2.3.1):** ≤3 flashes/sec and flash area small or
  below luminance thresholds. The wisp dissolve is safe; a full-screen white
  Surge flash is exactly the failure mode — use a radial glow instead. Run
  PEAT over the final win/Surge sequences.
- **Color:** the HP bars already differ by position + label (good); damage vs
  heal numbers get a sign or icon, never color alone.
- **Screen readers:** the battle log is already prose — `role="log"` +
  `aria-live="polite"` (append newest-last, the opposite of today's
  newest-first prepend) makes the entire fight screen-reader playable nearly
  for free, something almost no game ships. Command buttons carry state in the
  label ("Surge — one use, ready"). §3.1's event list makes this systematic.
- **Timing:** per §3.5 — bonus-only, assist toggle, no mash inputs, skippable
  theater.
- **Targets & text:** ≥48 px touch rows; log and menus respect OS text
  scaling.

### 3.8 The progression spine — one economy, and a sibling already in production

Rung 7 is three features in canon order (Journal → drops → keychains, GDD
§4.2–4.4) but **one economy in dependency order**: the Journal makes each kill
_legible_ (a page, a tally, a condition), drops make each kill _yield_ (a
material with a name), keychains make the yield _matter_ (the same three verbs,
sharper). Ship any of the three alone and it dangles; ship them in order and
every battle advances something forever — the fix for the §4.0 dead-end where
a park's last recruit makes battles economically pointless.

The deepest finding of this pass, though, is not about the game at all:
**ParkFi already ships a mature progression engine**, and the spine should be
built as its architectural sibling. The achievements/levels system
(`src/lib/achievements.ts` + `src/server/achievements/engine.ts`) is the most
battle-tested progression code in the repo: 28 families / 97 tiers defined as
a **catalog in code** (the DB stores only unlocked tier ids in
`user_achievement`), fed by a location-ping pipeline that folds GPS into
`user_park_day` rollups, runs a queue-dwell state machine (8-minute anchored
dwell ⇒ a ride), ingests sensor-verified coaster traces, and stamps per-day
condition flags — `rainy` (from `weather_obs`), `rope_drop`, `night_owl` —
that are precisely the _verified-by-physics_ checks doc
[08](08-achievements-persistence-coldstart.md) demands. Evaluation is a pure
closed-set reconcile: `computeStats` derives every stat from rows,
`satisfiedTierIds` returns the full deserved set, and an
insert-`onConflictDoNothing` makes unlocks **sticky, idempotent, and
retroactive** (add a tier later and history satisfies it instantly — the
`track_distance_m` precedent, which became correct the moment `coaster_stats`
was seeded, with zero backfill code). On top: a 20-level XP curve with titles,
a toast/haptic/level-up ceremony funnel, and dev tooling (`devUnlockNext`,
`devResetMine`) that lets the whole unlock loop be QA'd from a desk.

Both files carry the same deliberate comment: _independent of the Living
Layer — no imports from `src/server/living/**`_. That boundary is load-bearing
and this pass keeps it (§3.11). The design stance in one line: **steal the
architecture, share the substrate, never merge the systems.**

### 3.9 The Journal is the achievements engine pointed at `encounter_log`

Every architectural decision the Journal needs has already been made once:

- **Catalog in code.** Journal pages (one per species) and their condition
  entries are a `JOURNAL` catalog next to `ACHIEVEMENTS` — names, flavor,
  thresholds, XP values as data, exactly like the 97 tiers. The DB stores only
  sticky `journal_entry` unlocks (the `user_achievement` mirror). Species are
  already code-defined (`heartlessSpec` is deterministic), so the catalog keys
  off the same species codes. Content ships in a deploy, not a migration —
  and the cron+Claude lore pattern ([11](11-architecture.md)) can draft page
  flavor at scale.
- **Derived counts, zero new bookkeeping.** First-of-species and tally
  milestones (10/50/200) are pure aggregates over `encounter_log` — which
  already records `(user_id, heartless_type, outcome, ts, live_state_snapshot)`
  per battle. No counter table, no increment discipline; a
  `computeJournalStats(logRows)` in the `aggregateDayRows` style (pure,
  DB-free, unit-testable) plus the same closed-set reconcile. Add a milestone
  tier next year and every veteran's history fills it on next evaluation.
- **Sticky unlocks, one write path.** `evaluateAndUnlockJournal` mirrors
  `evaluateAndUnlock`: never deletes, admin revoke as the only removal,
  newly-unlocked delta returned for ceremony. It runs where the rows change —
  inside `resolveEncounter` — not on a poll.
- **The ceremony funnel is a second consumer.** The unlock-toast /
  tier-badge / haptic pipeline (`components/achievements/*`) already stages
  exactly the "page filled" moment; the Journal reuses the pattern (KH skin,
  "obtained!" jingle per §3.3) rather than inventing a parallel one.
- **Dev idiom transplants.** A `devUnlockNextPage` / `devResetJournal` pair is
  what makes the forge loop testable without a park visit — the same reason
  the achievements engine grew them.

What does **not** transplant: the ping pipeline. The Journal's events are
battles, not location fixes — `encounter_log` is already its `user_park_day`.
The engine's _shape_ (rows → pure aggregate → closed-set reconcile → sticky
insert → ceremony delta) carries over unchanged; the input table differs.

### 3.10 Condition entries — two witness classes, and a snapshot gap costing us history

Condition entries are the moat's content expression (§3 rung 7), and each
needs a **witness** — evidence the server holds that the condition truly held.
They split cleanly in two:

- **World-shaped conditions** — _defeated during a real ride-down_, _in rain_,
  _after dark_, _in its home World_ — are witnessed by live state at battle
  time plus the log timestamp. The primitives all exist: `weather_obs` (the
  achievements engine's `isRainyNow` is the exact query), park-local hour via
  the `localParts` idiom, the mark's attraction→land→World resolution
  (`startEncounter` already does it), and `attraction_status_obs` for
  downtime. (_Home World_ additionally needs the species catalog to gain a
  `homeWorld` — a content decision, currently unmodeled.)
- **Battle-shaped conditions** — _flawless_ (no damage taken), _surge-less_ —
  are witnessed by the **move list**, which is exactly the §2 integrity
  artifact. This is the second time priorities 1 and 5 converge (§3.1 was the
  first): the submitted move list is simultaneously the anti-cheat evidence
  and the trophy witness. Server replay emits the §3.1 `RoundEvent[]`; the
  condition verdicts (`flawless`, `surgeless`) fall out of the replay for
  free.

The gap, found in source: the snapshot is thinner than its own type. The
`LiveStateSnapshot` type declares `weather` and `crowdIndex`, but the darkness
worker only ever writes `{status, standbyMin, capturedAt}` — and
`resolveEncounter` copies the mark's _spawn-time_ snapshot into
`encounter_log`, capturing nothing at resolve. So today, "sealed in the rain"
has **no durable witness**: rain is join-recoverable from `weather_obs` only
while its retention lasts, and "still really down when you fought it" isn't
recoverable at all.

The recommendation this pass promotes into priority 1 (§7): **stamp verdicts
at resolve, now, ahead of the Journal itself.** Concretely: at
`resolveEncounter`, capture a resolve-time snapshot (attraction status,
weather condition, park-local hour) and — once §2's replay lands — the
battle-shaped verdict booleans, onto the `encounter_log` row. That makes every
condition a **pure function of the log row forever**, independent of obs
retention and replayable into any future catalog entry. It is a few lines,
and it is the one part of the spine where delay is unrecoverable: every week
without it is a week of battles whose trophies can never be awarded
retroactively. (The reconcile stays derived for counts; verdicts are stamped
because their witnesses — the move list, transient live state — are heavy or
gone by evaluation time. `encounter_log` remains the single source; nothing
else needs to be consulted.)

### 3.11 The boundary — two XP systems by design, cross-talk through rows

The obvious temptation is to unify: one XP pool, one level, one engine. It is
wrong here, and the existing comment-enforced boundary should be kept and
canonized. ParkFi levels (Turnstile Tourist → The Mouse Knows Your Name) are
the **civilian identity** — they work for every user who never arms play mode,
they're store-review-safe, and they sit on the app's most stable code. Wielder
rank is the **game** — volatile, flagged, IP-entangled, and (per GDD §4.1)
about to gain bands and trials. Merging them couples the app's steadiest
system to its most experimental one and forces every game-balance change
through the civilian economy. Two ledgers, two curves, permanently. The rules:

1. **Shared substrate, not shared modules.** Both systems consume the same
   observation tables (`weather_obs`, `attraction_status_obs`, geo state, the
   future M5b presence primitive) and may share _pure helpers_ lifted into
   `lib/` (`localParts`, the rain query, `pointInPolygon`). Neither server
   module imports the other, ever.
2. **Game→app crosstalk is a stat bump.** When the game wants civilian
   recognition (an achievements family for sealing, say), the living router
   bumps an allowlisted `user_stat` counter **server-side** (e.g.
   `breaches_sealed`) — the exact `bumpEventStat` shape, minus client
   reportability. The achievements catalog then celebrates the game without
   knowing it exists. **Gated on §2 integrity**: until seals are
   server-verified, a couch script farms civilian XP too — one more thing the
   integrity work unblocks.
3. **App→game crosstalk is a read.** The game may read achievements-owned
   rows as data (`user_park_day` day flags, `user_attraction`, presence). The
   M5b presence primitive should land on the achievements side — that engine
   already owns geo state and the dwell machine — and be consumed by both.

One more payoff: the GDD §4.1 **Mark of Mastery trials** are
achievements-shaped predicates. "Close 3 wounds in a single visit" is a
day-scoped aggregate over `encounter_log` — the `aggregateDayRows` idiom
verbatim; "complete any World's full Journal page set" reads the §3.9
reconcile. The trial evaluator should be built as the same kind of pure
function over rows, unit-tested the same way, from day one.

### 3.12 Drops — the anti-cheat posture applied to loot

GDD §4.4's canon line is the whole design: the drop is a **pure deterministic
function of (mark seed, species, tier, live snapshot)** — `heartlessSpec`'s
posture applied to loot. Implications, in order of load-bearing-ness:

- **The server computes drops; the client never proposes them.** Drops land in
  `resolveEncounter`'s win branch beside `grantWielderXp`, derived entirely
  from data the server holds. Under §2's replay they need no additional
  validation — a verified win _is_ a verified drop.
- **Seeded means re-rolls don't exist.** The same mark yields the same drop;
  farming a spawn can't fish for rarity. Rarity policy rides the live
  snapshot: the rarest materials sit behind the hardest-to-fake conditions
  (§3.10's witnesses price the loot), which is the §8 balance philosophy and
  the moat expressed as an economy.
- **Idempotency is inherited.** `resolveEncounter` already short-circuits on
  already-resolved marks (`activeEncounterMark`), so double-award needs no new
  guard; record the computed drop on the `encounter_log` row for audit.
- **The ceremony is an event.** The victory theater receives typed `drop`
  events in the §3.1 `RoundEvent[]` stream — the "obtained!" jingle, the
  material card, the Journal tally tick, one beat each, skippable.
- **Schema:** a `wielder_material (user_id, material, qty)` ledger — material
  keys are `element × tier` (shard → stone → gem) plus `husk` (Nobody-only)
  and `thread` (incursion-only) per GDD §4.4. Recipes are code (catalog-in-code
  again); no currency in v1.

Drops can ship **before the forge** — materials accumulating toward known
recipes is anticipation, not waste (the collection-economy pattern) — but
**after the Journal**, which is what makes a drop read as "the Breaker's
stone" rather than inventory noise.

### 3.13 Keychains & the loadout — where growth becomes felt, and the session pin

Doc [10](10-data-model.md)'s sketches stand: `keyblade` / `wielder_keyblade`
(gear + level), `seal_state` (world-day control points). The first full seal
of a World grants its keychain (GDD §4.3 — geography is the loot table); the
forge upgrades it +1/+2/+3 with that same World's materials, band-gated.

The point of the whole spine lands here: **the loadout finally makes
`battle.ts`'s constants variables.** Might adds to Strike, Surge power scales
the nuke, the element and signature perk hook the same pure functions that
already take `fieldParty` — growth becomes a felt change in the three verbs,
fixing §4.0's "growth is a toast, never a power change." `fieldParty` is the
precedent to copy: computed server-side at `startEncounter`, passed into pure
resolution, never trusted from the client.

The one integrity detail that must not be missed: **the §2 encounter session
row must pin the loadout at `startEncounter`** — keychain id, upgrade level,
party — and the server replay must resolve with the pinned loadout. Otherwise
equip-after-fight retro-buffs a submitted move list (win a Breaker fight you
lost by swapping to the +3 before resolving). The session row was already the
plan; this adds three columns and closes the hole before it opens. It also
resolves the Canon Log's 2026-07-04 open follow-up in the same stroke:
companion ally-action magnitude should read gear and level from the pinned
session, not just seed stats.

The braid back into the Journal completes the economy: completing a World's
page set unlocks that World's keychain upgrade tier (GDD §4.2–4.3), so the
hunt feeds the forge feeds the verbs feeds the hunt — and per-park keychain
sets become the meta-collection axis that travels (doc
[08](08-achievements-persistence-coldstart.md) Part B's traveling identity).

### 3.14 Build order and doc deltas

Cheapest-first, with the witnesses front-loaded because they're the only
unrecoverable part:

1. **Now, inside priority 1:** resolve-time snapshot stamping on
   `encounter_log` (§3.10) — ships with or even before the session/replay
   work; plus the loadout columns on the session row (§3.13) when it lands.
2. **Journal v1:** catalog + derived reconcile + sticky `journal_entry` +
   ceremony reuse (§3.9). Schema anticipates the §4 consumers — emblem pages
   and trinity ticks are entry types, not retrofits (§7 priority 5's existing
   note). World-shaped condition entries only; battle-shaped ones activate
   when replay lands.
3. **XP economy (GDD §4.5):** species XP replaces the flat +10 in
   `grantWielderXp`'s callers; Journal first-of-species and condition XP ride
   the same grant. Rank stays linear until —
4. **Rank bands + trials (GDD §4.1):** trial evaluator as pure predicates
   over `encounter_log`/journal state (§3.11).
5. **Drops + `wielder_material`** (§3.12).
6. **Keychains + loadout-aware battle + seal_state** (§3.13); **forge UI
   last** — it's a Moogle, kupo (§3 rung 8).

If adopted, canon/doc touches: [10](10-data-model.md) gains `journal_entry`,
`wielder_material`, the `encounter_log` verdict/snapshot columns, and the
session-pin columns; the GDD §4.2 gains the witness-class distinction
(world-shaped vs battle-shaped) and §10's Journal/forge rows update as these
land; doc [08](08-achievements-persistence-coldstart.md) Part A should record
the boundary rules (§3.11) — the achievements engine as the civilian sibling,
crosstalk through rows only; and a Canon Decision Log entry records the
two-ledgers-by-design decision so nobody unifies the XP pools in a refactor.

## 4. Feeling connected to others — a five-tier ladder, ordered by risk

Research supports the async-first canon: Pokémon GO's ~60% 3-day retention
(vs ~15% app-industry average) is heavily attributed to social scaffolding,
and the academic literature consistently finds belonging/co-presence effects —
while also finding that **comparison-based features demotivate a meaningful
slice of players**. KH's fiction wants cooperation-against-darkness, not PvP.

- **Tier 0 — read-only ambience** (SSE, no new tables): "N wielders in this
  park today," per-breach "sealed 14m ago," a World **darkness meter** everyone
  collectively pushes back. Zero UGC/moderation/privacy surface; honest
  aggregates feel alive even at low user counts.
- **Tier 1 — close the async loops already built:** "someone touched your
  echo" / resonance notifications (pre-refiction: found-your-mark). The
  **A4 FCM push work is code-complete** — this and the incursion pulse are
  its first game consumers. Highest retention per line of code in the whole
  social space.
- **Tier 2 — live presence rooms:** a Durable Object per park broadcasting
  coarse aggregates only (counts/events, never coordinates). Hibernation makes
  the economics trivial (Cloudflare's worked example: ~$138/mo naive vs
  ~$10/mo hibernated; incoming messages billed 20:1, outgoing free).
- **Tier 3 — friends + "sealed together":** friend graph on Better-Auth users;
  a bond bonus when two friends win at the same breach within N minutes —
  verifiable purely from `encounter_log` timestamps. Friendship as mechanic.
- **Tier 4 — Convergences:** solo-instanced Rifts with a shared countdown and
  a "23 wielders answered" tally first; true shared-state co-op only when
  density justifies it (the GDD's open question).

The ladder answers _how_ connection is delivered and at what risk. A later
same-day pass (§4.1–4.9) interrogated the harder question underneath it:
whether the **mark** — as currently designed — is even the right community
interaction, and what the Kingdom Hearts expression of async social actually
is.

### 4.1 The mark problem — storyless, unaddressed, stakeless

The diagnosis, stated plainly: the darkness half of the layer is
fiction-first and it shows — every system feature answers "what is this in
KH?" instantly (ride down = a wounded heart; Nobodies = the wound hollowed
out; sealing = the Keyhole). The social half never got that treatment, and
the [GDD glossary](GDD.md) contains the confession: every row maps our
mechanic to real KH canon except one — _"player-left pin → a wielder's
mark."_ The fiction column just restates the mechanic. Nobody in Kingdom
Hearts "leaves a mark." Four concrete failures follow:

1. **No cosmological standing.** There is no artifact in the KH universe that
   a discovery pin _is_. It's geocaching wearing the game's map — which is
   why it feels arbitrary no matter how it's skinned.
2. **No addressee.** Connection in KH is always _between_ hearts — a letter
   that finds its reader, a charm binding separated friends, a promise. A
   broadcast note addressed to nobody is the weakest possible form of the
   thing the entire franchise is about.
3. **No stakes in the war.** Discovery pins touch nothing — not the darkness,
   not progression, not the Journal. Pillar 6 says a battle whose only yield
   is XP is under-designed; a social act whose only yield is a pin on a map
   fails the same test. The two halves of the layer currently share a map and
   nothing else.
4. **Anchored to coordinates, not meanings.** A mark at a lat/lng is
   graffiti; a mark about _the third lamppost's hidden Mickey_ is a discovery
   about the world. The current model treats the park as a coordinate plane
   when its entire value is that it's a dense field of authored, nameable
   detail.

And a fifth, structural: free-text UGC is the highest-moderation-risk content
in the whole design — and it sits exactly where the fiction is weakest. We're
paying the most for the least.

The mistake is **exposing the primitive as the product**. Doc
[03](03-marks-and-discovery.md)'s "one table, many types" is a _schema_
insight, and it stays — but "mark" should never be a user-facing noun. The
types are the features, and each type must be a fiction-first artifact or it
shouldn't exist. (This doc now holds itself to the same rule: below, "mark"
appears only as the schema/engineering primitive — the features speak
breach, echo, Trinity, emblem, letter.)

### 4.2 The cosmology test

The design rule this pass proposes canonizing: **every community feature must
be an expression of one of KH's four substances** — _hearts connect; memory
is substance; light pushes back darkness; keys open and close._ If a feature
can't answer "what is this in the cosmology?", it doesn't ship. The darkness
engine passes effortlessly (that's why it feels right); `discovery` and
`dare` fail flat.

Apply the test and the franchise turns out to have _already designed our
async-social system_ — KH canon is unusually rich in exactly the artifact
class we need, because its theme has always been connection across absence:

| We need                                    | KH already has                                                                | What it is                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| a trace another player left                | **echoes in place** (The Final World; hearts persisting where they were felt) | strong feeling lingers as a touchable trace                                         |
| co-op that works async                     | **Trinity Marks** (KH1 — literally "marks")                                   | sigils only wielders see; three hearts — the _party_ — awaken them                  |
| a collectible hunt rooted in the real park | **Lucky Emblems** (KH3)                                                       | hidden-Mickey emblems photographed in the world — the parks are _full of real ones_ |
| a message to a specific person             | **the bottle letter** (Kairi's)                                               | a letter that crosses worlds to find its reader                                     |
| a bond token between friends               | **Wayfinders / paopu**                                                        | charms binding separated friends                                                    |
| the record of it all                       | **Jiminy's Journal**                                                          | already canon in §4.2 of the GDD                                                    |
| other wielders as ambient presence         | **Union χ**                                                                   | you are one of many wielders in the same war, mostly felt indirectly                |

The re-foundation below is just this table, ordered by cost.

### 4.3 Echoes, and the light of a World (the cheap 80%)

**Refiction `discovery` → the echo.** A wielder doesn't drop a pin; their
heart leaves an **echo** — a trace of feeling in a place (canon: The Final
World, where hearts persist as touchable stars where they burned brightest).
Finding one, your Keyblade resonates: you touch, for a moment, the heart
that stood here. Same table, same payload, same moderation pipeline — new
verb, new ceremony, new authoring prompt. The prompt is the important part:
not "add a note" but _"what did this place make you feel?"_ — feeling-first,
tip/photo attached. Leaving one: a small light kneels into the ground
(§3-grade ceremony, one canvas beat). Finding one: a resonance ring and the
echo's text, with the find-count reframed as _"12 hearts have touched this
echo."_ Schema keeps `discovery`; only the product speaks KH.

**Then make echoes matter to the war.** The layer has exactly one economy —
light versus darkness — and the social half must buy into it or stay
decorative. Give every World a **light level**: raised by seals, by echoes
left, by echoes resonated (§4.6 prices the contributions); decaying with
time. Where the light is thin, the
darkness bites harder — a straightforward multiplier input into
`spawnDecision`/escalation (both already pure functions built for new
inputs). Now leaving an echo is _tending the World's light_ — a defensive
act in the same war as battle, and the flywheel's two halves close into one
loop: the feed wounds the World, wielders seal and kindle, absence lets the
dark back in. First implementation is a derived aggregate over existing rows
(recent seals + echo activity per world) — **zero new writes** — surfaced as
the §4 tier-0 darkness meter, pushed over the §6 channel as `light` events,
and rendered as literal per-World brightness on the play map. The retention
fiction falls out for free and it is pure KH melancholy: _the light you
tended fades if no one keeps it._ The park needs you back.

### 4.4 Trinity Marks & Lucky Emblems (the KH-native community mechanics)

**Trinity Marks are the answer to "is a pin even the right interaction."**
KH1's Trinities are sigils only wielders can see, requiring the _party_ to
activate — and the canonical trio that activated them was a wielder and two
**companions** (Sora, Donald, Goofy). The async translation: a wielder plants
a Trinity at a verified spot (placement only — **zero user text**); it lies
dormant until **three hearts** have stood on it — over hours or _weeks_. The
third heart wakes it for everyone who touched it: retroactive push ("The
Trinity you joined in Fantasyland has awakened"), rewards and a Journal tick
for all three, first-kindled credit to the planter. Three _wielders_ is the
full form; a woven wielder may instead **call on their party** — fielded
companions stand in for the missing hearts, at reduced XP (sketch in §4.6) —
which is the KH1 image, literally, and what makes the loop solo-completable
per pillar 2. This is co-op that **works at low
density because waiting is the mechanic** — cold-start's biggest weakness
(nobody's here _right now_) converted into anticipation (someone will be).
It's the first real consumer of the A4 FCM work after the echo-touched push, it
rides the §6.3 vocabulary (`trinity` events), it has no moderation surface
at all, and presence-verification makes every awakening real by
construction. Of everything in this pass, this is the feature most worth
prototyping.

**Lucky Emblems make the park itself the content.** KH3's emblems are
hidden-Mickey-shaped by canon, and the real parks are saturated with real
hidden Mickeys — the crossover writes itself. The first finder _registers_
an emblem (photo + spot, presence-verified); subsequent wielders confirm by
finding it — the exact `pin_scan` confirmation pattern already in
production. Confirmed emblems join a permanent park registry credited to the
finder ("first witnessed by…"), and hunting the registry is a canonical
collection track (Journal page per World). This converts UGC from _broadcast
free-text_ into _curation of a bounded registry_ — the moderation surface
collapses to photo review, and the strongest content author in the system
becomes the park itself, which was always the right answer.

### 4.5 Letters, memories, and the cut

- **Letters (tier 3, with the friend graph):** the bottle-letter, literally —
  leave a message _for a named friend_ at a place; it finds them when they
  next stand there, even years later. Friendship-gated, so the moderation
  surface is a DM between mutuals. The single most KH feature in the whole
  plan; it waits only because the friend graph does.
- **Memories** (already in the taxonomy) are the personal thread's echoes —
  elevate them: returning to a place surfaces _your own_ past ("You stood
  here last July — the day you sealed three breaches"). Zero social risk,
  pure sentiment, and the logbook (M6) becomes Jiminy's Journal of your own
  visits.
- **Cut `dare`.** It fails the cosmology test (trials come from Masters and
  Marks of Mastery, not from strangers), and it is the single riskiest item
  in the taxonomy — anonymous strangers instructing guests to _do things_ in
  a physical park is a doc-09 safety surface we should decline to build. The
  impulse it served (leaving a challenge for whoever comes next) is absorbed
  by Trinity Marks with system-authored content.

### 4.6 Mechanic sketches (numbers are starting points, not canon)

#### Echoes

- **Authoring is structured-first, and that's the moderation dial.** The
  required part of an echo is a **resonance** — one of ~6 named feelings
  (wonder, joy, calm, thrill, nostalgia, mischief), picked, not typed. Free
  text and photo are _optional attachments_. This means v1 can ship
  **structured-only with literally zero text-moderation surface** and still
  be emotionally legible ("someone stood here and felt wonder"), with text
  unlocked later (or rank-gated — trusted wielders type, new ones pick).
  The prompt is "what did this place make you feel?", never "add a note."
- **Rate + placement:** presence-verified (canon), ~1 echo per wielder per
  anchor per day, ~10 per park-day. Snap to the nearest named anchor
  (attraction/landmark/land) when within ~30 m — echoes attach to _meanings_,
  not coordinates (§4.1 failure 4), and only fall back to a raw point when
  nothing nameable is near.
- **Density is ambience, not clutter.** Echoes bin by anchor: the map shows
  _places that hold echoes_, and a place's sheet reads "the castle steps hold
  4,812 echoes — 37 today," then a short ranked list (recency + resonance
  count). A heavily-echoed spot glowing on the map **is** the tier-0
  aliveness signal, and it works better the more crowded the park is —
  the rare feature that _improves_ with density.
- **Finding:** inside the anchor's geofence the wrist/ear cues resonance;
  reveal shows the nearest echoes; "touching" one reads it and offers
  **resonate** (the upvote, refictioned) — resonance extends the echo's
  decay per doc 03's good-content-lives-longer rule. Counters speak KH:
  "12 hearts have touched this echo."
- **Decay & the memory unification:** an echo fades for _others_ in ~4–6
  weeks unless resonated — but it **never fades for its author**, for whom it
  is simply their `memory` at that spot. This is a real modeling insight:
  memory and discovery collapse into **one row with a visibility flag** —
  your logbook is the echoes you left; the world's ambience is the subset
  others can touch. Doc [10](10-data-model.md) should absorb this.

#### The light of a World

- **The value:** per-World scalar in [0,1], a decayed sum of contributions —
  seal ≫ trinity awakening > echo left ≈ echo resonated — with half-life
  **τ ≈ 4 days** and a cold-start floor (~0.35) so an unvisited park reads
  _quiet_, never _punished_. Per-wielder daily contribution caps keep echo
  chains from farming it; seals dominating keeps the war primary.
- **The effect:** an input to the pure functions that already exist. Dim
  World → higher rare-spawn weight in `spawnDecision` and a faster
  escalation clock (GDD §3.4's ~45 min Nobody threshold tightening toward
  ~30); bright World → calmer, better recruiting (the "calm" the forecast
  row already imagines). Crucially this is a **negative feedback loop**:
  darkness concentrates where attention lapsed → more to seal → sealing
  restores light. It self-balances and it _steers players toward neglected
  Worlds_ — a traffic-shaping knob dressed as fiction.
- **Display & events:** five named bands — **radiant / bright / dim /
  waning / dark** — rendered as literal per-World map brightness plus a
  meter chip. The §6 channel carries `light` events **only on band
  crossings** (not continuous values): "The light in Fantasyland is waning"
  is a world-voice line and a call to action; a float stream is neither.
- **Implementation:** a derived aggregate over existing rows (seal
  timestamps from `encounter_log`, echo/resonance rows) — **no new writes,
  no new tables** — cached like the other read-mostly queries. If history
  is ever needed, a `world_light_obs` table follows the repo's obs idiom.

#### Trinity Marks

- **Plant:** presence-verified; rank-gated (band 2+) so day-one accounts
  can't litter; ~1 per wielder per day; snaps to a named anchor within
  guest-accessible World polygons. **No user content** — the planter chooses
  only the spot. Planting costs nothing in v1 (a munny/material cost is a
  later economy knob).
- **Dormancy:** visible to every wielder on the play map as a faint sigil —
  discovery _is_ the pull; a sigil is a reason to walk somewhere. Open
  question for playtest: show "two hearts woven, one needed" (pull) or keep
  it mysterious (wonder). Default to showing progress — KH1 trinities were
  visible, and legible goals beat coy ones outdoors.
- **Weaving in:** enter the ~20 m geofence and dwell ~30 s (upgraded to the
  M5b presence primitive when it lands) → "your heart is woven into this
  Trinity." Idempotent per wielder; the planter is woven at creation.
- **Awakening at three hearts** (KH1's canonical trio). Everyone
  woven gets: forge materials + a Journal tick + a light contribution at
  that anchor — and the absent get the retroactive FCM push, which is the
  entire emotional payload of the feature: _"The Trinity you joined in
  Fantasyland has awakened."_ Something you did last Tuesday mattered today.
  The park-public SSE event ("a Trinity awakened in Fantasyland") joins the
  §6.3 vocabulary; the personal push stays on FCM per the permanent split.
- **Calling on the party — companion stand-ins (decision 2026-07-16).**
  KH1's trinities were awakened by a wielder and two _companions_, so
  companion assistance is not a concession — it's the most canonical image
  the feature has. A woven wielder standing at the sigil may fill the
  missing hearts with fielded companions and awaken it on the spot, at a
  price: a companion-assisted awakening pays **reduced XP** to the completer
  (sketch: ½ the awakening XP and materials, a smaller light contribution)
  and never records a bond credit. Wielders already woven get the _full_
  retroactive push and reward regardless of how the third heart arrived —
  the discount falls only on whoever chose not to wait. Three hearts stays
  the invariant — no lowered-N variant exists. To keep patience
  the premium path (waiting _is_ the mechanic), companions can stand in
  only after the sigil has been dormant **~72 h** — so the near-expiry
  moment becomes a real choice: _wait for a human heart, or call on your
  party._ Closes pillar 2 (solo-completable) without lowering N, gives
  the roster its first purpose outside battle, and the two forms become
  separate Journal condition entries ("awakened with your party" /
  "three wielders" — §3.9's catalog absorbs both). Open knob: whether only
  the sigil's home-World companions may answer the call (more fiction,
  less availability — playtest it).
- **Same-moment completion** — three friends standing on it together — gets
  the big ceremony and records a bond credit (the tier-3 "sealed together"
  mechanic gets its second verifiable-from-timestamps input for free).
- **Lifecycle:** a dormant Trinity fades in ~14 days, refreshed by each new
  weave. Near expiry, woven wielders get **one** "it's fading — one heart is
  needed; wait, or call on your party" push (a re-visit driver; strictly one,
  never naggy). An
  expired Trinity fades quietly — soft consequences, per the loss-is-cheap
  philosophy. Unreachable or bad placements are self-cleaning via the same
  decay.

#### Lucky Emblems

- **Register:** the KH3 Gummiphone framing, literally — the rung-1 lite-AR
  camera overlay (§5) with a circular reticle is the _registration
  viewfinder_. Photo + presence-verified anchor; prompt frames the emblem,
  not people (auto face-blur before storage is the research item below).
- **Confirm:** pending until **3 distinct wielders** independently find and
  frame the same target (spatial dedupe within ~15 m; the `pin_scan`
  confirmation pattern verbatim). Confirmed → permanent registry entry,
  first-witness credit forever ("first witnessed by …" — the one place a
  wielder's name appears in the social layer, and it's earned curation, not
  broadcast).
- **The hunt:** per-World Journal pages ("7 of 12 emblems witnessed in this
  World"); completing a park's registry is a marquee achievement with a
  secret-ending-style reward (KH3 precedent). Fiction: the emblems are **the
  King's sign** — Mickey walked these Worlds first and left his mark where
  only the attentive would look. Disney's real hidden Mickeys become, in
  fiction, exactly what they are: proof the King passed through.

#### Data-model deltas (sketch for doc 10)

- `mark.type` gains `trinity` and `emblem`; `discovery` stays as the echo's
  storage type (UI-only rename first; schema rename is a later, separate
  decision).
- One new table serves both mechanics: **`mark_participant`**
  `(mark_id, wielder_id, role: planter|woven|witness|confirmer|companion, at,
verification)` — trinity weaves and emblem confirmations are the same
  shape, which is doc 03's one-primitive spirit applied to _participation_.
  Companion stand-ins are `role: companion` rows carrying the summoning
  wielder's id plus a nullable `companion_id`, so "who awakened this and
  how" is answerable from the same table.
- World light: derived, no table (above). Journal ticks ride the GDD §4.2
  `journal_entry` design. Echo/memory unification: `visibility` flag on
  `mark` replaces the separate `memory` type.

### 4.7 Fiction drafts (proposed story-bible language, GDD §7)

> Written to be pasted into the GDD if adopted; tone per §0.5 — earnest,
> warm, lightly melancholic.

- **Echoes:** Strong feelings linger. When a heart is truly moved, it leaves
  an echo — a small warmth in the stone, invisible to everyone who isn't
  carrying a Key. Touch one, and for a moment two hearts meet across the
  days between them.
- **The light of a World:** A World's heart is kept not only by sealing its
  wounds. Every echo left, every Trinity woken, every breach closed kindles
  its light — and light left untended dims. The darkness always knows where
  no one has been keeping watch.
- **Trinities:** In the old stories, wielders traveled in threes. The sigils
  remember. Plant one and it waits — a promise that others will come. When
  three hearts have stood in the same place, even days apart, the promise
  keeps, and the Trinity wakes for all of them at once. A companion's heart
  counts — it always has — though the old magic burns brightest when all
  three carry Keys.
- **The King's sign:** The King walked these Worlds long before you, and
  left his mark where only the attentive would think to look. Every emblem
  you witness is proof — you saw what he saw.

### 4.8 Build order, and what would change in canon

Cheapest-first, mirroring §6.4's presentation-before-transport logic:

1. **Echo refiction** — copy, structured-resonance authoring, find/leave
   ceremony. No schema change, no new risk; can ride the priority-2 feel
   workstream. (Structured-only v1 also _removes_ the current free-text
   moderation surface.)
2. **World light level** — derived aggregate + map brightness + spawn-weight
   input + `light` band events. Small, and it fuses the layer's two halves.
3. **Trinity Marks** — new mark type + `mark_participant`, dormant-until-
   three-hearts mechanic with companion stand-ins, FCM awakening. The
   flagship async-social feature.
4. **Lucky Emblem registry** — new mark type + confirmation flow + Journal
   track; registration viewfinder doubles as the rung-1 lite-AR debut.
5. **Letters** — after the tier-3 friend graph exists.

If adopted, this pass touches canon (this doc can't change it — GDD wins):
[03](03-marks-and-discovery.md)'s taxonomy (echo/trinity/emblem/letter
replace discovery/dare as the social types; memory folds into echo
visibility), the GDD glossary rows + §3.7 Socialspace, the §4.7 fiction
into the story bible, [10](10-data-model.md) (`mark_participant`,
visibility flag), and a Canon Decision Log entry recording the cosmology
test, the dare cut, and the trinity three-hearts rule (companion stand-ins
at reduced XP, 2026-07-16).

### 4.9 Handoff — open questions for the next pass

Ordered roughly by how much they'd change the design if answered badly:

1. **Trinity N — resolved (2026-07-16); the discount needs tuning.** N stays
   3 (canon) and the density worry is answered by companion stand-ins
   (§4.6): a woven wielder may complete a dormant trinity with fielded
   companions at reduced XP, so cold-start never strands a sigil and N
   never needs lowering. What still needs modeling: the discount size
   and the ~72 h stand-in delay, jointly — too generous and nobody waits
   (the retroactive-push payload dies); too stingy and low-density parks
   read as broken. Model expected human-completion probability from
   realistic park-DAU and set the discount so waiting dominates wherever
   completion within ~a week is plausible.
2. **Echo content ceiling.** Is structured-resonance-only emotionally
   sufficient, or does it read as hollow without text? Research prior art:
   geocaching logs, Pokémon GO postcards, Munzee, Landmarks-style apps —
   what did free-text-at-place actually produce, quality-wise?
3. **Light tuning.** τ, band thresholds, contribution weights, the
   cold-start floor — simulate against real `attraction_status_obs` +
   dev-park mark data; verify the negative-feedback loop damps rather than
   oscillates (a World ping-ponging radiant↔dark weekly would feel broken).
   The escalation interaction (GDD §3.4 thresholds) needs a joint balancing
   pass over the pure functions in `battle.ts`/`darkness.ts`.
4. **Emblem photo pipeline.** Face-blur before storage (edge transform vs
   on-device), human review queue volume at projected registration rates,
   and spatial+visual dedupe. Also the IP question: does a hidden-Mickey
   hunt collide with Disney's own Hidden Mickeys lore/merch, or is it the
   licensed synergy it appears to be?
5. **Dormant-sigil legibility.** Progress shown ("one heart needed") vs
   mystery — a playtest question with a default (show it), but worth
   confirming outdoors where §3.6's legibility findings apply.
6. **Schema rename strategy.** `discovery`→`echo` as UI alias forever vs an
   actual migration; same for folding `memory` into visibility. Cheap now,
   annoying later — decide before Trinity Marks add adjacent code.
7. **The letters design** (tier 3) is intentionally unspecced — it should be
   designed _with_ the friend graph, not before it.

## 5. AR — the landscape moved; the plan moved with it

Facts that invalidated the original doc 07/12 plan (all now recorded there):

- **8th Wall is gone.** Hosted platform shut down 2026-02-28 (campaigns die
  2027-02-28). Engine core open-sourced (MIT, 8thwall.org) but **SLAM is
  binary-only** and VPS/Maps/hand-tracking were never released. Foundation
  risk, not a plan.
- **WebXR `immersive-ar` still doesn't work on iOS Safari** in 2026 (flag
  exists, non-functional), and WebXR is generally unavailable in webviews.
- **ParkFi now ships a Capacitor native shell**, so "no install" stopped being
  the binding constraint; native AR is one plugin away.
- **Players don't want ambient AR anyway:** most Pokémon GO players play
  AR-off; Monster Hunter Now ships combat AR-off by default. Evidence for
  pillar 4 — 2D canonical, AR as the earned peak.

Revised ladder (canonical in [07](07-ar-and-channels.md)): **rung 1**
camera-overlay "lite AR" (camera preview behind a transparent webview +
device-orientation parallax) → **rung 2** thin Capacitor plugin hosting
ARKit/RealityKit + ARCore/SceneView plane anchors → **rung 3** **ARCore
Geospatial API** VPS (actively maintained on both platforms; sub-meter anchors
wherever Street View exists; Streetscape Geometry for occlusion; Niantic
Lightship de-prioritized post-Scopely) → **rung 4** shared geospatial anchors
for co-op (both clients resolve the same lat/lng/alt — no pairing infra, which
turns shared AR into a game-state problem the DO room already solves).

**Cheap de-risk:** spend one dev afternoon probing `checkVpsAvailability` on a
coordinate grid across the parks to learn exactly which Worlds have VPS
coverage before committing to rung 3.

## 6. Sync backend — the ladder

External game-backend platforms were evaluated (including all-in-one
"database-owns-the-logic" offerings) and rejected: anything that wants to own
both state and logic would put a dual-write seam exactly through the moat,
because our irreplaceable state (`queue_obs`, `attraction_status_obs`) lives
in Timescale and must stay there. **The realtime layer is built on
infrastructure we already run — do not introduce a second stateful backend.**

The right ladder for this stack:

1. **SSE via tRPC v11 `httpSubscriptionLink`** — we're already on splitLink;
   add a subscription split. Server: async-generator procedure fed by Postgres
   `LISTEN/NOTIFY` (the worker's `reconcileDarkness` fires
   `NOTIFY living_marks, '<parkId>'` — a 3-line change). EventSource gives
   auto-reconnect for hostile park connectivity. **Caveat:** the Cloudflare
   cache rules + `lib/cache.ts` GET allowlist must bypass the subscription
   path. Converts "map refreshes within 30s" into "darkness erupts as the ride
   breaks" — the moat, felt.
2. **Durable Objects per-park rooms** (partyserver, actively maintained under
   `cloudflare/partykit`) for tier-2 presence, pulses, raid lobbies — and the
   natural future home of a raid tick loop. We're already deep in Cloudflare.
3. **Colyseus/Nakama: skip.** Colyseus matters only for continuous
   authoritative simulation (battles are turn-based and replay-verifiable);
   Nakama's bundled social graph duplicates Better-Auth + Postgres.

Rung 1 is deepened below (§6.1–6.6, added later on 2026-07-15) — first the
design interrogation it deserved, then the spec.

### 6.1 Interrogating the feature — is push anything more than a flex?

Steelman the doubt first, because the line item as written earns it. The
worker discovers a ride-down at most ~60 s after the upstream feed shows it
(`pollIntervalMs` = 60 000), and the play map already re-polls within 30 s.
SSE deletes the final 0–30 s tail of a pipeline whose dominant term is ingest
cadence. Nobody walking through Fantasyland can feel 30 s → 0 s. If "SSE mark
push" means _the map refreshes faster_, it is exactly the look-at-me feature
it smells like — engineering that demos well and changes no one's afternoon.

The reframe that survives the interrogation: **latency is not the product.**
The work changes the _category_ of what the client receives, in three ways a
faster poll cannot:

1. **State → events.** A poll returns the current mark list; everything else
   is silence. When a mark vanishes between polls the client cannot say _why_
   — sealed by another Wielder? ride recovered? TTL? — so the most
   narratively valuable moments in the world are mute. A push channel carries
   typed, timestamped, **caused** events (`eruption`, `seal`, `fade`), and
   events are the only thing presentation can theatricalize (§3.1's whole
   architecture is events) and the only thing a narrator can speak.
   [03](03-marks-and-discovery.md) calls the `world` type "how the park
   speaks" — a voice is timing, and a narrator on a 30-second tape delay
   isn't one.
2. **Simultaneity.** Under polling every phone has a random 0–30 s phase
   offset. Two friends standing shoulder to shoulder — the _modal_ social
   configuration of a theme-park visit — see the same eruption half a minute
   apart, which doesn't just fail to prove the world is live; it actively
   disproves it ("mine doesn't show it yet"). Push lands a world event on
   every phone in the park in the same second.
   [02](02-living-layer-and-flywheel.md)'s communal thread — "world events
   every present player feels **at once**" — is not implementable on polling
   at all. This is the load-bearing point.
3. **The nervous system.** Every rung of §4's ladder (darkness meter, sealed
   tickers, incursion pulses, Rift countdowns, presence) presupposes a
   server→client event path. "Mark push" is merely the first payload on a
   channel the entire roadmap silently assumes. Building it isn't building a
   feature; it's building the layer's spinal cord.

So the instinct is half right: shipped as _transport with no ceremony_ it
would be substance-free — a pin silently appearing 20 s sooner is invisible.
The conclusion isn't to cut it; it's that **the feature is the ceremony and
SSE is its delivery guarantee**, which re-orders the work (§6.4).

### 6.2 The Kingdom Hearts case — one world, one heart

Put the IP lens on properly. In KH cosmology a world _has a heart_; darkness
enters through wounds in it; and Keyblade wielders **sense** darkness before
they see it — the series' most repeated beat is a character stopping
mid-scene: _"…did you feel that?"_ The archetypal world event is the storm
over Destiny Islands: when a world's state changes it changes for everyone on
it, in the same moment, sky-first — nobody checks a map to learn their world
is falling. A Nomura world is melodramatically synchronous; state changes are
scenes, not notifications. Four consequences for us:

- **The phone is attunement, not UI.** The channel's fiction: a Wielder in
  the park is _attuned to the world's heart_. A ride breaking down is a
  wound; every attuned Wielder feels the same flinch in the same second —
  haptic thrum in the pocket, a one-beat darkening of the ambience bus
  (§3.3), and if the map is up, darkness _pooling out of the ground_ at the
  spot before the pin resolves. You didn't read an update; you sensed a
  disturbance. That is the difference between a map that refreshes and a
  world that reacts — and the fiction is only honest if delivery is push.
- **The seal heard around the park.** Today sealing a breach is completely
  private — the most heroic act in the game has zero witnesses. One `seal`
  event makes every seal a public act: every other Wielder feels the world
  exhale ("A breach was sealed in Tomorrowland"). This is doc 02's seam —
  _your solo actions nudge the communal state_ — made physical for the first
  time, at zero UGC/moderation cost because every word is system-authored.
- **The storm is content.** A real Florida thunderstorm closes half a park's
  outdoor rides inside one worker tick. Under polling that's a pile of pins;
  under events it's a recognizable _burst_ the client can stage as an
  **incursion** — "The sky darkens. Something is coming." The realest weather
  in the game becomes its best scene, free, from data already ingested.
  Burst-collapse is therefore not a UX guard rail; it's a headline entry in
  the vocabulary.
- **Eyes up.** The flywheel starts at the wrist and ear precisely so guests
  aren't staring down. A polled world only speaks when looked at; a push
  world taps _you_. Within an armed play session, pocket-buzz → glance →
  engage is the designed posture, and it requires the server to initiate.

### 6.3 The event vocabulary (v1)

The durable contract is not the transport but the **event schema** — the
words the world can say. Transports are swappable (a tier-2 DO room can
publish the same vocabulary later); the vocabulary is canon. v1, the smallest
set that earns the channel:

| Event       | Payload                                   | The world says                                                                                            | Gate               |
| ----------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------ |
| `eruption`  | markId, attraction, heartlessType, rarity | "Darkness erupts at Space Mountain"                                                                       | none               |
| `incursion` | parkId, count, markIds                    | "The sky darkens — breaches are opening across the World" (collapsed burst of ≥3 eruptions in one window) | none               |
| `fade`      | markId, attraction                        | "The darkness at Big Thunder recedes" (ride recovered / TTL)                                              | none               |
| `seal`      | markId, attraction                        | "Another Wielder sealed the breach at Space Mountain"                                                     | **integrity (§2)** |
| `echo`      | markId                                    | an echo blooms on the map, no fanfare (§4.3; storage type stays `discovery`)                              | none               |

Two canon rules bind it:

- **Aggregates, never identities** (§4 tier 0): `seal` carries no user id, no
  name, and never any person's coordinates — only the mark's public location
  and the fact of another Wielder. Nothing in v1 creates a privacy or
  moderation surface.
- **The integrity gate is real.** Broadcasting seals _amplifies_ the §2 cheat
  incentive — a couch-sealed breach would be announced to every phone in the
  park. `eruption`/`incursion`/`fade`/`echo` claim no player achievement
  and ship immediately; `seal` waits for server-replay validation. The
  vocabulary happens to decompose exactly along the integrity boundary, which
  is convenient: the channel ships before priority 1 finishes, and `seal` is
  its first post-integrity payload.

The §4 re-foundation grows this vocabulary on the same channel: `light` band
crossings ("The light in Fantasyland is waning" — §4.6) and park-public
`trinity` awakenings. Per-person payloads (your Trinity woke, your echo was
touched) never ride SSE — they are FCM, per the permanent split in §6.5.

### 6.4 Presentation before transport (the build order that avoids the trap)

§6.1's verdict implies a decomposition the priority list obscured:

- **Rung A — world-event presentation, on the existing poll.** Derive events
  client-side by diffing successive `living.marks` results (new id →
  `eruption`; vanished id → a cause-unknown `fade`) and feed a **map
  presentation queue** — the exact §3.1 pattern aimed at the map instead of
  the battle panel: typed events → small presentation state machine → juice
  keyed per event type (stain-bloom + pin resolve + haptic for eruption,
  quiet dissolve for fade, reduced-motion variants per §3.7). This delivers
  ~70 % of the felt feature with zero backend work and belongs _inside_ the
  priority-2 combat-feel workstream — same architecture, second consumer.
- **Rung B — the SSE transport.** Replaces inference with truth: real causes
  (`fade` vs `seal`), real timestamps, park-wide simultaneity, `incursion`
  recognition, and the death of the 30 s poll. Client cost is small because
  rung A already built the consumer; the wire just feeds the same queue
  better events.

The trap this avoids is shipping B without A — a pin appearing via push with
no ceremony is invisible, and the feature would be judged (correctly) as the
flex §6.1 described. Priorities 2 and 3 are therefore entangled: the
presentation queue rides with combat feel; the wire below is what remains of
"priority 3."

### 6.5 The wire, end to end

Event flow: **mark writers → Postgres triggers → `pg_notify` → one dedicated
LISTEN connection per web process → in-process emitter keyed by park → tRPC
async-generator subscription → SSE → client cache + presentation queue.** The
load-bearing choices:

1. **Emit at the data layer, not the call sites.** Mark writers already span
   two services — the worker spawns/refreshes/fades (`darkness.ts`), the web
   app seals (`resolveEncounter`), report-fades, and inserts discovery marks
   (`routers/living.ts`) — and every future feature adds more. A pair of
   row-level triggers on `mark` (`AFTER INSERT`; `AFTER UPDATE OF state WHEN
(OLD.state IS DISTINCT FROM NEW.state)`) firing
   `pg_notify('living_marks', json)` makes the pulse a property of the mark
   primitive itself — [03](03-marks-and-discovery.md)'s "one primitive"
   argument applied to events: every writer, current and future, emits
   correctly with zero app-code discipline. `UPDATE OF state` deliberately
   excludes the worker's per-tick TTL/snapshot re-stamp — a still-down ride
   refreshing `expiresAt` must not re-erupt (the upsert's conflict branch
   never touches `state`, so this falls out of the existing code). Trigger
   payload stays dumb — `{op, id, park_id, type, is_system, state,
attraction_id}` — and the listener maps rows to vocabulary (`INSERT` +
   `encounter` + system → `eruption`; `active→claimed` → `seal`;
   `active→faded` → `fade`). Hand-written timestamped migration per repo
   convention. Two free Postgres properties matter: NOTIFY fires **on
   commit** (no phantom events from rolled-back writes), and payloads cap at
   ~8 KB (send ids + enums; hydrate names server-side).
2. **One listener per web process.** LISTEN pins a session, so it cannot ride
   the drizzle/node-postgres pool — a dedicated `pg.Client` singleton with a
   reconnect loop (backoff, re-`LISTEN`). LISTEN/NOTIFY has **no replay**:
   anything missed while disconnected is gone, so on (re)connect the listener
   raises a `resync` signal that subscribers translate into a marks-query
   invalidation. Fan-out is a plain in-process `EventEmitter` keyed by
   parkId. The design is accidentally horizontal-scale-safe — N web replicas
   each LISTEN independently and serve their own SSE clients. (If a
   transaction-mode pooler like pgbouncer ever fronts the database, LISTEN
   needs a carved-out direct connection — flagging now.)
3. **The subscription is public and park-scoped.** tRPC v11 async-generator
   procedure — `living.onParkEvents({parkSlug})` — yielding
   `tracked(id, event)`, with server-side SSE ping enabled (~15–25 s) via
   `initTRPC`'s `sse` option. Keeping it a `publicProcedure` — world events
   are identical for everyone, like the cacheable reads — sidesteps the
   entire EventSource auth problem (EventSource can't send headers; tRPC's
   `connectionParams` puts tokens in URLs, which we never do; the native
   shell's Bearer-header scheme simply isn't needed here). **Personal**
   notifications ("your echo was touched") never ride this channel — they're
   Tier 1 FCM pushes. That split is permanent by design.
4. **Client: one more branch in the existing `splitLink`.**
   `op.type === "subscription"` → `httpSubscriptionLink` (superjson
   transformer, same URL fn) in `root-provider.tsx`; the two existing
   branches are untouched. `useSubscription` mounts only while play mode is
   armed — connection lifetime = play session. Handlers: event → incremental
   `setQueryData` on `living.marks` + push onto the rung-A presentation
   queue; connect/reconnect → invalidate `living.marks` (the resync
   guarantee, which also covers app-suspension socket death on native — SSE
   over EventSource works fine in the WKWebView). The 30 s `refetchInterval`
   in `park-map.tsx` demotes to a slow belt-and-braces reconcile (120 s+):
   park connectivity is hostile, EventSource auto-reconnect + resync-on-open
   is the primary path, but a live map should never depend on one mechanism.
5. **Edge realities (the §6 caveat, made concrete).** The subscription
   arrives as a GET on `/api/trpc/living.onParkEvents`. The Cloudflare cache
   rule is an allowlist keyed to `CACHEABLE_TRPC_PATHS`, so it won't _cache_
   the stream — but caching isn't the failure mode, **buffering** is:
   current community reports show CF holding `text/event-stream` bodies
   until ~100 KB accumulates unless the origin objects. The stream response
   needs `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`
   (respected by CF), and Nitro compression must skip event-streams
   (compression is a buffer). The SSE ping doubles as the keep-alive that
   prevents proxy idle-drops (CF 524s bite on silent origins). Verify with
   `curl -N` through the edge — not against localhost — before calling it
   done.

### 6.6 Honest limits

- **Ingest cadence is now the floor.** With the client tail gone, an eruption
  lags reality by upstream-feed latency + ≤60 s of worker tick, and no SSE
  work changes that. The channel's real promise is that **any future ingest
  speedup reaches every phone instantly** — the wire stops being the
  bottleneck forever.
- **Foreground only.** SSE exists while the app is open (pocket-with-app-armed
  counts). App-closed reach is FCM's job (Tier 1); never sell this channel as
  "push notifications."
- **Witness math.** At current in-park concurrency, park-wide simultaneity
  has few witnesses — but the two-friends-one-meter-apart case works at N=2,
  is the modal configuration of a park visit, and is exactly where polling's
  phase offset embarrasses worst. Solo players still get the causality
  moment (ride audibly stops → phone flinches), bounded by the ingest floor
  above.
- **Cost flips the right way.** Each armed client swaps two full-list
  refetches per minute (a 500-row query) for one idle stream fed by events;
  the server swaps N pollers for one LISTEN connection. Radio wake from the
  ~25 s ping is the price; it's cheaper than the refetch it replaces.

## 7. Priority order (rewritten through the four passes)

1. **Integrity: server-replay battle validation + encounter sessions.** Start
   with the §3.1 event-queue refactor — it is shared with priority 2. The
   passes _narrowed_ what this blocks: not "all social" — only `seal`
   attribution (§6.3), an honest light economy (§4.6: seals dominate
   light, so couch seals would inflate it), and the game→app achievement
   crosstalk (§3.11 rule 2). Everything else below ships without it. Two
   small items ride along per §3.14: resolve-time snapshot stamping on
   `encounter_log` (§3.10 — the only unrecoverable-if-delayed work in the
   spine) and loadout pinning on the session row (§3.13).
2. **The feel workstream — one architecture, three consumers.** The §3.1
   event-queue/presentation pattern, built once, serving: combat theater
   (command menu, turn theater, timing verbs, audio, ceremony — §3.1–3.7),
   the map presentation queue (§6.4 rung A, driven by poll-diff until the
   wire lands), and the echo refiction + leave/find ceremony (§4.8 step 1,
   which also _deletes_ the free-text moderation surface).
3. **The wire (§6.5):** mark triggers → LISTEN/NOTIFY →
   `httpSubscriptionLink`, carrying vocabulary v1 (§6.3) minus `seal` until
   priority 1 lands.
4. **The light of a World (§4.6):** derived aggregate → per-World map
   brightness → spawn-weight input → `light` band events on the new wire.
   Small, and it fuses the layer's two halves into one economy.
5. **Journal + drops + keychains (GDD §4.2–4.4)** — fix the XP dead-end,
   built per §3.8–3.14: the achievements engine's architecture (catalog in
   code, derived reconcile over `encounter_log`, sticky unlocks, shared
   ceremony funnel) with the two-ledger boundary kept (§3.11). The Journal
   schema should anticipate its §4.6 consumers (emblem pages, trinity ticks)
   so they're pages, not retrofits.
6. **Tier 0/1 social:** honest aggregates + your-echo-was-touched push (the
   A4 FCM work's first game consumers), then **Trinity Marks** (§4.6) —
   whose retroactive awakening push is FCM's marquee payload.
7. **Rung-1 lite-AR debuts as the Lucky-Emblem registration viewfinder**
   (§4.6) rather than a generic reveal; run the VPS coverage probe on the
   same in-park trip as M5b presence validation (M5b also upgrades trinity
   weaving from dwell-time to the real presence primitive).
8. **Nobodies → solo Rifts → DO presence rooms → shared-anchor
   Convergences** — the Rift pulse rides the §6 channel; before Nobodies
   tune, run the §4.9 joint balancing pass (escalation clock × World light,
   both inputs to the same pure functions).

## 8. Docs re-aligned in this pass (2026-07-15)

[07](07-ar-and-channels.md) (AR tech path rewritten), [12](12-demo-vertical-slice.md)
(demo vehicle = Capacitor build), [14](14-implementation-plan.md) (M4b/M7),
[11](11-architecture.md) (diagram, AR runtime, deployment),
[13](13-roadmap-risks-ip.md) (Phase 0), [01](01-vision-and-strategy.md)
(design ethic), [README](README.md) (doc map), and a
[GDD Canon Decision Log entry](GDD.md) recording the AR-path revision. No
gameplay canon changed.

---

## Sources

### 8th Wall shutdown & open-sourcing

- [Road to VR — Niantic's WebAR platform 8th Wall goes open source as hosted services go offline](https://roadtovr.com/niantic-webar-platform-8th-wall-open-source/)
- [8th Wall — Goodbye 8thwall.com. Hello 8thwall.org.](https://www.8thwall.com/blog/post/208587408737/8th-wall-open-source)
- [8th Wall — Transition update: engine distribution and open source plans (SLAM binary-only)](https://www.8thwall.com/blog/post/202888018234/8th-wall-update-engine-distribution-and-open-source-plans)
- [8th Wall open-source docs](https://8thwall.org/docs/open-source)
- [AR-Code — 8th Wall shutdown timeline & impact](https://ar-code.com/blog/8th-wall-is-shutting-down-timeline-impact-and-the-best-8th-wall-alternative-for-webar)
- [Niantic Spatial — Wikipedia (Scopely sale, enterprise pivot)](https://en.wikipedia.org/wiki/Niantic_Spatial)

### WebXR / iOS reality

- [XRDoctors — WebXR on iOS: what actually works in Safari in 2026](http://xrdoctors.pro/blog/webxr-on-ios-what-actually-works)
- [TestmuAI — WebXR browser support in 2026](https://www.testmuai.com/learning-hub/webxr-compatible-browsers/)
- [Apple Developer Forums — WebXR AR module flag non-functional](https://developer.apple.com/forums/thread/756850)

### AR anchoring & VPS

- [Google — ARCore Geospatial API overview](https://developers.google.com/ar/develop/geospatial)
- [Google — checkVpsAvailability](https://developers.google.com/ar/develop/unity-arf/geospatial/check-vps-availability)
- [Google — Geospatial developer guide for iOS](https://developers.google.com/ar/develop/ios/geospatial/developer-guide)
- [ARCore iOS SDK releases (actively maintained)](https://github.com/google-ar/arcore-ios-sdk/releases)
- [Niantic Spatial — Lightship VPS docs](https://www.nianticspatial.com/docs/nsdk/features/lightship_vps/)
- [Niantic Spatial — Shared AR docs](https://www.nianticspatial.com/docs/ardk/features/shared_ar/)

### Capacitor AR path

- [Cap-go capacitor-camera-preview (`toBack: true`)](https://github.com/Cap-go/capacitor-camera-preview)
- [capacitor-community — native AR plugin proposal](https://github.com/capacitor-community/proposals/issues/99)
- [SceneView — 3D/AR SDK for Android & iOS](https://sceneview.github.io/)
- [Ionic — AR with Capacitor: AR Quick Look](https://ionic.io/blog/augmented-reality-with-capacitor-ar-quick-look)

### AR adoption evidence

- [Pokémon GO Hub — AR disabled: what it means for the AR community](https://pokemongohub.net/post/article/opinion/ar-disabled-what-does-this-mean-for-the-ar-community/)
- [Dot Esports — Pokémon GO's regular AR mode scrapped](https://dotesports.com/pokemon/news/pokemon-gos-regular-ar-mode-scrapped-to-make-interacting-with-buddy-mons-easier)
- [Niantic Help — What's changing with AR in Pokémon GO](https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/4483-what-s-changing-with-ar-in-pokemon-go/)

### Realtime sync backends

- [tRPC — httpSubscriptionLink (SSE)](https://trpc.io/docs/client/links/httpSubscriptionLink)
- [tRPC — Subscriptions](https://trpc.io/docs/server/subscriptions)
- [tRPC — Next.js SSE chat example](https://github.com/trpc/examples-next-sse-chat)
- [Cloudflare — Durable Objects pricing (hibernation economics)](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Cloudflare — Durable Objects WebSocket best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [partyserver on npm (maintained under cloudflare/partykit)](https://www.npmjs.com/package/partyserver)
- [cloudflare/partykit](https://github.com/cloudflare/partykit)
- [Astahmer — multiplayer state machine with Durable Objects](https://www.astahmer.dev/posts/multiplayer-state-machine-with-durable-objects/)
- [Heroic Labs — Nakama](https://heroiclabs.com/nakama/)
- [Namazu — real-time game backend comparison](https://namazustudios.com/best-real-time-game-backends/)

### LISTEN/NOTIFY & SSE through proxies (§6.5)

- [PostgreSQL — NOTIFY (commit semantics, ~8 KB payload cap)](https://www.postgresql.org/docs/current/sql-notify.html)
- [PostgreSQL — LISTEN (session-pinned; no replay)](https://www.postgresql.org/docs/current/sql-listen.html)
- [node-postgres — Client (notification events; dedicated non-pool client)](https://node-postgres.com/apis/client)
- [MDN — Using server-sent events (EventSource semantics, reconnect)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
- [Cloudflare community — Using SSE with the Cloudflare proxy (buffering, headers)](https://community.cloudflare.com/t/using-server-sent-events-sse-with-cloudflare-proxy/656279)
- [Cloudflare community — CF buffers text/event-stream (~100 KB flush; X-Accel-Buffering)](https://community.cloudflare.com/t/sse-endpoint-breaks-after-recent-update-cloudflare-buffers-text-event-stream-desp/810790)
- [Cloudflare community — SSE and HTTP 524 timeouts (keep-alive pings)](https://community.cloudflare.com/t/are-server-sent-events-sse-supported-or-will-they-trigger-http-524-timeouts/499621)

### Location-game social design & retention

- [A Sense of Belonging: Pokémon GO and Social Connectedness](https://www.researchgate.net/publication/318574661_A_Sense_of_Belonging_Pokemon_GO_and_Social_Connectedness)
- [Effects of Pokémon GO on physical activity and psychological/social outcomes — systematic review](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8123321/)
- [Impacts of Pokémon GO on route/mode choice (retention figures)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7903220/)
- [CHI 2024 — engagement with location-based game features](https://doi.org/10.1145/3613904.3642786)
- [Pokémon GO Hub — friendship system guide](https://pokemongohub.net/post/guide/go-hub-guide-to-friendship/)

### Game feel & juice (§3.2)

- [Blood Moon Interactive — Juice in game design](https://www.bloodmooninteractive.com/articles/juice.html)
- [GameAnalytics — Squeezing more juice out of your game design](https://www.gameanalytics.com/blog/squeezing-more-juice-out-of-your-game-design)
- [Wayline — The "juice" problem: how exaggerated feedback harms design (intensity must encode meaning)](https://www.wayline.io/blog/the-juice-problem-how-exaggerated-feedback-is-harming-game-design)
- [GameJuice — browsable juice technique library](https://gamejuice.co.uk/browse)

### Turn-based architecture & event sequencing (§3.1)

- [Outscal — Turn-based game architecture (command pattern, queues)](https://outscal.com/blog/turn-based-game-architecture)
- [GameDev.net — Finite state machine for turn-based games](https://gamedev.net/blogs/entry/2274204-finite-state-machine-for-turn-based-games/)
- [GameDev.net — Complex side effects & event sequencing in XCOM-likes (resolve-then-queue)](https://gamedev.net/forums/topic/717940/)

### Web animation performance (§3.2)

- [MDN — CSS and JavaScript animation performance](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/CSS_JavaScript_animation_performance)
- [Motion — The web animation performance tier list](https://motion.dev/magazine/web-animation-performance-tier-list)
- [CSS-Tricks — A comparison of animation technologies](https://css-tricks.com/comparison-animation-technologies/)
- [DebugBear — requestAnimationFrame and web performance](https://www.debugbear.com/blog/requestanimationframe)

### Game audio on the web / in webviews (§3.3)

- [MDN — Audio for Web games (sprites, unlock, mobile constraints)](https://developer.mozilla.org/en-US/docs/Games/Techniques/Audio_for_Web_Games)
- [Matt Harrison — Perfect web audio on iOS devices](https://matt-harrison.com/posts/web-audio/)
- [howler.js](https://howlerjs.com/)
- [WebKit bug 167788 — WKWebView ignores AVAudioSession category (own session; Ambient↔Playback flip)](https://bugs.webkit.org/show_bug.cgi?id=167788)
- [Apple Developer Forums — WKWebView ignores AVAudioSessionCategory](https://developer.apple.com/forums/thread/24464)
- [capacitor-community/native-audio #22 — silent-switch / session category configurability](https://github.com/capacitor-community/native-audio/issues/22)

### Haptics (§3.4)

- [Capacitor — Haptics plugin API](https://capacitorjs.com/docs/apis/haptics)
- [Apple — Core Haptics (AHAP patterns)](https://developer.apple.com/documentation/corehaptics)
- [Newly — Using haptics in mobile apps (iOS generators vs Android waveforms)](https://newly.app/sensors/haptics-mobile-apps)

### Input timing & latency (§3.5)

- [Rhythm Quest devlog 4 — music/game synchronization](https://rhythmquestgame.com/devlog/04.html)
- [Rhythm Quest devlog 10 — latency calibration](https://rhythmquestgame.com/devlog/10.html)
- [Exceed7 — Rhythm game crash course (mobile input & audio latency)](https://exceed7.com/native-audio/rhythm-game-crash-course/index.html)

### Mobile ergonomics & outdoor UX (§3.6)

- [Parachute — Mastering the thumb zone](https://parachutedesign.ca/blog/thumb-zone-ux/)
- [Tim Graf — Designing for the thumb zone](https://timgraf.com/ux-design/designing-for-the-thumb-zone-a-modern-guide-to-mobile-ux-that-respects-human-anatomy/)
- [Upslide — One-handed mobile UX best practices](https://upslidedesignstudio.com/blogs/one-handed-mobile-ux-design-best-practices-for-better-mobile-apps)
- [The Pokémon GO Experience — location-based AR game goes mainstream (outdoor/glare findings)](https://www.researchgate.net/publication/316650774_The_Pokemon_GO_Experience_A_Location-Based_Augmented_Reality_Mobile_Game_Goes_Mainstream)
- [Convergence 2023 — Augmented play: AR features in location-based games](https://journals.sagepub.com/doi/10.1177/13548565231156495)

### Game accessibility (§3.5, §3.7)

- [Game Accessibility Guidelines — full list](https://gameaccessibilityguidelines.com/full-list/)
- [Game Accessibility Guidelines — avoid repeated inputs (button-mashing / QTEs)](https://gameaccessibilityguidelines.com/avoid-repeated-inputs-button-mashing-quick-time-events/)
- [Xbox Accessibility Guideline 116 — input (adjustable timing)](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/116)
- [Xbox Accessibility Guideline 118 — photosensitivity (flash thresholds, PEAT)](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/118)
- [web.dev — Animation and motion (prefers-reduced-motion)](https://web.dev/learn/accessibility/motion)
- [WCAG 2.3.1 — three flashes or below threshold](https://wcag.dock.codes/documentation/wcag231/)
- [Sara Soueidan — Accessible notifications with ARIA live regions](https://www.sarasoueidan.com/blog/accessible-notifications-with-aria-live-regions-part-1/)

### KH battle UI reference (§3.6)

- [Game UI Database — Kingdom Hearts II](https://www.gameuidatabase.com/gameData.php?id=675)
- [KH Wiki — Commands (menu behavior, per-world theming)](https://www.khwiki.com/Commands)

### KH canon for async social (§4.2–4.5)

- [KH Wiki — Trinity (KH1 Trinity Marks: party-activated sigils)](https://www.khwiki.com/Trinity)
- [KH Fandom — Trinity Mark](https://kingdomhearts.fandom.com/wiki/Trinity_Mark)
- [KH Wiki — Lucky Emblem (KH3 hidden-Mickey photo hunt)](https://www.khwiki.com/Lucky_Emblem)
- [KH Wiki — The Final World (hearts persisting in place)](https://www.khwiki.com/The_Final_World)
- [KH Wiki — Wayfinder (bond token between separated friends)](https://www.khwiki.com/Wayfinder)
