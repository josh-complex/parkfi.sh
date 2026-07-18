import * as React from "react";
import posthog from "posthog-js";

// Shortest signed delta from `a` to `b` on the 0–360 compass circle, in
// (-180, 180] — so smoothing/thresholds take the short way across the 0/360 seam
// instead of spinning the long way round.
function angleDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// iOS exposes a ready-made compass heading off the orientation event; the type
// isn't in lib.dom, so widen it here.
type OrientationEventLike = DeviceOrientationEvent & { webkitCompassHeading?: number };
type PermissionCapable = { requestPermission?: () => Promise<PermissionState> };

/**
 * Live compass heading (degrees, clockwise from true north) from the device's
 * magnetometer via the DeviceOrientation API — so the "facing" arrow points the
 * right way even when the user is standing still, which GPS course-over-ground
 * can't do (`coords.heading` is null unless you're actually moving).
 *
 * Only listens while `enabled` (it's a battery cost, so gate it on location
 * being active). iOS 13+ needs a one-time permission grant from a user gesture —
 * call `requestPermission()` from a tap (we hang it off the locate button). The
 * reading is circularly smoothed, rAF-throttled, and ≥1°-thresholded, then
 * handed to `onHeading` — deliberately a callback, not React state, so sensor
 * ticks never re-render the consumer tree (the map stage pipes it into the
 * fused-heading store, whose consumers are all imperative). `onHeading(null)`
 * fires when the listener turns off (no support, permission revoked, disabled).
 */
export function useDeviceHeading(
  enabled: boolean,
  onHeading: (heading: number | null) => void,
): {
  requestPermission: () => void;
} {
  // Read via a ref so a consumer passing an inline closure doesn't re-arm the
  // listeners every render.
  const onHeadingRef = React.useRef(onHeading);
  onHeadingRef.current = onHeading;

  const requestPermission = React.useCallback(() => {
    if (typeof window === "undefined") return;
    const D = window.DeviceOrientationEvent as unknown as PermissionCapable | undefined;
    // Only iOS gates orientation behind a prompt; elsewhere this is absent and
    // events flow once we attach the listeners below.
    if (D && typeof D.requestPermission === "function") {
      D.requestPermission().catch(() => {
        // denied / dismissed — heading stays null and the cone falls back to GPS
        posthog.capture("heading_permission_denied");
      });
    }
  }, []);

  React.useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    // Smoothed heading carried across events; rAF batches the emit and a 1°
    // threshold keeps downstream work down while still tracking a turn.
    let smoothed: number | null = null;
    let pending: number | null = null;
    let emitted: number | null = null;
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (pending == null) return;
      if (emitted == null || Math.abs(angleDelta(emitted, pending)) >= 1) {
        emitted = pending;
        onHeadingRef.current(pending);
      }
    };

    const onOrient = (e: Event) => {
      const ev = e as OrientationEventLike;
      let raw: number | null = null;
      if (typeof ev.webkitCompassHeading === "number") {
        // iOS: already true-north referenced and screen-orientation compensated.
        raw = ev.webkitCompassHeading;
      } else if (ev.absolute && ev.alpha != null) {
        // W3C absolute orientation: `alpha` grows counter-clockwise from north,
        // so heading = 360 - alpha. Add the screen angle so it tracks the top of
        // the *screen* (not the device) when held in landscape. Ignore
        // non-absolute `deviceorientation` events — their alpha has no fixed
        // north reference.
        const screenAngle = (typeof screen !== "undefined" && screen.orientation?.angle) || 0;
        raw = 360 - ev.alpha + screenAngle;
      }
      if (raw == null || Number.isNaN(raw)) return;
      raw = ((raw % 360) + 360) % 360;
      // Adaptive circular low-pass toward the raw reading, taking the short way
      // around the seam. The gain scales with how far the reading has moved:
      // tiny frame-to-frame deltas (sensor jitter while holding still) are damped
      // hard for a calm arrow, while a real turn opens the gain up so it still
      // swings around promptly instead of lagging behind the user.
      if (smoothed == null) {
        smoothed = raw;
      } else {
        const delta = angleDelta(smoothed, raw);
        const alpha = 0.06 + 0.34 * Math.min(1, Math.abs(delta) / 60);
        smoothed = (smoothed + delta * alpha + 360) % 360;
      }
      pending = smoothed;
      if (!raf) raf = requestAnimationFrame(flush);
    };

    // `deviceorientationabsolute` is the true-north stream on Chrome/Android;
    // iOS delivers its compass heading on plain `deviceorientation`. Listen to
    // both — the non-absolute, non-iOS case is filtered out inside the handler.
    window.addEventListener("deviceorientationabsolute", onOrient, true);
    window.addEventListener("deviceorientation", onOrient, true);
    return () => {
      window.removeEventListener("deviceorientationabsolute", onOrient, true);
      window.removeEventListener("deviceorientation", onOrient, true);
      if (raf) cancelAnimationFrame(raf);
      onHeadingRef.current(null);
    };
  }, [enabled]);

  return { requestPermission };
}
