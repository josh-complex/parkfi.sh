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
  /** Longest contiguous sub-0.4 g burst, seconds (the airtime *gate* input). */
  airtimeBurstS?: number;
  /** Longest run with windowed-median g ≥ 2.0, seconds (maxG-only gate input). */
  maxGSustainS?: number;
  /** Capture exceeded MAX_SIGNATURE_DURATION_S — never a ride. */
  overlong?: boolean;
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

/** One circular park geofence to monitor natively (background-capable). */
export interface ParkGeofence {
  /** Stable id echoed back on transition (the park id, as a string). */
  id: string;
  lat: number;
  lng: number;
  /** Trigger radius in metres. */
  radiusM: number;
}

export type GeofenceTransition = "enter" | "exit";

/** A background park entry/exit, delivered even when the WebView was suspended. */
export interface ParkTransitionEvent {
  regionId: string;
  transition: GeofenceTransition;
  /** When the OS reported the crossing (epoch ms). Events are persisted to an
   *  on-device queue at receipt and replayed on the next bridge boot/resume,
   *  so a transition that fired while the app was killed still carries the
   *  real time rather than the time the app was next opened. */
  at?: number;
}

/** A detected ride as delivered to listeners: the trace plus the ride's start
 *  time (epoch ms) from the on-device event queue. */
export type RideDetectedEvent = RideTrace & { at?: number };

/** Result of `drainPending`: what was flushed from the on-device queue. */
export interface DrainedEvents {
  transitions: number;
  rides: number;
  /** Age in ms of the oldest flushed event (since it was queued), or null. */
  oldestAgeMs: number | null;
}

export type LocationPermissionState = "granted" | "denied" | "prompt";

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

  /**
   * Cumulative steps since the current monitoring session was armed (F-steps),
   * plus the session's start time (epoch ms) as its identity — the server keys
   * its dedupe cursor on it. Both `null` when the device lacks a step counter,
   * the permission was denied, or monitoring was never armed. Counting runs on
   * the hardware step coprocessor, so backgrounded/locked stretches are
   * included.
   */
  getStepSample(): Promise<{ steps: number | null; sessionStartMs: number | null }>;

  /**
   * Historical step total over an absolute window (reconciliation). iOS only —
   * served from CMPedometer's ~7-day buffer, so it survives app kills. Android
   * and web resolve `steps: null` (no system step store without Health Connect).
   */
  queryStepSpan(opts: { fromMs: number; toMs: number }): Promise<{ steps: number | null }>;

  /**
   * Request the "always/background" location grant that region monitoring needs
   * to fire while the app is suspended. On iOS this escalates WhenInUse →
   * Always; on Android 10+ it's the separate ACCESS_BACKGROUND_LOCATION grant
   * (which the OS routes to a settings screen). Resolves the resulting state;
   * never rejects. A `denied`/`prompt` result just means geofences run only
   * while the app is in use.
   */
  requestBackgroundLocation(): Promise<{ location: LocationPermissionState }>;

  /**
   * Replace the set of monitored park geofences (idempotent — call again with a
   * new set to swap). Region monitoring wakes the app on enter/exit even from a
   * suspended/terminated state, which is what makes park-entry detection work
   * with the phone pocketed. iOS caps simultaneous regions at 20; pass the
   * nearest N. A no-op without the background-location grant.
   */
  setParkGeofences(opts: { regions: ParkGeofence[] }): Promise<void>;

  /** Stop monitoring all park geofences. */
  clearParkGeofences(): Promise<void>;

  /**
   * Replay anything in the on-device event queue to the listeners below. Ride
   * and transition events are appended to a JSON-lines file the moment the OS
   * delivers them — including in a process the geofence revived with no
   * bridge — and flushed on plugin load, on resume, and on this call. Web and
   * an empty queue resolve zeros.
   */
  drainPending(): Promise<DrainedEvents>;

  addListener(event: "rideStarted", cb: () => void): Promise<PluginListenerHandle>;
  addListener(
    event: "rideDetected",
    cb: (event: RideDetectedEvent) => void,
  ): Promise<PluginListenerHandle>;
  /** Background park entry/exit from region monitoring (retained until consumed). */
  addListener(
    event: "parkTransition",
    cb: (event: ParkTransitionEvent) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
