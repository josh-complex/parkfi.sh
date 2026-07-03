import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpDownIcon,
  ChevronDownIcon,
  LayoutGridIcon,
  ListIcon,
  SlidersHorizontalIcon,
} from "lucide-react";

import { RideFilterControls, RideFilterFooter } from "#/components/rides/ride-filter-button.tsx";
import {
  rideFilterCount,
  rideMatchesFilter,
  useRideFilter,
} from "#/components/rides/ride-filter.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Carousel,
  CarouselArrows,
  CarouselContent,
  CarouselItem,
} from "#/components/ui/carousel.tsx";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "#/components/ui/drawer.tsx";
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
type View = "grid" | "list";

const SORTS: ReadonlyArray<{ key: Sort; label: string }> = [
  { key: "wait", label: "Longest wait first" },
  { key: "name", label: "Name (A–Z)" },
];

const VIEW_STORAGE_KEY = "waits-view";

function statusLabel(status: string | null): string {
  switch (status) {
    case "DOWN":
      return "Down";
    case "REFURBISHMENT":
      return "Refurb";
    default:
      return "Closed";
  }
}

/** Solid, image-legible wait badge (mirrors the Eats status-badge treatment). */
function waitBadgeClass(ride: Ride): string {
  if (ride.status !== "OPERATING") return "bg-black/60 text-white backdrop-blur-sm";
  const w = ride.standbyWait;
  if (w == null) return "bg-sky-500 text-white";
  if (w < 20) return "bg-emerald-500 text-white";
  if (w < 45) return "bg-amber-500 text-white";
  if (w < 75) return "bg-orange-500 text-white";
  return "bg-red-500 text-white";
}

function WaitBadge({ ride, className }: { ride: Ride; className?: string }) {
  const label =
    ride.status === "OPERATING"
      ? ride.standbyWait != null
        ? `${ride.standbyWait} min`
        : "Open"
      : statusLabel(ride.status);
  return (
    <Badge className={cn("border-0 text-xs font-semibold shadow", waitBadgeClass(ride), className)}>
      {label}
    </Badge>
  );
}

/** Card for the grid view — same shape as the Eats "picks" cards. */
function RideCard({ ride }: { ride: Ride }) {
  return (
    <Link
      to="/park/$slug/ride/$rideSlug"
      params={{ slug: ride.parkSlug, rideSlug: ride.slug }}
      className="block"
    >
      <div className="group flex flex-col gap-2 outline-none">
        <div className="bg-muted relative aspect-[4/3] w-full overflow-hidden rounded-2xl">
          {ride.imageThumbUrl ? (
            <img
              src={ride.imageThumbUrl}
              alt={ride.imageAlt ?? ride.name}
              loading="lazy"
              className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : null}
          <WaitBadge ride={ride} className="absolute right-2 top-2" />
        </div>
        <div className="flex flex-col gap-0.5 px-0.5">
          <span className="line-clamp-1 text-sm font-medium group-hover:underline">
            {ride.name}
          </span>
          {ride.land && (
            <span className="text-muted-foreground line-clamp-1 text-xs">{ride.land}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

/** Row for the list view (the plain vertical list). */
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
      <WaitBadge ride={ride} />
    </Link>
  );
}

/** Sort chooser — shared bottom drawer, styled to its surface via `variant`. */
function SortDrawer({
  sort,
  onSort,
  variant,
}: {
  sort: Sort;
  onSort: (s: Sort) => void;
  variant: "ghost" | "outline";
}) {
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant={variant} size="sm" className={cn(variant === "ghost" && "rounded-full")}>
          <ArrowUpDownIcon data-icon="inline-start" />
          Sort
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Sort rides</DrawerTitle>
          <DrawerDescription>Choose how each park&rsquo;s rides are ordered.</DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-1 px-4 pb-4">
          {SORTS.map((s) => (
            <DrawerClose key={s.key} asChild>
              <Button
                variant={sort === s.key ? "secondary" : "ghost"}
                className="justify-start"
                onClick={() => onSort(s.key)}
              >
                {s.label}
              </Button>
            </DrawerClose>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/** Filter chooser — reuses the shared ride-filter controls (same as the map). */
function FilterDrawer({ variant }: { variant: "ghost" | "outline" }) {
  const { filter } = useRideFilter();
  const count = rideFilterCount(filter);
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant={variant} size="sm" className={cn(variant === "ghost" && "rounded-full")}>
          <SlidersHorizontalIcon data-icon="inline-start" />
          Filter
          {count > 0 && (
            <span className="bg-primary text-primary-foreground ml-0.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full px-1 text-[11px] font-bold leading-[1.1rem]">
              {count}
            </span>
          )}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="border-b pb-4">
          <DrawerTitle>Filter rides</DrawerTitle>
        </DrawerHeader>
        <RideFilterControls />
        <RideFilterFooter />
      </DrawerContent>
    </Drawer>
  );
}

function ViewToggle({
  view,
  onView,
  variant,
}: {
  view: View;
  onView: (v: View) => void;
  variant: "ghost" | "outline";
}) {
  const next: View = view === "grid" ? "list" : "grid";
  return (
    <Button
      variant={variant}
      size="icon-sm"
      className={cn(variant === "ghost" && "rounded-full")}
      onClick={() => onView(next)}
      aria-label={view === "grid" ? "Switch to list view" : "Switch to card view"}
    >
      {view === "grid" ? <ListIcon /> : <LayoutGridIcon />}
    </Button>
  );
}

/**
 * The Waits page: every ride across all parks in collapsible per-park sections,
 * styled after the Eats/Stays shelves — a horizontal card carousel per park
 * ("grid", the default) or a plain vertical list, toggled from the controls and
 * remembered across visits. Sort + filter live in a desktop toolbar and a mobile
 * FAB (both share the ride-filter drawer with the map via `useRideFilter`).
 */
export function CrossParkWaits() {
  const trpc = useTRPC();
  const { data: rides, isLoading } = useQuery(trpc.parks.allRides.queryOptions());
  const { filter } = useRideFilter();
  const [sort, setSort] = React.useState<Sort>("wait");
  const [view, setView] = React.useState<View>("grid");
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());

  // Read the remembered view after mount (SSR renders the default so server and
  // first client render agree — no hydration mismatch).
  React.useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_STORAGE_KEY);
      if (v === "grid" || v === "list") setView(v);
    } catch {
      /* private mode / disabled storage — keep the default */
    }
  }, []);

  const setViewPersist = React.useCallback((v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapse = React.useCallback((slug: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  // Freeze the display order so cards don't jump as live waits tick: rank ride
  // ids once (by the active sort) and reuse that rank across data refetches —
  // numbers update in place, positions hold. Re-ranks only when the sort changes.
  const orderRef = React.useRef<{ sort: Sort; map: Map<number, number> } | null>(null);
  const orderMap = React.useMemo(() => {
    const list = rides ?? [];
    if (list.length > 0 && (!orderRef.current || orderRef.current.sort !== sort)) {
      const cmp =
        sort === "wait"
          ? (a: Ride, b: Ride) =>
              (b.standbyWait ?? -1) - (a.standbyWait ?? -1) || a.name.localeCompare(b.name)
          : (a: Ride, b: Ride) => a.name.localeCompare(b.name);
      const sorted = [...list].sort(cmp);
      const map = new Map<number, number>();
      sorted.forEach((r, i) => map.set(r.id, i));
      orderRef.current = { sort, map };
    }
    return orderRef.current?.map ?? new Map<number, number>();
  }, [rides, sort]);

  const groups = React.useMemo(() => {
    const filtered = (rides ?? []).filter((r) => rideMatchesFilter(r, filter));
    const byPark = new Map<string, { parkName: string; parkSlug: string; rides: Array<Ride> }>();
    for (const r of filtered) {
      const g = byPark.get(r.parkSlug) ?? { parkName: r.parkName, parkSlug: r.parkSlug, rides: [] };
      g.rides.push(r);
      byPark.set(r.parkSlug, g);
    }
    const rank = (r: Ride) => orderMap.get(r.id) ?? Number.MAX_SAFE_INTEGER;
    return [...byPark.values()].map((g) => {
      g.rides.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
      const open = g.rides.filter((r) => r.status === "OPERATING");
      const withWait = open.filter((r) => r.standbyWait != null);
      const avg =
        withWait.length > 0
          ? Math.round(withWait.reduce((s, r) => s + (r.standbyWait ?? 0), 0) / withWait.length)
          : null;
      return { ...g, isOpen: open.length > 0, avg };
    });
  }, [rides, filter, orderMap]);

  const shown = groups.reduce((n, g) => n + g.rides.length, 0);

  return (
    <div className="flex flex-col p-4 pb-28 lg:px-6">
      {/* Desktop controls — mirrors the Eats/Stays top bar; mobile uses the FAB. */}
      <div className="hidden items-center justify-end gap-2 pb-2 md:flex">
        <SortDrawer sort={sort} onSort={setSort} variant="outline" />
        <FilterDrawer variant="outline" />
        <ViewToggle view={view} onView={setViewPersist} variant="outline" />
      </div>

      {isLoading && <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>}

      {!isLoading && shown === 0 && (
        <div className="py-16 text-center text-sm text-muted-foreground">
          No rides match your filters.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.parkSlug);
          const subtitle =
            g.isOpen && g.avg != null
              ? `${g.avg} min average wait`
              : `${g.rides.length} ride${g.rides.length === 1 ? "" : "s"}`;
          // Bleed the whole section to the container edges (canceling the page's
          // px-4/lg:px-6) so the card track scrolls flush to the device edge; the
          // heading, resting cards, and list re-inset to stay aligned.
          return (
            <Carousel
              key={g.parkSlug}
              opts={{ align: "start", dragFree: true }}
              className="-mx-4 lg:-mx-6"
            >
              <section className="flex flex-col gap-3 py-3">
                <div className="flex items-end justify-between gap-4 px-4 lg:px-6">
                  <button
                    type="button"
                    onClick={() => toggleCollapse(g.parkSlug)}
                    aria-expanded={!isCollapsed}
                    className="-my-1 flex min-w-0 items-center gap-2 rounded-lg py-1 pr-2 text-left transition-colors hover:opacity-80"
                  >
                    <ChevronDownIcon
                      className={cn(
                        "size-5 shrink-0 self-center text-muted-foreground transition-transform",
                        isCollapsed && "-rotate-90",
                      )}
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-lg font-semibold tracking-tight">
                        {g.parkName}
                      </span>
                      <span className="truncate text-sm text-muted-foreground">{subtitle}</span>
                    </span>
                  </button>
                  {!isCollapsed && <CarouselArrows className="hidden shrink-0 md:flex" />}
                </div>

                {!isCollapsed &&
                  (view === "grid" ? (
                    <CarouselContent className="ml-0 gap-4 px-4 lg:px-6">
                      {g.rides.map((r) => (
                        <CarouselItem
                          key={r.id}
                          // Embla only reads the last slide's margin for the end
                          // gap — the track's padding-right is ignored — so
                          // last:mr keeps the final card off the device edge at
                          // full scroll.
                          className="basis-[42%] pl-0 last:mr-4 sm:basis-1/3 md:basis-1/4 lg:basis-1/5 lg:last:mr-6 xl:basis-1/6"
                        >
                          <RideCard ride={r} />
                        </CarouselItem>
                      ))}
                    </CarouselContent>
                  ) : (
                    <div className="px-4 lg:px-6">
                      <div className="mx-auto flex w-full max-w-3xl flex-col rounded-2xl border bg-card/40 p-1">
                        {g.rides.map((r) => (
                          <RideRow key={r.id} ride={r} />
                        ))}
                      </div>
                    </div>
                  ))}
              </section>
            </Carousel>
          );
        })}
      </div>

      {/* Mobile controls — floating FAB, matching Eats/Stays. */}
      {!isLoading && shown > 0 && (
        <div
          className="fixed left-1/2 z-40 -translate-x-1/2 md:hidden"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + var(--bottom-nav-height) + 1rem)" }}
        >
          <div className="flex items-center gap-1 rounded-full border bg-popover/95 p-1 shadow-xl supports-backdrop-filter:backdrop-blur">
            <SortDrawer sort={sort} onSort={setSort} variant="ghost" />
            <span className="h-5 w-px bg-border" />
            <FilterDrawer variant="ghost" />
            <span className="h-5 w-px bg-border" />
            <ViewToggle view={view} onView={setViewPersist} variant="ghost" />
          </div>
        </div>
      )}
    </div>
  );
}
