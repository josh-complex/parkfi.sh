import * as React from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { AppInset } from "#/components/app-inset.tsx";
import { AppSidebar } from "#/components/app-sidebar.tsx";
import { PlayMap } from "#/components/living/play-map.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { SidebarProvider } from "#/components/ui/sidebar.tsx";
import { useLivingLayerEnabled } from "#/integrations/posthog/feature-flags.ts";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/play/$slug")({
  component: PlayPage,
  head: () =>
    seo({
      title: "Wayfarer — ParkFi",
      description: "Your in-park adventure — explore the realms and gather your party (preview).",
    }),
});

function PlayPage() {
  const { slug } = Route.useParams();
  // Client-side feature gate. Defaults false until PostHog resolves, so the
  // experience stays hidden unless the `living-layer` flag is on for this user.
  // This gates ONLY the UI; the backend tables/engine are independent.
  const enabled = useLivingLayerEnabled();

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <AppInset>
        <SiteHeader title="Wayfarer" />
        <div className="flex flex-1 flex-col p-4">
          {enabled ? (
            <PlayMap parkSlug={slug} />
          ) : (
            <div className="text-muted-foreground mx-auto max-w-md py-16 text-center">
              <p className="text-foreground text-lg font-medium">Not available yet</p>
              <p className="mt-2 text-sm">
                Wayfarer is in preview and isn’t enabled for your account.
              </p>
              <Link to="/" className="text-primary mt-4 inline-block text-sm">
                ← Back to the parks
              </Link>
            </div>
          )}
        </div>
      </AppInset>
    </SidebarProvider>
  );
}
