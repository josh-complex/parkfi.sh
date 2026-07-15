# Sensor Pipeline & Achievement Feedback — Follow-up Handoff

> Status: planned 2026-07-14, from two audit passes over the shipped B2/B3/B6 code.
> Companion to [PLAN.md](./PLAN.md) (original architecture) and [DEPLOY.md](./DEPLOY.md)
> (device gates G1–G8). Everything below was verified against the tree at audit
> time — file:line references included so claims can be re-checked cheaply.
>
> Toolchain reminders for the implementer:
>
> - `node` is NOT on PATH — run every CLI through bun (`bun vp check`, `bun vp test`, `bun cap …`).
> - Migrations are hand-written timestamped folders under `drizzle/` (no `_journal.json`,
>   never `drizzle-kit generate`).
> - **Never commit** — the repo owner handles all git operations.
> - Never start dev servers unless explicitly asked.
> - iOS/Kotlin constants live in TWO mirrored files: `RideConst` in
>   `packages/ride-recorder/ios/Sources/RideRecorderPlugin/RideDetection.swift` and
>   `packages/ride-recorder/android/src/main/java/sh/parkfi/riderecorder/RideDetection.kt`.
>   Any constant change must land in both.

---

## Context: what the audits found

**Audit 1 (device data & detection)** traced the full sensor chain — both native
capture engines, both metric computers, the JS bridge (`src/lib/ride-recorder-client.ts`),
server ingestion (`src/server/achievements/rides.ts`), and the seed data
(`services/coaster-stats/seed.csv`).

**Audit 2 (feedback & delivery)** traced how achievements/recaps reach the user —
unlock toast funnel (`src/components/achievements/unlock-toasts.tsx`), recap toast,
the `notifiedAt`/`pendingUnlocks` ledger, push infrastructure (`src/server/notifications/*`),
iOS background modes, and Android service posture.

**Already fixed in the session that produced this doc (do not redo):**

- `devResetMine` now also wipes `user_ride_event` + `user_attraction`
  (`src/server/achievements/engine.ts`).
- New `devResetRides` (engine + `achievements.devResetRides` adminProcedure) wipes only
  sensor data: `user_ride_event`, `user_attraction`, and the five sensor `user_stat`
  keys (`coaster_drops`, `airtime_seconds`, `max_g_best`, `inversions_ridden`,
  `vertical_m`; `track_distance_m` is computed live, never stored).
- Debug panel (`src/components/dev/error-test-panel.tsx`, Achievements group) has
  "Clear ride/sensor data" and the pre-existing "Reset my achievements".
- **W2 applied**: `maxDurationS`/`MAX_DURATION_S` = 345 in both `RideDetection.swift`
  and `RideDetection.kt` (Zod stays 360 → real 15 s margin).
- **W7 applied**: `airtime_seconds` / `vertical_m` accumulate raw floats in
  `rides.ts` (rounding is display-time only).
- **F14 applied (new finding, see below)**: `estTopSpeedKmh` + sample `altRel` Zod
  fields are now `.nullish().transform(v => v ?? null)`; Android `resultToJs` emits
  `org.json.JSONObject.NULL` for null values; iOS emits `NSNull()` instead of
  `Optional.none as Any` (two sites in `RideDetection.swift`). Tests added in
  `rides.test.ts` for missing-key acceptance + null normalization. **The native
  halves are compile-unverified in this env — confirm they build on first
  `bun cap sync` + Xcode/Gradle build.**
- DEPLOY.md's stale "not implemented yet" header rewritten; stale `ACHIEVEMENTS_DEV`
  comments corrected to `adminProcedure` (engine.ts + error-test-panel.tsx).

**Applied 2026-07-14 (Part 1 — server + client, `bun vp check` clean, 60 tests green):**

- **W1** — `hasRideSignature` + `RIDE_SIGNATURE` const in `src/lib/ride-metrics.ts`;
  server gate (signature + `confidence >= 0.5`) at step 0 of `ingestRideTrace`;
  client suppression gate in `achievement-tracker.tsx`. Unit table in
  `src/lib/ride-metrics.test.ts`. **NOT done: the native `computeConfidence`
  multiplier (W1 item 4, Swift+Kotlin)** — deferred to the Part 2 native pass; the
  server gate is authoritative so this is only a tuning refinement.
- **W4** — clamp basis fixed: `coasterClampReason` now bounds `maxDropM` by
  `maxHeightM ?? dropHeightM` × 1.5 (dropped the cumulative-`verticalM` check);
  `max_height_m` added to the query. Tests updated. Still inert until W14 seeds figures.
- **W5** — `src/lib/ride-debug-log.ts` ring (cap 20) + `useRideDebugLog`; "Ride
  recorder" section with Copy-JSON in `error-test-panel.tsx`; `ride_trace_rejected`
  / `ride_trace_suppressed` PostHog events from the tracker.
- **W6** — `ingestRideTrace` returns `duplicate: boolean`; client skips the recap
  toast (and rings a "duplicate") when true.
- **W10** — `achievements.myRideLog` (keyset-paginated, sensor-only, no `trace`);
  "Ride log" section on the achievements page with Load-more + empty state.
- **W12** — replaced the celebration's bare `toast.dismiss()` with per-id dismissal
  of the funnel's own `achv:*` ids + shared `LOCNUDGE_TOAST_IDS`; recap toast now
  survives a level-up.

- **W14** — every RCDB-published figure backfilled in `services/coaster-stats/seed.csv`
  (ft→m): drop/max-height for seven-dwarfs, tron, barnstormer, everest (also
  corrected its 60 m show-structure height to the 34 m track height), rock-n-roller,
  revenge-of-the-mummy, hulk, hagrids, flight-of-the-hippogriff; track length, speed
  and height for trolls. Corrected two inversion counts to RCDB (stardust 0→1,
  curse-of-the-werewolf 1→0). **Left blank where RCDB has no figure** (indoor/launch
  coasters with no listed drop; the 2025 Epic Universe rides curse/hiccups/mine-cart).
  **Coverage audited against the live DB** (probe over all 10 tracked parks — 7 dry
  Orlando parks + 3 water parks): the seed now covers every RCDB-listed roller coaster
  at the dry parks. **Added two the original seed missed** — `escape-from-gringotts`
  (USF) and `pteranodon-flyers` (IOA), both real coasters (no RCDB numbers yet, seeded
  with inversions only). **Data gap flagged:** `hollywood-rip-ride-rockit` is in the
  seed but has NO matching `attractions` row (upstream ThemeParks.wiki ingest gap), so
  that row is inert until USF re-ingests it; kept so it self-heals. 22 rows total.
  **Remaining deploy step (I did NOT run — touches the DB):** `bun run cron:coaster-stats`
  then `achievements.adminReevaluateAll` so the clamp arms and trackmiles credit
  retroactively.

**Still open in Part 1:** the W14 deploy step above (cron + reevaluate). DB-level
integration tests for the W1 server gate / W6 dedupe flag were not added:
`rides.test.ts` covers pure helpers only (no DB test harness exists); those paths
are covered by typecheck + the pure `hasRideSignature` table.

**Applied 2026-07-14 (Part 2 — native. TS parts `bun vp check` clean; Swift/Kotlin
are COMPILE-UNVERIFIED in this env — confirm on first `bun cap sync` + Xcode/Gradle
build. `bun cap sync` is REQUIRED so the new @capacitor/haptics pod/gradle dep and
the foreground service register natively):**

- **W3** — iOS altimeter now starts in `startMonitoring` (was `beginRecording`) and
  stops only in `stopMonitoring`; removed the per-ride restart and the
  `finishRecording` stop, so the pre-trigger ring carries real altitude and the
  lift hill is captured. `RideRecorder.swift`.
- **W1·4 (native)** — `computeConfidence` now multiplies the score by 0.4 when
  `drops == 0 && airtime < 0.5`, in BOTH `RideDetection.swift` and `RideDetection.kt`,
  so walking can't clear the server's 0.5 floor on jitter alone.
- **W13** — `@capacitor/haptics` added; `src/lib/vibrate.ts` branches on `isNative()`
  (dynamic import) → impact ladder for `vibrateUnlock`, impact-run + Success
  notification for `vibrateLevelUp`; web path unchanged. Exported API identical.
- **W8** — new `RideMonitorService` (Android foreground service, `specialUse` type)
  owns the `RideRecorder`; `RideRecorderPlugin.kt` starts/stops it, forwards
  `rideDetected` with `retainUntilConsumed = true`, and tracks foreground via
  resume/pause. 12 h dead-man self-stop. Manifest: service decl + `FOREGROUND_SERVICE`
  / `FOREGROUND_SERVICE_SPECIAL_USE` / `POST_NOTIFICATIONS` (plugin manifest, mirrored
  in the app manifest). **Decision made: `specialUse` (needs a Play Console
  declaration — see DEPLOY.md); `health` is the documented fallback.**
- **W11** — local recap notification when the app isn't foreground: Android posts
  from `RideMonitorService` (`ride-recap` channel); iOS posts via
  `UNUserNotificationCenter` in the plugin's `onRideDetected` (guarded on
  `applicationState != .active`). Dumb recap string mirrors `rideRecapSegments` in
  each native language. De-duped against the in-app toast (skipped when active).
- **W9** — **decision made: option B (iOS background location).** New
  `LocationKeepAlive` (CoreLocation) holds a low-accuracy background `location`
  session while monitoring so `CMMotionManager` survives screen-lock mid-ride;
  started/stopped by `RideRecorder` with the monitoring lifecycle. `Info.plist`:
  added `location` to `UIBackgroundModes` + `NSLocationAlwaysAndWhenInUseUsageDescription`.
  No iOS-specific "keep app open" copy (capture is now backgrounded on both
  platforms). App Review will scrutinize continuous background location — notes in
  DEPLOY.md. Deliberately the SAME capability the Living Layer needs (don't fork).

**Still open after Part 2:** device verification of all native halves per DEPLOY.md
G5–G8 (can't compile/run here); `bun cap sync`; the Play Console `specialUse`
declaration; and Part 3 field tuning.

---

## Findings index (severity-ordered)

| #   | Finding                                                                                                                                                                                                                                                             | Severity                                                                                                    | Workstream |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------- |
| F1  | Walking in-park triggers fake rides; no ride-signature or confidence gate anywhere                                                                                                                                                                                  | 🔴 Critical                                                                                                 | W1         |
| F2  | Capture dies when the phone is pocketed/locked (no iOS background mode, no Android foreground service) — contradicts PLAN.md B2's assumption                                                                                                                        | 🔴 Critical (device-gated)                                                                                  | W8, W9     |
| F3  | Recap feedback is at-most-once and fires exactly when the app can't show it; `user_ride_event` has no per-ride read-back UI                                                                                                                                         | 🟠                                                                                                          | W10, W11   |
| F4  | Device duration cap (360 s) == server Zod cap (`lte(360)`) with zero margin → whole-ride silent reject possible                                                                                                                                                     | 🟠                                                                                                          | W2         |
| F5  | iOS starts the altimeter only at ride trigger → lift hill invisible; iOS verticalM/maxDropM read systematically lower than Android                                                                                                                                  | 🟠                                                                                                          | W3         |
| F6  | Coaster clamp is inert (every `drop_height_m` in seed.csv is blank) AND its vertical check has the wrong basis (cumulative Σ\|Δalt\| vs 3× a single drop figure) — will false-reject once seeded                                                                    | 🟠                                                                                                          | W4         |
| F7  | Rejections are invisible (`errorToast: false`, no logging) — field testing can't distinguish reject from no-detect                                                                                                                                                  | 🟠                                                                                                          | W5         |
| F8  | Level-up celebration calls `toast.dismiss()` (all toasts) — eats the recap toast on exactly the best rides                                                                                                                                                          | 🟡                                                                                                          | W12        |
| F9  | Haptics are `navigator.vibrate` only — silent no-op in iOS WKWebView                                                                                                                                                                                                | 🟡                                                                                                          | W13        |
| F10 | Dedupe returns success indistinguishable from a fresh write → duplicate "Ride recorded" toasts                                                                                                                                                                      | 🟡                                                                                                          | W6         |
| F11 | `airtimeS` is `Math.round`ed per ride before accumulation → floor bias vs the 10 s first tier                                                                                                                                                                       | 🟡                                                                                                          | W7         |
| F12 | Seed gaps: 4 rows missing `track_length_m` (contribute 0 to trackmiles forever); `drop_height_m`/`max_height_m` mostly empty                                                                                                                                        | 🟡                                                                                                          | W14        |
| F13 | Achievement content never rides the push channel — correct for v1 (unlock ledger is at-least-once); only future case is a retroactive-credit digest                                                                                                                 | ℹ️ decision recorded                                                                                        | W15        |
| F14 | Null-valued keys vanish at the native→JS bridge (Android `JSONObject.put(k, null)` removes the key; iOS stored `Optional.none as Any`) → no-barometer devices sent `estTopSpeedKmh`/`altRel` with keys MISSING → Zod `.nullable()` rejected **every** no-baro trace | 🔴 was Critical — **FIXED** (server `.nullish()` + native explicit nulls; native halves compile-unverified) | done       |

---

# Part 1 — Server + client work (testable in this environment, do first)

## W1. Ride-signature gate (kills the walking false-positive) — F1 ✅ APPLIED (server + client; native confidence multiplier still pending)

**Evidence.**

- Start trigger: rolling 5 s variance of |specific force| > 1.5 (m/s²)² sustained 3 s
  (`RideConst.startVarThreshold` / `START_VAR_THRESHOLD`). Walking with a phone in a
  pocket produces variance well above this. End trigger = standing still 20 s. So
  walk ≥ ~23 s → stop (queue, kiosk) → a "ride" ≥ 20 s duration is computed and emitted.
- `confidence` is computed on device and Zod-bounded (`rides.ts` schema, `[0,1]`) but
  **never read** by the device emit path (`finishRecording` emits unconditionally on
  both platforms), the client listener (`achievement-tracker.tsx` submits every
  `rideDetected`), or the server (`ingestRideTrace` ignores it). PLAN.md B2's
  "`<0.5` → don't auto-submit" was never implemented.
- Even with that gate, walking scores ~0.55 (variance 0.35 + duration-band 0.2)
  because the confidence terms are additive with no mandatory ride-signature term.
- Server consequence: geofence passes (fresh in-park ping), nearest-attraction
  resolution within 120 m almost always resolves in dense areas, unanchored path sets
  `creditRideCount: true` → `user_attraction` +1 and `user_park_day.rides` +1 → inflates
  `rider` (500-tier) and `explorer` families, plus junk `user_ride_event` rows and
  recap-toast spam. Dedupe only throttles to one per attraction per ±5 min.

**Spec — three layers, server authoritative:**

1. **Shared predicate** in `src/lib/ride-metrics.ts` (pure, testable, imported by both
   client and server):

   ```ts
   /** A trace shows coaster-like evidence, not just walking jitter. */
   export function hasRideSignature(m: RideMetrics): boolean {
     return (
       m.dropCount >= 1 ||
       m.airtimeS >= 0.5 ||
       m.maxG >= 1.8 || // windowed-median g walking never reaches
       m.inversions >= 1
     );
   }
   ```

   Thresholds are starting points — expect field-tuning (see Part 3). Keep them in
   one exported const object so tuning is a one-file change.

2. **Server (authoritative)** — in `ingestRideTrace` after Zod parse, before the geo
   lookup: `if (!hasRideSignature(metrics)) throw PRECONDITION_FAILED("No ride
signature — looks like ordinary movement")`. Also gate `confidence >= 0.5` here
   (belt + suspenders; the device number is client-supplied so signature is the real
   defense, confidence is a tiebreak).

3. **Client** — in the `rideDetected` listener (`achievement-tracker.tsx`), skip the
   mutation when `!hasRideSignature(trace.metrics)`; record the suppressed trace in
   the debug ring (W5) so field testing still sees what the device detected.

4. **Device (both platforms)** — do NOT gate emission. Keep emitting every detection
   so the JS layer sees the raw stream during tuning. Instead, strengthen
   `computeConfidence`: make the low-g/drop term a multiplier, not an addend —
   `if drops == 0 && airtime < 0.5 { score *= 0.4 }` after the additive pass. Mirror
   in Swift + Kotlin.

5. **Optional hardening (decide, don't assume):** require a live dwell anchor
   (`state.anchorAttractionId != null`) for the unanchored `creditRideCount` path to
   bump `rides`/`user_attraction`, treating signature-only unanchored rides as
   metrics-only. This trades a real coverage loss (rides whose queue dwell was missed)
   for stronger anti-inflation. Recommend: ship the signature gate first, revisit
   after field data.

**Tests** (`src/server/achievements/rides.test.ts` + a new `ride-metrics.test.ts`):

- Walking fixture (durationS 45, dropCount 0, airtimeS 0, maxG 1.3, inversions 0,
  confidence 0.55) → PRECONDITION_FAILED, no rows written.
- Legit coaster fixture (2 drops, 3.8 g) → accepted.
- Boundary: maxG exactly 1.8 → accepted; 1.79 with nothing else → rejected.
- `hasRideSignature` unit table.

**Acceptance:** `bun vp check` clean; all rides tests pass; walking fixture cannot
credit any stat, ride count, or park-day row.

## W2. Duration cap margin — F4 ✅ APPLIED (see "Already fixed" above)

**Evidence.** Both `RideConst.maxDurationS` (iOS/Android) and the Zod bound
(`durationS: z.number().gt(0).lte(360)` in `rides.ts`) are 360. `finishRecording`
fires when `now - recordStart >= 360`, so computed `durationS = last.t - first.t`
can exceed 360 by up to a sample gap; `round1` usually lands 360.0 but a sensor
hiccup yields 360.1+ → the entire ride is rejected server-side, silently. The
360 s budget also includes the 10 s pre-trigger ring seed and up to 20 s quiet tail.

**Spec.** Set `maxDurationS = 345.0` in BOTH `RideDetection.swift` and
`RideDetection.kt`. Leave the Zod bound at 360 (now a real 15 s margin). Do not
touch the ±10 % wall-clock consistency check.

**Tests.** None new needed server-side; add a comment at the Zod bound noting the
device cap is 345 and the 15 s delta is deliberate margin.

## W4. Coaster clamp: fix the basis, then arm it — F6 ✅ APPLIED (basis fixed; arms once W14 seeds figures)

**Evidence.** `coasterClampReason` (`rides.ts`) checks
`metrics.verticalM > stats.dropHeightM * 3`. But `verticalM` is _cumulative_
Σ|Δaltitude| (up + down, whole ride): a single-drop coaster already accumulates
~2× its drop height (lift up + drop down); anything with mid-course hills sails
past 3×. Today this never fires because **every `drop_height_m` cell in seed.csv is
blank** — the clamp is inert, which also means it provides zero anti-spoof value.
The inversions check (`> published + 2`) is the only live clamp.

**Spec.**

1. Change the vertical check's basis to the _single largest drop_, which is what
   `drop_height_m`/`max_height_m` actually describe:
   ```ts
   // maxDropM is one descent; compare like-with-like, generous sensor margin.
   if (bound != null && metrics.maxDropM > bound * 1.5)
     return `maxDropM … exceeds 1.5× published …`;
   // where bound = stats.maxHeightM ?? stats.dropHeightM
   ```
   Requires adding `maxDropM` to the clamp input type and `max_height_m` to the
   query in `ingestRideTrace` step 2. Drop the `verticalM` check entirely (no
   published figure legitimately bounds a cumulative sum).
2. Keep reject-not-clamp semantics for the inversions check (a phantom-inversion
   trace is spoof-shaped), but note in a comment that this means one bad metric
   discards the ride — accepted trade-off, revisit with field data.
3. Seed data (W14) must be filled before this clamp does anything in prod.

**Tests.** Update the clamp unit tests: cumulative-vertical no longer rejects;
`maxDropM 40` vs `max_height_m 20` rejects; missing stats → null (unchanged).

## W5. Rejection & suppression visibility — F7 ✅ APPLIED

**Evidence.** `submitRideTrace` mutation uses `meta: { errorToast: false }`; server
rejects throw `PRECONDITION_FAILED` with a reason string that nobody ever sees.
During G6–G8 field runs, "nothing happened" is indistinguishable between
no-detection, client suppression (W1), and server rejection.

**Spec.**

1. Client-side module `src/lib/ride-debug-log.ts`: a module-level ring buffer
   (cap ~20) of `{ at, kind: "accepted" | "suppressed" | "rejected" | "duplicate",
reason?, metrics }`. Push from the `rideDetected` listener (suppressed), the
   mutation `onSuccess` (accepted/duplicate — see W6), and `onError` (rejected, with
   `err.message`).
2. Debug panel: new "Ride recorder" group in `error-test-panel.tsx` listing the ring
   (time · kind · one-line recap via `rideRecapSegments` · reason). Add a "Copy as
   JSON" action for filing tuning notes from the park.
3. PostHog: capture `ride_trace_rejected` (reason, confidence, durationS, maxG) and
   `ride_trace_suppressed` — server-truth telemetry for tuning thresholds across
   testers. Follow the existing named-event pattern (see `chunk_reload` usage).

**Acceptance:** every path through the listener/mutation lands exactly one ring
entry; panel renders without a signed-in admin crashing on empty ring.

## W6. Duplicate-submit flag — F10 ✅ APPLIED

**Evidence.** `ingestRideTrace` step 3 returns `evaluateAndUnlock(userId)` on dedupe —
shape-identical to a fresh accept — so the client re-shows "Ride recorded".

**Spec.** Return `{ ...evaluateAndUnlock result, duplicate: true }` on the dedupe
path (and `duplicate: false` on writes, keeping the type non-optional). Client skips
`showRideRecapToast` when `duplicate` (still logs to the W5 ring as "duplicate").

**Tests.** Dedupe fixture asserts `duplicate: true` and no recap-relevant state
change; fresh write asserts `duplicate: false`.

## W7. Airtime accumulation precision — F11 ✅ APPLIED (see "Already fixed" above)

**Evidence.** `rides.ts` step 6: `addStat(userId, "airtime_seconds",
Math.round(metrics.airtimeS))`. Typical per-ride airtime is 1–4 s; 0.4 s rides credit
0 against a 10 s first tier. `user_stat.value` is `double precision` — no storage
reason to round.

**Spec.** Pass the raw float for `airtime_seconds` and `vertical_m` (same issue,
smaller impact). Rounding stays at display time (`formatStatValue` already handles
it). Verify no test pins the rounded values.

## W10. Ride journal (durable recap) — F3 ✅ APPLIED

**Evidence.** Every accepted ride's full metrics are stored in `user_ride_event`,
but the only read-back is the per-attraction aggregate `achievements.myRideStats`
(consumed by `src/components/park-dashboard/ride-detail.tsx`). The recap toast is
the sole per-ride surface and it's 6 s long. No ledger, no replay (contrast the
unlock funnel's `notifiedAt`/`pendingUnlocks` at-least-once design).

**Spec.**

1. New query `achievements.myRideLog` (protectedProcedure):
   cursor-paginated (by `riddenAt DESC, id DESC`, page ~20) select from
   `user_ride_event` joined to `attractions` (name, slug) + `parks` (name, slug,
   timezone). Return `{ riddenAt, source, metrics, attraction: {…}, park: {…} }`.
   Exclude `trace` (audit blob, don't ship it to the client).
2. UI: a "Ride log" section — recommended placement: the achievements page (it
   already renders the sensor families; the log is their receipts). Each row:
   attraction name, park-local date/time, `rideRecapSegments(metrics)` joined with
   " · ", a `source` badge (`sensor` / `sensor+dwell`). Empty state copy for
   pre-native users ("Sensor-verified rides will show up here").
3. Reuse `rideRecapSegments` from `src/lib/ride-recap.ts` — do not re-format.

**Tests.** Router test for pagination + join shape; `rideRecapSegments` is already
covered (`ride-recap.test.ts`).

## W12. Recap vs level-up toast collision — F8 ✅ APPLIED

**Evidence.** `showUnlockToasts` leveled-up branch calls bare `toast.dismiss()`
(`unlock-toasts.tsx`) to clear the stack before the celebration — which also kills a
recap toast fired milliseconds earlier by the same `submitRideTrace` success handler.
Best-ride-ever is precisely when the recap gets eaten.

**Spec.** Track the achievement stack's own toast ids (the funnel already generates
`achv:*` ids) in a module-level set; replace `toast.dismiss()` with per-id dismissal
of known `achv:*`/`locnudge:*` ids. Alternative (simpler, acceptable): re-order in
`achievement-tracker.tsx` — fire `showRideRecapToast` _after_ `celebrate(...)`
returns when `newlyUnlocked.length > 0`... but the celebration is async (staggered
timeouts), so targeted dismissal is the correct fix; do that.

**Tests.** None automatable cheaply (sonner); verify by hand via debug panel
("Unlock next achievement" right after a synthetic recap — see W5 ring).

## W14. Seed data fill — F12 ✅ APPLIED (RCDB figures backfilled; cron + reevaluate still to run at deploy)

**Evidence.** `services/coaster-stats/seed.csv`: all 20 coaster rows have blank
`drop_height_m`; most blank `max_height_m`; 4 rows (trolls-trollercoaster,
hiccups-wing-gliders, mine-cart-madness, curse-of-the-werewolf) missing
`track_length_m`, so those rides contribute 0 m to `track_distance_m` forever.

**Spec.** Hand-curate the missing figures from RCDB pages (facts, not copyrightable;
do NOT scrape — house rule in the CSV header). Priority: `max_height_m` +
`drop_height_m` for every row (arms W4), then the 4 missing track lengths. Re-run
`bun run cron:coaster-stats` (idempotent upsert) and `achievements.adminReevaluateAll`
afterward so trackmiles credits retroactively.

---

# Part 2 — Native work (needs Xcode/Android Studio; device-verify per DEPLOY.md)

## W3. iOS: start the altimeter with monitoring — F5 ✅ APPLIED (compile-unverified native)

**Evidence.** `RideRecorder.swift`: `startAltimeter()` is called inside
`beginRecording()`, so the 10 s pre-trigger ring samples all carry `altRel: nil` and
relative altitude zeroes at the _trigger point_. Android's barometer runs from
arming (`basePressure` set on first pressure event), so its ring samples carry real
altitude. Consequences: iOS loses the lift-hill climb entirely (verticalM/maxDropM
systematically lower than Android for the same ride), and first-drop detection
(needs −4 m/s barometric descent) is disadvantaged if the trigger fires mid-drop.

**Spec.** Move `startAltimeter()` into `startMonitoring` (after
`motion.isDeviceMotionAvailable` guard); stop it only in `stopMonitoring`. Remove
the start from `beginRecording`. CMAltimeter is ~1 Hz — battery impact negligible
against the IMU. `relAltitude` continuity across multiple rides in one arming
session is fine: all metrics use relative deltas/drawdowns within a capture.

**Verify.** Simulator can't do barometer — this is a G6 field check: compare
verticalM for the same coaster iOS vs Android after the change (should converge).

## W8. Android: foreground service for capture survival — F2 ✅ APPLIED — specialUse FGS (compile-unverified; needs Play Console declaration)

**Evidence.** PLAN.md B2 specified "Foreground service while monitoring"; the
shipped plugin has none (no `Service`, no wakelock — `RideRecorder.kt` runs a bare
`HandlerThread` in the WebView process). Screen-off → cached-app freezing stops
sensor delivery; Capacitor pauses WebView JS, so even a completed detection can't
submit until resume.

**Spec (outline — implementer must verify current Play policy details):**

1. `RideMonitorService : Service` inside the plugin package. `startForeground` with
   a minimal, low-importance ongoing notification ("ParkFi is watching for rides —
   only while you're in the park"). The service owns the `RideRecorder` instance;
   the plugin binds/talks to it.
2. `foregroundServiceType`: **decision needed** — `health` (semantically right,
   needs `FOREGROUND_SERVICE_HEALTH` + an associated runtime permission on API 34+)
   vs `specialUse` (escape hatch, needs a Play Console declaration). Research the
   current policy before wiring the manifest; do not guess.
3. Partial wakelock while _recording_ only (not monitoring) if field tests show
   sensor gaps with screen off despite the service.
4. `POST_NOTIFICATIONS` runtime permission: already in the app's flow via
   `@capacitor/push-notifications` registration — confirm ordering (service must not
   start before the grant on API 33+; degrade to foreground-only monitoring if denied).
5. Lifecycle: `startMonitoring` starts the service; `stopMonitoring` (park exit,
   tracker unmount, logout) stops it. The service must also self-stop on a
   12 h dead-man timer — never outlive a park day because a disarm was missed.
6. `rideDetected` while WebView is paused: hold the result in the service and flush
   through `notifyListeners` with `retainUntilConsumed` semantics
   (Capacitor: `notifyListeners(event, data, /* retainUntilConsumed */ true)`) so
   the JS gets it on resume even if no listener was attached at fire time. This
   pairs with W11 (the local notification is the user-visible half).

**Verify (device-gated):** G5/G6 with screen locked — sensors keep sampling, a ride
detected while pocketed lands in JS on unlock, and the submit succeeds.

## W9. iOS capture posture — decision, then (maybe) code — F2 ✅ APPLIED — option B (iOS background location; compile-unverified; App Review scrutiny expected)

**Evidence.** `ios/App/App/Info.plist` `UIBackgroundModes` = `remote-notification`
only. No `location` mode exists despite PLAN.md B2's note assuming one. Locked
screen → app suspends in seconds → `CMMotionManager` stops mid-ride. iOS sensor
detection currently works only phone-in-hand, screen on — which coaster loading
procedures prohibit.

**Options (pick one; recommend A for v1):**

- **A. Accept foreground-only on iOS v1.** No code beyond honesty: iOS sensor
  achievements become opportunistic (pre-lock capture window, rides where the phone
  is legal to hold — family coasters, dark rides that trip the variance gate).
  Ensure copy never promises automatic detection on iOS. Ship, gather Android field
  data, revisit.
- **B. Add `location` background mode** + significant-change location so the app
  stays alive in-park. Real costs: App Review scrutiny (must justify continuous
  background location), battery, privacy copy. It IS on the roadmap anyway for the
  Living Layer — if B is chosen, coordinate with that plan rather than doing a
  one-off.
- **C. Manual record affordance:** surface `startRecording()`/`stopRecording()`
  (already implemented on both platforms, currently unused by any UI) as an explicit
  "I'm boarding" button — works with the screen locked afterward? NO — same
  suspension applies. C only helps combined with B. Park it.

**Deliverable if A:** a short section in DEPLOY.md documenting the platform
asymmetry + a `nativePlatform() === "ios"` copy tweak wherever sensor achievements
are pitched (check the achievements page empty states).

## W11. Local notification recap — F3 ✅ APPLIED (compile-unverified native)

**Evidence.** The recap's natural moment (phone comes out of pocket after the ride)
is exactly when the WebView was suspended. A lock-screen notification is the right
surface, and it does NOT need FCM: server push would require `submitRideTrace` to
have already happened (JS alive), at which point the toast works anyway. Local,
on-device notification at detection time sidesteps the whole problem.

**Spec.**

- Android: post from `RideMonitorService` at `rideDetected` — title "🎢 Ride
  recorded", body from the same segments logic (port `rideRecapSegments`'s rules or
  build the string in Kotlin from the metrics map — keep it dumb: drops · g ·
  airtime). Tap → launch intent → app opens; the retained `rideDetected` event
  (W8.6) then drives the submit + real toast/unlock flow.
- iOS: `UNUserNotificationCenter` add when `UIApplication.shared.applicationState
!= .active` at detection time. Under option W9-A this fires rarely
  (backgrounded-but-not-yet-suspended window); under W9-B it becomes the primary
  recap surface. Cheap either way; permission is shared with push registration (A4).
- De-dupe with the in-app toast: if the app is active, skip the notification (both
  platforms).

## W13. Native haptics — F9 ✅ APPLIED (needs bun install + cap sync)

**Evidence.** `src/lib/vibrate.ts` uses `navigator.vibrate`, undefined in WKWebView —
every unlock/level-up celebration is silent on iOS native. The file's own comment
acknowledges the API gap; on native the fix exists.

**Spec.** Install `@capacitor/haptics`. In `vibrate.ts`, branch on `isNative()`
(dynamic-import the plugin so web bundles don't grow — follow the
`native-push-client.ts` pattern): map `vibrateUnlock(tier)` to a sequence of
`Haptics.impact({ style })` calls (Light×(tier−1), then Medium, then Heavy finale)
and `vibrateLevelUp()` to `Haptics.notification({ type: Success })` after a short
impact run. Keep the exported API identical; web path unchanged. `bun cap sync`
after install.

---

# Part 3 — Field-tuning protocol (after Parts 1–2, on hardware)

The detection constants have never seen a real accelerometer trace. Run DEPLOY.md's
G5–G8 protocol with the W5 debug ring + PostHog events as the data channel:

1. **Negative controls first** (no park needed): 30-min walk, car ride, elevator,
   stairs, bus. Expected: detections may fire (variance gate is loose by design) but
   every one must be _suppressed_ (W1 client gate) or _rejected_ (W1 server gate) —
   zero credited rides. Any credit = tighten `hasRideSignature` thresholds.
2. **Positive controls**: a real coaster with published figures (Hulk: 7 inversions;
   VelociCoaster: 4). Check per-metric plausibility and iOS-vs-Android convergence
   (W3). Log `confidence` distributions — pick the final gate from data, not vibes.
3. **Reachability calibration** (for the catalog, after data exists): current tier
   math implies `gforce` 4.5 g ≈ Rock 'n' Roller Coaster only; `inversions` 100 ≈
   7+ dedicated loop days; `vertical` 8,849 m inflated by baro noise until tuned.
   Re-cut thresholds only AFTER real distributions exist — additive catalog changes
   only (never renumber existing tier ids; users hold them).

---

## Ordering & dependency graph

```
W1 (signature gate) ──┬─ do first, blocks meaningful field data
W2 (duration margin) ─┤
W4 (clamp basis) ─────┼─ pure TS + tests, no device
W5 (debug ring) ──────┤   (W5 before any field run)
W6 (dupe flag) ───────┤
W7 (airtime float) ───┤
W10 (ride journal) ───┘
W14 (seed fill) ────── data-only; arms W4 in prod; rerun cron + adminReevaluateAll

W3 (iOS altimeter) ─── small Swift change, verify at G6
W8 (Android FG service) ─┬─ the capture-survival pair; W11 hangs off W8
W9 (iOS posture) ────────┘   decision before store copy is written
W11 (local notif recap) ── after W8; iOS half after W9 decision
W13 (haptics) ──────────── independent, any time

Part 3 field protocol ──── after W1+W5 minimum; ideally after W3+W8
```

**Per-phase gate:** `bun vp check` (0 errors) + `bun vp test` after every
workstream. Native builds: `NATIVE_BUILD=1 bun vp build` must stay green; plain
`bun vp build` byte-identical for web.

## Explicit non-goals (decided, don't drift)

- **No FCM/web push for achievements or recaps in v1** (F13). The unlock ledger is
  already at-least-once; the recap's reliable channel is local notification (W11).
  Only future revisit: a single digest push if `adminReevaluateAll` retroactive
  credit runs become routine.
- **No raw 50 Hz trace upload** — the ≤600-sample 4 Hz downsample cap stands.
- **No renumbering/removal of existing catalog tier ids.**
- **No `TRACK_EVENTS` additions for sensor keys** — they must stay server-written.
