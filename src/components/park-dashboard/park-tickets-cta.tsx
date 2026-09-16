"use client";

import { Link } from "@tanstack/react-router";
import { CalendarCheckIcon, ExternalLinkIcon, TagIcon, TicketIcon } from "lucide-react";

import { TintPanel } from "#/components/detail/panels.tsx";
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
 * The park page's exit block (plan §4.3): a peach panel with the one yellow key
 * that leaves the app — out to the operator's own ticket purchase flow — and a
 * second, outline key for the guest who already holds a ticket.
 *
 * On the native MDE shell (Disney) the primary link resolves to the app's
 * `mdx://tickets/buy` purchase screen; on the web (and Universal everywhere) it
 * falls back to the https ticket store, which itself hands off to the installed
 * app via OS App Links. See `src/lib/disney-links.ts` and the memory note
 * `mde-deeplink-platform-gating`.
 *
 * The second key differs by operator because the underlying product does:
 * Disney's park reservation calendar has no Universal equivalent, so Universal
 * gets our own price comparison instead of a link to a page that doesn't exist.
 */
export function ParkTicketsCta({
  operatorSlug,
  className,
}: {
  operatorSlug: string | null | undefined;
  className?: string;
}) {
  const native = useIsNative();
  const resort = isUniversal(operatorSlug) ? "UOR" : "WDW";
  const href = buyTicketsHref(resort, native);
  // In the app (Disney) the link opens MDE itself; on the web it's the store.
  const opensApp = native && ticketPurchaseDeepLink(resort) != null;
  const reservationHref = parkReservationUrl(resort);

  return (
    <TintPanel tone="peach" title="Ready to go?" className={className}>
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-card text-peach-fg">
          <TicketIcon className="size-5" strokeWidth={1.75} />
        </span>
        <p className="text-sm leading-snug text-peach-sub">
          {opensApp
            ? "Buy tickets in My Disney Experience, or check today's date-based prices first."
            : `Compare today's prices before you buy on ${ticketStoreLabel(resort)}.`}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="yellow"
          size="lg"
          className="min-w-0 font-bold"
          render={<a href={href} target="_blank" rel="noreferrer" />}
        >
          <span className="truncate">Buy tickets</span>
          <ExternalLinkIcon />
        </Button>
        {reservationHref ? (
          <Button
            variant="outline"
            size="lg"
            className="min-w-0 font-bold"
            render={<a href={reservationHref} target="_blank" rel="noreferrer" />}
          >
            <CalendarCheckIcon />
            <span className="truncate">Reserve a day</span>
          </Button>
        ) : (
          <Button
            variant="outline"
            size="lg"
            className="min-w-0 font-bold"
            render={<Link to="/tickets" />}
          >
            <TagIcon />
            <span className="truncate">Ticket prices</span>
          </Button>
        )}
      </div>
    </TintPanel>
  );
}
