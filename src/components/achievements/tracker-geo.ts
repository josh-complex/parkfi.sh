/**
 * Pure geometry/selection helpers for the achievement tracker's ping loop —
 * extracted so the W1 fix-selection and near-park escalation rules are
 * unit-testable without React (see tracker-geo.test.ts).
 */

/** A candidate fix for the ping loop, normalized to scalar fields. `capturedAt`
 *  is the fix's own platform timestamp (epoch ms), used for the age bound. */
export interface CandidateFix {
  lng: number;
  lat: number;
  accuracy: number;
  capturedAt: number;
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
 * Oldest fix (by its own `capturedAt`) the ping loop will send at all. Three
 * loop intervals: a live watch delivers far more often than this, so only a
 * watch that stopped delivering — the WebView frozen in the background — leaves
 * a fix this old. Replaying that fix on resume is how a pre-background,
 * in-park coordinate was pinged 600 ms *after* the geofence exit on the
 * 2026-08-29 hop day (R3); past this bound the tick treats it as "no fix".
 */
export const FIX_MAX_AGE_MS = 90_000;

/**
 * Best-fix selection (W1): among the tracker's own watch fix and the shared
 * last-fix (fed by every other watch — the map's nav/high watch included),
 * prefer the shared fix when it's fresh (< {@link LAST_FIX_FRESH_MS}) and more
 * accurate. The old "own state first" rule made the tracker's coarse low-power
 * fix shadow a GPS-grade map fix, which is how outdoor park pings landed above
 * the server's 150 m accuracy gate all day.
 *
 * Either candidate older than {@link FIX_MAX_AGE_MS} is discarded first (R3);
 * null when nothing usable remains.
 */
export function selectBestFix(
  own: CandidateFix | null,
  shared: SharedFix | null,
  nowMs: number,
): (CandidateFix & { source: "own" | "shared" }) | null {
  const fresh = (capturedAt: number) => nowMs - capturedAt <= FIX_MAX_AGE_MS;
  const ownOk = own && fresh(own.capturedAt) ? own : null;
  const sharedOk = shared && fresh(shared.capturedAt) ? shared : null;
  const alt = sharedOk
    ? {
        lng: sharedOk.coords[0],
        lat: sharedOk.coords[1],
        accuracy: sharedOk.accuracy,
        capturedAt: sharedOk.capturedAt,
        source: "shared" as const,
      }
    : null;
  if (!ownOk) return alt;
  if (
    alt &&
    sharedOk &&
    nowMs - sharedOk.capturedAt < LAST_FIX_FRESH_MS &&
    sharedOk.accuracy < ownOk.accuracy
  ) {
    return alt;
  }
  return { ...ownOk, source: "own" };
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
