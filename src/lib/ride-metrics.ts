/**
 * On-device ride metrics contract — the shape the native `ride-recorder`
 * Capacitor plugin computes and uploads, and the shape stored in
 * `user_ride_event.metrics` / validated by the `submitRideTrace` Zod schema.
 *
 * This is the single source of truth for the metric fields. The plugin's
 * `packages/ride-recorder/src/definitions.ts` re-declares the same interface for
 * its standalone build; keep the two in lock-step (the server Zod schema in
 * `src/server/achievements/rides.ts` mirrors these fields with plausibility
 * bounds baked in).
 */
export interface RideMetrics {
  startedAt: string; // ISO
  endedAt: string; // ISO
  durationS: number;
  dropCount: number;
  airtimeS: number; // cumulative seconds |a| < 0.4 g
  maxG: number; // peak of 0.3–0.5 s windowed-median |a|/9.81
  inversions: number;
  verticalM: number; // Σ|Δaltitude| (barometric), 0 if !baroAvailable
  maxDropM: number; // largest single barometric descent
  estTopSpeedKmh: number | null; // 3.6·√(2·9.81·maxDropM) — ALWAYS an estimate, label it so
  baroAvailable: boolean;
  gyroAvailable: boolean;
  confidence: number; // 0..1 ride-signature score
}

/** One downsampled audit sample (~4 Hz) for server plausibility checks. */
export interface RideSample {
  t: number; // ms since ride start
  aMag: number; // |acceleration| in m/s²
  altRel: number | null; // relative altitude in m, null if no barometer
}

export interface RideTrace {
  metrics: RideMetrics;
  /** ~4 Hz downsample for server plausibility checks; hard cap 600 samples. */
  samples?: RideSample[];
}

/**
 * Ride-signature thresholds. A trace must clear at least one of these to be
 * treated as a coaster ride rather than ordinary movement (walking, a bus, an
 * elevator). Kept in one place so field-tuning is a one-file change. Mirrored
 * into the native `RideConst` on both platforms (W3 gates the local recap
 * notification on the same rule) — keep the three in lock-step.
 *
 * 2026-07-29 (W5 provisional, from the WDW field test): `minMaxG` raised
 * 1.8 → 2.3 — `computeMaxG`'s 0.4 s windowed median reads 1.5–2.5 g from
 * ordinary step impacts (queue shuffling, phone handling), so 1.8 sat inside
 * the walking band and let walking traces through. A maxG-only signature now
 * also requires a sustained ride (`maxGMinDurationS`): step impacts are brief,
 * launch/helix g is sustained. Revisit both against ride_trace_* field data.
 */
export const RIDE_SIGNATURE = {
  /** Any detected barometric descent counts. */
  minDropCount: 1,
  /** Cumulative airtime (|a| < 0.4 g), in seconds. */
  minAirtimeS: 0.5,
  /** Peak windowed-median g — above the walking-impact band (1.5–2.5 g). */
  minMaxG: 2.3,
  /** A maxG-only signature (no drop/airtime/inversion evidence) must also last
   *  this long — walking impacts spike briefly; real g-force is sustained. */
  maxGMinDurationS: 40,
  /** Any gyroscope-confirmed inversion counts. */
  minInversions: 1,
} as const;

/**
 * Whether a trace shows coaster-like evidence, not just walking jitter. Pure and
 * shared by the client suppression gate (`use-detected-ride.ts`), the
 * authoritative server gate (`ingestRideTrace`), and — as a native mirror —
 * the local recap-notification gate on both platforms.
 */
export function hasRideSignature(m: RideMetrics): boolean {
  return (
    m.dropCount >= RIDE_SIGNATURE.minDropCount ||
    m.airtimeS >= RIDE_SIGNATURE.minAirtimeS ||
    m.inversions >= RIDE_SIGNATURE.minInversions ||
    (m.maxG >= RIDE_SIGNATURE.minMaxG && m.durationS >= RIDE_SIGNATURE.maxGMinDurationS)
  );
}
