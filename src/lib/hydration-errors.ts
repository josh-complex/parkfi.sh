import { reportError } from "#/lib/report-error.ts";

/**
 * Recoverable React errors — above all hydration mismatches (React #418/#423/
 * #425), which React swallows by re-rendering the tree on the client and
 * reports only through `hydrateRoot`'s `onRecoverableError`. That hook runs
 * *during* hydration, before `PostHogProvider` has booted the client, so
 * `client.tsx` parks each one here and the provider flushes them once PostHog
 * is up.
 *
 * Why bother: a mismatch in production is silent (the page still works) but
 * costs a full client re-render on every load, and the minified message names
 * nothing. The `componentStack` React hands us here is the one thing that does
 * — it names the component whose markup disagreed with the server's.
 */
interface RecoverableError {
  error: unknown;
  componentStack: string | undefined;
}

const pending: Array<RecoverableError> = [];
let flushed = false;

const HYDRATION_RE = /hydrat|#418\b|#423\b|#425\b/i;

export function recordRecoverableError(error: unknown, componentStack?: string): void {
  // Keep React's default behaviour of surfacing it in the console — with the
  // one thing the default lacks.
  // eslint-disable-next-line no-console
  console.error(error, componentStack ? `\nComponent stack:${componentStack}` : "");
  if (flushed) {
    send({ error, componentStack });
    return;
  }
  pending.push({ error, componentStack });
}

/** Called once by `PostHogProvider` after `posthog.init`. Later records go
 *  straight through. */
export function flushRecoverableErrors(): void {
  flushed = true;
  for (const entry of pending.splice(0)) send(entry);
}

function send({ error, componentStack }: RecoverableError): void {
  const message = error instanceof Error ? error.message : String(error);
  reportError(error, {
    source: "render",
    // The page recovered on its own; nothing to toast, but worth an issue.
    severity: "degraded",
    context: {
      recoverable: true,
      hydrationMismatch: HYDRATION_RE.test(message),
      componentStack,
      path: typeof location === "undefined" ? undefined : location.pathname,
    },
  });
}
