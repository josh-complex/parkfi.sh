import * as React from "react";

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
          the support link is dropped entirely. */}
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
    </SidebarInset>
  );
}
