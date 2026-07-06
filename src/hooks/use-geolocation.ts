import * as React from "react";
import posthog from "posthog-js";

/**
 * Discriminated geolocation state. Coords follow the project's [lng, lat]
 * convention (GeoJSON / MapLibre order) so they drop straight into the map and
 * the geofence helpers without a flip.
 */
export type GeoState =
  | { status: "idle" }
  | { status: "prompting" }
  | { status: "granted"; coords: [number, number]; accuracy: number; heading: number | null }
  | { status: "denied" }
  | { status: "unavailable" }
  | { status: "error"; message: string };

const GEO_OPTS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 15_000,
};

// Remembers that the user turned the locate feature on, so it can re-engage
// across sessions (see `rememberActive`). Only ever set once we're actually
// `granted`, and cleared on `denied`, so a stale flag can't outlive a revoked
// permission.
const ACTIVE_KEY = "parkfi:geo:active";

function readActiveFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ACTIVE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeActiveFlag(active: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (active) window.localStorage.setItem(ACTIVE_KEY, "1");
    else window.localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* private mode / disabled storage — the session still tracks state in memory */
  }
}

/**
 * Thin wrapper over `navigator.geolocation`. It never prompts on mount — the
 * browser only surfaces the permission dialog from a user gesture, and silent
 * geolocation is hostile UX — so the consumer calls `locate()` from a tap. With
 * `watch: true` it keeps a live `watchPosition` going (for following the user as
 * they walk) until `stop()` or unmount. Degrades to `unavailable` off a secure
 * context / SSR rather than throwing.
 *
 * With `rememberActive: true` the "on" state persists across sessions: once the
 * user has activated locate (we reached `granted`), a later mount silently
 * re-engages the watch — but *only* when the browser already reports the
 * geolocation permission as `granted` (checked via the Permissions API), so we
 * still never surface a prompt without a gesture. A revoked permission clears
 * the flag, so it won't keep retrying.
 */
export function useGeolocation(opts?: { watch?: boolean; rememberActive?: boolean }) {
  const watch = opts?.watch ?? false;
  const rememberActive = opts?.rememberActive ?? false;
  const [state, setState] = React.useState<GeoState>({ status: "idle" });
  const watchIdRef = React.useRef<number | null>(null);

  const stop = React.useCallback(() => {
    if (watchIdRef.current != null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  // Turn the feature back off: drop the watch, return to `idle` (so the locate
  // button reads as inactive again), and forget the remembered flag so it won't
  // auto-resume next session. The permission itself stays granted — a later
  // `locate()` re-engages without another prompt.
  const deactivate = React.useCallback(() => {
    stop();
    if (rememberActive) writeActiveFlag(false);
    setState({ status: "idle" });
  }, [stop, rememberActive]);

  const locate = React.useCallback(() => {
    if (
      typeof navigator === "undefined" ||
      !navigator.geolocation ||
      typeof window === "undefined" ||
      !window.isSecureContext
    ) {
      setState({ status: "unavailable" });
      return;
    }
    setState((s) => (s.status === "granted" ? s : { status: "prompting" }));
    const onSuccess = (pos: GeolocationPosition) => {
      // Reaching `granted` means the feature is on — remember it so a later
      // session can silently re-engage (no-op when `rememberActive` is off).
      if (rememberActive) writeActiveFlag(true);
      setState({
        status: "granted",
        coords: [pos.coords.longitude, pos.coords.latitude],
        accuracy: pos.coords.accuracy,
        heading: pos.coords.heading,
      });
    };
    const onError = (err: GeolocationPositionError) => {
      if (err.code === err.PERMISSION_DENIED) {
        // Expected user choice — an event (never an exception). Living Layer
        // depends on this funnel to see how many users grant location.
        posthog.capture("geolocation_denied");
        // Permission is gone — drop the flag so we don't keep trying to resume.
        if (rememberActive) writeActiveFlag(false);
        setState({ status: "denied" });
      } else {
        posthog.capture("geolocation_error", { code: err.code, message: err.message });
        setState({ status: "error", message: err.message });
      }
    };
    if (watch) {
      stop();
      watchIdRef.current = navigator.geolocation.watchPosition(onSuccess, onError, GEO_OPTS);
    } else {
      navigator.geolocation.getCurrentPosition(onSuccess, onError, GEO_OPTS);
    }
  }, [watch, stop]);

  React.useEffect(() => stop, [stop]);

  // Cross-session resume: if the user previously had locate on, re-engage it on
  // mount — but only after the Permissions API confirms geolocation is already
  // `granted`, so no dialog is ever surfaced without a gesture. Runs once. If
  // the API is unavailable (or reports prompt/denied) we leave it off; the user
  // taps the button, which prompts as usual.
  const locateRef = React.useRef(locate);
  locateRef.current = locate;
  React.useEffect(() => {
    if (!rememberActive || !readActiveFlag()) return;
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((res) => {
        if (!cancelled && res.state === "granted") locateRef.current();
        else if (res.state === "denied") writeActiveFlag(false);
      })
      .catch(() => {
        /* query unsupported for geolocation on this browser — skip auto-resume */
      });
    return () => {
      cancelled = true;
    };
  }, [rememberActive]);

  return { state, locate, stop, deactivate };
}
