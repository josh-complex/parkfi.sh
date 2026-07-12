import * as React from "react";

import { isNative } from "#/lib/platform.ts";

/**
 * SSR-safe {@link isNative}. Returns `false` during SSR and the first client
 * paint, then the real value after mount — so a native-only affordance never
 * causes a hydration mismatch (server and first client render agree on the
 * web branch; the effect flips it on device). Use this, not `isNative()`
 * directly, inside rendered output.
 *
 * Main use: choosing an MDE `mdx://` app deep link vs. a Disney website URL —
 * the custom scheme only resolves in the native shell, so the web branch must
 * win everywhere else.
 */
export function useIsNative(): boolean {
  const [native, setNative] = React.useState(false);
  React.useEffect(() => setNative(isNative()), []);
  return native;
}
