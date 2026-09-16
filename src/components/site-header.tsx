import { useCanGoBack, useLocation, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeftIcon } from "lucide-react";

import { MobileUserMenu } from "#/components/mobile-user-menu.tsx";
import { OmniSearch } from "#/components/omni-search.tsx";
import { buttonVariants } from "#/components/ui/button.tsx";
import { cn } from "#/lib/utils.ts";
import { useHideOnScrollDown } from "#/hooks/use-hide-on-scroll-down.ts";
import { useIsMobile } from "#/hooks/use-mobile.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";

/** Mobile-only top bar: a floating search pill beside the account menu. On
 *  desktop this renders nothing — the site masthead (`SiteHeaderDesktop`) owns
 *  search, alerts, theme and the account menu there. Routes still pass `title`/
 *  `mobileTitle`; they're currently unused but kept so callers need no change. */
export function SiteHeader(_props?: { title?: string; mobileTitle?: string }) {
  const isMobile = useIsMobile();
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

  // Auto-hide the search bar on scroll-down / reveal on scroll-up (same pattern
  // as the welcome masthead). The fullscreen map is exempt: it never scrolls and
  // the search is the only way in, so it stays pinned there — and arriving at the
  // map forces the bar back into view if you'd scrolled it away on another page.
  const pathname = useLocation({ select: (l) => l.pathname });
  const isMap = pathname === "/map";
  // `reopenAbove: Infinity` keeps the classic reveal-on-scroll-up here, against
  // the hook's new default. On a phone this pill is the *only* way into search
  // (the bottom-nav island carries destinations, not search), so it has to come
  // back mid-page. The desktop masthead, which has no such job, doesn't.
  const scrolledAway = useHideOnScrollDown({ reopenAbove: Infinity });
  const hidden = !isMap && scrolledAway;

  // Show a back affordance whenever there's somewhere in history to return to.
  const router = useRouter();
  const canGoBack = useCanGoBack();

  if (!isMobile) return null;

  return (
    <motion.header
      // Backgroundless so the map/page shows behind it (the search pill and account
      // button float). `pointer-events-none` lets taps fall through to the map, with
      // the interactive children re-enabling pointer events.
      initial={false}
      animate={{ y: hidden ? "-100%" : "0%" }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="pointer-events-none sticky top-0 z-30 flex shrink-0 items-center bg-transparent text-foreground"
      // Locked to a known height so a full-bleed page (/activity) can pull its
      // hero up by exactly `--safe-top + --app-header-h` and reach the top edge.
      style={{
        paddingTop: "var(--safe-top)",
        minHeight: "calc(var(--safe-top) + var(--app-header-h))",
      }}
    >
      {/* `--chrome-gutter` (a touch tighter than the content's `px-4`) so the
          floating search pill and back button overhang the page slightly, in step
          with the bottom-nav island and the map's control clusters. */}
      <div className="relative w-full px-(--chrome-gutter)">
        <div className="relative flex w-full items-center gap-2">
          {/* An inset search pill (thicker top border like our inputs) sitting
              inline next to the account avatar. The search owns its own pill chrome
              now — while typing it springs out to full width and covers the avatar
              (see OmniSearch inline). */}
          <div className="pointer-events-auto flex w-full items-center gap-2">
            <AnimatePresence initial={false}>
              {canGoBack && (
                <motion.button
                  key="back"
                  type="button"
                  onClick={() => router.history.back()}
                  aria-label="Go back"
                  initial={{ opacity: 0, width: 0, marginRight: -8, scale: 0.8 }}
                  animate={{ opacity: 1, width: 52, marginRight: 0, scale: 1 }}
                  exit={{ opacity: 0, width: 0, marginRight: -8, scale: 0.8 }}
                  transition={{ type: "spring", stiffness: 700, damping: 34, mass: 0.7 }}
                  style={{ borderRadius: 9999 }}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "icon" }),
                    // The outline variant is `dark:bg-transparent`, which lets the
                    // map show through the floating back button in dark mode. Force
                    // a solid fill to match the account button beside it.
                    "size-13 shrink-0 bg-background text-foreground dark:bg-background",
                  )}
                >
                  <ArrowLeftIcon className="size-5" />
                </motion.button>
              )}
            </AnimatePresence>
            <OmniSearch variant="inline" className="flex-1" />
            <MobileUserMenu showDot={hasAlerts} />
          </div>
        </div>
      </div>
    </motion.header>
  );
}
