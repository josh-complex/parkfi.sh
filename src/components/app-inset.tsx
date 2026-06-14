import * as React from "react";
import { createPortal } from "react-dom";

import { BuyMeACoffee } from "#/components/buy-me-a-coffee.tsx";
import { OmniSearch } from "#/components/omni-search.tsx";
import { SidebarInset } from "#/components/ui/sidebar.tsx";
import { cn } from "#/lib/utils.ts";

import type { ReactNode } from "react";

/**
 * The app surface for every dashboard route: a blue toolbar (site-wide omni
 * search + support link) sitting in the inset's blue gutter, above a white,
 * rounded content card that holds the route's header and body.
 *
 * It renders as the sidebar's peer `<main>` (via `SidebarInset`) so the inset
 * margins still track the sidebar's open/collapsed state — we just strip the
 * card chrome off the outer element and reapply it to the inner card so the
 * toolbar can breathe on the blue background. On mobile the card is transparent
 * so the shell stays the same blue app surface it was before.
 */
export function AppInset({ children, className }: { children: ReactNode; className?: string }) {
  // The FAB is portalled to <body> so it pins to the viewport: this tree has
  // transformed/clipped ancestors (see map-stage's morph), which would otherwise
  // contain a `position: fixed` element and strand it at the top-left.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <SidebarInset
      // `--toolbar-height` is the single source of truth for the blue bar's
      // height; fixed-height routes (the overview map) subtract it from 100svh.
      // Drop the inset's top gutter (`mt-0`) so the only blue around the toolbar
      // is its own symmetric `py-2` — giving equal space above and below.
      style={{ "--toolbar-height": "3.25rem" } as React.CSSProperties}
      className="bg-transparent md:peer-data-[variant=inset]:mt-0 md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:shadow-none"
    >
      {/* Blue toolbar — search on the left, support link pinned right. Desktop
          only: on mobile the search moves under the header (see SiteHeader) and
          the support link becomes a floating button (below). */}
      <div className="hidden h-(--toolbar-height) shrink-0 items-center gap-3 px-4 py-2 text-white md:flex lg:px-6">
        <OmniSearch />
        <BuyMeACoffee className="ml-auto" />
      </div>
      {/* White content card. Transparent on mobile so the blue shell shows through. */}
      <div
        className={cn(
          "relative flex min-h-0 w-full flex-1 flex-col md:rounded-2xl md:bg-background md:shadow-sm",
          className,
        )}
      >
        {children}
      </div>

      {/* Mobile support link: a small round coffee-cup FAB pinned bottom-left,
          beside the sort/filter controls. */}
      {mounted &&
        createPortal(
          <BuyMeACoffee
            fab
            className="fixed left-4 z-40 shadow-lg md:hidden"
            style={{ bottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
          />,
          document.body,
        )}
    </SidebarInset>
  );
}
