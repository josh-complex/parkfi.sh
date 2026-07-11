import { useQuery } from "@tanstack/react-query";
import { PanelLeftIcon } from "lucide-react";

import { MobileUserMenu } from "#/components/mobile-user-menu.tsx";
import { OmniSearch } from "#/components/omni-search.tsx";
import { useSidebar } from "#/components/ui/sidebar.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";

/** Sidebar-panel toggle. Desktop lives inline in the blue toolbar (see AppInset);
 *  on mobile the sidebar is reached from the bottom island / account menu, so this
 *  is only mounted on desktop. */
export function MenuTrigger() {
  const { toggleSidebar } = useSidebar();
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label="Toggle navigation"
      className="pointer-events-auto relative inline-flex size-9 shrink-0 items-center justify-center rounded-full text-current transition-transform hover:bg-foreground/10 active:scale-90"
    >
      <PanelLeftIcon className="size-[18px]" />
      <span className="sr-only">Toggle navigation</span>
    </button>
  );
}

/** Mobile-only top bar: a floating search pill beside the account menu. The page
 *  title and the desktop toggle/bell/theme have moved into the blue toolbar
 *  (AppInset), so on desktop this renders nothing. Routes still pass `title`/
 *  `mobileTitle`; they're currently unused but kept so callers need no change. */
export function SiteHeader(_props?: { title?: string; mobileTitle?: string }) {
  const { isMobile } = useSidebar();
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

  if (!isMobile) return null;

  return (
    <header
      // Backgroundless so the map/page shows behind it (the search pill and account
      // button float). `pointer-events-none` lets taps fall through to the map, with
      // the interactive children re-enabling pointer events.
      className="pointer-events-none sticky top-0 z-30 shrink-0 border-b border-transparent bg-transparent text-foreground transition-[height] ease-linear"
      style={{ paddingTop: "var(--safe-top)" }}
    >
      <div className="relative px-3 py-3">
        <div className="relative flex w-full items-center gap-2">
          {/* An inset search pill (thicker top border like our inputs) sitting
              inline next to the account avatar. The search owns its own pill chrome
              now — while typing it springs out to full width and covers the avatar
              (see OmniSearch inline). */}
          <div className="pointer-events-auto flex w-full items-center gap-2">
            <OmniSearch variant="inline" className="flex-1" />
            <MobileUserMenu showDot={hasAlerts} />
          </div>
        </div>
      </div>
    </header>
  );
}
