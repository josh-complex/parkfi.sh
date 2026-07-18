"use client";

import { CalendarCheckIcon, ExternalLinkIcon, TicketIcon } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { useIsNative } from "#/hooks/use-is-native.ts";
import {
  buyTicketsHref,
  parkReservationUrl,
  ticketPurchaseDeepLink,
  ticketStoreLabel,
} from "#/lib/disney-links.ts";
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
 *
 * Disney also gets a secondary "make a park reservation" link, for guests who
 * already hold a ticket or annual pass and just need to book a park + date.
 * Unlike ticket purchase there's no `mdx://` route for this — MDE itself opens a
 * plain web URL — so it's a single https link that OS App Links hands off to the
 * app on native. Universal has no reservation system, so it's Disney-only.
 */
export function ParkTicketsCta({ operatorSlug }: { operatorSlug: string | null | undefined }) {
  const native = useIsNative();
  const resort = isUniversal(operatorSlug) ? "UOR" : "WDW";
  const href = buyTicketsHref(resort, native);
  // In the app (Disney) the link opens MDE itself; on the web it's the store.
  const opensApp = native && ticketPurchaseDeepLink(resort) != null;
  const reservationHref = parkReservationUrl(resort);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-md">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

      {reservationHref && (
        <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CalendarCheckIcon className="size-5" strokeWidth={1.75} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold leading-tight">Already have tickets?</span>
              <span className="text-xs text-muted-foreground">
                Make a park reservation for your date
              </span>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 sm:shrink-0"
            render={<a href={reservationHref} target="_blank" rel="noreferrer" />}
          >
            Make a reservation
            <ExternalLinkIcon className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
