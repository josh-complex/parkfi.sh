import * as React from "react";

/**
 * `false` during SSR and the first client render, then `true` after hydration.
 *
 * Gate any output that legitimately differs between server and client — e.g. a
 * relative "x min ago" label computed from the current clock — behind this so
 * the first client render still matches the server HTML and React doesn't throw
 * a hydration mismatch.
 */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
