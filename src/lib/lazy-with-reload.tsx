import * as React from "react";

// After a redeploy the hashed chunk filenames change, but a client still running
// the previous build's HTML (or holding a stale service-worker precache) keeps
// referencing the old names. The next lazy `import()` then 404s with "Failed to
// fetch dynamically imported module", which bubbles to the router's error
// boundary as a generic "Something went wrong!".
//
// The fix is to treat that specific failure as "your HTML is stale" and reload
// once to pull fresh HTML (and therefore fresh chunk hashes). A sessionStorage
// guard keyed per-chunk stops an infinite reload loop: if the import still fails
// after a reload — a genuinely broken build, not just a stale client — we let the
// error surface instead of cycling forever.
const RELOAD_KEY = "parkfi:chunk-reload";

function isModuleLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Failed to fetch/i.test(msg)
  );
}

// Reloads at most once per chunk per session. Returns true if it triggered a
// reload (caller should keep the rejected promise pending so nothing renders the
// error in the brief window before navigation tears the page down).
function reloadOnce(id: string): boolean {
  if (typeof window === "undefined") return false;
  let reloaded: string[] = [];
  try {
    reloaded = JSON.parse(sessionStorage.getItem(RELOAD_KEY) ?? "[]") as string[];
  } catch {
    reloaded = [];
  }
  if (reloaded.includes(id)) return false;
  try {
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify([...reloaded, id]));
  } catch {
    // Private mode / storage disabled — fall through; a reload is still better
    // than a hard error, and worst case the loop guard just doesn't engage.
  }
  window.location.reload();
  return true;
}

/**
 * Drop-in replacement for `React.lazy` that recovers from stale-chunk failures.
 * On a module-load error it reloads the page once (per chunk, per session) to
 * fetch the current build; any other error is rethrown unchanged.
 *
 * `id` must be a stable string unique to the chunk (e.g. its module path) so the
 * per-chunk reload guard works.
 */
// Mirrors React.lazy's own constraint (`ComponentType<any>`) so components with
// required props are accepted — a narrower `unknown` would reject them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithReload<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  id: string,
): React.LazyExoticComponent<T> {
  return React.lazy(() =>
    factory().catch((err: unknown) => {
      if (isModuleLoadError(err) && reloadOnce(id)) {
        // Reload is underway; keep this promise pending so React's Suspense
        // boundary shows the fallback (not the error) until the page navigates.
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }),
  );
}

/**
 * Backstop for any dynamic import that doesn't go through `lazyWithReload`
 * (Vite dispatches `vite:preloadError` when a chunk preload/import fails). Call
 * once on the client. Mirrors the per-session loop guard above under a shared
 * key so the two mechanisms don't double-reload.
 */
export function installPreloadErrorReload(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", () => {
    reloadOnce("vite:preloadError");
  });
}
