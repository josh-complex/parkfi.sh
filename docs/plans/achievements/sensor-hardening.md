# Sensor achievements hardening plan

_2026-07-18. Follow-on to `docs/plans/capacitor-native/FOLLOWUP.md` (W-numbers) from a
full-system review of the native ride-detection pipeline. Workstreams here are
S-numbered; they do not supersede any W item — cross-references inline. Everything
native remains compile-verified only until the Phase E field protocol runs._

## Findings → workstreams

| #   | Finding                                                                                               | Severity           | Fix      |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------ | -------- |
| F-A | iOS monitoring unbounded after backgrounded park exit (no dead-man, disarm needs a foreground ping)   | 🔴 battery/privacy | S8       |
| F-B | Background-detected rides rejected: 15-min ping freshness measured at submit time, pings pause hidden | 🔴 correctness     | S1, S10  |
| F-C | Baro EMA hardcodes dt = 0.1 s while capture runs 50 Hz → drops undercounted, maxDropM lags            | 🔴 detector        | S4       |
| F-D | Confidence ×0.4 collapse contradicts `RIDE_SIGNATURE` → maxG/inversion-only rides unsubmittable       | 🔴 detector        | S2, S5   |
| F-E | iOS Motion & Fitness denial: `baroAvailable=true` with all-nil altitude → worse than no barometer     | 🟠                 | S6       |
| F-F | Android screen-off capture unverified vs SoC suspend (no wakelock; non-wakeup sensors)                | 🟠 (device-gated)  | V1       |
| F-G | iOS `requestAlwaysAuthorization` stacked on WhenInUse; Always likely unneeded; 2.5.4 review risk      | 🟠 store           | S8, S11  |
| F-H | Nudge toast promises "Only used while the app is open" while iOS asks for background location         | 🟠 trust           | S11      |
| F-I | Prompt stacking at first park entry (motion + location upgrade, no pre-explanation)                   | 🟡                 | S12      |
| F-J | `HIGH_SAMPLING_RATE_SENSORS` unnecessary (gates >200 Hz; we sample ≤50 Hz)                            | 🟡                 | S13      |
| F-K | W8.4 POST_NOTIFICATIONS degradation never implemented (silent FGS when notifications denied)          | 🟡                 | S13      |
| F-L | Retained `rideDetected` events lost if app killed while backgrounded                                  | 🟡                 | S9       |
| F-M | Rate/parity drift: Android `MONITOR_HZ`/`ACTIVE_HZ` unused (~16.7 Hz actual); gyro runs in monitoring | 🟡 battery         | S7       |
| F-N | iOS `deviceMotion` monitoring keeps the gyro powered ("accel-only, cheap" comment is wrong)           | 🟡 battery         | S7 (opt) |
| F-O | Android recap notification fixed `RECAP_ID` — consecutive rides overwrite the recap                   | ⚪                 | S14      |
| F-P | ±5 min same-attraction dedupe eats genuine short-cycle re-rides                                       | ⚪                 | S3       |

## Phasing and rationale

- **Phase A (server-only, deploy immediately):** S1, S2, S3. No app release needed;
  also compensates for old client binaries in the field (version skew).
- **Phase B (native detector correctness):** S4, S5, S6, S7. Must land **before**
  the Part-3 field-tuning protocol — otherwise thresholds get tuned against a
  broken drop detector and a self-contradicting confidence score.
- **Phase C (lifecycle & battery bounds):** S8, S9, S10. Same store build as B.
- **Phase D (permissions, copy, store posture):** S11, S12, S13, S14. Same build;
  S11/S12 need a product decision first (see Decisions).
- **Phase E (device-gated field verification):** V1–V5, per
  `device-test-tooling.md`. Gates store submission.

One store build carries B+C+D. Server A ships ahead and is forward-compatible.

## Decisions needed (before Phase D starts)

1. **D1 — iOS location authorization: drop `requestAlwaysAuthorization` (recommended).**
   WhenInUse + `UIBackgroundModes: location` + `allowsBackgroundLocationUpdates`
   keeps fixes flowing after screen lock and shows the status-bar location
   indicator (a transparency feature here). Always adds no capability we use and
   costs the scariest prompt in iOS. Keeping Always is only right if the Living
   Layer has a concrete near-term need for suspended-state wakeups.
2. **D2 — iOS accel-only monitoring (S7 optional half).** Cuts monitoring-mode gyro
   power at the cost of the 10 s pre-trigger ring lacking gravity/gyro channels
   (first-seconds inversions missed — lift hills, so ~never). Recommended, but it
   changes ring semantics; decide before implementing S7 on iOS.
3. **D3 — Android notifications-denied posture (S13).** W8.4 says degrade to
   foreground-only monitoring. Alternative is running the FGS anyway (legal; the
   OS hides the notification). Recommend honoring W8.4 — silent background sensing
   is the exact optics the ongoing notification exists to prevent.

---

## Phase A — server-first correctness

### S1. Ride-time-relative geo freshness (F-B server half)

**Evidence.** `isPingFresh(state.at, now)` in `src/server/achievements/rides.ts`
measures against submit time. Pings pause while the WebView is hidden
(`achievement-tracker.tsx` visibility check), which is the normal pocketed state
the W8/W9 background-capture machinery exists for. A ride detected mid-pocket and
flushed on resume >15 min after the last ping is rejected and permanently lost.

**Spec.**

- Change the freshness rule to be relative to the **ride**, not the submit:
  accept when `state.at` falls within `[startedAt − QUEUE_WINDOW_MS, now]`, with
  `QUEUE_WINDOW_MS = 90 min` (longest realistic pre-show + queue with the phone
  pocketed). `state.parkId` must still be set. Rationale: the anti-spoof core is
  "this user was verifiably inside a park geofence shortly before the ride began";
  the couch-shake case stays rejected because the last in-park ping ages out.
- Attraction resolution: prefer the dwell anchor **only if** `state.at` is within
  the old 15-min window; otherwise fall through to nearest-attraction against the
  last ping coords (stale coords are typically the queue entrance — which is the
  attraction being ridden — so this degrades well).
- Return a **distinct error code** for freshness rejection (e.g. message key
  `STALE_GEO`) so the client retry path (S10) can distinguish it from permanent
  rejections.
- Keep the published-stats clamp, signature gate, and dedupe unchanged — they are
  the compensating controls that make the wider window safe.

**Verify.** Extend `rides.test.ts`: ping at T, ride start T+70 min → accepted with
nearest-attraction resolution; ride start T+100 min → rejected; anchor honored at
T+10 min, ignored at T+40 min.

### S2. Server tolerance for collapsed-confidence clients (F-D server half)

**Evidence.** Fielded binaries compute `confidence *= 0.4` whenever
`drops == 0 && airtime < 0.5`, capping the score at 0.3 < the 0.5 floor even when
maxG/inversion evidence is strong. Fixing the native formula (S5) doesn't fix
already-installed apps.

**Spec.** In `ingestRideTrace`, bypass the 0.5 floor when the metrics carry
signature-grade evidence the collapse ignores: `maxG ≥ RIDE_SIGNATURE.minMaxG` or
`inversions ≥ RIDE_SIGNATURE.minInversions` (import the constants — no magic
numbers). The floor still applies to drop/airtime-evidenced traces (defense in
depth against forged low-effort metrics). Comment it as version-skew tolerance,
removable after the S5 build is the fleet floor.

**Verify.** Unit test: trace with `maxG 3.2, confidence 0.3` accepted; trace with
`maxG 1.2, dropCount 1, confidence 0.3` still rejected.

### S3. Dedupe refinement for short-cycle re-rides (F-P, minor)

**Spec.** Keep the ±5 min window, but exempt when the stored event's
`metrics.endedAt` precedes the new `startedAt` by ≥ 60 s (walk-off-and-reboard
minimum). Reads the stored jsonb of the one candidate row — no schema change.
Low priority; do last in Phase A.

**Verify.** Unit test both sides of the 60 s boundary.

---

## Phase B — native detector correctness (Swift + Kotlin in lock-step)

### S4. Real per-sample dt in the barometric EMA (F-C)

**Evidence.** iOS: `let dt = smoothed.isEmpty ? 0.1 : 0.1` (literal leftover),
Kotlin: `exp(-0.1 / tau)`. Capture runs 50 Hz (dt = 0.02 s) → effective smoothing
time constant ~5 s instead of 1 s → dz/dt flattened → the −4 m/s drop detector
undercounts and `maxDropM` lags. This corrupts the signature gate, confidence,
and any field tuning done on top.

**Spec.** Use each sample's actual `dt = s[i].t − s[i−1].t`, clamped to
[0.001, 0.5] s (guards timestamp glitches and gap-spanning samples). Mirror
exactly in `RideDetection.swift` + `RideDetection.kt`.

**Verify.** New native unit tests (see S-test below): synthesize a 40 m descent at
−8 m/s sampled at both 10 Hz and 50 Hz; both must count 1 drop and report
maxDropM within 10% of truth. Current code fails the 50 Hz case.

### S5. Align the confidence collapse with `RIDE_SIGNATURE` (F-D native half)

**Spec.** Add to `RideConst` (both platforms, with a mirror-comment to
`RIDE_SIGNATURE` in `src/lib/ride-metrics.ts`): `SIG_MAX_G = 1.8`,
`SIG_MIN_INVERSIONS = 1`. Collapse becomes: multiply by 0.4 only when
`drops == 0 && airtime < 0.5 && maxG < SIG_MAX_G && inversions < SIG_MIN_INVERSIONS`
— i.e. only traces the client gate would suppress anyway. Update the W1 comments
on both platforms.

**Verify.** Unit test: inversion-heavy zero-airtime trace scores ≥ 0.5.

### S6. Honest barometer availability (F-E)

**Evidence.** iOS sets `baroAvailable` from hardware presence; a Motion & Fitness
denial means `CMAltimeter` never delivers, every `altRel` is nil,
`computeBaroMetrics` smooths a flat zero series (0 drops, 0 vertical), and the
no-baro low-g fallback never runs.

**Spec.** Two layers:

1. **Compute-time (both platforms, the robust one):** in `RideMetricsComputer`,
   derive `baroUsable = baroAvailable && samples contain ≥1 non-nil altRel`; use
   `baroUsable` for the metrics path and report it as the `baroAvailable` flag.
   Covers denial, sensor failure, and any future cause identically.
2. **Arm-time (iOS):** in `startMonitoring`, also gate on
   `CMAltimeter.authorizationStatus() == .authorized` so the flag is honest from
   the start and the low-g fallback engages immediately.

**Verify.** Unit test: all-nil-altRel trace with `baroAvailable=true` input →
falls back to `countLowGDrops`, reports `baroAvailable=false`.

### S7. Sampling-rate parity + monitoring-mode gyro power (F-M, F-N)

**Spec.**

- **Android:** replace `SENSOR_DELAY_UI`/`SENSOR_DELAY_GAME` with explicit
  `samplingPeriodUs` derived from `MONITOR_HZ` (100_000 µs) and `ACTIVE_HZ`
  (20_000 µs) — the constants become real and both platforms monitor at 10 Hz.
  Register the **gyro only from `beginRecording`** (the start trigger is
  accel-variance only); keep gravity registered (ring seeding needs it; it's
  accel-derived and cheap). Unregister gyro again in `finishRecording`.
- **iOS (behind D2):** monitoring mode via `startAccelerometerUpdates` at 10 Hz
  computing |a| directly; escalate to `deviceMotion` at trigger. Ring samples
  during monitoring carry `gyroDegS = 0` and gravity from a simple low-pass of
  raw accel; document that pre-trigger inversions aren't detectable (lift hills —
  acceptable). Fix the "accel-only, cheap" comment either way.

**Verify.** Debug-ring sample-rate assertion in a manual couch recording (existing
C3 tooling); V2 battery measurement quantifies the win.

### S-test. Native unit-test scaffolding (enables S4–S6 verification)

`RideMetricsComputer` is pure on both platforms but has zero tests. Add a JUnit
target to `packages/ride-recorder/android` and an XCTest target to the SPM
package, with a tiny shared-fixture generator (synthetic descent, airtime pulse,
inversion rotation, walking jitter) ported to each. These are the same shapes the
JS synthetic-trace panel uses (Layer C1) — keep the numbers in step so native and
JS QA agree.

---

## Phase C — lifecycle & battery bounds

### S8. iOS dead-man + native geofence self-disarm; Android passive parity (F-A, F-G)

**Evidence.** Disarm requires a foreground ping to flip `inPark` false. iOS has no
dead-man; the keep-alive prevents suspension indefinitely → leave the park
backgrounded and 10 Hz fusion + continuous location runs until the app is next
opened. Android is bounded but still burns up to 12 h post-exit.

**Spec.**

- **iOS dead-man:** 12 h `DispatchSourceTimer` armed in `startMonitoring`,
  cancelled in `stopMonitoring`, firing `stopMonitoring()` — mirror of Android's.
- **Native geofence self-disarm (both platforms):** `startMonitoring` gains
  optional `armLat`/`armLng`/`armRadiusM` (JS passes the current fix from
  `coordsRef` and a 3 km default at arm time). iOS: `LocationKeepAlive`'s
  delegate — whose fixes are currently discarded — now checks distance from the
  arm center; outside the radius sustained 10 min → stop monitoring. Android: a
  `LocationManager.PASSIVE_PROVIDER` listener in `RideMonitorService` (zero
  battery — piggybacks other apps' fixes; park visitors' phones fix constantly),
  same rule. Falls back to dead-man-only when no fixes arrive.
- This also converts the iOS background location from "keep-alive with discarded
  fixes" (the 2.5.4 rejection pattern) into location that is genuinely consumed —
  update the `LocationKeepAlive` doc comment, which currently self-incriminates.

**Verify.** V5 field check; simulator: `adb emu geo fix` / Xcode location
simulation driving an exit → service stops within 15 min, confirmed in the debug
panel.

### S9. Persist undelivered ride traces (F-L)

**Evidence.** `retainUntilConsumed` retention is in-memory; an app killed while
backgrounded (common overnight) loses the detected ride.

**Spec.** On detection, both platforms append the `RideResult` JSON to a small
on-disk pending queue (iOS: file in Application Support; Android: file written by
the service; cap 10, FIFO). New plugin method `drainPendingTraces(): { traces: RideTrace[] }`

- `clearPendingTrace(id)` — each queued trace gets a UUID. The JS tracker drains
  on mount and on `resume`, runs each through the existing `useDetectedRideHandler`
  funnel, and clears on submit success **or** terminal rejection (not on `STALE_GEO`,
  which S10 retries). Server dedupe makes redelivery idempotent, so at-least-once
  is safe.

**Verify.** Manual-record a trace, force-kill the app, relaunch → recap toast +
submit fire once; second relaunch → nothing (cleared).

### S10. Stale-flush ordering + one retry (F-B client half)

**Spec.** In the tracker: record `lastPingAt` on each successful ping. When a
trace arrives (live event or S9 drain) and `lastPingAt` is older than 10 min,
fire one immediate ping (reuse the tick body) and submit after it settles
(2 s timeout — don't hold traces hostage to a slow fix). On a `STALE_GEO`
rejection, keep the trace and retry once after the next successful ping. All
other rejections stay terminal. Log each transition to the debug ring.

**Verify.** Dev-sim: arm Layer A, freeze pings 20 min, inject a synthetic trace →
observe ping-then-submit ordering and the retry path in the ring.

---

## Phase D — permissions, copy, store posture

### S11. iOS location authorization simplification (F-G, F-H; needs D1)

**Spec (assuming D1 = drop Always).**

- `LocationKeepAlive.start()`: remove both authorization requests. Guard instead:
  if status is not `.authorizedWhenInUse`/`.authorizedAlways`, don't start the
  session (capture degrades to foreground-only — the W9-A posture). WhenInUse is
  in practice always granted before arm, because arming is downstream of a
  granted geolocation ping loop.
- `Info.plist`: keep `NSLocationAlwaysAndWhenInUseUsageDescription` (harmless,
  required if Always is ever granted externally) but rewrite it to describe
  in-park ride detection without instructing users to pick "Always". Rewrite
  `NSLocationWhenInUseUsageDescription` to mention the brief background use.
- **Copy fix (F-H):** nudge toast in `achievement-tracker.tsx` — replace
  "Only used while the app is open. Never shared." with
  "Used while you're in the park — including briefly in the background during
  rides. Never shared." Audit other sensor-achievement pitch copy
  (achievements page empty states, store listing) for the same promise.

**Verify.** Fresh install run-through: exactly one location prompt (the existing
ping-loop one), no Always prompt, background capture still works screen-locked
(V4), blue indicator visible while armed.

### S12. Pre-arm consent sheet — fixes prompt stacking (F-I)

**Spec.** First time an arm would fire on native (per-device flag in
`@capacitor/preferences`), don't arm; instead show a one-time sheet: "Track your
rides automatically? ParkFi uses motion sensors while you're in the park to
detect coasters — drops, airtime, g-force." Accept → set flag, arm (the Motion &
Fitness prompt now fires in context, alone). Decline → snooze re-offer 14 days
(reuse the locnudge snooze pattern). The sheet also carries the notification
rationale on Android when POST_NOTIFICATIONS isn't yet granted. This gives App
Review a clean consent narrative and users one decision at a time.

**Verify.** Fresh-install flow on both platforms: sheet → single OS prompt →
armed; decline path leaves native fully cold.

### S13. Android manifest cleanup + notifications-denied degradation (F-J, F-K; needs D3)

**Spec.**

- Remove `HIGH_SAMPLING_RATE_SENSORS` from both the plugin and app manifests and
  correct the comment (permission gates >200 Hz; `SENSOR_DELAY_GAME`/50 Hz is
  free). Shrinks the Play data-safety surface.
- Degradation (D3 = honor W8.4): in `startMonitoring`, check
  `NotificationManagerCompat.areNotificationsEnabled()`. If disabled, skip the
  FGS and run the recorder in-process on its `HandlerThread` (foreground-only
  capture — same class, no service). Surface a hint in the achievements UI:
  "Enable notifications for background ride tracking."
- Finalize the Play Console `specialUse` declaration text (subtype property
  string already written) at submission time; keep `health`+`FOREGROUND_SERVICE_HEALTH`
  as the documented fallback if review pushes back (FOLLOWUP W8).

**Verify.** Notifications denied → no FGS, in-app detection still works; enabled →
FGS with ongoing notification as today.

### S14. Unique Android recap notification ids (F-O)

**Spec.** Derive the notify id from the detection timestamp (`(endedAt/1000) % Int.MAX`)
so consecutive rides stack instead of overwriting. iOS already does this.

---

## Phase E — field verification protocol (device-gated, per `device-test-tooling.md`)

| ID  | Check                                                                                                                                                                                  | Gate for                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| V1  | **Android screen-off continuity** (F-F): manual-record a 10-min pocketed walk; inspect debug-ring sample gaps. Gaps → add partial wakelock during _recording only_ (W8.3) and re-test. | Android background story |
| V2  | **Battery**: 2 h armed idle session — Instruments Energy Log (iOS), Battery Historian (Android). Acceptance: ≤3%/h iOS, ≤2%/h Android.                                                 | Store submission         |
| V3  | **verticalM convergence** iOS vs Android on the same coaster (W3 check, meaningful only after S4).                                                                                     | Field tuning             |
| V4  | **End-to-end background ride**: phone locked through a full ride → local recap notification → unlock → submit succeeds (proves S1+S9+S10 together).                                    | Store submission         |
| V5  | **Park-exit self-disarm**: leave the geofence backgrounded; monitoring stops ≤15 min (S8), confirmed via debug panel + OS battery attribution next morning.                            | Store submission         |

## Rollout & sequencing summary

```
Phase A (server)  ── deploy now; S2 marked removable post-fleet-upgrade
Phase B (native)  ─┬─ one store build, blocks field tuning
Phase C (native)  ─┤
Phase D           ─┘  D1–D3 decided first; S11/S12 copy + consent in same build
Phase E           ── on-device, gates store submission; V1 may add the wakelock
```

Version skew rule: the server must accept traces from pre-B binaries for as long
as they exist in the field — S1 and S2 are exactly that tolerance; do not tighten
them until the B build is the enforced minimum app version.
