import { PostHog } from "posthog-node";

// Background services (worker, geo, crons) report only to Railway stdout without
// this. A single lazy client per process gives PostHog Error Tracking grouping +
// alerting on top of the existing `console.error` logs.
//
// `distinctId` is always `service:<name>` so these exceptions stay OUT of person
// profiles (the project is `identified_only`, so no person is created) while
// remaining filterable by service in the dashboard.
const key = process.env.POSTHOG_KEY;
const ph = key
  ? new PostHog(key, {
      host: process.env.POSTHOG_HOST ?? "https://us.i.posthog.com",
    })
  : null;

/**
 * Capture a service failure to PostHog (and stderr). `service` tags the source
 * (e.g. "worker", "cron-weather"); `step` narrows it (e.g. a park slug, feed
 * name, or "main"). Never throws — telemetry must not take down a service.
 */
export function reportServiceError(service: string, step: string, error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  // eslint-disable-next-line no-console
  console.error(`[${service}] ${step} failed:`, err);
  ph?.captureException(err, `service:${service}`, { source: "service", service, step });
}

/**
 * Flush queued events before the process exits. MUST be awaited before
 * `process.exit` in crons or the batched events are dropped — this is the whole
 * reason the helper exists.
 */
export async function flushTelemetry(): Promise<void> {
  await ph?.shutdown();
}
