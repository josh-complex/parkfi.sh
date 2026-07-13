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

interface RideRecorderPlugin {
  requestPermissions(): Promise<{ motion: MotionPermissionState }>;
  checkPermissions(): Promise<{ motion: MotionPermissionState }>;
  startMonitoring(opts?: { imuHz?: number; baroHz?: number }): Promise<void>;
  stopMonitoring(): Promise<void>;
  startRecording(): Promise<void>;
  stopRecording(): Promise<RideTrace | null>;
  addListener(event: "rideDetected", cb: (trace: RideTrace) => void): Promise<PluginListenerHandle>;
  addListener(event: "rideStarted", cb: () => void): Promise<PluginListenerHandle>;
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
