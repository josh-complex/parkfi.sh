"use client";

import * as React from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ScanLineIcon, SearchIcon } from "lucide-react";

import { AppInset } from "#/components/app-inset.tsx";
import { AppSidebar } from "#/components/app-sidebar.tsx";
import { PinCard, type PinCardData } from "#/components/pins/pin-card.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { SidebarProvider } from "#/components/ui/sidebar.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/pins")({
  component: PinsPage,
  head: () =>
    seo({
      title: "Disney Pin Catalog & Trading — ParkFi",
      description:
        "Browse and identify Disney trading pins, track your collection, and find trades with other collectors.",
      path: "/pins",
    }),
});

const SORT_LABEL: Record<string, string> = {
  name: "Name",
  year_desc: "Newest",
  value_desc: "Most valuable",
};

const ALL = "__all__";

function PinsPage() {
  const trpc = useTRPC();

  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [series, setSeries] = React.useState<string>(ALL);
  const [character, setCharacter] = React.useState<string>(ALL);
  const [sort, setSort] = React.useState<"name" | "year_desc" | "value_desc">("name");
  const [cursor, setCursor] = React.useState<number | undefined>(undefined);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Reset pagination whenever the filters or search change.
  React.useEffect(() => {
    setCursor(undefined);
  }, [debounced, series, character, sort]);

  const facetsQ = useQuery(trpc.pinCatalog.facets.queryOptions());

  const searching = debounced.length >= 2;

  const searchQ = useQuery({
    ...trpc.pinCatalog.search.queryOptions({ q: debounced }),
    enabled: searching,
    placeholderData: (prev) => prev,
  });

  const browseQ = useQuery({
    ...trpc.pinCatalog.browse.queryOptions({
      series: series === ALL ? undefined : series,
      character: character === ALL ? undefined : character,
      sort,
      cursor,
    }),
    enabled: !searching,
    placeholderData: (prev) => prev,
  });

  // The catalog grid accumulates browse pages as the user loads more.
  const [browsePins, setBrowsePins] = React.useState<PinCardData[]>([]);
  React.useEffect(() => {
    if (searching || !browseQ.data) return;
    setBrowsePins((prev) =>
      cursor == null ? browseQ.data!.pins : [...prev, ...browseQ.data!.pins],
    );
  }, [browseQ.data, cursor, searching]);

  const pins = searching ? (searchQ.data ?? []) : browsePins;
  const nextCursor = searching ? null : (browseQ.data?.nextCursor ?? null);
  const isLoading = searching ? searchQ.isLoading : browseQ.isLoading && browsePins.length === 0;

  const seriesItems: Record<string, string> = {
    [ALL]: "All series",
    ...Object.fromEntries((facetsQ.data?.series ?? []).map((s) => [s, s])),
  };
  const characterItems: Record<string, string> = {
    [ALL]: "All characters",
    ...Object.fromEntries((facetsQ.data?.characters ?? []).map((c) => [c, c])),
  };

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <AppInset>
        <SiteHeader title="Pins" />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h1 className="text-xl font-semibold">Pin catalog</h1>
                  <p className="text-muted-foreground text-sm">
                    Browse Disney trading pins, track your collection, and find trades.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" render={<Link to="/pins/collection" />}>
                    My collection
                  </Button>
                  <Button variant="outline" size="sm" render={<Link to="/pins/trades" />}>
                    Trades
                  </Button>
                  <Button size="sm" render={<Link to="/pins/scan" />}>
                    <ScanLineIcon />
                    Scan a pin
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-56 flex-1">
                  <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search pins…"
                    className="pl-9"
                  />
                </div>
                <Select
                  value={series}
                  onValueChange={(v) => v && setSeries(v as string)}
                  items={seriesItems}
                >
                  <SelectTrigger size="sm" aria-label="Series">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(seriesItems).map(([v, label]) => (
                      <SelectItem key={v} value={v}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={character}
                  onValueChange={(v) => v && setCharacter(v as string)}
                  items={characterItems}
                >
                  <SelectTrigger size="sm" aria-label="Character">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(characterItems).map(([v, label]) => (
                      <SelectItem key={v} value={v}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={sort}
                  onValueChange={(v) => v && setSort(v as "name" | "year_desc" | "value_desc")}
                  items={SORT_LABEL}
                >
                  <SelectTrigger size="sm" aria-label="Sort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SORT_LABEL).map(([v, label]) => (
                      <SelectItem key={v} value={v}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isLoading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-[3/4] w-full rounded-2xl" />
                  ))}
                </div>
              ) : pins.length === 0 ? (
                <Empty>
                  <EmptyTitle>No pins found</EmptyTitle>
                  <EmptyDescription>
                    {searching
                      ? "Try a different search term."
                      : "Try clearing a filter, or scan a pin to add it."}
                  </EmptyDescription>
                  <Button className="mt-4" render={<Link to="/pins/scan" />}>
                    Scan a pin
                  </Button>
                </Empty>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {pins.map((pin) => (
                      <PinCard key={pin.id} pin={pin} />
                    ))}
                  </div>
                  {nextCursor != null ? (
                    <div className="flex justify-center pt-2">
                      <Button
                        variant="outline"
                        disabled={browseQ.isFetching}
                        onClick={() => setCursor(nextCursor)}
                      >
                        {browseQ.isFetching ? "Loading…" : "Load more"}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </AppInset>
    </SidebarProvider>
  );
}
