import { WebPlugin } from "@capacitor/core";

import type {
  LocationPermissionState,
  MotionPermissionState,
  RideRecorderPlugin,
  RideTrace,
} from "./definitions";

/**
 * No-op web stub. The browser has no reliable coaster-grade IMU/barometer
 * access, and the app never arms monitoring off native — so every capture
 * method rejects "unavailable" rather than pretending. Permission checks
 * resolve "denied" so the JS layer treats web as sensor-less.
 */
export class RideRecorderWeb extends WebPlugin implements RideRecorderPlugin {
  private notAvailable(): never {
    throw this.unimplemented("ride-recorder is native-only (iOS/Android).");
  }

  async requestPermissions(): Promise<{ motion: MotionPermissionState }> {
    return { motion: "denied" };
  }

  async checkPermissions(): Promise<{ motion: MotionPermissionState }> {
    return { motion: "denied" };
  }

  async startMonitoring(): Promise<void> {
    this.notAvailable();
  }

  async stopMonitoring(): Promise<void> {
    // Safe no-op so teardown paths don't throw on web.
  }

  async startRecording(): Promise<void> {
    this.notAvailable();
  }

  async stopRecording(): Promise<RideTrace | null> {
    return null;
  }

  async getStepSample(): Promise<{ steps: number | null; sessionStartMs: number | null }> {
    return { steps: null, sessionStartMs: null };
  }

  async queryStepSpan(): Promise<{ steps: number | null }> {
    return { steps: null };
  }

  // Region monitoring is a native-OS capability; the browser has no equivalent
  // that survives the tab being backgrounded, so these are inert no-ops. The web
  // app already runs its own foreground `watchPosition` geofence, so nothing is
  // lost by the stubs.
  async requestBackgroundLocation(): Promise<{ location: LocationPermissionState }> {
    return { location: "denied" };
  }

  async setParkGeofences(): Promise<void> {
    // no-op on web
  }

  async clearParkGeofences(): Promise<void> {
    // no-op on web
  }
}
