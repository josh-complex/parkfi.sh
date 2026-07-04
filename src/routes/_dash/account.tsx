import { Outlet, createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { authClient } from "#/lib/auth-client.ts";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";

export const Route = createFileRoute("/_dash/account")({
  component: AccountLayout,
});

const TABS = [
  { id: "profile", label: "Profile", path: "/account/profile" },
  { id: "security", label: "Security", path: "/account/security" },
  { id: "alerts", label: "Alerts", path: "/account/alerts" },
  { id: "connections", label: "Connections", path: "/account/connections" },
] as const;

function AccountLayout() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const activeTab = TABS.find((t) => pathname.startsWith(t.path))?.id ?? "profile";

  if (isPending) {
    return (
      <div className="p-6 max-w-2xl space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-9 w-80 rounded-3xl" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-4xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          You must be signed in to view account settings.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account settings</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage your profile, security, and connected accounts.
        </p>
      </div>

      <ToggleGroup value={[activeTab]}>
        {TABS.map((tab) => (
          <ToggleGroupItem
            key={tab.id}
            value={tab.id}
            onClick={() => void navigate({ to: tab.path })}
          >
            {tab.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <Outlet />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
