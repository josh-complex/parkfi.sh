import { useEffect, useRef } from "react";
import { PanelLeftIcon } from "lucide-react";

import { NotificationBell } from "#/components/notifications/notification-bell.tsx";
import { ThemeToggle } from "#/components/theme-toggle.tsx";
import { MenuIcon, type MenuIconHandle } from "#/components/ui/anim-icons/menu.tsx";
import { useSidebar } from "#/components/ui/sidebar.tsx";

/**
 * Desktop shows the static sidebar-panel icon; mobile shows the hamburger ⇄ X
 * that morphs with the offcanvas flyout's open state.
 */
function MenuTrigger() {
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
      className="pointer-events-auto -mr-1.5 inline-flex size-9 items-center justify-center rounded-full text-current transition-transform hover:bg-foreground/10 active:scale-90"
    >
      {isMobile ? <MenuIcon ref={iconRef} size={22} /> : <PanelLeftIcon className="size-[18px]" />}
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
  // On mobile the sidebar is hidden offcanvas, so the header is the only place
  // to reach these; on desktop they live in the sidebar footer unless collapsed.
  const showActions = isMobile || state !== "expanded";
  // When the offcanvas flyout is open, lift the header above the sheet overlay
  // (z-50) so the trigger (now an X) stays tappable, and strip the bar's chrome
  // so it floats over the dimmed backdrop.
  const flyoutOpen = isMobile && openMobile;
  const displayTitle = isMobile && mobileTitle ? mobileTitle : title;

  return (
    <header
      className={
        flyoutOpen
          ? "pointer-events-none sticky top-0 z-[60] shrink-0 border-b border-transparent bg-transparent text-white"
          : // Sticky on mobile only; on desktop the bar scrolls away with the page.
            "sticky top-0 z-30 shrink-0 border-b border-white/10 bg-sidebar/90 text-sidebar-foreground backdrop-blur-md transition-[height] ease-linear md:static md:border-border md:bg-transparent md:text-foreground md:backdrop-blur-none"
      }
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="relative flex h-(--header-height) w-full items-center gap-2 px-4 lg:px-6">
        {/* Desktop: the sidebar toggle sits on the left, ahead of the title. */}
        {!isMobile && <MenuTrigger />}

        {/* Mobile: theme + notifications are pinned to the left. */}
        {isMobile && (
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <NotificationBell />
          </div>
        )}

        <h1
          className={
            isMobile
              ? "absolute left-1/2 max-w-[55%] -translate-x-1/2 truncate text-center text-base font-semibold tracking-tight"
              : "truncate text-base font-semibold tracking-tight"
          }
        >
          {displayTitle}
        </h1>

        <div className="ml-auto flex items-center gap-1">
          {/* Desktop: bell + theme on the right when the sidebar is collapsed. */}
          {showActions && !isMobile && (
            <>
              <NotificationBell />
              <ThemeToggle />
            </>
          )}
          {/* Mobile: the trigger (hamburger ⇄ X) lives on the right. */}
          {isMobile && <MenuTrigger />}
        </div>
      </div>
    </header>
  );
}
