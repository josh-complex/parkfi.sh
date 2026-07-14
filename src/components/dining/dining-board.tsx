"use client";

import * as React from "react";
import { getRouteApi } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useQuery } from "@tanstack/react-query";

import { DiningSearchBar, DiningMobileFAB } from "#/components/dining/dining-search-bar.tsx";
import { ResultsView } from "#/components/dining/dining-results-view.tsx";
import { DiningCuisineChips } from "#/components/dining/dining-cuisine-chips.tsx";
import { DiningRecentlyUpdated } from "#/components/dining/dining-recently-updated.tsx";
import { DiningPicks } from "#/components/dining/dining-picks.tsx";
import {
  diningSearchKey,
  searchToState,
  stateToSearch,
} from "#/components/dining/dining-search-params.ts";
import {
  applySearch,
  diningStore,
  hydratePartySize,
  resetDiningStore,
  setStuck,
} from "#/components/dining/dining-store.ts";
import {
  deriveOptions,
  filterRestaurants,
  sortRestaurants,
  type AvailabilityMap,
  type AvailabilityEntry,
} from "#/components/dining/dining-filters.ts";
import {
  parkNowMinutes,
  type HoursMap,
  type ScheduleEntry,
} from "#/components/dining/dining-hours.ts";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useIsMobile } from "#/hooks/use-mobile.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";

const PAGE_SIZE = 12;

const diningRoute = getRouteApi("/_app/dining");

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Pre-search browse: the menu-change feed + curated picks shelves only. */
function BrowseView({ isLoading }: { isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, g) => (
          <div key={g} className="flex flex-col gap-4">
            <Skeleton className="h-6 w-56" />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <DiningRecentlyUpdated variant="restaurants" />
      {/* Character Dining sits above the cart/quick-service activity shelf, with
          Snacks & Sweet Treats and a dedicated Mobile Ordering shelf right below
          it (in that order); the remaining curated picks follow. */}
      <DiningPicks include={["character"]} />
      <DiningRecentlyUpdated variant="carts" />
      <DiningPicks include={["sweet-treats"]} />
      <DiningPicks include={["mobile-order"]} />
      <DiningPicks exclude={["character", "sweet-treats", "mobile-order"]} />
    </div>
  );
}

export function DiningBoard() {
  const trpc = useTRPC();
  const isMobile = useIsMobile();
  const { data: session } = authClient.useSession();

  const searched = useStore(diningStore, (s) => s.searched);
  const filters = useStore(diningStore, (s) => s.filters);
  const partySize = useStore(diningStore, (s) => s.partySize);
  const sortKey = useStore(diningStore, (s) => s.sortKey);
  const page = useStore(diningStore, (s) => s.page);

  // Restore the remembered party size on mount, and reset store state when the
  // board unmounts (navigation away).
  React.useEffect(() => {
    hydratePartySize();
    return resetDiningStore;
  }, []);

  // The committed search is mirrored into the URL so it survives navigation:
  // tap a cuisine chip → open a restaurant → Back lands on the filtered results
  // (not the browse home), and a filtered search is a shareable link.
  const urlSearch = diningRoute.useSearch();
  const navigate = diningRoute.useNavigate();
  const searchKey = diningSearchKey(urlSearch);
  const hydratedRef = React.useRef(false);

  // URL → store: hydrate on mount and whenever the URL changes (Back/Forward,
  // shared links). Runs before the reflect effect below so the initial params
  // are applied before we consider writing back.
  React.useEffect(() => {
    applySearch(searchToState(urlSearch));
    hydratedRef.current = true;
  }, [searchKey, urlSearch]);

  // store → URL: reflect committed filter/sort/page changes back into the URL,
  // replacing rather than pushing so filter tweaks don't pile up in history.
  // Read live store state (not the render-time slices) so the mount tick — where
  // the URL→store effect above has just applied the params synchronously — sees
  // the hydrated values and doesn't clobber the URL back to defaults.
  React.useEffect(() => {
    if (!hydratedRef.current) return;
    const s = diningStore.state;
    const next = stateToSearch({
      filters: s.filters,
      searched: s.searched,
      sortKey: s.sortKey,
      page: s.page,
    });
    if (diningSearchKey(next) !== searchKey) {
      void navigate({ to: "/dining", search: next, replace: true });
    }
  }, [filters, searched, sortKey, page, searchKey, navigate]);

  // The pill rides a hero wash at rest, then flips to a translucent bar once it
  // sticks over the scrolling content. A flow sentinel marks the hand-off.
  const sentinelRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const headerOffset = isMobile ? 48 : 0;
    const obs = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), {
      rootMargin: `-${headerOffset + 1}px 0px 0px 0px`,
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [isMobile]);

  const restaurantsQ = useQuery(trpc.dining.restaurants.queryOptions());
  const hoursQ = useQuery(trpc.dining.hours.queryOptions({}));

  const days = 30;
  const availabilityQ = useQuery({
    ...trpc.dining.availability.queryOptions({ partySize: Number(partySize), days }),
    enabled: searched,
  });

  const restaurants = restaurantsQ.data;

  const availabilityMap: AvailabilityMap = React.useMemo(() => {
    const m = new Map<string, AvailabilityEntry>();
    for (const entry of availabilityQ.data ?? []) m.set(entry.facilityId, entry);
    return m;
  }, [availabilityQ.data]);

  const hoursMap: HoursMap = React.useMemo(() => {
    const m = new Map<string, Array<ScheduleEntry>>();
    for (const entry of hoursQ.data ?? []) m.set(entry.facilityId, entry.schedules);
    return m;
  }, [hoursQ.data]);

  const options = React.useMemo(() => deriveOptions(restaurants ?? []), [restaurants]);

  const todayStr = today();
  const nowMin = parkNowMinutes();
  const referenceDate = todayStr;

  const visible = React.useMemo(() => {
    if (!restaurants) return [];
    const filtered = filterRestaurants(
      restaurants,
      availabilityMap,
      filters,
      referenceDate,
      hoursMap,
      nowMin,
    );
    return sortRestaurants(filtered, availabilityMap, sortKey, referenceDate);
  }, [restaurants, availabilityMap, filters, sortKey, referenceDate, hoursMap, nowMin]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const isLoading = restaurantsQ.isLoading || (searched && availabilityQ.isLoading);

  return (
    <div className="relative isolate flex flex-col">
      {/* Hero wash behind the headline + at-rest pill; scrolls away with the
          page. Desktop only — mobile goes straight into the content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 hidden h-60 bg-[radial-gradient(120%_140%_at_50%_-25%,color-mix(in_oklab,var(--color-sidebar)_26%,transparent),transparent_70%)] md:block"
      />

      {/* Short hero — desktop only, collapses away once the user commits a search. */}
      <div
        className={`hidden transition-all duration-500 ease-in-out md:grid ${
          searched ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-4 pt-8 pb-5 text-center lg:px-6">
            <h1 className="text-2xl font-bold tracking-tight">Find a table at the parks</h1>
            <p className="text-muted-foreground mx-auto mt-1 max-w-xl text-sm">
              Browse Disney &amp; Universal restaurants, then search to see live reservation
              availability.
            </p>
          </div>
        </div>
      </div>

      {/* Flow sentinel: marks where the bar starts sticking. */}
      <div ref={sentinelRef} aria-hidden className="h-0" />

      <DiningSearchBar options={options} />
      <DiningMobileFAB options={options} />

      {/* Mobile quick cuisine filters, tucked under the header's omnisearch. */}
      <DiningCuisineChips options={options} />

      <div className="mx-auto flex w-full max-w-[100rem] flex-col gap-8 p-4 pb-24 lg:px-6">
        {searched ? (
          <ResultsView
            isLoading={isLoading}
            isError={availabilityQ.isError}
            restaurants={pageItems}
            availabilityMap={availabilityMap}
            hoursMap={hoursMap}
            nowMin={nowMin}
            referenceDate={referenceDate}
            total={visible.length}
            hasRestaurants={!!restaurants?.length}
            options={options}
            currentPage={currentPage}
            pageCount={pageCount}
            loggedIn={!!session?.user}
            defaultPartySize={Number(partySize)}
          />
        ) : (
          <BrowseView isLoading={restaurantsQ.isLoading} />
        )}
      </div>
    </div>
  );
}
