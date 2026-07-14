import * as React from "react";
import { onlineManager } from "@tanstack/react-query";

/**
 * Live online/offline status, sourced from react-query's `onlineManager` — the
 * exact same signal that pauses read queries when the device drops offline.
 * Reusing it (rather than a private `navigator.onLine` listener) keeps the
 * offline banner and the paused queries in lockstep: the banner is up precisely
 * while reads are stalled, and clears the instant the manager flips back and the
 * paused fetches resume.
 *
 * SSR returns `true` (assume online) so the server never renders offline chrome.
 */
export function useIsOnline(): boolean {
  return React.useSyncExternalStore(
    (cb) => onlineManager.subscribe(() => cb()),
    () => onlineManager.isOnline(),
    () => true,
  );
}

/**
 * True when a query has nothing to show and can't fix that on its own right now:
 * it either errored, or it's *paused* because the device is offline. The default
 * `networkMode: "online"` parks an offline fetch instead of failing it, so
 * `isError` stays `false` and `isLoading` (= `isPending && isFetching`) drops to
 * `false` too — which is exactly what made the browse tabs fall through to a
 * misleading "empty" message. Callers use this to swap that empty copy for an
 * honest offline/retry state (see `ConnectionLost`).
 *
 * A disabled/idle query (no data, not paused, not errored) returns `false`, so
 * gated queries don't trip it.
 */
export function queryUnavailable(q: {
  data: unknown;
  isError: boolean;
  isPaused: boolean;
}): boolean {
  return q.data === undefined && (q.isError || q.isPaused);
}
