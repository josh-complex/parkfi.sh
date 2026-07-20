import { useEffect } from "react";
import { HeadContent, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { ThemeProvider } from "next-themes";

import PostHogProvider from "../integrations/posthog/provider";

import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";

import appCss from "../styles.css?url";

import type { QueryClient } from "@tanstack/react-query";

import type { TRPCRouter } from "#/integrations/trpc/router";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { TooltipProvider } from "#/components/ui/tooltip";
import { Toaster } from "#/components/ui/sonner";
import { FaviconSync } from "#/components/favicon-sync.tsx";
import { NativeSystemBars } from "#/components/native-system-bars.tsx";
import { NativeLifecycle } from "#/components/native-lifecycle.tsx";
import { PWARegister } from "#/components/pwa-register";
import { RouteErrorFallback } from "#/components/route-error-fallback";
import { JsonLd } from "#/components/seo/json-ld.tsx";
import { seo, websiteJsonLd } from "#/lib/seo.ts";
import { markLaunched } from "#/lib/app-launch.ts";
import { syncDeviceCornerRadius } from "#/lib/device-corners.ts";
import { armSplashFailsafe, hideSplash } from "#/lib/native-splash.ts";
import { initNetworkWatch } from "#/lib/native-network.ts";
import { isNative } from "#/lib/platform.ts";
import { loadToken } from "#/lib/native-token.ts";
import { initNativeAuthDeepLinks } from "#/lib/native-oauth.ts";

interface MyRouterContext {
  queryClient: QueryClient;

  trpc: TRPCOptionsProxy<TRPCRouter>;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  // Native shell only: hydrate the persisted bearer token into memory before any
  // loader query fires, so the first authed request carries `Authorization`.
  // No-op on web/SSR/prerender (isNative() is false there); loadToken() caches
  // after the first call, so repeat navigations are instant.
  beforeLoad: async () => {
    if (isNative()) {
      await loadToken();
      // Register the OAuth deep-link handler once (idempotent) so a
      // `parkfi://auth-callback` return is caught even if the flow started
      // before the login route mounted.
      initNativeAuthDeepLinks();
    }
  },
  head: () => {
    const base = seo({
      title: "ParkFi — Live Theme Park Wait Times, Ticket Prices & Dining",
      description:
        "Track real-time wait times, Lightning Lane availability, ticket pricing, and dining reservations across Walt Disney World and Universal Orlando — all on one live park map.",
      keywords:
        "theme park wait times, Disney World wait times, Universal Orlando wait times, Lightning Lane availability, theme park ticket prices, dining reservations, live park map",
      // No `path` here: each route owns its own canonical. TanStack merges/dedupes
      // meta by name but NOT <link> tags, so a canonical set here would be emitted
      // on every page *in addition* to the route's own — telling Google every deep
      // page is a duplicate of "/". The homepage canonical comes from _dash/index.
    });
    return {
      meta: [
        { charSet: "utf-8" },
        {
          name: "viewport",
          // `interactive-widget=resizes-visual` (the spec default, pinned here
          // because it's load-bearing): the on-screen keyboard shrinks only the
          // *visual* viewport, never the layout viewport. The map (`fixed
          // inset-0`) and other full-height shells stay put, and keyboard-aware
          // panels (see omni-search.tsx) size themselves off `visualViewport`.
          // On Android this only holds once the native window stops resizing
          // for the IME — see `windowSoftInputMode="adjustNothing"` in the
          // AndroidManifest.
          content:
            "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-visual",
        },
        { name: "theme-color", content: "#1c468e" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
        { name: "apple-mobile-web-app-title", content: "ParkFi" },
        { name: "robots", content: "index, follow" },
        ...base.meta,
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "manifest", href: "/manifest.json" },
        // iOS home-screen icon: Safari doesn't reliably decode webp for
        // apple-touch-icon, so point at the brand PNG.
        { rel: "apple-touch-icon", href: "/img/brand/full_white.png" },
        // Tab favicon. The SVG carries a prefers-color-scheme media query so the
        // mark flips to white on dark tab bars (and stays brand blue on light) —
        // honored by SVG-favicon browsers (Chrome/Edge/Firefox/Safari 16+). The
        // webp/PNG are raster fallbacks for browsers without SVG-favicon support.
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "icon", type: "image/webp", href: "/img/brand/blue.webp" },
        { rel: "icon", type: "image/png", href: "/img/brand/blue.png" },
        ...base.links,
      ],
    };
  },
  // Shell-level errors (above `_dash`) get the same full-pane fallback as every
  // other route; the capture is centralized in the router's `defaultOnCatch`.
  errorComponent: RouteErrorFallback,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  // Runs once after the initial route has resolved and rendered, so any
  // launch-time redirect (see the "/" route) has already been decided. From here
  // on, `hasLaunched()` is true and in-app navigations behave normally.
  useEffect(markLaunched, []);

  // Flag the Capacitor native shell for CSS. The WKWebView/WebView reports
  // `display-mode: browser`, so our `@media (display-mode: standalone)` safe-area
  // compensation never fires natively; the `.native` hook (styles.css) mirrors it
  // so native matches the installed PWA instead of floating above the home
  // indicator. Client-only: `isNative()` is false on SSR/web.
  useEffect(() => {
    if (isNative()) {
      document.documentElement.classList.add("native");
      // Fire-and-forget: publishes --device-corner-radius-* so the bottom nav
      // rounds concentric with the physical display corners.
      void syncDeviceCornerRadius();
      // The launch splash is held (launchAutoHide:false) until the app has
      // painted — dismiss it now, with a failsafe so it can never wedge.
      void hideSplash();
      armSplashFailsafe();
      // Start tracking OS connectivity so offline-aware paths can back off.
      initNetworkWatch();
    }
  }, []);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <JsonLd data={websiteJsonLd()} />
        <PostHogProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <FaviconSync />
            <NativeSystemBars />
            <NativeLifecycle />
            <TooltipProvider>
              {children}
              <TanStackDevtools
                config={{
                  triggerHidden: true,
                }}
                plugins={[
                  {
                    name: "Tanstack Router",
                    render: <TanStackRouterDevtoolsPanel />,
                  },
                  TanStackQueryDevtools,
                ]}
              />
            </TooltipProvider>
            <Toaster position="top-center" />
          </ThemeProvider>
        </PostHogProvider>
        <PWARegister />
        <Scripts />
      </body>
    </html>
  );
}
