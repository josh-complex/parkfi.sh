# ride-recorder

On-device coaster ride detection for the ParkFi Capacitor shell (iOS + Android).
Computes a compact `RideMetrics` summary from the phone's IMU and barometer and
uploads it (with a small ~4 Hz audit trace) to `achievements.submitRideTrace`.
Raw 50 Hz streams never leave the device.

This is a **local, private plugin** (`file:packages/ride-recorder`), picked up by
`cap sync`. The app talks to it through `src/lib/ride-recorder-client.ts` via
`registerPlugin("RideRecorder")` — it does not import this package's JS at
runtime, which keeps the web bundle free of native code. The JS layer here
(`src/`) exists so the plugin is a complete, standalone Capacitor plugin.

## Detection pipeline

1. **Monitoring** (armed by JS only while in-park): `deviceMotion` / linear+gravity
   sensors at ~10 Hz. A rolling 5 s variance of specific-force magnitude watches
   for a ride start. A 10 s pre-trigger ring buffer keeps the lift hill / launch.
2. **Recording** (on trigger): escalate to 50 Hz IMU + barometer, seed with the
   ring buffer, emit `rideStarted`.
3. **Finalize** (quiet ≥20 s or 6 min cap): compute metrics, emit `rideDetected`
   with the trace, revert to monitoring. Sessions <20 s are discarded.

All metrics are orientation-independent (magnitude + gravity-relative frames).
See `RideDetection.{swift,kt}` — the two engines are kept in lock-step and the
constants live in one `RideConst` block per platform.

## Documented false positives (rejected on-device or server-side)

| Source               | Why it doesn't count                                                           |
| -------------------- | ------------------------------------------------------------------------------ |
| Elevator / stairs    | Barometric change but no acceleration variance → never triggers recording.     |
| Car / bus / monorail | Variance without sustained low-g events, and no attraction anchor server-side. |
| Phone drop / knock   | Single-sample spike — the 0.3–0.5 s windowed **median** for max-G kills it.    |
| Pocket fumbling      | Inversions require a >90°/s gyro rate through the flip, not a slow reorient.   |
| "Couch shake" replay | Server requires a fresh in-park geofence ping to attribute the ride.           |

## Barometer-less phones

Many midrange Android phones have no barometer. `baroAvailable` reports `false`,
barometric metrics (`verticalM`, `maxDropM`, `estTopSpeedKmh`) zero/null out,
drops fall back to sustained low-g detection, and `confidence` reflects the
degraded signal. The families still progress.
