import * as React from "react";

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
 * reading is circularly smoothed and rAF-throttled so the arrow glides instead
 * of jittering and React doesn't re-render at the raw sensor rate. Returns null
 * until a heading is available (no support, permission not granted, or off).
 */
export function useDeviceHeading(enabled: boolean): {
  heading: number | null;
  requestPermission: () => void;
} {
  const [heading, setHeading] = React.useState<number | null>(null);

  const requestPermission = React.useCallback(() => {
    if (typeof window === "undefined") return;
    const D = window.DeviceOrientationEvent as unknown as PermissionCapable | undefined;
    // Only iOS gates orientation behind a prompt; elsewhere this is absent and
    // events flow once we attach the listeners below.
    if (D && typeof D.requestPermission === "function") {
      D.requestPermission().catch(() => {
        /* denied / dismissed — heading stays null and the cone falls back to GPS */
      });
    }
  }, []);

  React.useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    // Smoothed heading carried across events; rAF batches the React update and a
    // 1° threshold keeps re-renders down while still tracking a turn.
    let smoothed: number | null = null;
    let pending: number | null = null;
    let emitted: number | null = null;
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (pending == null) return;
      if (emitted == null || Math.abs(angleDelta(emitted, pending)) >= 1) {
        emitted = pending;
        setHeading(pending);
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
      // Circular exponential smoothing toward the raw reading — calm but
      // responsive, taking the short way around the seam.
      smoothed = smoothed == null ? raw : (smoothed + angleDelta(smoothed, raw) * 0.15 + 360) % 360;
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
      setHeading(null);
    };
  }, [enabled]);

  return { heading, requestPermission };
}
