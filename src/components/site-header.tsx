import { useQuery } from "@tanstack/react-query";
import { PanelLeftIcon } from "lucide-react";

import { MobileUserMenu } from "#/components/mobile-user-menu.tsx";
import { NotificationCenter } from "#/components/notifications/notification-center.tsx";
import { OmniSearch } from "#/components/omni-search.tsx";
import { ThemeToggle } from "#/components/theme-toggle.tsx";
import { useSidebar } from "#/components/ui/sidebar.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";

/** Rotating placeholder hints for the mobile search (morphs between them). */
const SEARCH_HINTS = [
  "Space Mountain",
  "Magic Kingdom",
  "Hagrid's Motorbike",
  "dining at EPCOT",
  "Cosmic Rewind",
  "VelociCoaster",
  "Haunted Mansion",
  "Universal Studios",
];

/** Desktop sidebar-panel toggle. On mobile the sidebar is no longer reachable
 *  from the header — primary nav lives in the bottom island, secondary items in
 *  the account menu — so this is desktop-only. */
function MenuTrigger() {
  const { toggleSidebar } = useSidebar();
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label="Toggle navigation"
      className="pointer-events-auto relative -mr-1.5 inline-flex size-9 items-center justify-center rounded-full text-current transition-transform hover:bg-foreground/10 active:scale-90"
    >
      <PanelLeftIcon className="size-[18px]" />
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
  const { isMobile, state } = useSidebar();
  const { data: session } = authClient.useSession();
  const loggedIn = !!session?.user;
  // Surface unread alerts as a dot on the mobile account menu (the bell now lives
  // inside it). Shares the NotificationCenter query key, so this adds no request.
  const trpc = useTRPC();
  const alertsQ = useQuery({
    ...trpc.rideAlerts.list.queryOptions(),
    enabled: loggedIn && isMobile,
  });
  const hasAlerts = (alertsQ.data?.parks ?? []).reduce((n, p) => n + p.alerts.length, 0) > 0;
  // On desktop the bell/theme live in the header unless the sidebar footer is
  // showing them (panel expanded, signed in).
  const showActions = isMobile || state !== "expanded";
  const showHeaderBell = !isMobile && (showActions || !loggedIn);
  const displayTitle = isMobile && mobileTitle ? mobileTitle : title;

  return (
    <header
      // Backgroundless on mobile so the map/page shows behind it (the search pill
      // and account button float). `pointer-events-none` lets taps fall through to
      // the map, with the interactive children re-enabling pointer events. On
      // desktop it's the normal static bar.
      className="pointer-events-none sticky top-0 z-30 shrink-0 border-b border-transparent bg-transparent text-foreground transition-[height] ease-linear md:pointer-events-auto md:static md:border-border"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="relative px-4 py-3 lg:px-6 md:py-2">
        <div className="relative flex w-full items-center gap-2">
          {isMobile ? (
            // Mobile: one full-width inset search bar (thicker top border, like
            // our inputs) with a morphing placeholder, and the account avatar
            // tucked inside on the right — raised in 3D so it pops off the inset.
            <div className="pointer-events-auto flex h-16 w-full items-center gap-2 rounded-full border border-border border-t-[3px] bg-background/95 pr-2 pl-4 backdrop-blur">
              <OmniSearch variant="inline" placeholderTexts={SEARCH_HINTS} className="flex-1" />
              <MobileUserMenu showDot={hasAlerts} />
            </div>
          ) : (
            <>
              {/* Desktop: sidebar toggle, then title, then bell/theme on the right
                  (the bell only here when not in the expanded footer; the theme
                  toggle only when the panel is collapsed). */}
              <MenuTrigger />
              <h1 className="truncate text-base font-semibold tracking-tight">{displayTitle}</h1>
              <div className="ml-auto flex items-center gap-1">
                {showHeaderBell && <NotificationCenter />}
                {showActions && <ThemeToggle />}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
