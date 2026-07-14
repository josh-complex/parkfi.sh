import { WifiOffIcon } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { useIsOnline } from "#/hooks/use-online-status.ts";
import { cn } from "#/lib/utils.ts";

/**
 * Inline placeholder for a browse surface whose data couldn't load — shown in
 * place of the list's "empty" copy when its query is offline-paused or errored
 * (see `queryUnavailable`). It distinguishes "we couldn't reach the server" from
 * the genuine "there's nothing here", which the old shared empty text conflated
 * (e.g. "No rides match your filters." while actually offline).
 *
 * Copy adapts to why we failed: offline vs. a server error while online. Retry
 * is optional — offline queries resume on their own once the connection returns
 * (and the global `OfflineBanner` already signals that), so a button mainly
 * helps the online-but-errored case.
 */
export function ConnectionLost({
  onRetry,
  className,
}: {
  onRetry?: () => void;
  className?: string;
}) {
  const online = useIsOnline();
  return (
    <div className={cn("flex flex-col items-center gap-3 py-16 text-center", className)}>
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <WifiOffIcon className="size-6" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{online ? "Couldn't load" : "You're offline"}</p>
        <p className="mx-auto max-w-xs text-sm text-muted-foreground">
          {online
            ? "We couldn't reach the server just now. Give it another try in a moment."
            : "We couldn't load this over your current connection — it'll refresh on its own once you're back online."}
        </p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
