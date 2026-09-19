import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";

import { recordRecoverableError } from "#/lib/hydration-errors.ts";

/**
 * Custom client entry. Identical to TanStack Start's default (which this file
 * shadows by name) except for `onRecoverableError`: React's default just calls
 * `reportError`, which leaves a bare minified "#418" in the console and in
 * PostHog with no way to tell *which* component disagreed with the server.
 * Routing it through `recordRecoverableError` keeps the console line and adds
 * React's component stack to the captured issue (see `lib/hydration-errors.ts`).
 */
startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
    {
      onRecoverableError: (error, errorInfo) => {
        recordRecoverableError(error, errorInfo.componentStack ?? undefined);
      },
    },
  );
});
