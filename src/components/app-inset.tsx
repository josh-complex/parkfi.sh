import * as React from "react";

import { BuyMeACoffee } from "#/components/buy-me-a-coffee.tsx";
import { CastMemberHeadline } from "#/components/cast-member-badge.tsx";
import { MobileBottomNav } from "#/components/mobile-bottom-nav.tsx";
import { NotificationCenter } from "#/components/notifications/notification-center.tsx";
import { OmniSearch } from "#/components/omni-search.tsx";
import { MenuTrigger } from "#/components/site-header.tsx";
import { ThemeToggle } from "#/components/theme-toggle.tsx";
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
 * toolbar can breathe on the blue background. The card itself carries the
 * theme background at every breakpoint, so mobile always shows the light/dark
 * surface rather than the blue shell.
 */
export function AppInset({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <SidebarInset
      // `--toolbar-height` is the single source of truth for the blue bar's
      // height; fixed-height routes (the overview map) subtract it from 100svh.
      // `--bottom-nav-height` reserves room for the mobile bottom-nav island so
      // scrolling content and the Eats/Stays filter FABs can clear it.
      // Drop the inset's top gutter (`mt-0`) so the only blue around the toolbar
      // is its own symmetric `py-2` — giving equal space above and below.
      style={
        { "--toolbar-height": "3.25rem", "--bottom-nav-height": "4.5rem" } as React.CSSProperties
      }
      className="bg-transparent md:peer-data-[variant=inset]:mt-0 md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:shadow-none"
    >
      {/* Blue toolbar — sidebar toggle + search on the left, support link and the
          bell/theme actions pinned right. Desktop only: on mobile the search moves
          under the header (see SiteHeader) and the support link is dropped. */}
      <div className="hidden h-(--toolbar-height) shrink-0 items-center gap-3 py-2 text-white md:flex">
        <MenuTrigger />
        <OmniSearch />
        <CastMemberHeadline />
        <div className="ml-auto flex items-center gap-3">
          <NotificationCenter />
          <ThemeToggle />
        </div>
        <BuyMeACoffee className="" />
      </div>
      {/* Content card: theme background (white/dark) at every breakpoint, and
          rounded into a floating card on desktop only. Reserve room at the
          bottom on mobile so scrolling content clears the floating nav island
          (the fullscreen map route opts out via absolute fill). */}
      <div
        className={cn(
          "relative flex min-h-0 w-full flex-1 flex-col bg-background pb-[calc(var(--bottom-nav-height)+var(--safe-bottom))] md:rounded-2xl md:pb-0 md:shadow-sm",
          className,
        )}
      >
        {children}
      </div>
      {/* Mobile primary nav — fixed island floating over the content; desktop uses
          the sidebar instead (the bar is `md:hidden`). */}
      <MobileBottomNav />
    </SidebarInset>
  );
}
