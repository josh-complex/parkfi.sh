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
import { PWARegister } from "#/components/pwa-register";
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
      path: "/",
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
        { rel: "apple-touch-icon", href: "/icons/icon-192.png" },
        { rel: "icon", href: "/favicon.ico" },
        ...base.links,
      ],
    };
  },
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <JsonLd data={websiteJsonLd()} />
        <PostHogProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <TooltipProvider>
              {children}
              <TanStackDevtools
                config={{
                  position: "bottom-right",
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
          </ThemeProvider>
        </PostHogProvider>
        <PWARegister />
        <Scripts />
      </body>
    </html>
  );
}
