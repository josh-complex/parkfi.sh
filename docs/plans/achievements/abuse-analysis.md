# Achievements — abuse / anti-cheat analysis & hardening roadmap

Security audit of the achievements pipeline, done 2026-07-07. Focus: the
geo-derived stats (walking distance, line-waiting, rides, day flags) that an
attacker can farm by feeding fake location data, plus the honor-system event
counters. Written as a handoff — findings first, then a prioritized fix roadmap
with enough detail to implement without re-deriving the analysis.

Same guardrails as the rest of the achievements work apply: **100% independent
of the Living Layer** (no imports from `src/server/living/**` or
`src/components/living/**`), catalog lives in code, DB stores only unlocked tier
ids, migrations are hand-written timestamped folders (no `_journal.json`, no
`drizzle-kit generate`).

Relevant files:

- `src/lib/achievements.ts` — catalog (stat keys, families, tiers, XP/levels).
- `src/server/achievements/engine.ts` — ping ingest, queue state machine, stat
  aggregation, unlock evaluation.
- `src/integrations/trpc/routers/achievements.ts` — `ping` / `track` endpoints.
- `src/components/achievements/achievement-tracker.tsx` — client ping loop
  (~1 ping / 30s).

---

## 0. Threat model

The `ping` endpoint (`achievementsRouter.ping`) is a plain `protectedProcedure`
mutation that accepts client-supplied `lng`, `lat`, `accuracy`. It is
authenticated but **not rate-limited** (the only rate limiter in the repo,
`src/server/parks/ratelimit.ts`, guards _outbound_ park-vendor APIs, not this).

The realistic attacker is a logged-in user with a session token and `curl` (or a
20-line script). They do **not** need to spoof browser geolocation — they call
the tRPC endpoint directly with any coordinates and `accuracy: 1`. Park
boundaries, attraction coordinates, and weather are all discoverable (public API
/ DB-backed board data), so "you have to know where the park is" is not a
control. Assume the attacker knows every polygon and every attraction lat/lng.

### What is already well-defended (keep these)

- **Server-authoritative time.** No client timestamp is ever trusted; all
  deltas use `now = new Date()` server-side and the stored `state.at`.
- **Time-accumulation is bounded to 1× real elapsed time.** `present` /
  `anchorSeconds` accrue only `min(elapsed, PING_MAX_GAP_S)`, and per-ping
  distance is clamped to `WALK_SPEED_CAP_MS * elapsed`. So ping _frequency_
  cannot inflate time- or distance-based stats faster than wall-clock — spamming
  1000 pings/sec accrues nothing extra. This is the single most important
  existing control and every fix below should preserve it.
- **Unlocks are sticky and idempotent** (`onConflictDoNothing`), so
  re-evaluation can't double-award.
- **Dev/reset endpoints are `adminProcedure`** (owner email allowlist) — safe in
  prod, real users can't reach `devUnlock` / `devReset`.

The gap: the 1×-wall-clock bound protects the _magnitude per unit time_ of a few
stats, but many achievements don't depend on accrued time at all (boolean day
flags, distinct-place counts, distinct-attraction counts), and the ones that do
are still farmable at 1× by a stationary script.

---

## 1. Findings (worst first)

### F1 — Walking distance farmable at cap speed while stationary · HIGH

`distance_m`, `best_day_distance_m` → families `walker` ("Sole Survivor"),
`bigday` ("Leg Day").

`moved` in `ingestPing` is `min(distanceMeters(prev, now), WALK_SPEED_CAP_MS *
elapsed)`. The clamp is the _only_ plausibility check. A script that alternates
between two in-park points ~75 m apart every 30s, with `accuracy: 1`, credits the
full clamped 75 m every ping (2.5 m/s × 30s) — 9 km/h of "walking" from a couch.
Teleporting to random in-park points does the same: each hop is capped, but the
_sequence_ is never rejected, so it farms at the cap indefinitely.

"Walk Around the World" (1,000 km) is ~111 h of continuous scripted pinging — a
background loop clears it in under a week; the lower tiers fall in minutes/hours.

**Root cause:** distance is credited from raw point-to-point delta with no
idle/jitter/teleport detection; the clamp caps but never rejects.

### F2 — Rides & distinct attractions need zero waiting · HIGH

`rides`, `attractions_unique` → families `rider` ("Certified Ride Enjoyer"),
`explorer` ("Ride Explorer"); also `best_day_queue_seconds` (`queueday`).

The queue state machine anchors within `QUEUE_ENTER_RADIUS_M` (40 m) of an
attraction and credits +1 ride + `queue_seconds` after `QUEUE_MIN_DWELL_S`
(8 min) anchored. Nothing distinguishes "standing in a physical queue" from "GPS
frozen on a ride's published coordinates." Send the same attraction point every
30s → after 16 pings it's a ride, and `queue_seconds` accrues at 1× forever.

`attractions_unique` only needs _one_ ≥8-min dwell per distinct attraction, so a
script that walks the park's full attraction-coordinate list, dwelling 8 min at
each, unlocks "Nothing Left to Ride" (50 distinct) in one session.
`best_day_queue_seconds` "I Live Here Now" (8 h in one day) is one scripted day.

Note: lifetime `queue_seconds` ("A Week, Gone" = 168 h) _is_ still 1×-bounded,
so that specific tier stays slow. It's the count- and best-day-based tiers that
collapse.

**Root cause:** an 8-min dwell is inferred from proximity alone; a static
coordinate satisfies it.

### F3 — Day-flag achievements are one or two pings each · HIGH

`rope_drops`, `night_owls`, `full_days`, `weekend_days`, `streak_best` → families
`ropedrop`, `nightowl`, `fullday`, `weekender`, `streak`.

These are booleans OR'd onto the `user_park_day` row (or derived from the
existence of day rows). A single in-park ping before 09:30 sets `ropeDrop`; one
after 22:00 sets `nightOwl`; one on a Saturday makes a `weekend_day`; one per
calendar day extends `streak_best`. No dwell required.

- `full_day` ("Dawn to Dusk"): two pings/day (09:00 + 22:05) = a full open-to-
  close day with zero presence. "The Marathoner" (15 full days) = 30 pings.
- `streak_best` ("Do You Even Go Home?", 14-day streak): 14 pings across 14 days.

**Root cause:** flags require presence at a _moment_, not presence for a
_duration_.

### F4 — Distinct-place counts are one ping per place · HIGH

`park_days`, `parks_unique`, `park_hop_days` → families `gate` ("Through the
Turnstiles"), `passport` ("Park Passport"), `hopper` ("Hop to It").

`park_days` counts distinct `(park, day)` rows and one ping creates the row.
`parks_unique` / passport need one ping inside each park's bounds. Since coords
are attacker-chosen, one ping at each park centroid unlocks "World Tour" (10
parks) instantly, and two parks in one day mints `park_hop_days`
("Teleportation Suspect" — the tier name is nearly self-aware). The polygon test
(`parkForPoint`) is a correctness gate, not a security one.

**Root cause:** "visited a park" = "one ping landed in the polygon."

### F5 — `rain_days` farmable, low value · LOW

`rain_days` → family `rain` ("Weatherproof"). `isRainyNow` reads the park's own
`weather_obs` (last 2 h). Attacker watches public weather (or just pings every
park until one is raining); the flag sticks to the day row. Max 300 XP, trivial
effort. Fixing F3/F4 (presence-gating the day row) largely closes this too.

### F6 — Event counters are pure honor system · MEDIUM

`pin_scans`, `alerts_created`, `menus_viewed`, `forecast_views`, `searches` →
families `pins`, `alerts`, `menus`, `forecast`, `search`.

`track` bumps a counter by 1 per call with nothing but an enum check — no event
id, no dedup, no rate limit, no proof the action happened. `menu_view` doesn't
reference a menu; `search` doesn't reference a query. A `for` loop calling
`track` 100× clears "Snackademic" (100 menus), "Omnisearch, Omniscient" (50
searches), "Mission Control" (25 alerts) in seconds.

`alerts_created` is worse than a raw counter: it counts _creation events_, so
even if alert creation were validated, create → delete → create loops inflate it.

(`pins_owned` and `attractions_unique` are backed by real rows — `pin_have`
count and `user_attraction` rows — so they're harder; `attractions_unique` still
inherits F2's static-coordinate weakness upstream.)

**Root cause:** counters increment on an unverified client assertion.

### F7 — No ping throttle → free spam & amplification · MEDIUM

There's no server-side minimum spacing between pings. The 1×-wall-clock bound
means spam can't inflate time/distance _magnitude_, but it makes F1–F5 a free
`while true` loop, and every ping is several upserts + a full
`evaluateAndUnlock` recompute (`computeStats` re-reads all day rows + counts).
So it's also a cheap self-inflicted DB-write / CPU DoS vector per user.

---

## 2. Fix roadmap (by leverage)

Ordered so the two highest-leverage fixes (R1, R2) land first. Each notes the
findings it closes.

### R1 — Server-side ping rate limit · closes F7, caps F1–F5 cost

Reject pings arriving < ~20–25s after the user's last stored `state.at`
(the tracker sends every 30s, so honest clients have headroom). Drop early —
before any accrual or `evaluateAndUnlock` — so a rejected ping neither accrues
nor burns a recompute. Simplest impl: compare `now - state.at` at the top of
`ingestPing` and short-circuit (return the current `inPark`/today snapshot
without mutating). Cheap, kills the amplifier, bounds DB load.

### R2 — Idle / jitter / teleport rejection for distance · closes F1

The biggest hole. Options, roughly increasing rigor:

- Require net displacement over a sliding window (e.g. sum of per-ping moves
  must not vastly exceed straight-line displacement between window endpoints —
  catches oscillation between two points).
- Reject / zero the distance credit when consecutive fixes imply teleport-then-
  return patterns, or when positional variance over the last N pings is near
  zero (stationary jitter).
- Credit distance only when the _running_ speed sits in a human-plausible band
  rather than merely ≤ cap.

Keep the existing clamp as a floor. `src/server/achievements/geo.ts` +
`geo.test.ts` already isolate the geo math — add the plausibility helper there,
pure and unit-tested, mirroring `presenceDelta`.

### R3 — Real dwell continuity for rides · closes F2

An 8-min dwell should require evidence of _being there over time_, not one
frozen point. `anchorSince` is already tracked; additionally require, over the
dwell: a minimum number of _distinct_ pings (≥ ~8 for 8 min at 30s cadence) and
some minimum positional variance (a real queue shuffles; a spoof is pixel-
perfect). Zero-variance anchors should not settle as rides. This also raises the
bar on `attractions_unique` since it's downstream of the same settle.

### R4 — Presence-gate the day flags & day rows · closes F3, F4, F5

Require a minimum accumulated `present_seconds` in the day before a
`user_park_day` counts toward `park_days` / `parks_unique` / `park_hop_days`,
and before `ropeDrop` / `nightOwl` / `weekend` / `rainy` flags are honored. E.g.
a day needs ≥ ~10–15 min of gap-bounded presence to "count." Turns F3/F4 from
1–2 pings into genuine dwell, and since a farmed rain day now needs real
presence too, F5 mostly closes for free. Decide whether to gate at write time
(don't set the flag until presence threshold met) or at aggregate time (filter
in `aggregateDayRows`) — aggregate-time is easier to reason about and keeps the
raw row honest; it also lets a backfill re-apply the gate to historical rows.

### R5 — Back event counters with state or proofs · closes F6

- `alerts_created` → count _currently existing_ alerts (join the alerts table)
  instead of a monotonic creation counter, or dedupe by target id.
- `menu_view` / `search` / `forecast_view` → take the referenced id/query and
  dedupe within a time window (count distinct menus viewed, distinct searches),
  so a loop on one target counts once.
- At minimum, rate-limit `track` per user per event (piggyback on R1's limiter).

### R6 — Per-day sanity caps (backstop) · defense-in-depth for F1–F3

Cap daily accrual at values no honest guest reaches — e.g. ≤ ~50 km/day
distance, ≤ ~40 rides/day, ≤ ~16 h/day queue. Even if a per-ping check is
bypassed, the day row can't exceed the cap. Cheap to add in the upsert / at
aggregate time; log when a cap trips (potential-abuse signal).

---

## 3. Suggested sequencing for the handoff

1. **R1** (rate limit) — small, immediately reduces attack surface and DB load.
2. **R2** (idle distance) — highest-value single fix; walking is the flagship.
3. **R4** (presence-gate days) — closes the widest set of one-ping exploits
   (F3/F4/F5) in one change.
4. **R3** (dwell continuity) — closes ride/attraction farming.
5. **R5** (event counters) — independent, can land any time.
6. **R6** (daily caps) — final backstop once the specific paths are closed.

R1, R2, R3, R6 all sit in `engine.ts` / `geo.ts` and are unit-testable without a
DB (extend `engine.test.ts` / `geo.test.ts`). R4 touches `aggregateDayRows`
(pure, already tested) if done at aggregate time. R5 touches the router + schema.
Any change to how a stat is computed should be paired with an
`adminReevaluateAll` run (already exists) so historical users are re-scored
consistently — note that tightening a rule won't _revoke_ already-granted
sticky unlocks; if retroactive revocation of farmed tiers is desired, that's a
separate deliberate step (there's `adminRevoke`).
