import * as React from "react";

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

/**
 * Thin wrapper over `navigator.geolocation`. It never prompts on mount — the
 * browser only surfaces the permission dialog from a user gesture, and silent
 * geolocation is hostile UX — so the consumer calls `locate()` from a tap. With
 * `watch: true` it keeps a live `watchPosition` going (for following the user as
 * they walk) until `stop()` or unmount. Degrades to `unavailable` off a secure
 * context / SSR rather than throwing.
 */
export function useGeolocation(opts?: { watch?: boolean }) {
  const watch = opts?.watch ?? false;
  const [state, setState] = React.useState<GeoState>({ status: "idle" });
  const watchIdRef = React.useRef<number | null>(null);

  const stop = React.useCallback(() => {
    if (watchIdRef.current != null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

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
      setState({
        status: "granted",
        coords: [pos.coords.longitude, pos.coords.latitude],
        accuracy: pos.coords.accuracy,
        heading: pos.coords.heading,
      });
    };
    const onError = (err: GeolocationPositionError) => {
      if (err.code === err.PERMISSION_DENIED) setState({ status: "denied" });
      else setState({ status: "error", message: err.message });
    };
    if (watch) {
      stop();
      watchIdRef.current = navigator.geolocation.watchPosition(onSuccess, onError, GEO_OPTS);
    } else {
      navigator.geolocation.getCurrentPosition(onSuccess, onError, GEO_OPTS);
    }
  }, [watch, stop]);

  React.useEffect(() => stop, [stop]);

  return { state, locate, stop };
}
