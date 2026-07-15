import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpDownIcon, LayoutGridIcon, ListIcon, SlidersHorizontalIcon } from "lucide-react";

import { ConnectionLost } from "#/components/connection-lost.tsx";
import { RideCategoryChips } from "#/components/rides/ride-category-chips.tsx";
import {
  MAP_FILTER_PILL,
  MAP_FILTER_STACK,
  RideFilterControls,
  RideFilterFooter,
} from "#/components/rides/ride-filter-button.tsx";
import {
  RIDE_CATEGORIES,
  rideMatchesFilter,
  useRideFilter,
} from "#/components/rides/ride-filter.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import {
  Carousel,
  CarouselArrows,
  CarouselContent,
  CarouselItem,
} from "#/components/ui/carousel.tsx";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "#/components/ui/drawer.tsx";
import { SortRows, type SortDir, type SortOption } from "#/components/ui/sort-menu.tsx";
import { queryUnavailable } from "#/hooks/use-online-status.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { Image, useCfImages, useDataSaver } from "#/components/ui/image.tsx";
import { preloadImage } from "#/lib/image-preload.ts";
import { disneyResizeUrl, HERO_IMAGE, resolveImageUrls } from "#/lib/image.ts";
import { cn } from "#/lib/utils.ts";
import { formatParkName } from "#/lib/parks.ts";

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
  imageCardUrl: string | null;
  imageHeroUrl: string | null;
  imageAlt: string | null;
  imageThumbhash: string | null;
};

type Sort = "wait" | "name";
type View = "grid" | "list";

const SORTS: ReadonlyArray<SortOption<Sort>> = [
  {
    key: "wait",
    label: "Wait",
    directional: true,
    defaultDir: "desc",
    ascHint: "shortest first",
    descHint: "longest first",
  },
  {
    key: "name",
    label: "Name",
    directional: true,
    defaultDir: "asc",
    ascHint: "A–Z",
    descHint: "Z–A",
  },
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
    <Badge
      className={cn(
        "border-0 text-xs font-normal tabular-nums shadow",
        waitBadgeClass(ride),
        className,
      )}
    >
      {label}
    </Badge>
  );
}

/** Card for the grid view — same shape as the Eats "picks" cards. */
/** `eager` marks above-the-fold cards: eager-loaded so the browser's preload
 *  scanner fetches them from the SSR HTML instead of waiting for hydration +
 *  the IntersectionObserver. Only the first section's leading cards qualify. */
function RideCard({ ride, eager }: { ride: Ride; eager?: boolean }) {
  const cf = useCfImages();
  const dataSaver = useDataSaver();
  // On intent (hover / focus / touch), warm the ride's detail-page hero at low
  // priority so tapping through shows it instantly. Resolves the exact URL
  // ride-detail's <Image> will request (same HERO_IMAGE transform, same
  // dataSaver state) so it's a cache hit, not a wasted second fetch. Pairs with
  // the router's `intent` route-data preloading; no-op until the hero has
  // loaded once (deduped).
  const warmHero = () => {
    if (!ride.imageHeroUrl) return;
    const heroSrc = disneyResizeUrl(ride.imageHeroUrl, HERO_IMAGE.resizeWidth);
    const { src, srcSet } = resolveImageUrls(heroSrc, {
      cf,
      sizes: HERO_IMAGE.sizes,
      quality: HERO_IMAGE.quality,
      dataSaver,
    });
    preloadImage(src, { srcSet, sizes: HERO_IMAGE.sizes });
  };
  return (
    <Link
      to="/park/$slug/ride/$rideSlug"
      params={{ slug: ride.parkSlug, rideSlug: ride.slug }}
      onPointerEnter={warmHero}
      onFocus={warmHero}
      className="block"
    >
      <div className="group flex flex-col gap-2 outline-none">
        <div className="bg-muted relative aspect-[4/3] w-full overflow-hidden rounded-2xl">
          {ride.imageCardUrl ? (
            <Image
              src={ride.imageCardUrl}
              alt={ride.imageAlt ?? ride.name}
              loading={eager ? "eager" : "lazy"}
              aspect={4 / 3}
              placeholder={ride.imageThumbhash}
              className="size-full object-cover group-hover:scale-105"
            />
          ) : null}
          <WaitBadge ride={ride} className="absolute left-2 top-2" />
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
function RideRow({ ride, eager }: { ride: Ride; eager?: boolean }) {
  return (
    <Link
      to="/park/$slug/ride/$rideSlug"
      params={{ slug: ride.parkSlug, rideSlug: ride.slug }}
      className="flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-muted/60"
    >
      {ride.imageThumbUrl ? (
        <Image
          src={ride.imageThumbUrl}
          alt={ride.imageAlt ?? ride.name}
          loading={eager ? "eager" : "lazy"}
          boxWidth={44}
          aspect={1}
          placeholder={ride.imageThumbhash}
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

/**
 * Loading placeholder shown while `allRides` resolves. Mirrors the shelf layout
 * (per-park header + a card track / list) so the page keeps its shape instead of
 * collapsing to a single line of text. `view` matches the resting card vs. list.
 */
function WaitsSkeleton({ view }: { view: View }) {
  return (
    <>
      {Array.from({ length: 3 }).map((_, g) => (
        <section key={g} className="-mx-4 flex flex-col gap-3 lg:-mx-6">
          <div className="flex flex-col gap-1.5 px-4 lg:px-6">
            <Skeleton className="h-6 w-40 rounded-md" />
            <Skeleton className="h-4 w-24 rounded-md" />
          </div>
          {view === "grid" ? (
            <div className="flex gap-4 overflow-hidden px-4 lg:px-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex shrink-0 basis-[42%] flex-col gap-2 md:basis-1/3 lg:basis-1/4 xl:basis-1/5 2xl:basis-1/6"
                >
                  <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
                  <Skeleton className="h-4 w-3/4 rounded-md" />
                  <Skeleton className="h-3 w-1/2 rounded-md" />
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 lg:px-6">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-1 rounded-2xl border bg-card/40 p-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-2.5 py-2">
                    <Skeleton className="size-11 shrink-0 rounded-lg" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <Skeleton className="h-4 w-1/2 rounded-md" />
                      <Skeleton className="h-3 w-1/3 rounded-md" />
                    </div>
                    <Skeleton className="h-6 w-12 shrink-0 rounded-lg" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      ))}
    </>
  );
}

/** Sort chooser — shared bottom drawer, styled to its surface via `variant`. */
function SortDrawer({
  sortKey,
  sortDir,
  onSort,
  variant,
}: {
  sortKey: Sort;
  sortDir: SortDir;
  onSort: (key: Sort, dir: SortDir) => void;
  variant: "ghost" | "outline" | "pill";
}) {
  return (
    <Drawer>
      {variant === "pill" ? (
        <DrawerTrigger className={MAP_FILTER_PILL}>
          <ArrowUpDownIcon />
          Sort
        </DrawerTrigger>
      ) : (
        <DrawerTrigger asChild>
          <Button
            variant={variant}
            size="sm"
            className={cn("min-h-10", variant === "ghost" && "rounded-full")}
          >
            <ArrowUpDownIcon data-icon="inline-start" />
            Sort
          </Button>
        </DrawerTrigger>
      )}
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Sort rides</DrawerTitle>
          <DrawerDescription>
            Choose how each park&rsquo;s rides are ordered. Tap again to flip the direction.
          </DrawerDescription>
        </DrawerHeader>
        <SortRows options={SORTS} activeKey={sortKey} activeDir={sortDir} onChange={onSort} />
      </DrawerContent>
    </Drawer>
  );
}

/** Filter chooser — reuses the shared ride-filter controls (same as the map). */
function FilterDrawer({ variant }: { variant: "ghost" | "outline" | "pill" }) {
  return (
    <Drawer>
      {variant === "pill" ? (
        <DrawerTrigger className={MAP_FILTER_PILL}>
          <SlidersHorizontalIcon />
          Filter
        </DrawerTrigger>
      ) : (
        <DrawerTrigger asChild>
          <Button
            variant={variant}
            size="sm"
            className={cn("min-h-10", variant === "ghost" && "rounded-full")}
          >
            <SlidersHorizontalIcon data-icon="inline-start" />
            Filter
          </Button>
        </DrawerTrigger>
      )}
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
  variant: "ghost" | "outline" | "pill";
}) {
  const next: View = view === "grid" ? "list" : "grid";
  const label = view === "grid" ? "Switch to list view" : "Switch to shelf view";
  const icon = view === "grid" ? <ListIcon /> : <LayoutGridIcon />;
  // Mobile: a right-anchored 3D round button matching the map's controls (and the
  // left Filter/Sort pills' shelf/glare), mirroring the left cluster on the right.
  if (variant === "pill") {
    return (
      <button
        type="button"
        onClick={() => onView(next)}
        aria-label={label}
        className="btn-3d-outline border-3d shadow-3d pointer-events-auto flex size-11 items-center justify-center rounded-full bg-background text-foreground transition active:scale-95 dark:border-[color-mix(in_oklch,var(--border),white_25%)] [&>svg]:size-5"
      >
        {icon}
      </button>
    );
  }
  return (
    <Button
      variant={variant}
      size="icon-sm"
      className={cn("min-h-10 min-w-10", variant === "ghost" && "rounded-full")}
      onClick={() => onView(next)}
      aria-label={label}
    >
      {icon}
    </Button>
  );
}

/**
 * The Waits page: every ride across all parks in per-park sections, styled
 * after the Eats/Stays shelves — a horizontal card carousel per park
 * ("grid", the default) or a plain vertical list, toggled from the controls and
 * remembered across visits. Sort + filter live in a desktop toolbar and a mobile
 * FAB (both share the ride-filter drawer with the map via `useRideFilter`).
 */
export function CrossParkWaits() {
  const trpc = useTRPC();
  const ridesQ = useQuery(trpc.parks.allRides.queryOptions());
  const { data: rides, isLoading } = ridesQ;
  const unavailable = queryUnavailable(ridesQ);
  const { filter } = useRideFilter();
  const [sortKey, setSortKey] = React.useState<Sort>("wait");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");
  const setSort = React.useCallback((key: Sort, dir: SortDir) => {
    setSortKey(key);
    setSortDir(dir);
  }, []);
  const [view, setView] = React.useState<View>("grid");

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

  // Freeze the display order so cards don't jump as live waits tick: rank ride
  // ids once (by the active sort) and reuse that rank across data refetches —
  // numbers update in place, positions hold. Re-ranks only when the sort changes.
  const orderRef = React.useRef<{
    sortKey: Sort;
    sortDir: SortDir;
    map: Map<number, number>;
  } | null>(null);
  const orderMap = React.useMemo(() => {
    const list = rides ?? [];
    const stale =
      !orderRef.current ||
      orderRef.current.sortKey !== sortKey ||
      orderRef.current.sortDir !== sortDir;
    if (list.length > 0 && stale) {
      const byName = (a: Ride, b: Ride) => a.name.localeCompare(b.name);
      const cmp =
        sortKey === "wait"
          ? sortDir === "desc"
            ? // Longest first; missing waits sink to the bottom.
              (a: Ride, b: Ride) => (b.standbyWait ?? -1) - (a.standbyWait ?? -1) || byName(a, b)
            : // Shortest first; missing waits still sink to the bottom.
              (a: Ride, b: Ride) =>
                (a.standbyWait ?? Infinity) - (b.standbyWait ?? Infinity) || byName(a, b)
          : sortDir === "asc"
            ? byName
            : (a: Ride, b: Ride) => b.name.localeCompare(a.name);
      const sorted = [...list].sort(cmp);
      const map = new Map<number, number>();
      sorted.forEach((r, i) => map.set(r.id, i));
      orderRef.current = { sortKey, sortDir, map };
    }
    return orderRef.current?.map ?? new Map<number, number>();
  }, [rides, sortKey, sortDir]);

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

  // Quick-filter chips only offer categories actually present in the data
  // (dine/shop never appear here — `allRides` is scoped to entity_type ATTRACTION).
  const categoryOptions = React.useMemo(() => {
    const present = new Set((rides ?? []).map((r) => r.category).filter((c) => c != null));
    return RIDE_CATEGORIES.filter((c) => present.has(c.key));
  }, [rides]);

  return (
    <div className="flex flex-col">
      {/* Mobile quick attraction-type filters, tucked right under the header's
          omnisearch (the chip row's own py-2 sets the gap, like Eats/Stays). */}
      <RideCategoryChips categories={categoryOptions} />

      {/* Padded content container — mirrors the Eats/Stays browse wrapper; the
          shelves bleed back to the edges with their own -mx. */}
      <div className="mx-auto flex w-full max-w-[100rem] flex-col gap-4 p-4 pb-28 lg:px-6">
        {/* Desktop controls — mirrors the Eats/Stays top bar; mobile uses the FAB. */}
        <div className="hidden items-center justify-end gap-2 md:flex">
          <SortDrawer sortKey={sortKey} sortDir={sortDir} onSort={setSort} variant="outline" />
          <FilterDrawer variant="outline" />
          <ViewToggle view={view} onView={setViewPersist} variant="outline" />
        </div>

        {isLoading && <WaitsSkeleton view={view} />}

        {!isLoading && unavailable && <ConnectionLost onRetry={() => void ridesQ.refetch()} />}

        {!isLoading && !unavailable && shown === 0 && (
          <div className="py-16 text-center text-sm text-muted-foreground">
            No rides match your filters.
          </div>
        )}

        {groups.map((g, gi) => {
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
              <section className="flex flex-col gap-3">
                <div className="flex items-end justify-between gap-4 px-4 lg:px-6">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <h3 className="truncate text-lg font-semibold tracking-tight">
                      {formatParkName(g.parkName)}
                    </h3>
                    <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
                  </div>
                  <CarouselArrows className="hidden shrink-0 md:flex" />
                </div>

                {view === "grid" ? (
                  <CarouselContent
                    className="-ml-4"
                    viewportClassName="px-4 lg:px-6 [mask-image:linear-gradient(to_right,transparent,#000_1.5rem,#000_calc(100%_-_1.5rem),transparent)]"
                  >
                    {g.rides.map((r, i) => (
                      <CarouselItem
                        key={r.id}
                        className="basis-[42%] pl-4 md:basis-1/3 lg:basis-1/4 xl:basis-1/5 2xl:basis-1/6"
                      >
                        <RideCard ride={r} eager={gi === 0 && i < 5} />
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                ) : (
                  <div className="px-4 lg:px-6">
                    <div className="mx-auto flex w-full max-w-3xl flex-col rounded-2xl border bg-card/40 p-1">
                      {g.rides.map((r, i) => (
                        <RideRow key={r.id} ride={r} eager={gi === 0 && i < 10} />
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </Carousel>
          );
        })}
      </div>

      {/* Mobile controls — left-anchored stacked pills, matching the map's
          bottom-left Filter button exactly. Filter + Sort only (omni search
          covers search). The shelf/list view toggle mirrors them on the right. */}
      {!isLoading && shown > 0 && (
        <>
          <div
            className={MAP_FILTER_STACK}
            style={{ bottom: "calc(var(--safe-bottom) + var(--bottom-nav-height) + 1.4rem)" }}
          >
            <SortDrawer sortKey={sortKey} sortDir={sortDir} onSort={setSort} variant="pill" />
            <FilterDrawer variant="pill" />
          </div>
          <div
            className="pointer-events-none fixed right-4 z-40 flex md:hidden"
            style={{ bottom: "calc(var(--safe-bottom) + var(--bottom-nav-height) + 1.4rem)" }}
          >
            <ViewToggle view={view} onView={setViewPersist} variant="pill" />
          </div>
        </>
      )}
    </div>
  );
}
