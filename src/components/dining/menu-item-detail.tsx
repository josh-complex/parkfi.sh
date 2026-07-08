"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowLeftIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";

import { MenuItemPriceChart } from "#/components/dining/menu-item-price-chart.tsx";
import { menuItemAnchorId, slugifyMenuItem } from "#/components/dining/menu-content.tsx";
import { ChartErrorBoundary } from "#/components/chart-error-boundary.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

function formatPrice(price: number | null, currency: string | null): string | null {
  if (price === null) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency ?? "USD",
      minimumFractionDigits: Number.isInteger(price) ? 0 : 2,
    }).format(price);
  } catch {
    return `$${price}`;
  }
}

function isWithinDays(iso: string | null | undefined, days: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t <= days * 86_400_000;
}

const NEW_WINDOW_DAYS = 30;

/** A single stat cell in the summary card. */
function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{children}</span>
    </div>
  );
}

/**
 * Standalone menu-item detail page: one item's identity, its current price
 * framed against the tracked range, a price-trend chart, and its history
 * (renames + every observed price move). Reached from a menu item's title link
 * (`/dining/$facilityId/item/$slug`). Handles active, removed, and renamed-away
 * items — the last two link forward/back so a stale deep link still resolves.
 */
export function MenuItemDetail({ facilityId, slug }: { facilityId: string; slug: string }) {
  const trpc = useTRPC();
  const itemQ = useQuery(trpc.dining.menuItem.queryOptions({ facilityId, slug }));
  const venueQ = useQuery(trpc.dining.venue.queryOptions({ facilityId }));
  const item = itemQ.data;
  const venue = venueQ.data;

  const currency = item?.current?.currency ?? null;
  const points = item?.priceHistory ?? [];
  const stats = React.useMemo(() => {
    if (points.length === 0) return null;
    const prices = points.map((p) => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const first = prices[0]!;
    const current = prices[prices.length - 1]!;
    return { min, max, first, current, delta: current - first };
  }, [points]);

  // The price moves list (consecutive deltas), newest first.
  const moves = React.useMemo(() => {
    const out: Array<{ t: number; from: number; to: number }> = [];
    for (let i = 1; i < points.length; i++) {
      if (points[i].price !== points[i - 1].price) {
        out.push({ t: points[i].t, from: points[i - 1].price, to: points[i].price });
      }
    }
    return out.reverse();
  }, [points]);

  if (itemQ.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-2 pb-6 lg:px-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pt-2 pb-6 lg:px-6">
        <div className="rounded-2xl border bg-muted/30 py-16 text-center">
          <p className="text-lg font-semibold">Menu item not found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            We don&apos;t have a record for this item.{" "}
            <Link
              to="/dining/$facilityId"
              params={{ facilityId }}
              hash="menu"
              className="underline"
            >
              View the full menu
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  const currentPrice = formatPrice(item.current?.price ?? null, currency);
  const isNew = isWithinDays(item.firstSeenAt, NEW_WINDOW_DAYS);
  const chips = [item.current?.mealPeriod, item.current?.groupName].filter(
    Boolean,
  ) as Array<string>;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-2 pb-10 lg:px-6">
      {/* Breadcrumb back to the venue menu, anchored on this item. */}
      <nav className="-mb-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <Link
          to="/dining/$facilityId"
          params={{ facilityId }}
          hash="menu"
          className="inline-flex items-center gap-1.5 hover:underline"
        >
          <ArrowLeftIcon className="size-3.5" />
          Menu
        </Link>
        {venue && (
          <>
            <span aria-hidden>/</span>
            <Link to="/dining/$facilityId" params={{ facilityId }} className="hover:underline">
              {venue.name}
            </Link>
          </>
        )}
      </nav>

      {/* Header */}
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{item.title}</h1>
          {isNew && item.status === "active" && (
            <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400">
              New
            </Badge>
          )}
          {item.status === "removed" && <Badge variant="secondary">No longer offered</Badge>}
          {item.status === "renamed" && <Badge variant="secondary">Renamed</Badge>}
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <Badge key={c} variant="outline" className="font-normal">
                {c}
              </Badge>
            ))}
          </div>
        )}
        {item.current?.description && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {item.current.description}
          </p>
        )}
      </header>

      {/* Renamed-away / removed notices with a forward link when we have one. */}
      {item.status === "renamed" && item.renamedTo && (
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm">
          This item is now listed as{" "}
          <Link
            to="/dining/$facilityId/item/$slug"
            params={{ facilityId, slug: slugifyMenuItem(item.renamedTo) }}
            className="font-medium text-primary hover:underline"
          >
            {item.renamedTo}
          </Link>
          .
        </div>
      )}

      {/* Summary + current price */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base">
            {item.status === "removed" ? "Last known price" : "Current price"}
          </CardTitle>
          {item.current?.priceType && <CardDescription>{item.current.priceType}</CardDescription>}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-3xl font-semibold tabular-nums">
              {currentPrice ?? (stats ? formatPrice(stats.current, currency) : "—")}
            </span>
            {stats && Math.abs(stats.delta) >= 0.01 && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-sm font-medium",
                  stats.delta > 0
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-emerald-600 dark:text-emerald-400",
                )}
              >
                {stats.delta > 0 ? (
                  <TrendingUpIcon className="size-4" />
                ) : (
                  <TrendingDownIcon className="size-4" />
                )}
                {formatPrice(Math.abs(stats.delta), currency)} {stats.delta > 0 ? "up" : "down"}{" "}
                since first tracked
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {stats && (
              <>
                <Stat label="Lowest tracked">{formatPrice(stats.min, currency)}</Stat>
                <Stat label="Highest tracked">{formatPrice(stats.max, currency)}</Stat>
              </>
            )}
            <Stat label="First seen">
              {item.firstSeenAt
                ? `${formatDistanceToNowStrict(new Date(item.firstSeenAt))} ago`
                : "Since we began tracking"}
            </Stat>
            <Stat label="Last change">
              {item.lastChangedAt
                ? `${formatDistanceToNowStrict(new Date(item.lastChangedAt))} ago`
                : "No changes yet"}
            </Stat>
          </div>
        </CardContent>
      </Card>

      {/* Price trend */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base">Price history</CardTitle>
          <CardDescription>Every price we&rsquo;ve observed for this item</CardDescription>
        </CardHeader>
        <CardContent className="px-2 pb-4 sm:px-4">
          <ChartErrorBoundary
            label="Price history"
            fallback={<Empty>Price history unavailable right now.</Empty>}
          >
            {points.length < 2 ? (
              <Empty>
                {points.length === 1 && stats
                  ? `We just started tracking this item at ${formatPrice(stats.current, currency)}. The trend fills in as prices move.`
                  : "No price history recorded yet — the trend fills in once we catch a price change."}
              </Empty>
            ) : (
              <MenuItemPriceChart points={points} currency={currency} />
            )}
          </ChartErrorBoundary>
        </CardContent>
      </Card>

      {/* History: renames + individual price moves */}
      {(item.formerNames.length > 0 || moves.length > 0) && (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">History</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {item.formerNames.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Previously known as</span>
                <div className="flex flex-wrap gap-1.5">
                  {item.formerNames.map((n) => (
                    <Badge key={n} variant="outline" className="font-normal line-through">
                      {n}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {moves.length > 0 && (
              <ul className="flex flex-col divide-y divide-border/50">
                {moves.map((m, i) => {
                  const up = m.to > m.from;
                  return (
                    <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="text-muted-foreground">
                        {new Date(m.t).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                      <span className="inline-flex items-center gap-2 tabular-nums">
                        <span className="text-muted-foreground line-through">
                          {formatPrice(m.from, currency)}
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-0.5 font-medium",
                            up
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-emerald-600 dark:text-emerald-400",
                          )}
                        >
                          {up ? (
                            <TrendingUpIcon className="size-3.5" />
                          ) : (
                            <TrendingDownIcon className="size-3.5" />
                          )}
                          {formatPrice(m.to, currency)}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* Deep link back to this item within the full menu. */}
      {item.status === "active" && (
        <Link
          to="/dining/$facilityId"
          params={{ facilityId }}
          hash={menuItemAnchorId(item.title)}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline"
        >
          See it on the full menu
        </Link>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[212px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
