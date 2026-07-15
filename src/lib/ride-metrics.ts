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
 * elevator). Kept in one place so field-tuning is a one-file change.
 *
 * These are starting points that have never seen a real accelerometer trace —
 * expect to re-cut them from field data (see FOLLOWUP.md Part 3).
 */
export const RIDE_SIGNATURE = {
  /** Any detected barometric descent counts. */
  minDropCount: 1,
  /** Cumulative airtime (|a| < 0.4 g), in seconds. */
  minAirtimeS: 0.5,
  /** Peak windowed-median g — walking never sustains this. */
  minMaxG: 1.8,
  /** Any gyroscope-confirmed inversion counts. */
  minInversions: 1,
} as const;

/**
 * Whether a trace shows coaster-like evidence, not just walking jitter. Pure and
 * shared by both the client suppression gate (`achievement-tracker.tsx`) and the
 * authoritative server gate (`ingestRideTrace`).
 */
export function hasRideSignature(m: RideMetrics): boolean {
  return (
    m.dropCount >= RIDE_SIGNATURE.minDropCount ||
    m.airtimeS >= RIDE_SIGNATURE.minAirtimeS ||
    m.maxG >= RIDE_SIGNATURE.minMaxG ||
    m.inversions >= RIDE_SIGNATURE.minInversions
  );
}
