import * as React from "react";
import posthog from "posthog-js";

import { useGeoSim } from "#/lib/dev-geo-sim.ts";

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

// While turn-by-turn is running we want near-live fixes: a 15 s-stale puck lags
// ~20 m at walking speed, enough to blow through a turn cue or delay arrival. So
// nav mode drops `maximumAge` to ~1.5 s (the ambient app watch keeps the relaxed
// default for battery). See `navActive`.
const NAV_MAX_AGE_MS = 1_500;

function geoOpts(navActive: boolean): PositionOptions {
  return navActive ? { ...GEO_OPTS, maximumAge: NAV_MAX_AGE_MS } : GEO_OPTS;
}

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

/** Whether the user has ever turned locate on — lets a page gate copy on
 *  "has location ever been granted" without instantiating another watch. */
export function hasGrantedLocationBefore(): boolean {
  return readActiveFlag();
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
export function useGeolocation(opts?: {
  watch?: boolean;
  rememberActive?: boolean;
  navActive?: boolean;
}) {
  const watch = opts?.watch ?? false;
  const rememberActive = opts?.rememberActive ?? false;
  const navActive = opts?.navActive ?? false;
  const [state, setState] = React.useState<GeoState>({ status: "idle" });
  const watchIdRef = React.useRef<number | null>(null);
  // Read the current nav-mode flag from a ref inside `locate` so toggling it
  // doesn't recreate the callback; the watch is re-armed by the effect below.
  const navActiveRef = React.useRef(navActive);
  navActiveRef.current = navActive;

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

  const onSuccess = React.useCallback(
    (pos: GeolocationPosition) => {
      // Reaching `granted` means the feature is on — remember it so a later
      // session can silently re-engage (no-op when `rememberActive` is off).
      if (rememberActive) writeActiveFlag(true);
      setState({
        status: "granted",
        coords: [pos.coords.longitude, pos.coords.latitude],
        accuracy: pos.coords.accuracy,
        heading: pos.coords.heading,
      });
    },
    [rememberActive],
  );
  const onError = React.useCallback(
    (err: GeolocationPositionError) => {
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
    },
    [rememberActive],
  );

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
    const options = geoOpts(navActiveRef.current);
    if (watch) {
      stop();
      watchIdRef.current = navigator.geolocation.watchPosition(onSuccess, onError, options);
    } else {
      navigator.geolocation.getCurrentPosition(onSuccess, onError, options);
    }
  }, [watch, stop, onSuccess, onError]);

  // Re-arm a live watch when nav mode toggles, so the tighter/looser
  // `maximumAge` profile takes effect mid-session. Only touches an already-
  // running watch — it never starts one on its own (that needs a gesture).
  React.useEffect(() => {
    if (!watch || watchIdRef.current == null || typeof navigator === "undefined") return;
    navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = navigator.geolocation.watchPosition(
      onSuccess,
      onError,
      geoOpts(navActive),
    );
  }, [navActive, watch, onSuccess, onError]);

  React.useEffect(() => stop, [stop]);

  // Dev location simulator (Layer A). When armed from the dev panel, sim coords
  // masquerade as a live `granted` fix so the whole client loop — ping cadence,
  // in-park UI, ride-recorder arm/disarm — runs for real off simulated
  // positions. Disarmed for everyone else, so this is inert in normal use.
  const sim = useGeoSim();
  const effectiveState: GeoState =
    sim.armed && sim.coords
      ? {
          status: "granted",
          coords: [sim.coords.lng, sim.coords.lat],
          accuracy: sim.coords.accuracy,
          heading: null,
        }
      : state;

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

  return { state: effectiveState, locate, stop, deactivate };
}
