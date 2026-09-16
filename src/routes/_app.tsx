import * as React from "react";
import { Outlet, createFileRoute, useParams, useRouterState } from "@tanstack/react-router";

import { AchievementTracker } from "#/components/achievements/achievement-tracker.tsx";
import { SiteFooter } from "#/components/marketing/site-footer.tsx";
import { MobileBottomNav } from "#/components/mobile-bottom-nav.tsx";
import { OfflineBanner } from "#/components/offline-banner.tsx";
import { SelectionProvider } from "#/components/park-dashboard/selection-context.tsx";
import { MapStageProvider } from "#/components/park-map/map-stage.tsx";
import { RideFilterProvider } from "#/components/rides/ride-filter.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { SiteHeaderDesktop } from "#/components/site-chrome/site-header-desktop.tsx";

/**
 * The one persistent app shell. Every in-app route nests under this pathless
 * layout so the chrome — the desktop masthead, the mobile floating header, and
 * the bottom-nav island — mounts once and survives cross-section navigation:
 * no more tearing the whole shell down and rebuilding it on every dining →
 * stays → pins hop.
 *
 * Desktop wears the site's own top chrome — a pinned gradient stripe with the
 * wordmark nav floating under it in a glass capsule that scrolls away with the
 * page (`variant="floating"`; the auto-hiding masthead is now the marketing
 * pages' alone) — over a plain page, closed by the short footer; the sidebar rail, the
 * blue toolbar and the floating content card it used to sit in are gone
 * (docs/plans/dining-redesign §5). Mobile is untouched by that change: the
 * floating search header and the nav island still own navigation there, so the
 * two headers are swapped with `md:` display gates rather than a JS breakpoint
 * — same markup on the server, no hydration flip.
 *
 * The map stage lives here too (not on `_dash`), so the singleton `ParkMap` —
 * its WebGL context, markers, and camera — survives hops to non-dashboard
 * sections like tickets/dining/stays that sit *outside* `_dash`. Otherwise
 * leaving `/map` for a bottom-nav sibling tore the map down, and returning
 * remounted + re-zoomed it from scratch. The stage self-defers: it doesn't load
 * the map libraries or mount a renderer until the first `<MapSlot>` claims it,
 * so entry points like `/privacy` still pay nothing for the map.
 *
 * Because the shell lives above the `<Outlet>`, a child route's pending state
 * (the router's `defaultPendingComponent` skeleton) renders *inside* the shell
 * rather than replacing it — so the bottom nav stays put while a page loads
 * instead of vanishing behind the skeleton.
 *
 * The achievement tracker mounts here too (not on `_dash`): dining, stays,
 * pins, tickets, resort and predictions are `_app` siblings of `_dash`, and
 * mounting the tracker one level down meant every hop to one of them unmounted
 * it — tearing down the ping loop and disarming the native ride recorder
 * mid-visit (park-tracking fixes 2, R8). Its own queries are gated on
 * `loggedIn`, so logged-out visitors on those routes pay nothing.
 */
function AppShell() {
  // strict:false so this resolves on any route — the slug is only present on
  // `/park/$slug` (and its ride child); elsewhere the map runs in free-roam.
  const params = useParams({ strict: false }) as { slug?: string };
  const activeSlug = params.slug ?? null;

  // The Waits board has no room for a footer: it closes on a map pane that is
  // sticky for the full height of the viewport, so the link columns would
  // either butt up under a live map or drag the pane's bottom edge off screen
  // to reach them. The board's own filter rail carries the page's links.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const footer = pathname !== "/";

  return (
    <div
      // `data-slot="app-shell"` is the hook the native/standalone `min-height`
      // rules in styles.css pin the shell to (they used to target the sidebar
      // wrapper) — the iOS PWA bottom-gap fix depends on it.
      data-slot="app-shell"
      // `--bottom-nav-height` reserves room for the mobile nav island so
      // scrolling content and the Eats/Stays filter FABs clear it. The desktop
      // masthead publishes its own `--site-header-height` from a measurement.
      style={{ "--bottom-nav-height": "4.5rem" } as React.CSSProperties}
      className="flex min-h-svh w-full flex-col bg-background"
    >
      <SiteHeaderDesktop className="hidden md:block" desktopOnly variant="floating" />
      <SiteHeader />
      <SelectionProvider>
        <RideFilterProvider>
          <MapStageProvider activeSlug={activeSlug}>
            <AchievementTracker />
            <main className="relative flex min-h-0 w-full flex-1 flex-col pb-[calc(var(--bottom-nav-height)+var(--safe-bottom))] md:pb-0">
              <Outlet />
            </main>
          </MapStageProvider>
        </RideFilterProvider>
      </SelectionProvider>
      {/* Desktop closes on the short footer — the same link columns as the
          landing page's, one line of the disclaimer. Mobile ends at the nav
          island instead, and the Waits board ends at its own chrome (see
          `footer` above). */}
      {footer && (
        <div className="hidden md:block">
          <SiteFooter variant="short" />
        </div>
      )}
      {/* Mobile primary nav — fixed island floating over the content. */}
      <MobileBottomNav />
      {/* Persistent offline indicator — floats above the nav island whenever the
          device is offline, clearing itself on reconnect. */}
      <OfflineBanner />
    </div>
  );
}

export const Route = createFileRoute("/_app")({
  component: AppShell,
});
