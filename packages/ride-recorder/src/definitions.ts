import type { PluginListenerHandle } from "@capacitor/core";

/**
 * On-device ride metrics — the shape the native detection engine computes and
 * uploads. This is a **standalone re-declaration** of the app-side contract in
 * `src/lib/ride-metrics.ts`; the two must stay in lock-step (the server Zod
 * schema in `src/server/achievements/rides.ts` mirrors these fields with
 * plausibility bounds baked in).
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
  estTopSpeedKmh: number | null; // 3.6·√(2·9.81·maxDropM) — ALWAYS an estimate
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

export type MotionPermissionState = "granted" | "denied" | "prompt";

export interface RideRecorderPlugin {
  /** iOS 13+ motion permission (Android auto-grants; resolves "granted"). */
  requestPermissions(): Promise<{ motion: MotionPermissionState }>;
  checkPermissions(): Promise<{ motion: MotionPermissionState }>;

  /**
   * Arm passive detection. Cheap: accel-only ~10 Hz until a variance trigger
   * escalates to the full 50 Hz IMU + barometer capture. Idempotent.
   */
  startMonitoring(opts?: { imuHz?: number; baroHz?: number }): Promise<void>;
  stopMonitoring(): Promise<void>;

  /** Manual "I'm on the ride now" affordance — forces recording on. */
  startRecording(): Promise<void>;
  /** Stop a manual recording and return its trace (null if too short). */
  stopRecording(): Promise<RideTrace | null>;

  addListener(event: "rideStarted", cb: () => void): Promise<PluginListenerHandle>;
  addListener(event: "rideDetected", cb: (trace: RideTrace) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
