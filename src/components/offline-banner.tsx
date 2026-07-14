import { WifiOffIcon } from "lucide-react";

import { useIsOnline } from "#/hooks/use-online-status.ts";
import { cn } from "#/lib/utils.ts";

/**
 * A persistent "You're offline" bar that appears the moment the device loses its
 * connection and clears itself the instant it returns. Driven by react-query's
 * `onlineManager` (via `useIsOnline`), so it's in lockstep with the paused read
 * queries: while it's up, live data is stalled; when it drops, the queries have
 * already resumed and are refetching.
 *
 * This replaces the old one-shot toast, which only ever fired for the map's
 * `networkMode: "always"` query and auto-dismissed after ~1.5s — so every other
 * tab went offline silently. It floats just above the mobile bottom-nav island
 * (clearing the same safe-area + nav-height gutter the Eats/Stays FABs use) and
 * centers over the content on desktop. Always mounted; toggles via opacity so it
 * can animate in and out.
 */
export function OfflineBanner() {
  const online = useIsOnline();
  return (
    <div
      aria-hidden={online}
      className={cn(
        "pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4 transition-[opacity,transform] duration-300 ease-out",
        online ? "translate-y-2 opacity-0" : "translate-y-0 opacity-100",
      )}
      style={{ bottom: "calc(var(--safe-bottom) + var(--bottom-nav-height) + 1rem)" }}
    >
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-border bg-background/95 px-4 py-2 text-sm font-medium shadow-lg backdrop-blur-sm"
      >
        <WifiOffIcon className="size-4 shrink-0 text-muted-foreground" />
        <span>You&rsquo;re offline</span>
        <span className="text-muted-foreground">Check your connection</span>
      </div>
    </div>
  );
}
