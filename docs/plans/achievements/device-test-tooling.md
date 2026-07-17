# Achievements — couch-testing tooling for native device builds

Goal: exercise **every** achievement path end-to-end on local iOS/Android device
builds without being in a park. Written 2026-07-17 against the current tree.

The guiding principle: **simulate at the narrowest point that still exercises
the real pipeline.** Faking DB rows tests the catalog math but skips the engine;
faking unlocks tests only the toast. The tooling below injects at the _inputs_
(coords, traces, clock) so everything downstream — `ingestPing`'s dwell state
machine, `ingestRideTrace`'s gates, `evaluateAndUnlock`, the toast/haptic/
notification funnel — runs for real.

---

## What already exists (build on, don't duplicate)

| Tool                                       | Where                                                    | Covers                                                                   |
| ------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `devUnlock` / `devReset` / `devResetRides` | `achievements.ts` router (adminProcedure, caller-scoped) | Unlock toast/haptic/level-up funnel on demand; replay from zero          |
| Admin page (search / revoke / reset stats) | `admin.achievements.tsx`                                 | Revoke→re-earn loop, stat inspection for any user                        |
| Ride debug ring + panel section (W5)       | `ride-debug-log.ts`, `error-test-panel.tsx`              | Visibility into detected-trace fates (accepted/suppressed/rejected/dupe) |
| `nav-test-tools` PostHog flag pattern      | `feature-flags.ts`, `ErrorTestPanel` gating              | Ships QA UI in **prod/TestFlight builds** to admin accounts only         |
| `adb emu geo fix`                          | memory: android-emulator-nav-debugging                   | Emulator-only location spoofing                                          |

What's _not_ covered today: nothing can drive the **geo ping pipeline**
(park detection → distance/presence → queue dwell → settle) or the **sensor
ride pipeline** (fresh-ping anchor → trace gates → sensor stats) from a couch.
`DevLocationPanel` on the map deliberately never mocks location — it only sets
nav destinations.

## What makes each family couch-untestable today

1. **Geo-derived** (park days, distance, park hours, queues, rides-via-dwell,
   ride explorer, park hop): need coords inside a park polygon, and _time_ —
   30 s ping cadence, ≥8 min dwell, day rollovers.
2. **Clock-gated** (rope drop <9:30 local, night owl ≥22:00, dawn-to-dusk):
   need the right park-local wall-clock time. Server uses `new Date()` only.
3. **Calendar-derived** (streaks, weekend days): need multiple consecutive
   real days.
4. **Weather** (rainy): needs a `weather_obs` row with rain in the last 2 h.
5. **Sensor** (drops, airtime, max-G, inversions, vertical, trackmiles): need a
   native `rideDetected` trace that passes `hasRideSignature`, plus a fresh
   in-park ping to anchor attribution (`RIDE_FRESH_WINDOW_MS`), plus the
   coaster clamp against published figures.
6. **Event counters**: already testable — just use the app (or fire via panel).

---

## Layer A — on-device location simulator (client-only, no server changes)

**The highest-leverage piece.** A sim source that, when armed, substitutes
coords into the _existing_ client loop — `AchievementTracker`'s `coordsRef` and
(optionally) `useGeolocation` consumers — so the device sends real
`achievements.ping` mutations every 30 s with simulated positions. The server
runs everything authentically on its own clock. No new trust surface: `ping` is
already `protectedProcedure` and already trusts client coords by design.

Build:

- `src/lib/dev-geo-sim.ts` — a module-level store (same idiom as
  `ride-debug-log.ts`): `armSim(source)`, `disarmSim()`, `getSimCoords()`,
  `useGeoSim()`. Sources:
  - **Teleport**: fixed point (park entrance, or any attraction's coords).
  - **Walk**: interpolate between waypoints at a configurable real speed
    (≤ `WALK_SPEED_CAP_MS` = 2.5 m/s, or deliberately faster to test the clamp).
  - **Queue**: hold within `QUEUE_ENTER_RADIUS_M` (40 m) of a chosen
    attraction, with ±10 m jitter to look organic and test hysteresis.
  - **Exit**: step outside the polygon (tests anchor settle + disarm edge).
- `use-geolocation.ts` — if sim is armed, emit sim coords as `granted` state
  (small guard at the top of the watch callback, dev/flag-gated, tree-shaken
  from normal prod paths via the flag check).
- Dev panel card (new section in `ErrorTestPanel`, or a sibling
  `GeoSimSection`): park picker → attraction picker (reuse the tRPC attraction
  list queries) → Teleport / Walk / Queue at / Exit buttons + "armed" indicator
  showing current sim coords and last ping's `inPark`/`today` response.
- Optional: a "fast ping" toggle that drops `PING_INTERVAL_MS` to ~5 s while
  the sim is armed, so a queue dwell doesn't need 16 pings × 30 s of waiting
  (the server accrues dwell from _elapsed wall time_, so faster pings don't
  cheat time — see Layer B for that — but they make state transitions visible
  immediately).

What this proves on a real device: park-entry detection, the in-park UI, the
locnudge suppression, distance/presence accrual, **the arm/disarm edge for the
native RideRecorder** (so the IMU monitor genuinely arms at home), and — with
patience or Layer B — queue dwells.

Guardrails: gate on `import.meta.env.DEV || useNavTestToolsEnabled()` exactly
like `ErrorTestPanel`; skip/flag PostHog captures while armed so sim sessions
don't pollute funnel analytics.

## Layer B — time-warp scenario runner (admin tRPC + small engine refactor)

Real time is the enemy: 8-minute dwells, 9:30 rope-drop windows, 7-day streaks.
Fix it server-side, where the clock already lives.

- **Refactor**: thread an explicit `now: Date = new Date()` parameter through
  `ingestPing` (it already computes `now` once at the top and passes it down —
  the change is mechanical). The public `ping` procedure never forwards a
  client time; only the new admin procedure may.
- **`adminSimulateScenario`** (adminProcedure, acts on the caller's own
  account): takes a script — `[{ lng, lat, accuracy, atOffsetS }]` plus a
  `startAt` — and replays it through the real `ingestPing` with the injected
  clock. A six-hour park day executes in under a second and produces _exactly_
  the rows a real day produces: dwell settles, rope-drop/night-owl flags,
  presence deltas, `user_attraction` rows, streak-able day keys.
- **Scenario presets** (in code, next to the catalog): `fullParkDay` (rope
  drop → three 10-min queues → night owl), `parkHopDay`, `weekendPair`,
  `streak(n)` (loops N consecutive local days), `crossMidnightDwell` (the §0
  regression case). Parameterized by park.
- **`adminSetWeather`**: insert a synthetic `weather_obs` row (condition
  "Rain", `observedAt: now`) for a park so `isRainyNow` flips; it self-expires
  via the existing 2 h window. One button: "make it rain at <park>".
- Surface presets as buttons in **both** the web admin page and the on-device
  dev panel. Running them from the device matters: `newlyUnlocked` then flows
  back through the live toast/haptic funnel in the same session (running from
  the web instead exercises the `pendingUnlocks` replay path on next app
  launch — also worth testing, and it's free).

Note the intentional split: Layer A drives the _client loop + real time_;
Layer B drives the _server engine + compressed time_. Together they cover the
geo families completely.

## Layer C — sensor ride tooling

- **C1. Synthetic trace presets** (client dev panel; needs Layer A armed at an
  attraction). "Simulate ride: kiddie / launched / hyper / inverting" —
  fabricate a `RideTrace` that passes `hasRideSignature` and the coaster clamp
  for the anchored attraction, then push it through the _same_ path the native
  listener uses (signature gate → `submitRideTrace` → recap toast → ring).
  Also include a deliberately-bad preset ("walk-like", "impossible G") to
  verify rejection + ring visibility end-to-end.
- **C2. Trace fixture capture/replay.** `user_ride_event.trace` already stores
  every real trace (and it deliberately never ships to clients). Add
  `adminGetTrace(rideEventId)` (adminProcedure) + an "export fixture" action on
  the admin page, and let the dev panel replay saved fixtures. One real park
  visit becomes a permanent, realistic regression library — far better than
  hand-tuned synthetics for tuning `hasRideSignature`.
- **C3. Manual record mode** (on-device). The plugin interface already exposes
  `startRecording`/`stopRecording` — the dev panel just needs buttons. Record
  a car ride / vigorous shake / stairs, then show the computed `RideMetrics`,
  the signature verdict, and (optionally) submit. This is the only way to
  exercise the _real IMU → metrics bridge_ on hardware without a coaster; pure
  detector-algorithm coverage stays in the plugin's unit tests over recorded
  sample streams.
- Reset loop: `devResetRides` already exists.

## Layer D — observability while testing

Additions to `admin.achievements.tsx` (all read-only, cheap):

- **Geo cursor card**: live `user_geo_state` for the selected user — park,
  coords, `anchorAttractionId` (resolved to a name), `anchorSeconds`,
  `anchorSince` — with a refetch interval while open. Watching the dwell state
  machine tick during a Layer A queue sim is the difference between "it didn't
  work" and knowing _which_ transition failed.
- **Raw rows**: recent `user_park_day` rows (flags included) and `user_stat`
  counters, plus recent `user_ride_event`s with their gate `source`.
- Already covered: unlock list, revoke, resets.

---

## Sequencing

| #   | Work                                                                 | Size      | Unblocks                                           |
| --- | -------------------------------------------------------------------- | --------- | -------------------------------------------------- |
| 1   | Layer A sim store + tracker/geolocation hooks + panel card           | ~1 day    | everything client-side; native arm/disarm at home  |
| 2   | C1 synthetic trace presets (+ bad presets)                           | ~½ day    | all sensor families, recap toast, W11 notification |
| 3   | Layer B `now` refactor + `adminSimulateScenario` + presets + weather | ~1 day    | clock-gated, calendar, weather families in seconds |
| 4   | Layer D geo-cursor + raw-row cards                                   | ~½ day    | debugging visibility for 1–3                       |
| 5   | C2 fixture capture / C3 manual record                                | follow-up | detector tuning after next real visit              |

After 1–3, every one of the 22 families is exercisable on a device build at
home; 4–5 make failures diagnosable and the sensor path realistically tunable.

## Guardrails

- Server: everything new is `adminProcedure` (owner-only), same as `devUnlock`
  — safe in prod without env flags. The time-warp `now` must never be
  reachable from the public `ping`.
- Client: gate all sim UI on `import.meta.env.DEV || nav-test-tools`, matching
  `ErrorTestPanel`; the sim acts only on the signed-in (admin) account.
- Analytics: suppress or tag `posthog.capture` while the sim is armed.
- Platform alternatives (documented, not built): Xcode "Simulate Location"
  GPX playback works on tethered real iPhones; Android real devices need a
  mock-location provider app. Both are per-platform, untethered-hostile, and
  can't compress time — the in-app sim is preferred, but GPX is a good
  independent cross-check that the _real_ CoreLocation → `useGeolocation`
  path behaves.
