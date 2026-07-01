import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownWideNarrowIcon, ArrowDownAZIcon } from "lucide-react";

import { RideFilterButton } from "#/components/rides/ride-filter-button.tsx";
import { rideMatchesFilter, useRideFilter } from "#/components/rides/ride-filter.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

type Ride = {
  id: number;
  name: string;
  slug: string;
  category: string | null;
  status: string | null;
  standbyWait: number | null;
  parkSlug: string;
  parkName: string;
  land: string | null;
  heightRequirement: string | null;
  imageThumbUrl: string | null;
  imageAlt: string | null;
};

type Sort = "wait" | "name";

/** Standby-wait → pill colors, mirroring the map's `waitColor` buckets. */
function waitPillClass(wait: number | null): string {
  if (wait == null) return "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300";
  if (wait < 20) return "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300";
  if (wait < 45) return "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300";
  if (wait < 75) return "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300";
  return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
}

function statusLabel(status: string | null): string {
  switch (status) {
    case "DOWN":
      return "Down";
    case "REFURBISHMENT":
      return "Refurb";
    case "CLOSED":
      return "Closed";
    default:
      return "Closed";
  }
}

function WaitPill({ ride }: { ride: Ride }) {
  if (ride.status === "OPERATING") {
    if (ride.standbyWait == null) {
      return (
        <span className="rounded-lg bg-blue-100 px-2 py-1 text-[11px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          Open
        </span>
      );
    }
    return (
      <span
        className={cn(
          "flex min-w-[3rem] flex-col items-center rounded-lg px-2 py-1 leading-none",
          waitPillClass(ride.standbyWait),
        )}
      >
        <span className="text-sm font-bold">{ride.standbyWait}</span>
        <span className="text-[9px] font-medium opacity-80">min</span>
      </span>
    );
  }
  return (
    <span className="rounded-lg bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">
      {statusLabel(ride.status)}
    </span>
  );
}

function RideRow({ ride }: { ride: Ride }) {
  return (
    <Link
      to="/park/$slug/ride/$rideSlug"
      params={{ slug: ride.parkSlug, rideSlug: ride.slug }}
      className="flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-muted/60"
    >
      {ride.imageThumbUrl ? (
        <img
          src={ride.imageThumbUrl}
          alt={ride.imageAlt ?? ride.name}
          loading="lazy"
          className="size-11 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <div className="size-11 shrink-0 rounded-lg bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{ride.name}</div>
        {ride.land && <div className="truncate text-xs text-muted-foreground">{ride.land}</div>}
      </div>
      <WaitPill ride={ride} />
    </Link>
  );
}

/**
 * The Waits page: one filterable, sortable list of every ride across all parks,
 * grouped by park. The map handles spatial browsing; this is the itemized view.
 * Shares the ride filter (drawer) with the map via `useRideFilter`.
 */
export function CrossParkWaits() {
  const trpc = useTRPC();
  const { data: rides, isLoading } = useQuery(trpc.parks.allRides.queryOptions());
  const { filter } = useRideFilter();
  const [sort, setSort] = React.useState<Sort>("wait");

  const groups = React.useMemo(() => {
    const filtered = (rides ?? []).filter((r) => rideMatchesFilter(r, filter));
    const byPark = new Map<string, { parkName: string; parkSlug: string; rides: Array<Ride> }>();
    for (const r of filtered) {
      const g = byPark.get(r.parkSlug) ?? {
        parkName: r.parkName,
        parkSlug: r.parkSlug,
        rides: [],
      };
      g.rides.push(r);
      byPark.set(r.parkSlug, g);
    }
    const cmp =
      sort === "wait"
        ? (a: Ride, b: Ride) =>
            (b.standbyWait ?? -1) - (a.standbyWait ?? -1) || a.name.localeCompare(b.name)
        : (a: Ride, b: Ride) => a.name.localeCompare(b.name);
    const out = [...byPark.values()];
    for (const g of out) g.rides.sort(cmp);
    return out;
  }, [rides, filter, sort]);

  const stats = React.useMemo(() => {
    const all = rides ?? [];
    const open = all.filter((r) => r.status === "OPERATING");
    const withWait = open.filter((r) => r.standbyWait != null);
    const avg =
      withWait.length > 0
        ? Math.round(withWait.reduce((s, r) => s + (r.standbyWait ?? 0), 0) / withWait.length)
        : null;
    return { open: open.length, avg };
  }, [rides]);

  const shown = groups.reduce((n, g) => n + g.rides.length, 0);

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 pt-4">
      {/* Sticky toolbar: live summary + sort toggle + filter drawer. */}
      <div className="sticky top-0 z-10 -mx-4 mb-2 flex items-center gap-2 border-b bg-background/90 px-4 py-2 backdrop-blur md:rounded-t-2xl">
        <div className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">{stats.open} open</span>
          {stats.avg != null && (
            <span className="text-muted-foreground"> · {stats.avg} min avg</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSort((s) => (s === "wait" ? "name" : "wait"))}
          className="btn-3d-outline border-3d shadow-3d relative top-0 inline-flex items-center gap-1.5 rounded-full bg-background px-3.5 py-2 text-sm font-medium transition-[top,box-shadow] duration-150 active:top-[3px] active:shadow-3d-active dark:border-border"
        >
          {sort === "wait" ? (
            <ArrowDownWideNarrowIcon className="size-4" />
          ) : (
            <ArrowDownAZIcon className="size-4" />
          )}
          {sort === "wait" ? "Wait" : "A–Z"}
        </button>
        <RideFilterButton />
      </div>

      {isLoading && <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>}

      {!isLoading && shown === 0 && (
        <div className="py-16 text-center text-sm text-muted-foreground">
          No rides match your filters.
        </div>
      )}

      <div className="flex flex-col gap-5 pb-4">
        {groups.map((g) => (
          <section key={g.parkSlug}>
            <div className="mb-1 flex items-baseline justify-between px-2.5">
              <h2 className="text-sm font-semibold tracking-tight">{g.parkName}</h2>
              <span className="text-xs text-muted-foreground">{g.rides.length}</span>
            </div>
            <div className="flex flex-col rounded-2xl border bg-card/40 p-1">
              {g.rides.map((r) => (
                <RideRow key={r.id} ride={r} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
