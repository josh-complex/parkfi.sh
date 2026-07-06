import { PostHog } from "posthog-node";

/**
 * Lazy PostHog client for the long-lived web server (Nitro process). Shared so
 * every server-side capture point (currently the tRPC handler) uses one batching
 * client. Returns `null` when no key is configured so callers can no-op safely
 * in local/dev without env.
 *
 * `POSTHOG_KEY` is the server-side name; we also accept `VITE_POSTHOG_KEY`
 * (already present in the web build env) as a fallback — the VITE_ prefix is a
 * client-bundle convention, so services get a plain `POSTHOG_KEY`.
 */
let client: PostHog | null = null;

export function serverPostHog(): PostHog | null {
  const key = process.env.POSTHOG_KEY ?? process.env.VITE_POSTHOG_KEY;
  if (!key) return null;
  client ??= new PostHog(key, {
    host: process.env.POSTHOG_HOST ?? process.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com",
  });
  return client;
}
