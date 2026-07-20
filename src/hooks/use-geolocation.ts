import * as React from "react";
import { Store } from "@tanstack/store";
import posthog from "posthog-js";

import { useGeoSim } from "#/lib/dev-geo-sim.ts";
import { isNative } from "#/lib/platform.ts";

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

/**
 * Watch power profiles (§1.5). `high` is the historical default — every
 * consumer that doesn't say otherwise keeps it.
 *  - `nav`: turn-by-turn wants near-live fixes — a 15 s-stale puck lags ~20 m at
 *    walking speed, enough to blow through a turn cue or delay arrival.
 *  - `high`: GPS-grade fixes at a relaxed cadence — play-mode geofencing, a
 *    pending trip waiting on a good origin.
 *  - `low`: the ambient browse watch. Drops `enableHighAccuracy` — the only real
 *    battery lever, since a high-accuracy watch holds the GPS radio on — trading
 *    puck precision (wifi/cell fixes, tens of metres, ring shown) for battery
 *    while nothing that needs GPS accuracy is running.
 */
export type GeoProfile = "nav" | "high" | "low";

const GEO_PROFILES: Record<GeoProfile, PositionOptions> = {
  nav: { enableHighAccuracy: true, timeout: 10_000, maximumAge: 1_500 },
  high: { enableHighAccuracy: true, timeout: 10_000, maximumAge: 15_000 },
  low: { enableHighAccuracy: false, timeout: 20_000, maximumAge: 30_000 },
};

/**
 * Last known fix from any consumer this session, [lng, lat] + accuracy. Lets
 * far-away UI (a ride page's "Walk there · 6 min" CTA) estimate a walk without
 * owning a watch — reading it never prompts. Null until something locates.
 */
export const lastFixStore = new Store<{ coords: [number, number]; accuracy: number } | null>(null);

/**
 * Count of live, granted geolocation watches across every hook instance. Lets a
 * consumer without its own active watch (the achievement tracker's ping loop)
 * know that fresh fixes are flowing into {@link lastFixStore} — the instances
 * are otherwise isolated, so one instance reaching `granted` (the map's locate
 * tap) is invisible to the others. Watches only; one-shot `getCurrentPosition`
 * calls don't keep delivering and never count.
 */
export const activeWatchesStore = new Store(0);

// Remembers that the user turned the locate feature on, so it can re-engage
// across sessions (see `rememberActive`). Only ever set once we're actually
// `granted`, and cleared on `denied`, so a stale flag can't outlive a revoked
// permission.
//
// Three stored states (native uses all three; web only ever "1"/absent):
//   "1"    — on: the user has locate engaged.
//   "0"    — explicitly off: the user toggled locate off in-app. Native-only,
//            so the persistent OS grant doesn't silently re-engage on next
//            launch against the user's stated choice.
//   absent — unset: no in-app preference yet. On native the default then comes
//            from the phone's own location permission (see `nativeLocationGranted`).
const ACTIVE_KEY = "parkfi:geo:active";

type ActivePref = "on" | "off" | null;

function readActivePref(): ActivePref {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(ACTIVE_KEY);
    return v === "1" ? "on" : v === "0" ? "off" : null;
  } catch {
    return null;
  }
}

function readActiveFlag(): boolean {
  return readActivePref() === "on";
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

/** Native-only: record an explicit user "off" (distinct from unset) so the
 *  persistent OS grant doesn't auto-re-engage locate on next launch. */
function writeActiveOff() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_KEY, "0");
  } catch {
    /* storage disabled — session state still reflects the toggle */
  }
}

/**
 * Native-only: read the phone's location permission via the Capacitor plugin —
 * the source of truth for "is locate available" in the shell. Used to default
 * the locate toggle on for a fresh install that already granted location, since
 * the WebView's `navigator.permissions` query is unreliable/unsupported there.
 * The plugin is dynamically imported so it never enters the web bundle. Returns
 * false (never throws) off native or if the read fails.
 */
async function nativeLocationGranted(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    const status = await Geolocation.checkPermissions();
    return status.location === "granted" || status.coarseLocation === "granted";
  } catch {
    return false;
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
  /** Power/accuracy profile for the watch (see {@link GeoProfile}); defaults to
   *  the historical `high`. Changing it re-arms a running watch in place. */
  profile?: GeoProfile;
}) {
  const watch = opts?.watch ?? false;
  const rememberActive = opts?.rememberActive ?? false;
  const profile = opts?.profile ?? "high";
  const [state, setState] = React.useState<GeoState>({ status: "idle" });
  const watchIdRef = React.useRef<number | null>(null);
  // Whether the "feature is on" flag has been persisted for the current
  // activation — so reaching `granted` writes localStorage once, not on every
  // fix the watch delivers.
  const activeWrittenRef = React.useRef(false);
  // Read the current profile from a ref inside `locate` so switching it doesn't
  // recreate the callback; the watch is re-armed by the effect below.
  const profileRef = React.useRef(profile);
  profileRef.current = profile;
  // Whether this instance is currently counted in `activeWatchesStore`.
  const countedRef = React.useRef(false);

  const uncountWatch = React.useCallback(() => {
    if (countedRef.current) {
      countedRef.current = false;
      activeWatchesStore.setState((n) => n - 1);
    }
  }, []);

  const stop = React.useCallback(() => {
    uncountWatch();
    if (watchIdRef.current != null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, [uncountWatch]);

  // Turn the feature back off: drop the watch, return to `idle` (so the locate
  // button reads as inactive again), and forget the remembered flag so it won't
  // auto-resume next session. The permission itself stays granted — a later
  // `locate()` re-engages without another prompt.
  const deactivate = React.useCallback(() => {
    stop();
    // On native, record an explicit "off" so the persistent OS location grant
    // doesn't silently re-engage locate on next launch against this choice; on
    // web, forgetting the flag is enough (there's no OS-grant default there).
    if (rememberActive) {
      if (isNative()) writeActiveOff();
      else writeActiveFlag(false);
    }
    activeWrittenRef.current = false;
    setState({ status: "idle" });
  }, [stop, rememberActive]);

  const onSuccess = React.useCallback(
    (pos: GeolocationPosition) => {
      // Reaching `granted` means the feature is on — remember it so a later
      // session can silently re-engage (no-op when `rememberActive` is off).
      if (rememberActive && !activeWrittenRef.current) {
        activeWrittenRef.current = true;
        writeActiveFlag(true);
      }
      // First fix from a live watch: announce it to the shared count.
      if (watchIdRef.current != null && !countedRef.current) {
        countedRef.current = true;
        activeWatchesStore.setState((n) => n + 1);
      }
      const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
      const { accuracy, heading } = pos.coords;
      lastFixStore.setState((f) =>
        f && f.coords[0] === coords[0] && f.coords[1] === coords[1] && f.accuracy === accuracy
          ? f
          : { coords, accuracy },
      );
      // A fix identical to the last one (common while stationary: cached
      // `maximumAge` re-delivery, wifi positioning) bails the update — the map
      // stage and every other subscriber would otherwise re-render ~1×/s off a
      // fresh-but-equal state object while the user stands still.
      setState((s) =>
        s.status === "granted" &&
        s.coords[0] === coords[0] &&
        s.coords[1] === coords[1] &&
        s.accuracy === accuracy &&
        s.heading === heading
          ? s
          : { status: "granted", coords, accuracy, heading },
      );
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
        activeWrittenRef.current = false;
        // The watch object survives a revocation but will never deliver again.
        uncountWatch();
        setState({ status: "denied" });
      } else {
        posthog.capture("geolocation_error", { code: err.code, message: err.message });
        setState({ status: "error", message: err.message });
      }
    },
    [rememberActive, uncountWatch],
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
    const options = GEO_PROFILES[profileRef.current];
    if (watch) {
      stop();
      watchIdRef.current = navigator.geolocation.watchPosition(onSuccess, onError, options);
    } else {
      navigator.geolocation.getCurrentPosition(onSuccess, onError, options);
    }
  }, [watch, stop, onSuccess, onError]);

  // Re-arm a live watch when the profile changes (browse → trip pending → nav),
  // so the accuracy/staleness trade-off takes effect mid-session. Only touches
  // an already-running watch — it never starts one on its own (needs a gesture).
  React.useEffect(() => {
    if (!watch || watchIdRef.current == null || typeof navigator === "undefined") return;
    navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = navigator.geolocation.watchPosition(
      onSuccess,
      onError,
      GEO_PROFILES[profile],
    );
  }, [profile, watch, onSuccess, onError]);

  React.useEffect(() => stop, [stop]);

  // Dev location simulator (Layer A). When armed from the dev panel, sim coords
  // masquerade as a live `granted` fix so the whole client loop — ping cadence,
  // in-park UI, ride-recorder arm/disarm — runs for real off simulated
  // positions. Disarmed for everyone else, so this is inert in normal use.
  const sim = useGeoSim();
  // Keep the shared last-fix in step with the simulator too, so location-fed UI
  // outside the map (walk-time CTAs) is testable from the dev panel.
  const simCoords = sim.armed ? sim.coords : null;
  React.useEffect(() => {
    if (simCoords)
      lastFixStore.setState(() => ({
        coords: [simCoords.lng, simCoords.lat],
        accuracy: simCoords.accuracy,
      }));
  }, [simCoords]);
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
    if (!rememberActive) return;
    // Native (Capacitor) shell: the phone's location permission is the source of
    // truth. The WebView has no synchronous per-call permission dialog to guard
    // against (the web gesture rule doesn't apply), and its `navigator.permissions`
    // query is routinely unsupported for geolocation — which is why the web gate
    // below returned early and the watch never resumed, making the "on" state
    // look like it wasn't remembered. So: honor an explicit in-app off; otherwise
    // engage when remembered on, or default to on whenever the OS already grants
    // location. A revoked OS grant surfaces as PERMISSION_DENIED in `onError`.
    if (isNative()) {
      const pref = readActivePref();
      if (pref === "off") return;
      if (pref === "on") {
        locateRef.current();
        return;
      }
      let cancelled = false;
      void nativeLocationGranted().then((granted) => {
        if (!cancelled && granted) locateRef.current();
      });
      return () => {
        cancelled = true;
      };
    }
    if (!readActiveFlag()) return;
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

  // Stable object identity while nothing changed, so consumer effects that
  // depend on the hook's return don't re-run on every render of the consumer.
  return React.useMemo(
    () => ({ state: effectiveState, locate, stop, deactivate }),
    [effectiveState, locate, stop, deactivate],
  );
}
