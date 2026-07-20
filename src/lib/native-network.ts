import { Store } from "@tanstack/store";

import { isNative } from "#/lib/platform.ts";

/**
 * Connectivity state for the native shell.
 *
 * Parks have famously bad cell signal, so "am I online" is load-bearing here:
 * the achievement ping loop, tRPC queries, and any write want to back off while
 * offline rather than pile up failing requests (and a thrashing radio drains the
 * battery faster than anything). On native we read `@capacitor/network`, which
 * reports true OS connectivity; on web we fall back to `navigator.onLine`.
 *
 * `true` until proven otherwise, so nothing gates itself off before the first
 * status read resolves.
 */
export const onlineStore = new Store(true);

let started = false;

/**
 * Begin tracking connectivity into {@link onlineStore}. Idempotent. On native the
 * plugin is dynamically imported (kept out of the web bundle); on web we bind to
 * the `online`/`offline` window events. Returns a disposer, though the store is a
 * process singleton so callers rarely need it.
 */
export function initNetworkWatch(): () => void {
  if (started || typeof window === "undefined") return () => {};
  started = true;

  if (isNative()) {
    let handleP: Promise<{ remove: () => void }> | null = null;
    void (async () => {
      try {
        const { Network } = await import("@capacitor/network");
        const status = await Network.getStatus();
        onlineStore.setState(() => status.connected);
        handleP = Network.addListener("networkStatusChange", (s) => {
          onlineStore.setState(() => s.connected);
        });
      } catch {
        /* plugin unavailable — leave the optimistic default */
      }
    })();
    return () => void handleP?.then((h) => h.remove());
  }

  const sync = () => onlineStore.setState(() => navigator.onLine);
  sync();
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  return () => {
    window.removeEventListener("online", sync);
    window.removeEventListener("offline", sync);
  };
}

/** Current connectivity without subscribing — for imperative gates (e.g. the
 *  ping loop) that already run on a timer and don't need to re-render. */
export function isOnline(): boolean {
  return onlineStore.state;
}
