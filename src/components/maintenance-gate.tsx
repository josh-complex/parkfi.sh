import type * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ConstructionIcon, TrafficConeIcon } from "lucide-react";

import { useTRPC } from "#/integrations/trpc/react.ts";

/** The set of feature keys currently in maintenance mode (admin-toggled). */
export function useMaintenanceFeatures(): Set<string> {
  const trpc = useTRPC();
  const q = useQuery(trpc.removal.features.queryOptions());
  return new Set(q.data ?? []);
}

/** Diagonal amber/black caution stripe, slowly scrolling like real barricade tape. */
function CautionBar() {
  return (
    <div
      aria-hidden
      className="h-3 w-full shrink-0"
      style={{
        backgroundImage: "repeating-linear-gradient(45deg, #f59e0b 0 12px, #1c1917 12px 24px)",
        backgroundSize: "34px 34px",
        animation: "parkfi-stripes 1.1s linear infinite",
      }}
    />
  );
}

/**
 * Full-page "under maintenance" screen — a graceful construction motif shown
 * when a feature is toggled off. Framed by scrolling caution tape with a barrier
 * + cone mark.
 */
export function MaintenanceScreen({ title, message }: { title?: string; message?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-1 flex-col">
      <style>{`@keyframes parkfi-stripes { to { background-position: 34px 0; } }`}</style>
      <CautionBar />
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
        <div className="relative flex size-20 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 ring-1 ring-amber-500/30 dark:bg-amber-950/40 dark:text-amber-400">
          <ConstructionIcon className="size-10" />
          <TrafficConeIcon className="absolute -right-2 -bottom-2 size-7 text-amber-600 drop-shadow" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-bold tracking-tight">{title ?? "Under maintenance"}</h1>
          <p className="mx-auto max-w-md text-muted-foreground leading-relaxed">
            {message ??
              "This section is temporarily unavailable while we make some updates. Everything else on parkfi.sh is still up — check back here shortly."}
          </p>
        </div>
      </div>
      <CautionBar />
    </div>
  );
}

/**
 * Wraps a feature page: renders the maintenance screen when the feature's key is
 * toggled into maintenance, otherwise the page itself. Drop it around a route's
 * body so admins can take a whole section offline gracefully.
 */
export function MaintenanceGate({
  feature,
  title,
  message,
  children,
}: {
  feature: string;
  title?: string;
  message?: string;
  children: React.ReactNode;
}) {
  const features = useMaintenanceFeatures();
  if (features.has(feature)) return <MaintenanceScreen title={title} message={message} />;
  return <>{children}</>;
}
