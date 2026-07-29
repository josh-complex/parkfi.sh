/**
 * Pure geometry/selection helpers for the achievement tracker's ping loop —
 * extracted so the W1 fix-selection and near-park escalation rules are
 * unit-testable without React (see tracker-geo.test.ts).
 */

/** A candidate fix for the ping loop, normalized to scalar fields. */
export interface CandidateFix {
  lng: number;
  lat: number;
  accuracy: number;
}

/** Shared-store fix shape (`lastFixStore`): [lng, lat] + accuracy + capture time. */
export interface SharedFix {
  coords: [number, number];
  accuracy: number;
  capturedAt: number;
}

/** How recent a shared fix must be to *beat* the tracker's own fix. */
export const LAST_FIX_FRESH_MS = 60_000;

/**
 * Best-fix selection (W1): among the tracker's own watch fix and the shared
 * last-fix (fed by every other watch — the map's nav/high watch included),
 * prefer the shared fix when it's fresh (< {@link LAST_FIX_FRESH_MS}) and more
 * accurate. The old "own state first" rule made the tracker's coarse low-power
 * fix shadow a GPS-grade map fix, which is how outdoor park pings landed above
 * the server's 150 m accuracy gate all day.
 */
export function selectBestFix(
  own: CandidateFix | null,
  shared: SharedFix | null,
  nowMs: number,
): (CandidateFix & { source: "own" | "shared" }) | null {
  const alt = shared
    ? {
        lng: shared.coords[0],
        lat: shared.coords[1],
        accuracy: shared.accuracy,
        source: "shared" as const,
      }
    : null;
  if (!own) return alt;
  if (
    alt &&
    shared &&
    nowMs - shared.capturedAt < LAST_FIX_FRESH_MS &&
    shared.accuracy < own.accuracy
  ) {
    return alt;
  }
  return { ...own, source: "own" };
}

/** One park's geofence bbox (the `fence` field of `parks.list`, hull fallback). */
export interface FenceBox {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

/**
 * Padding around a park fence that counts as "plausibly at the park" for the
 * watch-profile escalation. Deliberately generous: a coarse wifi/cell fix
 * (tens to a few hundred metres of error) is precisely good enough for this
 * test, and escalating a kilometre early just means GPS is already warm when
 * the user walks through the gate.
 */
export const NEAR_PARK_PAD_M = 2_000;

/**
 * Whether a point falls inside any park fence bbox padded by `padM`. Pure
 * planar-degree math (equirectangular pad), fine at this scale.
 */
export function isNearAnyPark(
  lng: number,
  lat: number,
  fences: ReadonlyArray<FenceBox>,
  padM: number = NEAR_PARK_PAD_M,
): boolean {
  const latPad = padM / 111_320;
  for (const b of fences) {
    const midLat = (b.latMin + b.latMax) / 2;
    const lngPad = latPad / Math.cos((midLat * Math.PI) / 180);
    if (
      lat >= b.latMin - latPad &&
      lat <= b.latMax + latPad &&
      lng >= b.lngMin - lngPad &&
      lng <= b.lngMax + lngPad
    ) {
      return true;
    }
  }
  return false;
}
