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
import { PWARegister } from "#/components/pwa-register";
import { RouteErrorFallback } from "#/components/route-error-fallback";
import { JsonLd } from "#/components/seo/json-ld.tsx";
import { seo, websiteJsonLd } from "#/lib/seo.ts";

interface MyRouterContext {
  queryClient: QueryClient;

  trpc: TRPCOptionsProxy<TRPCRouter>;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
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
          content: "width=device-width, initial-scale=1, viewport-fit=cover",
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
            defaultTheme="light"
            enableSystem={false}
            disableTransitionOnChange
          >
            <FaviconSync />
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
