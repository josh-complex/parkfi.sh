"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon } from "lucide-react";

import { TintMeta, TintPanel } from "#/components/detail/panels.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useIsNative } from "#/hooks/use-is-native.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { buyTicketsHref, ticketStoreLabel } from "#/lib/disney-links.ts";
import { todayInTz } from "#/lib/park-hours.ts";
import { ALL_PARKS } from "#/lib/parks.ts";
import { cn } from "#/lib/utils.ts";

import { isUniversal } from "./lightning-lane.ts";

/** How far ahead the bars run — two months is the window a trip is priced over. */
const DAYS = 60;

/** "$139" — whole dollars; the cents on a park ticket are noise at this size. */
function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

/** `YYYY-MM-DD` at local midnight, formatted as "Wed, Oct 8". */
function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * "Tickets" — what a one-day adult ticket to *this* park costs today, the
 * cheapest date in the two months ahead, and the shape of the prices between,
 * with the exit to the operator's own store.
 *
 * Date-based pricing is the reason this card exists: both resorts price the
 * same ticket differently by day, so "which day should I come" (the band this
 * card sits in) and "what will it cost" are the same question. The bars carry
 * that — today's bar in the brand yellow, the cheapest in the panel's own ink,
 * the rest in the peach edge — and the two figures above them name the ends.
 *
 * Renders nothing for a park we hold no prices for (water parks, and any park
 * whose product filters aren't wired) rather than an empty frame.
 */
export function TicketPriceCard({
  parkSlug,
  operatorSlug,
  className,
}: {
  parkSlug: string | null;
  operatorSlug: string | null | undefined;
  className?: string;
}) {
  const trpc = useTRPC();
  const native = useIsNative();
  const resort = isUniversal(operatorSlug) ? "UOR" : "WDW";
  const park = ALL_PARKS.find((p) => p.slug === parkSlug) ?? null;

  const q = useQuery({
    ...trpc.tickets.priceCalendar.queryOptions({
      resort,
      park: park?.code ?? null,
      days: DAYS,
      pastDays: 0,
      parkHopper: false,
      ageGroup: "ADULT",
    }),
    enabled: !!park,
  });

  // Both resorts are in Florida, so "today" is the Eastern date — not the
  // viewer's, who may be a day ahead in Sydney and would otherwise price the
  // wrong day (and disagree with the SSR'd HTML).
  const todayIso = todayInTz("America/New_York");
  /** The bar under the pointer, named above the chart. */
  const [hovered, setHovered] = React.useState<{
    date: string;
    priceCents: number;
    available: boolean;
  } | null>(null);
  const { lead, leadLabel, cheapest, bars } = React.useMemo(() => {
    const rows = q.data?.days ?? [];
    const empty = { lead: null, leadLabel: "Today", cheapest: null, bars: [] };
    if (rows.length === 0) return empty;

    // The headline day. Today when today is on sale — and when it isn't (the
    // park is shut, or the store has stopped selling today's ticket, which is
    // routine by late afternoon), the next day that *is*, rather than the
    // em-dash this used to print. "Tickets — " under a card of prices reads as
    // a card that failed; "Tomorrow, $110" is the answer the reader wanted.
    const todayRow = rows.find((r) => r.date === todayIso) ?? null;
    const nextSellable = rows.find((r) => r.date > todayIso && r.available) ?? null;
    const leadRow = todayRow?.available ? todayRow : (nextSellable ?? todayRow ?? rows[0]!);

    const tomorrowIso = (() => {
      const d = new Date(`${todayIso}T00:00:00`);
      d.setDate(d.getDate() + 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    const label =
      leadRow.date === todayIso
        ? "Today"
        : leadRow.date === tomorrowIso
          ? "Tomorrow"
          : dayLabel(leadRow.date);

    // The cheapest day worth naming is one that can still be bought, and it is
    // never the day already named above — "come back on a cheaper day" is the
    // whole point, and naming the same date twice at two sizes is not a
    // comparison.
    const sellable = rows.filter((r) => r.available && r.date > leadRow.date);
    const cheapestRow = sellable.reduce<(typeof sellable)[number] | null>(
      (best, r) => (!best || r.priceCents < best.priceCents ? r : best),
      null,
    );
    return { lead: leadRow, leadLabel: label, cheapest: cheapestRow, bars: rows };
  }, [q.data, todayIso]);

  if (!park) return null;
  // `!q.data` rather than `isLoading` — see the same note in `CrowdAhead`.
  if (!q.data) {
    return <Skeleton className={cn("h-[263px] w-full rounded-[22px]", className)} />;
  }
  if (bars.length === 0) return null;

  const max = Math.max(...bars.map((b) => b.priceCents));
  const min = Math.min(...bars.map((b) => b.priceCents));
  const href = buyTicketsHref(resort, native);

  return (
    <TintPanel
      tone="peach"
      title="Tickets"
      meta={<TintMeta tone="peach">1-day, adult</TintMeta>}
      className={className}
    >
      {/* Two figures, pushed to opposite ends and sharing a baseline: the day
          you'd buy on the left, the day you'd rather buy on the right. They
          used to sit side by side at the left with a gap after them, which read
          as one wrapped sentence rather than as two ends of a range — and left
          the card's whole right half empty above a full-width chart. */}
      <div className="flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[11px] font-bold tracking-[0.06em] text-peach-sub uppercase">
            {leadLabel}
          </span>
          <p className="text-[32px] leading-none font-black tracking-[-0.02em] text-peach-fg tabular-nums">
            {lead ? dollars(lead.priceCents) : "—"}
          </p>
        </div>
        {cheapest && (
          <div className="flex min-w-0 flex-col items-end gap-1 text-right">
            <span className="text-[11px] font-bold tracking-[0.06em] text-peach-sub uppercase">
              Cheapest in {DAYS} days
            </span>
            <p className="text-[17px] leading-none font-extrabold text-peach-fg tabular-nums">
              {dollars(cheapest.priceCents)}
              <span className="ml-1.5 text-[13px] font-bold text-peach-sub">
                {dayLabel(cheapest.date)}
              </span>
            </p>
          </div>
        )}
      </div>

      {/* The bars are readable one by one, not just as a shape: hovering a day
          names it and its price above the chart, and the bar comes forward. A
          native `title` alone (which is all this had) waits a second, appears
          under the pointer in the OS font, and can't be seen at all on a touch
          screen — but it stays as the accessible fallback.

          One hover slot on the parent rather than sixty tooltips: this is
          sixty-odd spans in a scrolling column, and sixty `Tooltip` instances
          with their own portals and timers is a lot of machinery for a readout
          that is one line of text. */}
      <div className="relative flex flex-col gap-1.5">
        <div className="flex h-4 items-end justify-center">
          <span
            className={cn(
              "text-[12px] font-bold tabular-nums transition-opacity",
              hovered ? "text-peach-fg opacity-100" : "opacity-0",
            )}
            aria-hidden
          >
            {hovered
              ? `${dayLabel(hovered.date)} · ${dollars(hovered.priceCents)}${hovered.available ? "" : " · sold out"}`
              : "\u00a0"}
          </span>
        </div>
        <div
          className="flex h-16 items-end gap-px"
          role="img"
          aria-label={`Daily ticket price over the next ${DAYS} days, from ${dollars(min)} to ${dollars(max)}.`}
          onPointerLeave={() => setHovered(null)}
        >
          {bars.map((b) => (
            <span
              key={b.date}
              onPointerEnter={() => setHovered(b)}
              title={`${dayLabel(b.date)} · ${dollars(b.priceCents)}${b.available ? "" : " · sold out"}`}
              // Scaled across the range this park actually charges, not from
              // zero: a $109–$139 spread drawn from zero is a flat wall, and
              // the whole point of the bars is which days cost less. Floored at
              // a quarter so the cheapest day is still a bar.
              style={{
                height: `${max === min ? 100 : 25 + ((b.priceCents - min) / (max - min)) * 75}%`,
              }}
              className={cn(
                "min-w-0 flex-1 cursor-default rounded-[2px] transition-colors",
                // The two bars the figures above name, in the two colours those
                // figures are printed in — so the chart is read against them
                // rather than as a separate picture.
                hovered?.date === b.date
                  ? "bg-peach-fg"
                  : lead && b.date === lead.date
                    ? "bg-brand-yellow"
                    : cheapest && b.date === cheapest.date
                      ? "bg-peach-fg"
                      : "bg-peach-edge",
              )}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="yellow"
          size="lg"
          className="min-w-0 flex-1 font-bold"
          render={<a href={href} target="_blank" rel="noreferrer" />}
        >
          <span className="truncate">Buy on {ticketStoreLabel(resort)}</span>
          <ExternalLinkIcon />
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="shrink-0 font-bold"
          render={<Link to="/tickets" />}
        >
          All prices
        </Button>
      </div>
    </TintPanel>
  );
}
