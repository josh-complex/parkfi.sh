# 16 — Engagement & AR deep dive (2026-07-17)

> **Status: proposals, not canon.** This doc deep-dives the gaps found in the
> 2026-07-17 full-docs review: the missing player-facing beginnings (the Dive,
> the guide), magic, queue-time play, the at-home surface, per-World Heartless,
> group play and child users, sleeping Worlds and heat, and five AR/XR planning
> holes (assets & audio, the data-made-visible moment, sun/thermals, indoors,
> camera privacy). If adopted, each section's "canon delta" lands in the GDD
> deliberately, with a Canon Decision Log entry — until then the
> [GDD](GDD.md) wins. Monetization is **explicitly out of scope** by decision
> (§14): extremely light hand, ideally none, deferred to the publisher.
>
> House rules observed throughout: every proposal is checked against the six
> pillars, the cosmology test (GDD §3.7), the two-ledger boundary
> ([08](08-achievements-persistence-coldstart.md) Part A), and the integrity
> posture (server-authoritative, pure functions, replayable). Numbers are
> starting points, not canon.

---

## Part I — Game design

## 1. The Dive to the Heart — the missing beginning

### 1.1 The diagnosis

Cold-start ([08](08-achievements-persistence-coldstart.md)) exhaustively treats
the empty **world**; nothing treats the empty **player**. The Dreamer band's
trial is "the awakening: your first win" (GDD §4.1) — but there is no designed
path _to_ that first win: no character creation, no tutorialization, no fiction
for the moment an ordinary guest becomes a wielder. Meanwhile the franchise's
single most iconic scene — the **Dive to the Heart / Station of Awakening**,
the stained-glass dream where a disembodied voice offers the choice of
**sword / shield / staff** (and asks what you'll give up) — is precisely an
FTUE and a character-creation ceremony, already designed, already beloved, and
already licensed. Not using it is leaving the franchise's front door closed.

### 1.2 The design

**The Dive happens at home; the awakening happens in the park.** The Dive is a
dream — it needs no presence and claims none, which makes it the one _verb_
permitted on the at-home surface (§5). A new user (or a pre-trip planner) can
run the Dive from the couch: the stained-glass platform, the voice, the choice.
The Keyblade itself only _arrives_ at first verified park presence — "the
dream was a promise; the park is where it's kept." This turns the Dive into a
pre-trip anticipation mechanic (vacation-planning-grade, like the companion
sets in [05](05-companions-and-proximity.md)) and keeps pillar 3 intact: the
dream grants identity, never progression.

**The choice is the KH1 choice, mapped to the three verbs:**

| Dream choice        | KH meaning | Mechanical lean (starting point)                  |
| ------------------- | ---------- | ------------------------------------------------- |
| **Sword** (warrior) | strength   | +1 Strike                                         |
| **Shield** (guard)  | defense    | Guard blocks ⅔ instead of ½                       |
| **Staff** (mystic)  | magic      | +3 Surge power (and the §3 element affinity seat) |

Then the second beat, verbatim KH1: _choose what you give up_ — the
complementary −1-grade penalty on one of the other two. Two taps, a build
identity, and the §4.0 complaint ("player numbers are constants; growth is a
toast") gets its first fix _before_ the loadout even exists. Magnitudes stay
small (±1 grade) so no choice is a trap; the modifiers live on the `wielder`
row and are **pinned into the encounter session** like the loadout
(15 §3.13) — replay-safe by construction.

**The tutorial fight lives inside the Dive.** KH1's Dive includes the first
Shadows and ends under Darkside's shadow; ours stages the three-verb tutorial
against dream-Shadows _on the platform_ — 2D, desk-testable, no presence, no
live-data claim, and therefore no violation of pillar 1 (the Darkness is never
faked; a _dream_ is fiction, not feed). It grants the Traveler's Key and
nothing else — no XP, no Journal page (dream-Shadows aren't real Heartless).
The awakening trial — your first _real_ win — still requires a real wound in a
real park.

### 1.3 The empty-map problem, answered by the guide

The honest consequence of pillar 1: a brand-new wielder arming play mode on a
day when nothing is broken sees an empty map, and today nothing explains it.
Do **not** solve this with a pity spawn (that's a timer wearing a trenchcoat —
pillar 1 dies by a thousand such cuts). Solve it with voice (§2): the guide
names the truth as lore — _"the darkness stirs where a World's heart is
wounded. No World is wounded now. Walk with me — I'll show you what the
Worlds hold."_ — and routes the new wielder to what an unwounded park is rich
in: echoes to touch, a dormant Trinity, the World's light, the companion whose
ride is running. The empty map converts from bug to the game's clearest
statement of its own honesty. (This also implies first-session UX should lead
with the _social/ambient_ layer when the darkness is quiet — a real sequencing
note for onboarding.)

### 1.4 The Station is the profile

The stained-glass platform is too good to spend once. Make the wielder's
profile screen literally their **Station of Awakening**: the glass renders
their choice (sword/shield/staff motif), fills in recruited companions around
the rim (KH1 platforms depict the dreamer's bonds), gains a keychain border
per sealed World, and takes its palette from the home park. "Park Wrapped"
(M6) gets its shareable image for free — your year as a stained-glass window.
Pure presentation over rows that already exist; the cron+Claude pattern
([11](11-architecture.md)) can never draw glass, so this is a real (small)
art-pipeline item (§9).

### 1.5 Canon delta (if adopted)

GDD gains §4.-1 "The Dive" (or extends §5's loops with a "first session"
loop); §3.1 Userspace gains the dream-choice on `wielder`; Canon Log entry:
_the Dive is at-home-able, grants identity never progression; tutorial combat
is dream-staged; no pity spawns ever._ Doc [12](12-demo-vertical-slice.md)'s
demo script should almost certainly _open_ with the Dive — it's the strongest
first minute the pitch can have.

---

## 2. The guide — a voice for the layer

### 2.1 The diagnosis

Doc [07](07-ar-and-channels.md) promises "a line in your ear"; 15 §3.3 builds
audio buses; the cron+Claude pattern drafts "barks" — and no doc ever decides
**who is speaking**. KH's own new-wielder titles solved this exact problem
with **Chirithy** (_Union χ_): a small Dream-Eater-class companion who
narrates, tutorializes, keeps the record, and worries about you. A game about
an original wielder with no named cast _needs_ this figure or the entire
personal channel is a disembodied system voice.

### 2.2 The two-voice architecture (the elegant part)

The transport split that is already canon — park-public SSE vs personal FCM
(15 §6.3) — is also the **voice split**:

| Channel              | Voice         | Register                                  | Examples                                                      |
| -------------------- | ------------- | ----------------------------------------- | ------------------------------------------------------------- |
| SSE / park-public    | **the World** | mythic, impersonal, present-tense weather | "Darkness erupts at Space Mountain." "The light is waning."   |
| FCM / personal + ear | **the guide** | warm, second-person, knows your history   | "Your Trinity woke." "That's your third seal today — steady." |

One rule keeps it coherent forever: **the World never says "you"; the guide
never speaks to the park.** Every future feature knows which voice it gets by
which channel it rides — the vocabulary decomposition (aggregates vs personal)
was secretly a casting decision.

### 2.3 Cast or commission

Two options, both license-touching:

- **License Chirithy.** Maximum authenticity; instantly legible to KH fans;
  Dream Eaters exist precisely to accompany new wielders. Risk: Chirithy is
  narratively bound to _Union χ_'s story and to Player/Ventus lore — using it
  may import canon entanglements SE cares about.
- **Commission an original Dream-Eater-class guide.** Mirrors the "original
  wielder" rule (§0.5) one level up — _your_ story gets _its own_ guide. Owns
  the merch/identity space, avoids canon entanglement, still passes the
  cosmology test (Dream Eaters are canon substance). Costs a character design
  through the approval pipeline (§9).

Recommendation: the original guide, designed in the Dream Eater idiom, with
the license question ("may we create an original Dream Eater?") put to SE
early — it's the same class of ask as original Heartless variants (§6).

### 2.4 What the guide does, mechanically

- **The Dive's voice** (§1) and the FTUE thread afterward (first echo, first
  recruit, first seal each get one line, then it quiets down).
- **The ear channel's speaker** — threshold crossings, walking narration when
  (and only when) headphones are present ([07](07-ar-and-channels.md)'s
  degradation rules apply; captions otherwise).
- **The personal push author** — every FCM payload is a guide line. This gives
  the A4 FCM work a single copy voice instead of notification-ese.
- **The Journal's keeper.** The GDD names the bestiary "Jiminy's Journal," but
  Jiminy is Sora's chronicler; _your_ journal wants _your_ chronicler. The
  guide keeps the Journal in-fiction (Jiminy stays the archetype's name in
  design docs; the product says "the Journal").
- **Never a nag.** The guide obeys the §4.5 rule (no streak-guilt): it
  celebrates presence, never punishes absence — at-home lines are warm
  ("the Worlds will be brighter for your return"), never FOMO.

Delivery is text-first (the cron+Claude lore pattern drafts; humans curate a
canonical bark set); VO is a later asset rung (§9.4). Latency and cost stay
zero because barks are content, not generation-at-runtime.

### 2.5 Canon delta

GDD §7 gains the guide as a story-bible entity + the two-voice rule; §3.8
Interactionspace names the guide as the ear channel's persona. Open question
retired: "who narrates?" New open question: Chirithy vs original (a license
conversation).

---

## 3. Magic — activating the dormant element

### 3.1 The diagnosis

Elements saturate the design — World elements ([10](10-data-model.md)),
companion elements, `element × tier` materials (§4.4), and **the keychain spec
already carries an element** (§4.3) — yet the player never casts anything.
Fire/Blizzard/Thunder are as core to KH combat identity as the Keyblade, and
the verb set has no seat for them. The fix must not add a verb (canon:
"gates open capacity, never verbs"; the loadout modifies "the same three
verbs") — and it doesn't need to.

### 3.2 The design: Surge _is_ the spell slot

The keychain's element **transforms Surge**. Equip the frontier World's key
and your Surge is a Firaga burst; the winter World's key casts Blizzard. Same
verb, same once-per-fight economy, same server replay — the element is already
pinned in the session with the loadout (15 §3.13), so this ships with zero new
integrity surface. What each element does (starting points, one mechanical
hook each, never raw damage-only):

| Element      | Surge behavior                                           | The read it creates                           |
| ------------ | -------------------------------------------------------- | --------------------------------------------- |
| **Fire**     | damage + burn (foe takes N/turn for 2 turns)             | cast early                                    |
| **Blizzard** | damage + **freezes a Nobody's warp** for one turn        | the §6-designed warp read gets a counter-tool |
| **Thunder**  | damage split across all foes                             | the phased-escort answer (incursions, §4.6)   |
| **Water**    | damage + a one-hit veil (absorbs the next counterattack) | defensive surge                               |
| **Light**    | (keychain-rare) damage scaled by the World's light band  | the social economy reaches into battle        |

**Affinity is one pure table.** Heartless gain an element (per-World variants,
§6, make this natural); `resolveRound` multiplies Surge damage by
weak ×1.5 / neutral ×1.0 / resist ×0.5. That's ~ten lines in `battle.ts`,
replayable, and it converts the live feed into loadout strategy: storm weather
spawning Thunder-aligned wisps (Eventspace already plans weather-gated
Heartless) means **the real sky tells you which key to carry** — the moat
expressed as a build choice, which no static game can copy.

**Journal braid:** a new condition-entry family — _defeated with its opposing
element_ — witnessed by the pinned session's keychain element + the replay
(a battle-shaped witness per 15 §3.10's taxonomy; stampable from day one once
sessions pin loadouts).

### 3.3 What stays out

No mid-fight spell menus, no MP bar, no elemental Strike (Strike stays
physical so the choice lives in the loadout, not in a bigger menu), no Cure as
a verb (healing remains the support companion's job — it keeps companions
necessary). The staff Dive-choice (§1) leans into Surge/element power — the
mystic build is real without a spellbook.

### 3.4 Canon delta

GDD §4.3 keychain spec: "an element" → "an element, which transforms Surge
into that element's spell"; §6 battle scheme (designed-next) gains the
affinity table; §4.2 gains the opposing-element condition family; §8 gains the
affinity multipliers as knobs. Open question: does the starter Traveler's Key
stay elementless (a deliberate "you feel the difference when you first equip
an elemental key" beat — recommended) or start Light-aligned?

---

## 4. Queue-time — the largest surface we haven't designed

### 4.1 The diagnosis

Guests spend more park time in queues than doing anything else, and the queue
is the _one_ context where heads-down is socially fine, stand-still is
guaranteed, and boredom is the incumbent. Doc [06](06-location-and-geofencing.md)
defines a Queue geofence tier "for queue-time experiences"; the achievements
engine already runs a production **queue-dwell state machine** (≥8 min
anchored ⇒ a ride, 15 §3.8) — and the game uses queues only in prohibitions
("never interrupts a queue"). We built the detector and designed no
experience. Under the boundary rules, queue state is **app→game crosstalk as
a read** — the game may consume it with zero new location code.

### 4.2 What fits (and what never will)

Design constraints of a queue: interruptible every 30–90 s (the line moves),
one-handed, low-battery, indoor/GPS-poor, surrounded by strangers. So: **menu
verbs and reads only.** Never battles (attention + crowd flow), never AR
(a raised camera in a packed switchback is a privacy and courtesy failure —
§13), never anything that punishes putting the phone away mid-interaction.

The KH-native queue set:

1. **The Moogle finds you in line.** The forge/synthesis UI (§4.4) unlocks
   contextually when queue-dwell is detected — _"you look like you have a
   minute, kupo."_ Synthesis is menu gameplay; a queue is menu time. The forge
   being _queue-first_ rather than a map screen gives rung 8 of the feel
   ladder its home and makes lines the place your drops become gear.
2. **Companion vignettes.** A short (4–6 line) dialogue scene with a fielded
   companion — one per companion per day, drafted by the cron+Claude lore
   pattern and human-curated into a fixed bark library. **In their home
   World's signature queue, it's _their_ scene** ("the pirate talks while you
   wait for the pirate ride") — the proximity system reaching into the queue.
   Completing one grants a small bond tick (a future co-op/synergy input,
   [05](05-companions-and-proximity.md)) — capped daily, riding the verified
   dwell, so it's farm-proof by construction.
3. **Journal reading + condition planning.** The Journal's natural reading
   room, plus a live-aware prompt: _"Space Mountain is wounded right now — a
   ride-down page is possible today"_ (a read over active marks; no push, no
   nag — it appears only when you open the Journal in line).
4. **The queue's own page.** The civilian app's dwell machine confirms the
   ride afterward; the game adds the _anticipation_ face: the ride you're
   queued for, your history with it, whether its companion is recruited,
   whether your Surge will charge on it (the ride-as-controller beat, doc 04).

### 4.3 The ops pitch, again

"A game that makes lines feel shorter" is a measurable guest-satisfaction
lever and extends [09](09-moderation-trust-safety.md) Part C's
congestion-aware pitch: we are the location game that _wants_ you calm in the
queue, not sprinting through walkways.

### 4.4 Canon delta

GDD §6 interaction table gains a **Queue** context row (input: menu taps;
channel: screen; rule: interruptible, one-handed, no AR, no battles). §3.8
names the queue a first-class context. Doc [05](05-companions-and-proximity.md)
gains bonds-via-vignettes as a designed (future) input. Build-wise this slots
after the progression spine (forge exists) except vignettes, which could ride
the feel workstream's content pipeline early.

---

## 5. The at-home surface — verbs need presence; sight needs love

### 5.1 The diagnosis

Most guests visit annually. Between visits the docs offer FCM pushes and
(future) "Park Wrapped" — otherwise the save file is invisible 360 days a
year. Worse, the retention fiction is _already written_ around remote
visibility — _"the light you tended fades if no one keeps it… the park needs
you back"_ (GDD §7) — but no surface lets you _watch_ the light from home.
Presence-gating every **verb** is correct and stays; gating all **sight** was
never decided, just never designed.

### 5.2 The rule

> **Verbs need presence; sight needs love.** At home you may look at
> everything and touch nothing that the World feels.

The one exception, by design: the Dive (§1) — a dream claims no presence.

### 5.3 The surface (the Vestibule)

When the app opens outside any park boundary, play mode's home is the
**Vestibule** (working name — cosmology candidates: the Station itself):

- **Your Station** (§1.4) — profile-as-stained-glass; roster; keychain
  cabinet; the Journal in full (its natural reading room besides queues).
- **The Worlds, watchable.** Each visited park renders its Worlds' light
  bands — live, from the same derived aggregate. Copy is guide-voiced and
  guilt-free by rule (§2.4): the light _never_ reads as your fault. (The
  cold-start floor already guarantees "quiet, never punished" — the same
  guarantee, ported to feelings.)
- **Forge intent.** Recipes are known upfront (§4.4 canon) — so at home you
  can browse recipes and pin a **target** ("next: the frontier key +2 — needs
  3 frontier shards"). Pinned targets surface in-park on the map and in the
  queue Moogle. Pure read + a bookmark row; creates the pre-visit intention
  loop that vacation-planning-grade motivation runs on.
- **The starmap.** The cross-park meta-map finally claims its Gummi framing
  (doc 04's table has held the seat since day one): parks you've visited as
  worlds on a dark sea, keychains and seals marked, the route your save file
  has traveled. **v1 is presentation only** — no Gummi minigame is designed
  or planned; the starmap is the logbook's most shareable view and the
  cross-park differentiator made visible.
- **Trip integration.** ParkFi is a trip-planning product; when a trip signal
  exists, the Vestibule counts down and the guide gets pre-trip lines. This
  is the one place the civilian app and the game _point at each other_
  without touching (both read their own rows; no module imports — the
  boundary holds).

### 5.4 Notification policy (the part that can go wrong)

Light-band FCM to at-home users is a re-visit driver _and_ a guilt machine.
Policy: ambient world-state pushes go **only** to users with an upcoming-trip
signal or an explicit opt-in ("watch this park"); personal payloads (your
Trinity woke, your echo was touched) always deliver — they're news about
_your_ things, and they're the marquee at-home moments ("something you did
last Tuesday mattered today" lands hardest when you're far away).

### 5.5 Canon delta

GDD §5 gains a fourth loop — **away (between visits)**: watch → intend →
anticipate → return. §3.8 gains the Vestibule context. Pillar 3 gains the
sight/love sentence so nobody ever "fixes" remote viewing into remote play.

---

## 6. Per-World Heartless — the bestiary the license is for

### 6.1 The diagnosis

KH canon themes its bestiary per world (Air Pirates over Neverland, Search
Ghosts in Monstro, Wight Knights in Halloween Town); our catalog is three
global archetypes plus rarity. The GDD _already assumes_ per-World pages —
§4.2's "completing a **World's page set**" and the Luminary trial — but with
global species, every World's "set" is the same three pages. 15 §3.10 noticed
`homeWorld` is unmodeled, but filed it as a condition-entry blocker; it's
actually a **content-identity gap**: sealing Fantasyland should not _feel_
like sealing Tomorrowland.

### 6.2 The model: archetype × variant

Keep the three mechanical archetypes (shade/wisp/breaker, later
husk/sorcerer) exactly as the balance/stat layer. Add a **variant** content
layer keyed by World:

- `ref_heartless_variant (code, archetype, world_element_or_theme, name, art,
element)` — a variant is an archetype wearing a World's identity, carrying
  the §3 element. `heartlessSpec` already takes the mark and resolves
  deterministically; it gains the World (which `startEncounter` already
  resolves for `fieldParty`) and picks the variant by
  `(archetype, world theme)` — still pure, still seeded, still replayable.
- **The licensed bestiary does the naming.** Under license, map real KH
  species to land themes where they exist (pirate lands → the Neverland
  roster; spooky lands → Search Ghost-class; etc.) and commission original
  variants in the KH idiom where canon has no fit — the same ask-class as §2's
  original guide; batch it in the same SE conversation.
- **Journal pages key on variants.** Per-World page sets become real; the
  Luminary trial ("complete any World's full page set") becomes the tour of
  that World's own bestiary; first-of-species XP naturally pays once per
  variant, which repairs breadth economics across Worlds (a veteran entering
  a new World has pages to fill again — the cross-park loop gets content
  teeth, not just keychain teeth).
- **`homeWorld` falls out** — a variant's home is its World; the home-World
  condition entry (15 §3.10's unmodeled item) becomes modelable.

### 6.3 Phasing (the honest cost is art)

v1: **name + palette variants** — same silhouettes, per-World names, tinted
art, elements wired (this alone fixes Journal coherence and feeds §3
affinity). v2: real per-variant art as the §9 pipeline delivers. Never block
the schema on the art; the catalog-in-code pattern means variants land as
content drops.

### 6.4 Canon delta

GDD §2 glossary Heartless note gains the archetype×variant model; §3.4 gains
the variant entity; §4.2 pages re-key to variants; doc
[10](10-data-model.md) gains `ref_heartless_variant`.

---

## 7. The traveling party & child users

Two halves of the same fact: **the modal guest is a family**, and the current
social design is solo-adult + async-strangers.

### 7.1 The traveling party (co-visitors, without the friend graph)

The people you'll actually play with are standing next to you. Tier-3
friendship is the wrong primitive for them (heavier than needed, later than
needed). Proposal: a **session-scoped party** —

- **Form:** one wielder shows a QR / nearby code; others join. The party lives
  for the park day, then dissolves (a party that _was_ becomes a logbook
  entry, not a persistent graph — no social debt, no management UI, no
  moderation surface; forming one with strangers is possible and fine because
  it carries no reach beyond the day).
- **What it does (v1, all derivable from `encounter_log` + timestamps — zero
  new realtime infra):**
  - **Sealed-together:** party members who each win at the same breach within
    ~10 min get a shared ceremony line and a Journal tick ("sealed
    side-by-side"). This is 15 §4's tier-3 bond mechanic, generalized down to
    the day-party and shipped years earlier — same verification, from
    timestamps.
  - **The family Keyhole:** a World seal completed while partied credits the
    whole party's ceremony ("you sealed Fantasyland _together_") — the single
    most photographed moment the game will produce.
  - **Trinity, same-moment:** three partied hearts on a sigil is already the
    designed big-ceremony path — the party makes it discoverable.
- **What it never does:** shared HP, trading, chat (families have mouths),
  any reward _requiring_ a party (pillar 2 holds — party play is icing).
- Solo instances stay solo (v1 Rifts unchanged); the party is a _credit and
  ceremony_ overlay, not shared simulation — which is why it costs almost
  nothing and can precede the DO rooms by years.

### 7.2 Child users — the compliance gap that is also a design gap

A Disney-park KH game will be played by children; the docs are silent on
COPPA (US: under-13, verifiable parental consent, and **precise geolocation
is enumerated personal information** — regulators are most aggressive exactly
here) and GDPR-K (16 default, member-state floors at 13). "Age-gate to 13+
and look away" is both endemic-to-fail and off-brand for this license — and
the license itself is the answer: **Disney runs mature family-account and
parental-consent infrastructure across its properties.** The realistic
posture: the consent _machinery_ is a publisher-side integration; **our
architecture must not foreclose it.** What we build now:

1. **A profile age tier** (adult / teen / child) on the wielder from day one —
   cheap now, wrenching later.
2. **A child-tier capability matrix**, mostly falling out of decisions already
   made — the design has been accidentally kid-safe in exactly the right
   places:
   - The park channel is **aggregates, never identities** (canon) — the SSE
     surface is already minor-safe with zero changes.
   - Echoes are **structured-only** v1 — kid-safe today. The rule to add:
     _if/when free-text attachments unlock, child profiles never see or write
     them_ — the two-layer model ([09](09-moderation-trust-safety.md)) gains
     an age dimension on the open layer.
   - **No display names to or from child profiles** anywhere; the one place a
     name appears (emblem first-witness credit) shows a system-styled
     pseudonym for child accounts.
   - **No photo capture** for child profiles (emblem registration disabled;
     confirmation — which frames the same target but stores nothing — can
     stay).
   - Letters (tier 3) are mutuals-only by design; child tier simply doesn't
     get the feature until the publisher's family-friend infrastructure
     defines "mutual" for minors.
3. **Location minimization, strengthened per tier.** Doc
   [06](06-location-and-geofencing.md)'s posture (on-device geofence eval,
   derived events not breadcrumbs, short retention) is already unusually
   compliant; codify for child profiles: coarse derived events only, no
   location-history surface, shortest retention class.
4. **Store reality:** ship with a normal age rating (KH titles run E10+; our
   content — stylized fantasy conflict, "driven back, never killed" — sits
   comfortably there), _not_ in Apple's Kids Category (which would constrain
   the whole product); handle age inside the app per the above.

### 7.3 Canon delta

GDD §3.7 gains the traveling party (with the sealed-together tick); a new
GDD section (or doc 09 Part D) records the child-tier matrix and the
age-tier field; [13](13-roadmap-risks-ip.md) risks table gains a **child
privacy / COPPA** row (severity: launch-blocking; mitigation: age tiers +
minimization + publisher consent infrastructure). This is the one section of
this doc I'd treat as **non-optional**.

---

## 8. Sleeping Worlds & the sun — the two conditions we forgot

### 8.1 Sleeping Worlds (closed hours)

The park spends most of each day closed, and the layer has no fiction or
behavior for it — while KH holds a licensed concept purpose-built for it:
**sleeping worlds** (_Dream Drop Distance_). Proposal:

- **Closed = asleep, never wounded.** Engineering check — **verified
  2026-07-17**: `AttractionStatus` distinguishes `CLOSED` (3) and
  `REFURBISHMENT` (4) from `DOWN` (2), and both `spawnDecision` and the
  reconcile query filter strictly on `DOWN`, so overnight closures never
  spawn (assuming the upstream feed reports end-of-day as CLOSED, which the
  status mapper handles). The sleep behavior is therefore pure fiction and
  presentation: the Worlds sleep; the map at night shows them breathing
  slowly (a presentation state, zero mechanics).
- **The waking.** At rope drop the Worlds wake — a one-morning-beat ceremony
  for wielders present at open (the achievements engine already stamps
  `rope_drop`; app→game read). One `wake` event on the park channel at
  schedule-open is the World-voice version. Cheap, pure content, and it gives
  the most motivated guests (rope-droppers) a KH-native reason the morning
  feels special.
- **At-home nights:** the Vestibule (§5) renders sleeping parks as sleeping —
  the starmap at rest. (The guide, once, ever: "they're dreaming. So should
  you be.")

### 8.2 Heat (the condition bigger than rain)

`weather_obs` is designed into spawns as rain/storm; the _dominant_ Florida
condition — heat — appears nowhere, and it has both a safety face and a
content face:

- **Safety: heat-aware nudging.** The crowd-aware nudge principle
  ([09](09-moderation-trust-safety.md)) gains a heat term: above a heat-index
  threshold, suppress long-walk chaining ("Another Darkness stirs nearby →"
  gets a distance cap), and never route toward exposed spots midday.
- **Content: the light of the sun.** Never _reward_ presence in dangerous
  heat (a liability inversion). Invert it, and it's both fictionally perfect
  and operationally useful: **blazing noon calms the darkness in exposed
  ground — it retreats to shade and indoors.** Mechanically: a heat input to
  `spawnWeight` that shifts spawn placement toward shaded/indoor-adjacent
  anchors during high heat-index hours. The game literally steers players to
  shade — the World-light traffic-shaping trick (15 §4.6) applied to the sun,
  and another line in the Disney-ops pitch (doc 09 Part C).
- Journal: a _"defeated under the blazing sun"_ condition entry is the one
  acceptable heat reward **only if** it keys on temperature, not on
  exposure — earned in shade like anywhere else. (Or skip it; the calm-at-noon
  fiction is worth more than the page.)

### 8.3 Canon delta

GDD §3.5 Eventspace gains `park closed/open` (sleep/wake) and `heat` rows;
§8 gains the heat spawn-shift knob; doc 09 Part B gains heat-aware nudging.

---

## Part II — AR / XR

## 9. The asset & audio pipeline — the long-lead item nobody scheduled

### 9.1 The diagnosis

Every AR rung, the turn theater, the Dive, per-World variants, and the guide
all consume **licensed character art and KH-identity audio** — and no doc
plans the pipeline: who makes assets, in what formats, through whose
approval. For a licensed product the approval loop is the schedule risk: art
that takes a week to make can take a quarter to clear.

### 9.2 The 2D-authentic insight

Rung-1 lite AR wants sprites/billboards, not models — and that is not a
compromise: **KH's own mobile flagship (_Union χ_) shipped its entire
Heartless bestiary as 2D animated sprites.** A 2D-sprite reveal is
_authentically KH-mobile_. This reframes the v1 asset ask from "3D characters
for AR" (expensive, slow to approve) to "sprite sets in the Union-χ idiom"
(cheaper, faster, precedented with SE) — and the same sprites drive the 2D
battle theater, the map, and the Journal. One asset buy, four consumers.

### 9.3 The pipeline, per rung

| Consumer                  | Format                                               | Notes                                                                                             |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 2D battle / map / Journal | sprite sheets (idle/attack/hit/dissolve)             | the §6 variant plan defines the shopping list; palette-tint v1                                    |
| Rung-1 AR reveal          | same sprites, billboarded (canvas/WebGL)             | + the §11 darkness-compositing treatment                                                          |
| Rung-2 native AR          | 3D: **USDZ** (RealityKit) _and_ **glTF** (SceneView) | one Blender source, dual export, LODs; the dissolve+heart beat needs a native particle equivalent |
| The Dive / Station        | stained-glass illustration system                    | §1.4; modular rim elements so progression composes                                                |
| The guide                 | one character design + expression set                | §2.3; the flagship approval item                                                                  |

Process: a versioned asset catalog keyed to the code catalogs (species
variants, keychains) so art lands as content drops; batch SE/Disney brand
review per drop; start the first batch (starter bestiary + guide + Dive
glass) **now** — it gates nothing until it gates everything.

### 9.4 Audio is a license question before it is an asset question

KH's identity is inseparable from its score and audio marks — "Dearly
Beloved," the battle fanfares, the "obtained!" jingle. 15 §3.3 says
"commission" without asking whether the license _includes music_. Three
tiers, use all three deliberately:

1. **License original recordings for the identity anchors** — Dearly Beloved
   for the Vestibule/Station (opening the app at home to Dearly Beloved _is_
   the at-home surface's emotional thesis), the victory fanfare, the
   "obtained!" jingle. Small list, maximum authenticity; a publisher
   conversation, so start it early.
2. **Original score in the KH idiom** for ambience/battle loops (per-World
   ambience maps to the §6 variant work).
3. **Guide VO later** — text-first ships everything; VO is a v2 asset rung.

Doc [13](13-roadmap-risks-ip.md)'s license-terms checklist gains: music &
audio marks; original-character creation rights (guide, Heartless variants);
the Hidden-Mickey/emblem question already listed.

---

## 10. Darkness Sight — the flagship AR moment, finally scheduled

### 10.1 The diagnosis

Doc [07](07-ar-and-channels.md) calls "point at the broken ride and see the
data" _the single most distinctive AR moment we can show_ — then no rung,
milestone, or priority builds it. It needs neither tracking nor VPS; it needs
a bearing.

### 10.2 The rung-1.5 sketch

**Attunement view / Darkness Sight** (fiction: wielders _sense_ darkness —
"…did you feel that?"): the rung-1 camera chassis (same investment as the
emblem viewfinder) plus device heading:

- Inputs: GPS position, device heading (`deviceorientationabsolute` /
  WebKit compass heading — behind the §13 permission choreography), active
  mark coordinates (already on the client).
- Render: a screen-edge darkness vignette that intensifies as heading swings
  toward a wound; within ~10–15° alignment, a smoke-column billboard rises at
  the horizon point, scaled by distance, labeled with the World-voice line.
  Multiple wounds = multiple tendrils; an `incursion` burst = the whole sky
  edge staining (the storm-as-content beat, 15 §6.2, made visible).
- No tracking claim anywhere: nothing is world-locked; it's a bearing
  overlay, honest about being a _sense_, not a sight.

### 10.3 The physics caveat and the graceful floor

Phone compasses lie near large steel structures — which is what a theme park
is. Mitigations, in order: fuse GPS-track heading while the wielder walks;
widen the alignment cone; and when confidence is low, degrade to the
**attunement ring** — a screen-space compass rose around the map/camera
showing wound directions as pulses. The ring is fully honest, works indoors,
costs a component, and is itself a shippable v1 of the feature (the camera
version becomes its upgrade). Add a compass-deviation walk to the in-park
trip manifest (§15.3).

### 10.4 Canon delta

Doc 07's ladder gains rung 1.5 (Darkness Sight) between overlay and plane
anchors; the GDD §3.8 channels note gains it as the second AR moment after
the emblem viewfinder.

---

## 11. Sun, heat, thermals — AR against Florida

### 11.1 Black creatures in white light

Heartless are black; a noon camera feed is blinding — a dark sprite over
bright pavement is a contrast failure. The fix is fictionally load-bearing,
not just legible: **render darkness as absence, not as a dark object.** Under
and around the creature, darken and desaturate the _camera feed itself_ (a
radial multiply/vignette on the feed layer) so the Heartless stands in a pool
of failing light; keep the yellow eyes at full luminance as the anchor read.
That composite reads in direct sun (you're subtracting from a bright plate,
not competing with it), reads at night (the pool deepens), and _is the
mythology_ — darkness pools where they stand. Cheap at rung 1
(CSS/canvas over the preview); rungs 2–3 get ARKit/ARCore lighting
estimation to match shadow direction, which should be listed as part of
rung 2's value, not just anchoring.

Rules to write down: never a full-screen white flash outdoors (both a
§3.7 photosensitivity and a legibility rule — the radial-glow Surge decision
already covers it); UI chrome over camera uses the outdoor palette from
15 §3.6.

### 11.2 The thermal budget (the doc-06 treatment, applied to the camera)

Doc 06 budgets GPS battery as first-class and never mentions the camera —
which is the bigger burner. Camera + GPS + max-brightness screen in direct
Florida sun is the canonical thermal-throttle recipe, and iOS will dim,
throttle, and eventually kill the camera. Budget it like battery was
budgeted:

- **Sessions are short by design** (already canon — episodic AR); enforce it:
  soft cap AR sessions at ~60–90 s, matching battle length.
- **Freeze, don't stream, during ceremony:** at the resolve beat, freeze the
  last camera frame behind the victory theater (a "time stops" beat _and_ a
  thermal pause — the sensor off is the point).
- **Listen to the OS:** surface thermal state through the Capacitor plugin
  (iOS `ProcessInfo.thermalState`, Android's thermal API); at `serious`,
  auto-degrade to the 2D battle with one guide line ("even the layer shimmers
  in this heat") — the 2D-canonical rule means degradation is always safe.
- **Measure on the trip:** thermal + battery under AR is an in-park trip
  item (§15.3) with the same "full park day on one charge" bar doc 06 set.

### 11.3 Canon delta

Doc 07 gains an "AR against the sun" subsection (darkness-as-absence
compositing, no-white-flash, thermal budget + auto-degrade); doc 06's battery
section gains the camera/thermal line.

---

## 12. Indoors — writing the ladder's missing column

The parks' most atmospheric real estate is indoors (dark rides, indoor
queues, indoor lands), indoor rides break constantly (indoor breaches will be
_common_), and the AR ladder never says what works inside. The answers are
mostly fine — they just need writing down so nothing gets planned against a
rung that can't deliver it:

| Rung    | Indoors?                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------- |
| 1 / 1.5 | **Yes** (no tracking; Darkness Sight degrades to the attunement ring where compass/GPS fail)               |
| 2       | **Yes** — plane anchors work indoors; low light degrades detection (the 2D fallback rule covers the floor) |
| 3 VPS   | **No** — Street View coverage is outdoor pathways; VPS never resolves inside                               |
| 4       | Outdoor-only by inheritance from 3                                                                         |

Two consequences worth acting on:

1. **Location indoors is attraction-tier, not micro-tier.** Deep-indoor
   interactions anchor to the attraction, never to micro-spots; the queue
   experiences (§4) need only the dwell machine, which is GPS-tolerant by
   design.
2. **The VPS probe doubles as an authoring mask.** The planned
   `checkVpsAvailability` grid probe (15 §5) shouldn't just de-risk rung 3 —
   persist the results as a **placement-validity mask** for micro-anchored
   content: emblems, Trinity sigils, and future world-locked AR may only be
   authored/registered where the mask (or reliable GPS) says they can be
   found again. A sigil registered where no positioning system can resolve it
   is a self-inflicted ghost; the mask prevents it at write time.

Canon delta: the indoor column lands in doc 07's ladder table; the placement
mask lands in doc 03's integrity rules and the emblem/trinity specs.

---

## 13. The camera, other people's children, and one consent beat

### 13.1 The bystander rule

Emblem registration got the careful treatment (face-blur before storage,
frame-the-emblem prompts). The _general_ rule for every other AR use is
stated nowhere, and in a park full of strangers' kids it must be:

> **Camera frames never leave the device.** No AR session is recorded,
> stored, or uploaded — ever, by construction. The sole exception is the
> explicit emblem-registration capture, which stores one deliberate,
> face-blurred, EXIF-stripped photo.

Write it in doc [09](09-moderation-trust-safety.md) (a new Part: the camera &
bystanders), state it in the privacy policy and App Store privacy labels, and
let it bound future feature ideas (no "share your AR battle" clips in v1 —
that feature would need this rule renegotiated deliberately).

Etiquette is design too: AR prompts orient the wielder toward _ground and
architecture_, never across crowds (the encounter spawns at your feet; the
emblem reticle frames set-dressing); and no AR in queues (§4.2) is also a
camera-courtesy rule.

### 13.2 One consent beat, not three

The AR moment needs, on iOS: camera permission _and_ the
`DeviceOrientationEvent` permission (user-gesture-gated since iOS 13) — and
15 §3.6 already made the "Engage" tap the audio unlock. Choreograph all of it
into **one designed gesture**: the first AR-capable moment shows the guide's
pre-prompt ("raise your Key" — why the camera, what never leaves the device),
and the single confirming tap unlocks audio, requests motion, and requests
camera. Never at install, never stacked as three bare OS dialogs, and every
decline lands on the 2D-canonical path with zero loss of progression
(the pillar, enforced in the permission flow itself).

---

## Part III — Housekeeping

## 14. Monetization — the recorded stance (not a design)

Decision (2026-07-17, deliberately minimal): **the game designs no
monetization.** v1 ships with none; the design keeps an extremely light hand,
ideally none at all, with the pitch position that monetization — if any — is
the publisher's decision to make later, on top of a finished engagement
design. The only rule this imposes on us, and the reason to record it at all:
**no system may be tuned to create purchasable relief.** Decay, light τ,
XP curves, material scarcity, and stand-in discounts are engagement knobs
forever; if a monetization layer ever arrives, it may sell expression
(cosmetics, titles), never time, power, presence, or weather. Nothing else in
this doc — or the canon — depends on revenue existing.

## 15. Build-order impact, trip manifest, and canon deltas

### 15.1 Where this lands in the 15 §7 priority list

Nothing here displaces priorities 1–4 (integrity → feel → wire → light).
The insertions:

- **Rides along with priority 2 (feel):** the two-voice rule + first guide
  bark set (§2); the empty-map onboarding sequencing (§1.3); the
  darkness-as-absence AR compositing spec (§11.1) written now so rung-1 work
  builds it once.
- **Rides along with priority 5 (the spine):** variant catalog + elements
  (§6, §3 — the affinity table enters `battle.ts` with the loadout work,
  since both pin into the session); queue-Moogle surfaces when the forge
  exists (§4).
- **Rides along with priority 6 (social):** the traveling party's
  sealed-together tick (§7.1 — it's an `encounter_log` derivation, cheapest
  social feature in the whole plan); child age-tier field **earlier** — it's
  a schema column and a policy doc, and it's launch-gating (§7.2).
- **Rides along with priority 7 (lite AR + the trip):** Darkness Sight
  rung 1.5 (§10) on the same camera chassis as the emblem viewfinder; the
  consent choreography (§13.2).
- **New long-lead track, start now:** the asset & audio pipeline (§9) — the
  SE/Disney conversations (original guide, variant bestiary, music anchors)
  gate nothing today and everything in six months.
- **The Dive (§1)** is its own onboarding workstream — after the feel
  workstream proves the ceremony architecture (the Dive is ceremony-heavy),
  before any store launch (it's the first minute of the product).
- **Already done:** the closed≠DOWN engineering check (§8.1) — verified in
  code 2026-07-17; scheduled closure never spawns.

### 15.2 The at-home surface

The Vestibule (§5) is deliberately unscheduled above — it's a v1.5 product
surface, not a mechanic. Its cheapest slice (Journal + Station + light bands,
read-only) could ship alongside M6's logbook, which it largely _is_.

### 15.3 The in-park trip manifest (it keeps gaining jobs)

The single validation trip now carries: M5b presence/sensor-fusion
validation · the VPS coverage grid probe (persisted as the §12 placement
mask) · geofence accuracy + battery (doc 12) · **compass deviation walk**
(§10.3) · **AR thermal/battery session tests** (§11.2) · queue-dwell
verification against the game's queue surfaces (§4). Worth a one-page
checklist doc before the trip is booked — the trip is now load-bearing for
four workstreams.

### 15.4 Consolidated canon deltas (if adopted, GDD-first, one Canon Log entry each)

1. §1 The Dive — at-home dream, identity-not-progression, dream-staged
   tutorial, no pity spawns; Station-as-profile.
2. §2 The guide — story-bible entity; the two-voice rule (World=park channel,
   guide=personal); Chirithy-vs-original as a license question.
3. §3 Magic — keychain element transforms Surge; affinity table; the
   opposing-element Journal family; §8 knobs.
4. §4 Queue context — a §6 interaction-table row; forge is queue-first;
   companion vignettes/bonds.
5. §5 Away loop — "verbs need presence; sight needs love"; the Vestibule;
   the notification policy.
6. §6 Archetype × variant bestiary; per-World Journal pages; `homeWorld`
   modeled; `ref_heartless_variant` in doc 10.
7. §7 Traveling party (day-scoped, timestamp-verified); **child age tiers +
   the kid-tier capability matrix + a COPPA row in doc 13's risk table**
   (non-optional).
8. §8 Sleep/wake + heat rows in Eventspace; heat-aware nudging in doc 09;
   the shade-steering spawn shift.
9. §§9–13 into docs 07/06/09/13: the asset & audio pipeline (+ license
   checklist items), Darkness Sight as rung 1.5, the sun/thermal spec, the
   indoor column + placement mask, the bystander rule + one-consent-beat.
10. §14 the monetization stance, recorded once so no system is ever tuned
    against it.

## 16. Open questions raised by this pass

1. **Chirithy or an original Dream-Eater guide?** (License conversation;
   §2.3 recommends original.)
2. **Dive choice magnitudes** — are ±1-grade verb leans felt without being
   traps? (Tune with the loadout work; the choice must survive keychains
   stacking on top.)
3. **Does the Traveler's Key stay elementless** so the first elemental
   keychain is a felt transformation? (§3.4 — recommended yes.)
4. **Vignette content ops** — how large must the curated bark library be
   before queue vignettes don't repeat within a vacation? (Estimate:
   ~3–4 per companion per park visit-day × roster size; the cron+Claude
   pattern drafts, humans gate.)
5. **Party-of-strangers edge** — the day-party carries no reach, but should
   joining require physical co-presence (same-park check) to keep it a
   _traveling_ party? (Recommended yes — it's one geofence check.)
6. **Child tier vs Trinity/emblem participation** — weaves are zero-content
   and presence-verified (fine for kids?); first-witness pseudonymity needs
   a naming scheme.
7. ~~**Heat data source**~~ — resolved 2026-07-17: `weather_obs` already
   carries `temp_c` and `humidity` (OpenWeather One Call, both FORECAST and
   ACTUAL rows), which is exactly what a heat-index computation needs — the
   §8.2 work requires no ingest addition, just a pure `heatIndex(tempC,
humidity)` helper in `lib/` (shareable across the boundary per the
   two-ledger rules).
8. **Music licensing scope** — which (if any) original recordings are in
   reach; the answer reshapes §9.4's tiering.
9. **Does Darkness Sight ship camera-first or ring-first** (§10.3)? The ring
   is shippable without the camera chassis and could ride the map workstream.
