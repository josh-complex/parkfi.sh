/**
 * App-side bridge to the native `ride-recorder` Capacitor plugin (B2).
 *
 * We reach the native implementation through `registerPlugin("RideRecorder")`
 * rather than importing the `ride-recorder` package's JS — that keeps the web
 * bundle free of native plugin code (the proxy is inert on web, and every call
 * here is gated on {@link isNative}). The plugin interface is re-declared
 * against the app's `RideMetrics`/`RideTrace` contract in `ride-metrics.ts`.
 */
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

import { isNative } from "#/lib/platform.ts";
import type { RideTrace } from "#/lib/ride-metrics.ts";

type MotionPermissionState = "granted" | "denied" | "prompt";
type LocationPermissionState = "granted" | "denied" | "prompt";

/** One circular park geofence for native background region monitoring. */
export interface ParkGeofence {
  id: string;
  lat: number;
  lng: number;
  radiusM: number;
}

export type GeofenceTransition = "enter" | "exit";
export interface ParkTransitionEvent {
  regionId: string;
  transition: GeofenceTransition;
}

interface RideRecorderPlugin {
  requestPermissions(): Promise<{ motion: MotionPermissionState }>;
  checkPermissions(): Promise<{ motion: MotionPermissionState }>;
  startMonitoring(opts?: { imuHz?: number; baroHz?: number }): Promise<void>;
  stopMonitoring(): Promise<void>;
  startRecording(): Promise<void>;
  stopRecording(): Promise<RideTrace | null>;
  getStepSample(): Promise<{ steps: number | null; sessionStartMs: number | null }>;
  queryStepSpan(opts: { fromMs: number; toMs: number }): Promise<{ steps: number | null }>;
  requestBackgroundLocation(): Promise<{ location: LocationPermissionState }>;
  setParkGeofences(opts: { regions: ParkGeofence[] }): Promise<void>;
  clearParkGeofences(): Promise<void>;
  addListener(event: "rideDetected", cb: (trace: RideTrace) => void): Promise<PluginListenerHandle>;
  addListener(event: "rideStarted", cb: () => void): Promise<PluginListenerHandle>;
  addListener(
    event: "parkTransition",
    cb: (event: ParkTransitionEvent) => void,
  ): Promise<PluginListenerHandle>;
}

const RideRecorder = registerPlugin<RideRecorderPlugin>("RideRecorder");

// Motion permission is prompted lazily by the OS; only ask once per session.
let permissionAsked = false;

/**
 * Arm passive ride detection (native-only, non-throwing). Requests motion
 * permission the first time, then starts monitoring. Sensor errors (no IMU,
 * permission denied) are swallowed — sensor achievements are best-effort.
 */
export async function armRideMonitoring(): Promise<void> {
  if (!isNative()) return;
  try {
    if (!permissionAsked) {
      permissionAsked = true;
      await RideRecorder.requestPermissions();
    }
    await RideRecorder.startMonitoring();
  } catch {
    /* sensors unavailable — non-fatal */
  }
}

/** Disarm monitoring (native-only, non-throwing). Safe to call when not armed. */
export async function disarmRideMonitoring(): Promise<void> {
  if (!isNative()) return;
  try {
    await RideRecorder.stopMonitoring();
  } catch {
    /* already stopped */
  }
}

/**
 * Session-cumulative step count from the native pedometer — steps since ride
 * monitoring was last armed (i.e. since park entry), with the session's start
 * time as its identity. `null` on web, when the device has no step hardware, or
 * when the permission was denied. The raw cumulative + session id is what ships
 * to the server, which diffs it against a stored cursor — the client keeps no
 * baseline, so retries and reloads can't double-credit.
 */
export async function readStepSample(): Promise<{ cum: number; sessionMs: number } | null> {
  if (!isNative()) return null;
  try {
    const { steps, sessionStartMs } = await RideRecorder.getStepSample();
    if (
      typeof steps !== "number" ||
      !Number.isFinite(steps) ||
      typeof sessionStartMs !== "number" ||
      !Number.isFinite(sessionStartMs)
    ) {
      return null;
    }
    return { cum: steps, sessionMs: Math.round(sessionStartMs) };
  } catch {
    return null;
  }
}

/**
 * Historical step total over an absolute window, from the OS pedometer buffer.
 * iOS only — Android/web resolve null. Powers the day-window reconciliation
 * pass that repairs steps lost to process death or missed pings.
 */
export async function queryStepSpan(fromMs: number, toMs: number): Promise<number | null> {
  if (!isNative()) return null;
  try {
    const { steps } = await RideRecorder.queryStepSpan({ fromMs, toMs });
    return typeof steps === "number" && Number.isFinite(steps) ? steps : null;
  } catch {
    return null;
  }
}

/**
 * Manual record mode (device-test-tooling C3). Start/stop an explicit recording
 * on the native plugin — the only way to drive the *real* IMU → metrics bridge
 * on hardware without a coaster (record a car ride, a vigorous shake, stairs).
 * `stopRideRecording` returns the computed `RideTrace`, or null on web / if
 * nothing was recorded. Native-only; inert and non-throwing on web.
 */
export async function startRideRecording(): Promise<void> {
  if (!isNative()) return;
  try {
    await RideRecorder.startRecording();
  } catch {
    /* sensors unavailable — non-fatal */
  }
}

export async function stopRideRecording(): Promise<RideTrace | null> {
  if (!isNative()) return null;
  try {
    return await RideRecorder.stopRecording();
  } catch {
    return null;
  }
}

/**
 * Subscribe to sensor-detected rides. Returns a handle to remove the listener,
 * or `null` on web. Callers own the handle's lifecycle.
 */
export async function addRideDetectedListener(
  cb: (trace: RideTrace) => void,
): Promise<PluginListenerHandle | null> {
  if (!isNative()) return null;
  try {
    return await RideRecorder.addListener("rideDetected", cb);
  } catch {
    return null;
  }
}

// --- Background park geofencing (Tier 1) -------------------------------------

/**
 * Ask for the "always/background" location grant that region monitoring needs to
 * fire while the app is suspended (iOS: WhenInUse→Always; Android 10+: the
 * separate ACCESS_BACKGROUND_LOCATION grant, routed to settings on API 30+).
 * Native-only, never throws — returns the resulting state ("denied" on web).
 */
export async function requestBackgroundLocation(): Promise<LocationPermissionState> {
  if (!isNative()) return "denied";
  try {
    const { location } = await RideRecorder.requestBackgroundLocation();
    return location;
  } catch {
    return "denied";
  }
}

/**
 * Register (replace) the set of park geofences monitored natively. Region
 * monitoring wakes the app on enter/exit even when suspended — the background
 * complement to the foreground `watchPosition` loop. iOS caps at 20 regions, so
 * callers should pass only the nearest parks. Native-only, non-throwing.
 */
export async function setParkGeofences(regions: ParkGeofence[]): Promise<void> {
  if (!isNative() || regions.length === 0) return;
  try {
    await RideRecorder.setParkGeofences({ regions });
  } catch {
    /* background location not granted, or plugin unavailable — best-effort */
  }
}

/** Stop monitoring all park geofences (native-only, non-throwing). */
export async function clearParkGeofences(): Promise<void> {
  if (!isNative()) return;
  try {
    await RideRecorder.clearParkGeofences();
  } catch {
    /* already cleared */
  }
}

/**
 * Subscribe to background park entry/exit transitions. Returns a removable
 * handle, or `null` on web. The event is retained-until-consumed natively, so a
 * transition delivered while the WebView was suspended still fires on resume.
 */
export async function addParkTransitionListener(
  cb: (event: ParkTransitionEvent) => void,
): Promise<PluginListenerHandle | null> {
  if (!isNative()) return null;
  try {
    return await RideRecorder.addListener("parkTransition", cb);
  } catch {
    return null;
  }
}
