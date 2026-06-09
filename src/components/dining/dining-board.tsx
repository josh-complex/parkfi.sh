"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "#/components/ui/badge.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

const DAYS_OPTIONS = [
  { value: "7", label: "7d" },
  { value: "14", label: "14d" },
  { value: "30", label: "30d" },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

interface DayEntry {
  date: string;
  available: boolean;
  offerCount: number;
  mealPeriods: string[];
  observedAt: string;
}

interface AvailabilityEntry {
  facilityId: string;
  name: string;
  days: Array<DayEntry>;
}

function AvailabilitySparkline({
  days,
  windowDays,
}: {
  days: Array<DayEntry>;
  windowDays: number;
}) {
  const shown = days.slice(0, windowDays);
  return (
    <div className="flex gap-0.5">
      {shown.map((d) => (
        <div
          key={d.date}
          title={`${formatDate(d.date)}: ${d.available ? `${d.offerCount} slot${d.offerCount === 1 ? "" : "s"}` : "none"}`}
          className={cn(
            "h-2 w-1.5 rounded-sm",
            d.available ? "bg-primary" : "bg-muted-foreground/20",
          )}
        />
      ))}
    </div>
  );
}

interface Restaurant {
  facilityId: string;
  name: string;
  cuisine: string | null;
  experienceType: string | null;
  priceRange: string | null;
  parkResort: string | null;
  imageUrl: string | null;
  detailUrl: string | null;
  source: number;
}

function RestaurantCard({
  restaurant,
  availability,
}: {
  restaurant: Restaurant;
  availability: AvailabilityEntry | undefined;
}) {
  const todayStr = today();
  const todayData = availability?.days.find((d) => d.date === todayStr);
  const nextAvailable = availability?.days.find((d) => d.available && d.date >= todayStr);
  const latestObserved = availability?.days[0]?.observedAt;
  const subtitle = [restaurant.parkResort, restaurant.experienceType ?? restaurant.cuisine]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card className="@container/card overflow-hidden pt-0">
      {restaurant.imageUrl && (
        <div className="bg-muted relative h-32 w-full overflow-hidden">
          <img
            src={restaurant.imageUrl}
            alt={restaurant.name}
            loading="lazy"
            className="size-full object-cover"
          />
          {availability &&
            (todayData?.available ? (
              <Badge className="absolute top-3 right-3 bg-emerald-500 text-white shadow">
                Open today
              </Badge>
            ) : (
              <Badge variant="secondary" className="absolute top-3 right-3 shadow">
                None today
              </Badge>
            ))}
        </div>
      )}
      <CardHeader className={restaurant.imageUrl ? "pt-4" : undefined}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="line-clamp-1">
              {restaurant.detailUrl ? (
                <a
                  href={restaurant.detailUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  {restaurant.name}
                </a>
              ) : (
                restaurant.name
              )}
            </CardTitle>
            <CardDescription className="mt-0.5 line-clamp-1">{subtitle}</CardDescription>
          </div>
          {/* Status badge lives on the image when present; show it here otherwise. */}
          {!restaurant.imageUrl && availability ? (
            todayData?.available ? (
              <Badge className="bg-emerald-500 text-white shrink-0">Open today</Badge>
            ) : (
              <Badge variant="outline" className="shrink-0 text-muted-foreground">
                None today
              </Badge>
            )
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {availability ? (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {nextAvailable
                  ? `Next: ${nextAvailable.date === todayStr ? "today" : formatDate(nextAvailable.date)}`
                  : "No availability in window"}
              </span>
              {latestObserved && <span>Updated {relativeTime(latestObserved)}</span>}
            </div>
            <AvailabilitySparkline days={availability.days} windowDays={30} />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No observations yet</p>
        )}
        {restaurant.priceRange && (
          <span className="text-xs text-muted-foreground">{restaurant.priceRange}</span>
        )}
      </CardContent>
    </Card>
  );
}

export function DiningBoard() {
  const trpc = useTRPC();
  const [partySize, setPartySize] = React.useState("2");
  const [days, setDays] = React.useState("30");

  const restaurantsQ = useQuery(trpc.dining.restaurants.queryOptions());
  const availabilityQ = useQuery(
    trpc.dining.availability.queryOptions({
      partySize: Number(partySize),
      days: Number(days),
    }),
  );

  const restaurants = restaurantsQ.data;
  const availabilityMap = React.useMemo(() => {
    const m = new Map<string, AvailabilityEntry>();
    for (const entry of availabilityQ.data ?? []) m.set(entry.facilityId, entry);
    return m;
  }, [availabilityQ.data]);

  const isLoading = restaurantsQ.isLoading || availabilityQ.isLoading;

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="flex flex-col gap-2 px-4 sm:flex-row sm:items-end sm:justify-between lg:px-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight">Dining Reservations</h2>
          <p className="text-muted-foreground text-sm">
            Live reservation availability across Disney &amp; Universal restaurants.
          </p>
        </div>
        <div className="flex items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-muted-foreground text-xs">Party size</Label>
            <Select
              value={partySize}
              onValueChange={(v) => v && setPartySize(v)}
              items={Object.fromEntries(
                Array.from({ length: 8 }, (_, i) => [String(i + 1), String(i + 1)]),
              )}
            >
              <SelectTrigger className="w-20" aria-label="Party size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 8 }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {i + 1}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ToggleGroup
            multiple={false}
            value={[days]}
            onValueChange={(v) => setDays(v[0] ?? "30")}
            variant="outline"
            className="*:data-[slot=toggle-group-item]:px-3!"
          >
            {DAYS_OPTIONS.map((o) => (
              <ToggleGroupItem key={o.value} value={o.value}>
                {o.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      <div className="px-4 lg:px-6">
        {isLoading ? (
          <div className="grid gap-4 @xl/main:grid-cols-2 @4xl/main:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[160px] rounded-4xl" />
            ))}
          </div>
        ) : !restaurants?.length ? (
          <Empty>
            <EmptyTitle>No priority restaurants</EmptyTitle>
            <EmptyDescription>
              The dining sweep only covers restaurants marked as priority. None are configured yet.
            </EmptyDescription>
          </Empty>
        ) : (
          <div className="grid gap-4 @xl/main:grid-cols-2 @4xl/main:grid-cols-3">
            {restaurants.map((r) => (
              <RestaurantCard
                key={r.facilityId}
                restaurant={r}
                availability={availabilityMap.get(r.facilityId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
