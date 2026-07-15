/**
 * Client-side ride-detection debug ring (B2 field tuning, FOLLOWUP.md W5).
 *
 * During G5–G8 field runs "nothing happened" is otherwise ambiguous between a
 * no-detection, a client-side suppression (no ride signature), a server
 * rejection, and a dedupe. This module-level ring records every detected trace's
 * fate so the debug panel can show it and testers can copy it out for tuning
 * notes. It holds nothing sensitive and never leaves the device except when a
 * tester explicitly copies it.
 */
import * as React from "react";

import type { RideMetrics } from "#/lib/ride-metrics.ts";

export type RideDebugKind = "accepted" | "suppressed" | "rejected" | "duplicate";

export interface RideDebugEntry {
  /** Epoch ms the fate was recorded. */
  at: number;
  kind: RideDebugKind;
  /** Server/rejection reason or the suppression basis; absent when accepted. */
  reason?: string;
  metrics: RideMetrics;
}

const CAP = 20;
const ring: RideDebugEntry[] = [];
const listeners = new Set<() => void>();

/** Record one trace's fate (newest first, capped). Safe to call on web. */
export function logRideDebug(entry: Omit<RideDebugEntry, "at">): void {
  ring.unshift({ at: Date.now(), ...entry });
  if (ring.length > CAP) ring.length = CAP;
  for (const l of listeners) l();
}

/** Current ring, newest first. Stable reference between mutations (for React). */
export function getRideDebugLog(): readonly RideDebugEntry[] {
  return ring;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** React binding for the debug panel — re-renders when the ring changes. */
export function useRideDebugLog(): readonly RideDebugEntry[] {
  return React.useSyncExternalStore(subscribe, getRideDebugLog, getRideDebugLog);
}
