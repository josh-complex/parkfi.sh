/**
 * Client for the self-hosted Valhalla pedestrian routing engine (see
 * `valhalla/README.md`). We never call a third-party routing API — `fetchRoute`
 * asks our own Valhalla for a foot route on OSM footpaths and returns its
 * geometry + distance + ETA for the map to draw.
 *
 * Base URL handling mirrors the pin-embed service: Railway exposes internal
 * services as a schemeless `host:port`, which `fetch` rejects, so we prepend
 * `http://` and default the port to Valhalla's :8002 (and strip a trailing slash
 * so `${VALHALLA_URL}/route` is clean). Set `VALHALLA_URL` to the public domain
 * or the IPv6 `*.railway.internal` host (see README for the IPv6 listen caveat).
 */
import { decodePolyline } from "./polyline.ts";

export const VALHALLA_URL = normalizeBaseUrl(process.env.VALHALLA_URL ?? "http://localhost:8002");

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withScheme.replace(/\/+$/, ""));
  if (!url.port) url.port = "8002";
  return url.toString().replace(/\/+$/, "");
}

const TIMEOUT_MS = Number(process.env.VALHALLA_TIMEOUT_MS ?? 15_000);

export interface RouteManeuver {
  /** Human-readable step, e.g. "Turn right onto the walkway." */
  instruction: string;
  distanceMeters: number;
  timeSeconds: number;
  /** Valhalla maneuver type code. */
  type: number;
  /** Index into `coordinates` where this maneuver begins. */
  beginShapeIndex: number;
}

export interface RouteResult {
  /** Decoded route geometry as [lng, lat] points (GeoJSON / MapLibre order). */
  coordinates: Array<[number, number]>;
  distanceMeters: number;
  durationSeconds: number;
  maneuvers: RouteManeuver[];
}

interface ValhallaManeuver {
  instruction?: string;
  length?: number; // km (we request kilometers units)
  time?: number; // seconds
  type?: number;
  begin_shape_index?: number;
}
interface ValhallaLeg {
  shape?: string; // encoded polyline, precision 6
  maneuvers?: Array<ValhallaManeuver>;
}
interface ValhallaResponse {
  trip?: { legs?: Array<ValhallaLeg>; summary?: { length?: number; time?: number } };
}

/**
 * Walking route from `from` to `to` (both [lng, lat]). Valhalla wants `lat`/`lon`
 * keys with lat first, so we swap; the leg `shape` comes back as a precision-6
 * encoded polyline which we decode back to [lng, lat].
 */
export async function fetchRoute(
  from: [number, number],
  to: [number, number],
  signal?: AbortSignal,
): Promise<RouteResult> {
  const body = {
    locations: [
      { lat: from[1], lon: from[0] },
      { lat: to[1], lon: to[0] },
    ],
    costing: "pedestrian",
    directions_options: { units: "kilometers" },
  };
  const res = await fetch(`${VALHALLA_URL}/route`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`valhalla ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as ValhallaResponse;
  const legs = data.trip?.legs ?? [];
  const coordinates: Array<[number, number]> = [];
  const maneuvers: Array<RouteManeuver> = [];
  for (const leg of legs) {
    const offset = coordinates.length;
    if (leg.shape) coordinates.push(...decodePolyline(leg.shape, 6));
    for (const m of leg.maneuvers ?? []) {
      maneuvers.push({
        instruction: m.instruction ?? "",
        distanceMeters: (m.length ?? 0) * 1000,
        timeSeconds: m.time ?? 0,
        type: m.type ?? 0,
        beginShapeIndex: offset + (m.begin_shape_index ?? 0),
      });
    }
  }
  const summary = data.trip?.summary;
  return {
    coordinates,
    distanceMeters: (summary?.length ?? 0) * 1000,
    durationSeconds: summary?.time ?? 0,
    maneuvers,
  };
}
