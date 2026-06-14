import { useEffect, useRef } from "react";
import { PanelLeftIcon } from "lucide-react";

import { NotificationCenter } from "#/components/notifications/notification-center.tsx";
import { OmniSearch } from "#/components/omni-search.tsx";
import { ThemeToggle } from "#/components/theme-toggle.tsx";
import { MenuIcon, type MenuIconHandle } from "#/components/ui/anim-icons/menu.tsx";
import { useSidebar } from "#/components/ui/sidebar.tsx";
import { authClient } from "#/lib/auth-client.ts";

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
  const { data: session } = authClient.useSession();
  const loggedIn = !!session?.user;
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
        <div className="px-4 py-2 lg:px-6">
          {/* Main header row with title and controls */}
          <div className="relative flex w-full items-center gap-2">
            {/* Desktop: the sidebar toggle sits on the left, ahead of the title. */}
            {!isMobile && <MenuTrigger />}

            {/* Mobile: theme + notifications are pinned to the left. */}
            {isMobile && (
              <div className="flex items-center gap-1">
                <ThemeToggle />
                <NotificationCenter />
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
              {/* Desktop: the notification bell is always reachable from the top bar;
                  the theme toggle only appears here when collapsed (otherwise it
                  lives in the sidebar footer). */}
              {!isMobile && (
                <>
                  {showHeaderBell && <NotificationCenter />}
                  {showActions && <ThemeToggle />}
                </>
              )}
              {/* Mobile: the trigger (hamburger ⇄ X) lives on the right. While the
                  flyout is open it's pinned in a `fixed`, z-[60] wrapper so the X
                  floats above the z-50 sheet/backdrop — without lifting the rest of
                  the bar with it. */}
              {isMobile && !flyoutOpen && <MenuTrigger />}
            </div>
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

      {/* Mobile: the omni-search sits just below the header in normal flow — part
          of the scrollable content, so it scrolls away under the sticky bar
          rather than staying pinned. On desktop it lives in the blue toolbar
          gutter instead (see AppInset). */}
      {isMobile && !flyoutOpen && (
        <div className="shrink-0 px-4 pt-2 pb-3">
          <OmniSearch />
        </div>
      )}
    </>
  );
}
