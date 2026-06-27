import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { PanelLeftIcon } from "lucide-react";

import { NotificationCenter } from "#/components/notifications/notification-center.tsx";
import { OmniSearch } from "#/components/omni-search.tsx";
import { ThemeToggle } from "#/components/theme-toggle.tsx";
import { MenuIcon, type MenuIconHandle } from "#/components/ui/anim-icons/menu.tsx";
import { useSidebar } from "#/components/ui/sidebar.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";

/**
 * Desktop shows the static sidebar-panel icon; mobile shows the hamburger ⇄ X
 * that morphs with the offcanvas flyout's open state.
 */
function MenuTrigger({ showDot = false }: { showDot?: boolean }) {
  const { toggleSidebar, openMobile, isMobile } = useSidebar();
  const iconRef = useRef<MenuIconHandle>(null);

  useEffect(() => {
    if (!isMobile) return;
    if (openMobile) iconRef.current?.startAnimation();
    else iconRef.current?.stopAnimation();
  }, [isMobile, openMobile]);

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label="Toggle navigation"
      className="pointer-events-auto relative -mr-1.5 inline-flex size-9 items-center justify-center rounded-full text-current transition-transform hover:bg-foreground/10 active:scale-90"
    >
      {isMobile ? <MenuIcon ref={iconRef} size={22} /> : <PanelLeftIcon className="size-[18px]" />}
      {/* Unread-alerts dot: the bell now lives inside the menu, so surface its
          state on the trigger. Hidden while the flyout (the X) is open. */}
      {showDot && !openMobile && (
        <span className="bg-primary absolute top-1.5 right-1.5 size-2 rounded-full ring-2 ring-white" />
      )}
      <span className="sr-only">Toggle navigation</span>
    </button>
  );
}

export function SiteHeader({
  title = "Documents",
  mobileTitle,
}: {
  title?: string;
  /** On mobile the bar is the only place the page identity shows (the in-body
   * header is hidden there), so park views pass the park name to surface here. */
  mobileTitle?: string;
}) {
  const { isMobile, state, openMobile } = useSidebar();
  const { data: session } = authClient.useSession();
  const loggedIn = !!session?.user;
  // The notification bell moves into the mobile menu, so surface unread alerts as
  // a dot on the menu trigger. Shares the NotificationCenter query (same key), so
  // this adds no extra request.
  const trpc = useTRPC();
  const alertsQ = useQuery({
    ...trpc.rideAlerts.list.queryOptions(),
    enabled: loggedIn && isMobile,
  });
  const hasAlerts = (alertsQ.data?.parks ?? []).reduce((n, p) => n + p.alerts.length, 0) > 0;
  // On mobile the sidebar is hidden offcanvas, so the header is the only place
  // to reach these; on desktop they live in the sidebar footer unless collapsed.
  const showActions = isMobile || state !== "expanded";
  // On desktop the bell normally sits in the header, but when the panel is
  // expanded and signed in it moves beside the user button in the footer.
  const showHeaderBell = !isMobile && (showActions || !loggedIn);
  // When the offcanvas flyout is open, lift the header above the sheet overlay
  // (z-50) so the trigger (now an X) stays tappable, and strip the bar's chrome
  // so it floats over the dimmed backdrop.
  const flyoutOpen = isMobile && openMobile;
  const displayTitle = isMobile && mobileTitle ? mobileTitle : title;

  return (
    <>
      <header
        className={
          flyoutOpen
            ? // Drop `sticky`/`z` so the bar is NOT a stacking context: that keeps
              // the title + left controls below the z-50 flyout instead of being
              // dragged above it. The trigger is lifted on its own (see below).
              "pointer-events-none relative shrink-0 border-b border-transparent bg-transparent text-white"
            : // Sticky on mobile only; on desktop the bar scrolls away with the page.
              // Mobile bar is solid `bg-sidebar` (no opacity/blur) so it reads as a
              // seamless extension of the blue app surface behind it.
              "sticky top-0 z-30 shrink-0 border-b border-transparent bg-sidebar text-sidebar-foreground transition-[height] ease-linear md:static md:border-border md:bg-transparent md:text-foreground"
        }
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="relative px-4 py-2 lg:px-6">
          {/* Mobile keeps the flat `bg-sidebar` blue (no gradient) so the bar
              reads as one continuous color with the device status bar. */}
          {/* Main header row */}
          <div className="relative flex w-full items-center gap-2">
            {isMobile ? (
              // Mobile: the search bar IS the header; the menu sits to its right.
              // The page title is dropped here — the search takes its place.
              !flyoutOpen && (
                <>
                  <div className="min-w-0 flex-1">
                    <OmniSearch />
                  </div>
                  {/* The trigger (hamburger ⇄ X) lives on the right; while the
                      flyout is open it's pinned in the fixed wrapper below. */}
                  <MenuTrigger showDot={hasAlerts} />
                </>
              )
            ) : (
              <>
                {/* Desktop: sidebar toggle, then title, then bell/theme on the
                    right (the bell only here when not in the expanded footer; the
                    theme toggle only when the panel is collapsed). */}
                <MenuTrigger />
                <h1 className="truncate text-base font-semibold tracking-tight">{displayTitle}</h1>
                <div className="ml-auto flex items-center gap-1">
                  {showHeaderBell && <NotificationCenter />}
                  {showActions && <ThemeToggle />}
                </div>
              </>
            )}
            {isMobile && flyoutOpen && (
              <div
                className="pointer-events-none fixed top-0 right-0 z-[60] flex h-(--header-height) items-center px-4 text-white lg:px-6"
                style={{ paddingTop: "env(safe-area-inset-top)" }}
              >
                <MenuTrigger />
              </div>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
