"use client";

import { ExternalLinkIcon, TicketIcon } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { useIsNative } from "#/hooks/use-is-native.ts";
import { buyTicketsHref, ticketPurchaseDeepLink, ticketStoreLabel } from "#/lib/disney-links.ts";
import { isUniversal } from "./lightning-lane.ts";

/**
 * A "Buy tickets" deep link from a park page out to the operator's own ticket
 * purchase flow. On the native MDE shell (Disney) this resolves to the app's
 * `mdx://tickets/buy` purchase screen; on the web (and Universal everywhere) it
 * falls back to the https ticket store, which itself hands off to the installed
 * app via OS App Links.
 *
 * Mirrors the platform gating on the ride-detail page — the `mdx://` scheme only
 * resolves inside the app, so the target is chosen off `useIsNative()`. See
 * `src/lib/disney-links.ts`.
 */
export function ParkTicketsCta({ operatorSlug }: { operatorSlug: string | null | undefined }) {
  const native = useIsNative();
  const resort = isUniversal(operatorSlug) ? "UOR" : "WDW";
  const href = buyTicketsHref(resort, native);
  // In the app (Disney) the link opens MDE itself; on the web it's the store.
  const opensApp = native && ticketPurchaseDeepLink(resort) != null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-md sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <TicketIcon className="size-5" strokeWidth={1.75} />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold leading-tight">Ready to go?</span>
          <span className="text-xs text-muted-foreground">
            {opensApp
              ? "Buy tickets in My Disney Experience"
              : `Buy tickets on ${ticketStoreLabel(resort)}`}
          </span>
        </div>
      </div>
      <Button
        size="sm"
        className="gap-1.5 sm:shrink-0"
        render={<a href={href} target="_blank" rel="noreferrer" />}
      >
        Buy tickets
        <ExternalLinkIcon className="size-3.5" />
      </Button>
    </div>
  );
}
