import posthog from "posthog-js";
import { toast } from "sonner";

/**
 * Where an error originated. Drives PostHog grouping/triage; keep the set small
 * and stable so Error Tracking issues stay meaningful.
 */
export type ErrorSource =
  | "render" // React error boundary / router onCatch
  | "route-loader" // SSR/client loader ensureQueryData
  | "query" // queryCache.onError
  | "mutation" // mutationCache.onError
  | "chunk-load" // lazyWithReload / vite:preloadError
  | "map" // MapLibre/WebGL
  | "auth" // Better-Auth client flows
  | "device" // geolocation / heading / notifications / SW
  | "manual"; // ad-hoc call sites

export type ErrorSeverity = "critical" | "degraded" | "expected";

export interface ReportErrorOptions {
  source: ErrorSource;
  severity: ErrorSeverity;
  /** Extra grouping/triage props: feature, queryKey/path, route, parkSlug, ... */
  context?: Record<string, unknown>;
  /**
   * Critical-severity toast heading. `false` suppresses the toast (already
   * surfaced inline, e.g. a login error state or a route error component).
   * Defaults to a generic heading.
   */
  toast?: string | false;
  /**
   * Optional lighter subtext under the heading (the toast's second line). When
   * omitted and no custom `toast` heading is given, a generic subtext is shown.
   */
  toastDescription?: string;
  /** Stable id for sonner dedupe so repeated failures don't stack N toasts. */
  toastId?: string;
}

const GENERIC_TITLE = "Something went wrong";
const GENERIC_DESCRIPTION = "Please try again in a moment.";

/**
 * Single funnel for every reported error so call sites stay one-liners and the
 * severity/toast/telemetry conventions live in one place.
 *
 * - `expected` → a plain PostHog event (never an exception) so Error Tracking
 *   signal stays clean; never toasts.
 * - `degraded` / `critical` → `captureException`, tagged with source + severity.
 * - `critical` additionally toasts (unless `toast: false`), deduped by id.
 *
 * SSR-safe: `posthog-js` and sonner only run in the browser, so on the server we
 * fall back to `console.error`. Phase 3 routes the server path to posthog-node
 * (tRPC handler + services already capture there); this keeps the client helper
 * from ever touching browser-only globals during SSR prefetch.
 */
export function reportError(error: unknown, opts: ReportErrorOptions): void {
  const err = error instanceof Error ? error : new Error(String(error));

  // Server (SSR loader / query prefetch): no posthog-js, no sonner. Server-side
  // capture is handled by the tRPC handler and the services telemetry helper.
  if (typeof window === "undefined") {
    // eslint-disable-next-line no-console
    console.error(`[report-error:${opts.source}] ${err.message}`, opts.context ?? "");
    return;
  }

  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  if (opts.severity === "expected") {
    // Event, not exception — keeps Error Tracking signal clean.
    posthog.capture("expected_error", {
      source: opts.source,
      message: err.message,
      ...opts.context,
    });
    return;
  }

  posthog.captureException(err, {
    source: opts.source,
    severity: opts.severity,
    ...(offline ? { offline: true } : {}),
    ...opts.context,
  });

  if (opts.severity !== "critical" || opts.toast === false) return;

  // Offline: the persistent `OfflineBanner` (driven by react-query's
  // onlineManager) already tells the user their connection is down, and the
  // browse tabs show their own inline offline state — so a dead connection that
  // fails every in-flight request at once must NOT also throw a toast (or a
  // whole tower of them). We still captured above for telemetry; just stop here.
  if (offline) return;

  // Heading + optional lighter subtext. With no custom heading we show the
  // generic two-liner; a custom heading only gets a subtext if one is provided.
  const title = opts.toast ?? GENERIC_TITLE;
  const description =
    opts.toastDescription ?? (opts.toast === undefined ? GENERIC_DESCRIPTION : undefined);

  toast.error(title, {
    id: opts.toastId ?? `${opts.source}:${err.message}`,
    description,
  });
}
