import posthog from "posthog-js";
import { PostHogProvider as BasePostHogProvider, usePostHog } from "@posthog/react";
import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";

import { authClient } from "#/lib/auth-client.ts";

import { CfImagesFlagSync } from "./feature-flags.ts";

if (typeof window !== "undefined" && import.meta.env.VITE_POSTHOG_KEY) {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com",
    person_profiles: "identified_only",
    // SPA pageviews are captured manually in <PostHogPageview> on each router
    // navigation; auto-capture would fire on initial load only and miss them.
    capture_pageview: false,
    // Pageleave powers web-analytics bounce rate + session duration. With
    // capture_pageview off, the "2025-11-30" defaults won't auto-enable it
    // ("if_capture_pageview"), so turn it on explicitly.
    capture_pageleave: true,
    // Don't inject the surveys <script> into the DOM pre-hydration — it caused a
    // hydration mismatch around the SSR-rendered JsonLd <script>. Re-enable if we
    // ever adopt PostHog surveys.
    disable_surveys: true,
    // Auto-capture uncaught errors + unhandled promise rejections into Error
    // Tracking. This is the backstop for everything the explicit instrumentation
    // (router onCatch, query/mutation sinks, targeted call sites) doesn't cover.
    // Note: `lazyWithReload` keeps its rejected import pending during its one-shot
    // reload, so no unhandled rejection fires on the recoverable stale-chunk path.
    capture_exceptions: true,
    defaults: "2025-11-30",
  });
}

/**
 * Captures a `$pageview` for web analytics on every client-side navigation.
 *
 * TanStack Router is a SPA: after the initial document load it swaps routes via
 * the History API without a full page load, so PostHog's auto-capture can't see
 * them. We fire the initial pageview on mount, then subscribe to the router's
 * `onResolved` event (fired after each navigation settles, with the new URL
 * already on `window.location`) for every subsequent one. PostHog dedupes the
 * initial load because `subscribe` is attached after the first resolution.
 *
 * Client-only by construction: the subscription lives in an effect, so it never
 * runs during SSR.
 */
function PostHogPageview(): null {
  const ph = usePostHog();
  const router = useRouter();

  useEffect(() => {
    if (!ph) return;
    ph.capture("$pageview");
    return router.subscribe("onResolved", () => {
      ph.capture("$pageview");
    });
  }, [ph, router]);

  return null;
}

/**
 * Links the PostHog person to the signed-in Better-Auth user.
 *
 * A session-watching effect (not a login callback) is the robust approach: it
 * covers email/password, signup, passkey, and OAuth uniformly, because all of
 * them resolve to a client session. `identify()` also changes the distinct id,
 * which makes PostHog reload feature flags for the real user — that's what lets
 * us target flags like `living-layer` per account.
 *
 * Correctness guards:
 *  - never act while the session is still `isPending` (avoids reset()-ing a
 *    real user on every page load before the session resolves);
 *  - only `identify` on an anonymous→user (or user→different-user) transition,
 *    tracked via a ref, so we don't re-identify on every render;
 *  - only `reset()` on a genuine user→anonymous transition (real logout).
 */
function PostHogIdentify(): null {
  const ph = usePostHog();
  const { data: session, isPending } = authClient.useSession();
  const lastIdentified = useRef<string | null>(null);

  const userId = session?.user?.id;
  const email = session?.user?.email;
  const name = session?.user?.name;

  useEffect(() => {
    if (!ph || isPending) return;
    if (userId) {
      if (lastIdentified.current !== userId) {
        ph.identify(userId, { email, name });
        lastIdentified.current = userId;
      }
    } else if (lastIdentified.current !== null) {
      // Genuine logout: clear the person + revert flags to anonymous.
      ph.reset();
      lastIdentified.current = null;
    }
  }, [ph, isPending, userId, email, name]);

  return null;
}

interface PostHogProviderProps {
  children: ReactNode;
}

export default function PostHogProvider({ children }: PostHogProviderProps) {
  return (
    <BasePostHogProvider client={posthog}>
      <PostHogIdentify />
      <PostHogPageview />
      <CfImagesFlagSync />
      {children}
    </BasePostHogProvider>
  );
}
