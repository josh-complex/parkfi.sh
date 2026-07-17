/**
 * On-device location simulator (device-test-tooling Layer A).
 *
 * When *armed*, this module-level store substitutes coordinates into the real
 * client geolocation path (`useGeolocation` reads it, `AchievementTracker` pings
 * them), so a device at home sends genuine `achievements.ping` mutations every
 * cadence with simulated positions. The server runs everything authentically on
 * its own clock — no new trust surface (`ping` already trusts client coords by
 * design). Nothing here is bundled into a hot path: it's only ever *armed* from
 * the dev panel, which is gated on `import.meta.env.DEV || nav-test-tools`.
 *
 * Same idiom as `ride-debug-log.ts`: a plain store + a `useSyncExternalStore`
 * binding, so it works without any provider and is trivially inspectable.
 */
import * as React from "react";

/** [lng, lat] — GeoJSON / MapLibre order, matching the rest of the app. */
export type LngLat = [number, number];

export type SimKind = "teleport" | "walk" | "queue" | "exit";

export interface SimConfig {
  kind: SimKind;
  /** Human label shown in the panel (e.g. the attraction name). */
  label: string;
  /** Base point for teleport / queue / exit. */
  point?: LngLat;
  /** Ordered waypoints for walk. */
  waypoints?: LngLat[];
  /** Walk speed in m/s (defaults to a stroll; set high to test the cap). */
  speedMs?: number;
  /** Faster ping cadence (~5 s) while armed, so dwell transitions show quickly. */
  fastPing?: boolean;
}

export interface SimCoords {
  lng: number;
  lat: number;
  accuracy: number;
}

/** Last ping response echoed back for the panel (inPark / today rollup). */
export interface SimPingEcho {
  inPark: boolean;
  parkId?: number;
  distanceM?: number;
  queueSeconds?: number;
  rides?: number;
  at: number;
}

export interface SimState {
  armed: boolean;
  config: SimConfig | null;
  coords: SimCoords | null;
  startedAt: number;
  lastPing: SimPingEcho | null;
}

const IDLE: SimState = { armed: false, config: null, coords: null, startedAt: 0, lastPing: null };

let state: SimState = IDLE;
const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | null = null;

const QUEUE_JITTER_M = 10; // ±jitter so a held position looks organic
const DEFAULT_WALK_MS = 1.4; // an unhurried walk
const TELEPORT_ACCURACY_M = 8;
const QUEUE_ACCURACY_M = 12;

function emit(): void {
  for (const l of listeners) l();
}

// --- geo math (flat-earth approx; fine at park scale) ----------------------

function metersBetween(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * 111_320;
  const dLng = (b[0] - a[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/** Offset a point by (east, north) metres. */
function offsetMeters(p: LngLat, east: number, north: number): LngLat {
  const lat = p[1] + north / 111_320;
  const lng = p[0] + east / (111_320 * Math.cos((p[1] * Math.PI) / 180));
  return [lng, lat];
}

/** Position along a polyline at a given travelled distance (clamped to the end). */
function walkAlong(waypoints: LngLat[], travelledM: number): LngLat {
  if (waypoints.length === 1) return waypoints[0];
  let remaining = travelledM;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const segLen = metersBetween(waypoints[i], waypoints[i + 1]);
    if (remaining <= segLen || i === waypoints.length - 2) {
      const f = segLen === 0 ? 0 : Math.min(1, remaining / segLen);
      return [
        waypoints[i][0] + (waypoints[i + 1][0] - waypoints[i][0]) * f,
        waypoints[i][1] + (waypoints[i + 1][1] - waypoints[i][1]) * f,
      ];
    }
    remaining -= segLen;
  }
  return waypoints[waypoints.length - 1];
}

/** Recompute the live sim coordinate for the current config + elapsed time. */
function computeCoords(config: SimConfig, startedAt: number): SimCoords {
  const elapsedS = (Date.now() - startedAt) / 1000;
  switch (config.kind) {
    case "teleport":
    case "exit": {
      const [lng, lat] = config.point ?? [0, 0];
      return { lng, lat, accuracy: TELEPORT_ACCURACY_M };
    }
    case "queue": {
      const base = config.point ?? [0, 0];
      const east = (Math.random() * 2 - 1) * QUEUE_JITTER_M;
      const north = (Math.random() * 2 - 1) * QUEUE_JITTER_M;
      const [lng, lat] = offsetMeters(base, east, north);
      return { lng, lat, accuracy: QUEUE_ACCURACY_M };
    }
    case "walk": {
      const wp = config.waypoints ?? [];
      if (wp.length === 0) return { lng: 0, lat: 0, accuracy: TELEPORT_ACCURACY_M };
      const [lng, lat] = walkAlong(wp, elapsedS * (config.speedMs ?? DEFAULT_WALK_MS));
      return { lng, lat, accuracy: TELEPORT_ACCURACY_M };
    }
  }
}

function refresh(): void {
  if (!state.armed || !state.config) return;
  state = { ...state, coords: computeCoords(state.config, state.startedAt) };
  emit();
}

/** Arm the simulator with a config. Starts a 1 Hz ticker for moving/jittering
 *  sources so consumers see fresh coords; static sources set once. */
export function armSim(config: SimConfig): void {
  if (ticker) clearInterval(ticker);
  const startedAt = Date.now();
  state = {
    armed: true,
    config,
    startedAt,
    coords: computeCoords(config, startedAt),
    lastPing: null,
  };
  if (config.kind === "walk" || config.kind === "queue") {
    ticker = setInterval(refresh, 1000);
  } else {
    ticker = null;
  }
  emit();
}

/** Disarm — hands control back to the real geolocation watch. */
export function disarmSim(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
  state = IDLE;
  emit();
}

/** Current sim coords, or null when disarmed. Consumed by `useGeolocation`. */
export function getSimCoords(): SimCoords | null {
  return state.armed ? state.coords : null;
}

/** Echo a ping response back to the panel so it can show inPark/today. */
export function reportSimPing(echo: Omit<SimPingEcho, "at">): void {
  if (!state.armed) return;
  state = { ...state, lastPing: { ...echo, at: Date.now() } };
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): SimState {
  return state;
}

/** React binding — re-renders on any sim change (arm/disarm, tick, ping echo). */
export function useGeoSim(): SimState {
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
