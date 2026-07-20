import type { PermissionStatus, Position } from "@capacitor/geolocation";

import { isNative } from "#/lib/platform.ts";

/**
 * Geolocation source adapter — one interface over two very different backends:
 *
 *  - **Web**: `navigator.geolocation`, used synchronously.
 *  - **Native (Capacitor)**: `@capacitor/geolocation`, which bridges to
 *    CoreLocation / FusedLocation. We route native through the plugin because
 *    iOS WKWebView's `navigator.geolocation` is unreliable — the plugin is the
 *    canonical, supported path in the shell. It's an *async* API (watch ids and
 *    `clearWatch` come back via promises), so the native watch handle below can
 *    be told to `clear()` before it has even finished starting.
 *
 * Everything is normalized to {@link GeoFix} / {@link GeoSourceError} in the
 * project's `[lng, lat]` order so the hook never touches platform types. The
 * plugin is dynamically imported so it stays out of the web bundle.
 */

/** Normalized fix in `[lng, lat]` order (GeoJSON / MapLibre). */
export type GeoFix = { coords: [number, number]; accuracy: number; heading: number | null };

/**
 * Normalized failure. `denied` is the user/OS refusal the hook treats specially
 * (funnel event, flag clear); `unavailable` means there's no usable geolocation
 * source at all; everything else is a transient `error`.
 */
export type GeoSourceError =
  | { kind: "denied" }
  | { kind: "unavailable" }
  | { kind: "error"; code: number | null; message: string };

export type GeoHandlers = {
  onFix: (fix: GeoFix) => void;
  onError: (err: GeoSourceError) => void;
};

/** A running watch. `clear()` is idempotent and safe to call before an async
 *  native watch has finished starting (it cancels the pending start too). */
export interface GeoWatch {
  clear(): void;
}

/** Whether a usable geolocation source exists right now. Native always has one
 *  (the plugin); web needs the API present and a secure context. */
export function geolocationAvailable(): boolean {
  if (isNative()) return true;
  return (
    typeof navigator !== "undefined" &&
    !!navigator.geolocation &&
    typeof window !== "undefined" &&
    window.isSecureContext
  );
}

function webPositionToFix(pos: GeolocationPosition): GeoFix {
  return {
    coords: [pos.coords.longitude, pos.coords.latitude],
    accuracy: pos.coords.accuracy,
    heading: pos.coords.heading,
  };
}

function nativePositionToFix(pos: Position): GeoFix {
  return {
    coords: [pos.coords.longitude, pos.coords.latitude],
    accuracy: pos.coords.accuracy,
    // On the native plugin (8.2+) `heading` prioritizes the real compass heading,
    // falling back to course — better than the web value, which is course-only
    // and null while stationary.
    heading: pos.coords.heading ?? null,
  };
}

function webErrorToSource(err: GeolocationPositionError): GeoSourceError {
  // Only an outright permission denial is special. POSITION_UNAVAILABLE and
  // TIMEOUT are transient and surface as a generic `error` — `unavailable` is
  // reserved for "there is no geolocation source" (see `geolocationAvailable`).
  if (err.code === err.PERMISSION_DENIED) return { kind: "denied" };
  return { kind: "error", code: err.code, message: err.message };
}

function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

const isGranted = (s: PermissionStatus): boolean =>
  s.location === "granted" || s.coarseLocation === "granted";

/**
 * Native watch/one-shot. Resolves permission deterministically up front —
 * `checkPermissions`, then `requestPermissions` if not yet granted — rather than
 * trying to parse a denial out of a plugin error. `requestPermissions` is a
 * no-op returning `granted` when the grant already exists, so the cross-session
 * resume path (which only calls in when the OS already grants) never prompts;
 * a first tap with permission still in `prompt` surfaces the OS dialog as
 * expected.
 */
function startNativeWatch(options: PositionOptions, h: GeoHandlers, watch: boolean): GeoWatch {
  let cleared = false;
  let watchId: string | null = null;
  void (async () => {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      let status = await Geolocation.checkPermissions();
      if (!isGranted(status)) status = await Geolocation.requestPermissions();
      if (cleared) return;
      if (!isGranted(status)) {
        h.onError({ kind: "denied" });
        return;
      }
      if (!watch) {
        const pos = await Geolocation.getCurrentPosition(options);
        if (!cleared) h.onFix(nativePositionToFix(pos));
        return;
      }
      const id = await Geolocation.watchPosition(options, (pos, err) => {
        if (cleared) return;
        if (err) {
          h.onError({ kind: "error", code: null, message: errorMessage(err) });
          return;
        }
        if (pos) h.onFix(nativePositionToFix(pos));
      });
      // A `clear()` that landed while the watch was still starting: tear it down
      // now that we finally have its id.
      if (cleared) {
        void Geolocation.clearWatch({ id });
        return;
      }
      watchId = id;
    } catch (e) {
      if (!cleared) h.onError({ kind: "error", code: null, message: errorMessage(e) });
    }
  })();
  return {
    clear() {
      cleared = true;
      if (watchId != null) {
        const id = watchId;
        watchId = null;
        void import("@capacitor/geolocation").then(({ Geolocation }) =>
          Geolocation.clearWatch({ id }),
        );
      }
    },
  };
}

/** Start a live watch. Returns a handle immediately on both platforms. */
export function startWatch(options: PositionOptions, h: GeoHandlers): GeoWatch {
  if (isNative()) return startNativeWatch(options, h, true);
  const id = navigator.geolocation.watchPosition(
    (pos) => h.onFix(webPositionToFix(pos)),
    (err) => h.onError(webErrorToSource(err)),
    options,
  );
  return {
    clear() {
      navigator.geolocation.clearWatch(id);
    },
  };
}

/** One-shot fix (no live watch). */
export function getOnce(options: PositionOptions, h: GeoHandlers): void {
  if (isNative()) {
    startNativeWatch(options, h, false);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => h.onFix(webPositionToFix(pos)),
    (err) => h.onError(webErrorToSource(err)),
    options,
  );
}

/**
 * Native-only: read the phone's location permission via the plugin — the source
 * of truth for whether locate can silently re-engage on launch. Returns false
 * (never throws) off native or if the read fails.
 */
export async function nativeLocationGranted(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    return isGranted(await Geolocation.checkPermissions());
  } catch {
    return false;
  }
}
