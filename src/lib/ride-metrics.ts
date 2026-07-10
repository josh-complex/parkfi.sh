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
