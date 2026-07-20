import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { isNative } from "#/lib/platform.ts";

import type { PluginListenerHandle } from "@capacitor/core";

/**
 * Native shell only: app-lifecycle glue that a web browser gives us for free but
 * the Capacitor WebView does not.
 *
 * - **Resume refresh.** When a guest reopens the app after hours in a park, its
 *   on-screen data (wait times, dining, the dashboard) is stale — the WebView
 *   was frozen the whole time. On `appStateChange → isActive` we refetch the
 *   *active* (mounted) queries only, so the visible screen updates without
 *   hammering every cache entry.
 * - **Android hardware back.** Unhandled, Android's back gesture on the root
 *   route drops the user straight out of the app. We route it through the
 *   TanStack history instead, and only *background* the app (never hard-exit)
 *   when there's nowhere left to go back to — the platform-standard behaviour.
 *
 * Renders nothing; no-ops on web/SSR. The `@capacitor/app` plugin is dynamically
 * imported so it never enters the web bundle.
 */
export function NativeLifecycle() {
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isNative()) return;
    let stateHandle: PluginListenerHandle | null = null;
    let backHandle: PluginListenerHandle | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const { App } = await import("@capacitor/app");

        const sh = await App.addListener("appStateChange", ({ isActive }) => {
          // Only refetch what's mounted — a resume shouldn't stampede every
          // cached query, just make the screen the user is looking at correct.
          if (isActive) void queryClient.invalidateQueries({ refetchType: "active" });
        });

        const bh = await App.addListener("backButton", ({ canGoBack }) => {
          if (canGoBack) router.history.back();
          // Root route: mirror the platform convention — send the app to the
          // background rather than killing it, so a resume restores state.
          else void App.minimizeApp();
        });

        if (cancelled) {
          void sh.remove();
          void bh.remove();
        } else {
          stateHandle = sh;
          backHandle = bh;
        }
      } catch {
        /* plugin unavailable — lifecycle glue is best-effort */
      }
    })();

    return () => {
      cancelled = true;
      void stateHandle?.remove();
      void backHandle?.remove();
    };
  }, [router, queryClient]);

  return null;
}
