import { Link, Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { authClient } from "#/lib/auth-client.ts";
import { DetailCard } from "#/components/detail/panels.tsx";
import { LoginLink } from "#/components/login-link.tsx";
import { PageBody, PageMasthead } from "#/components/site-chrome/page-masthead.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { cn } from "#/lib/utils.ts";

export const Route = createFileRoute("/_app/_dash/account")({
  component: AccountLayout,
});

const TABS = [
  { id: "profile", label: "Profile", path: "/account/profile" },
  { id: "security", label: "Security", path: "/account/security" },
  { id: "alerts", label: "Alerts", path: "/account/alerts" },
  { id: "connections", label: "Connections", path: "/account/connections" },
] as const;

/**
 * The account tabs, set on the masthead's navy field: the open tab is the
 * page's yellow key, the rest are white-on-navy. They are `Link`s rather than a
 * `ToggleGroup` with an `onClick` navigate, so a tab is a real URL the browser
 * can open in a new window — and so the strip renders identically on the
 * server, where there is no session to read.
 */
function TabStrip({ active }: { active: string }) {
  return (
    <nav aria-label="Account settings" className="-mx-1 flex flex-wrap gap-2 px-1">
      {TABS.map((tab) => {
        const selected = tab.id === active;
        return (
          <Link
            key={tab.id}
            to={tab.path}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "relative top-0 rounded-full px-4 py-2 text-sm font-bold transition-[box-shadow,top,background-color] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-white/40 focus-visible:outline-none",
              selected
                ? "border-3d shadow-3d btn-3d-yellow bg-brand-yellow text-ink-on-yellow"
                : "border border-white/20 bg-white/10 text-white hover:-top-px hover:bg-white/18",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

function AccountLayout() {
  const { data: session, isPending } = authClient.useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const activeTab = TABS.find((t) => pathname.startsWith(t.path))?.id ?? "profile";

  return (
    <>
      <PageMasthead
        kicker="Your account"
        title="Account settings"
        description="Your profile, how you sign in, what we email you, and the services you've connected."
      >
        <TabStrip active={activeTab} />
      </PageMasthead>

      <PageBody size="form">
        {isPending ? (
          <>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-40 w-full rounded-[22px]" />
            ))}
          </>
        ) : !session?.user ? (
          <DetailCard
            title="Sign in to manage your account"
            description="Your profile, password, alerts and connected services all live behind a sign-in."
          >
            <Button className="w-fit" render={<LoginLink />}>
              Sign in
            </Button>
          </DetailCard>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="flex flex-col gap-5"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        )}
      </PageBody>
    </>
  );
}
