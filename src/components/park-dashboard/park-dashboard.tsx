"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "#/integrations/trpc/react.ts";

import { MapSlot } from "#/components/park-map/map-stage.tsx";
import { NotificationPrompt } from "#/components/notifications/notification-prompt.tsx";
import { ChartErrorBoundary } from "#/components/chart-error-boundary.tsx";
import { lazyWithReload } from "#/lib/lazy-with-reload.tsx";
import { useHydrated } from "#/lib/use-hydrated.ts";

import { Skeleton } from "#/components/ui/skeleton.tsx";

import { ParkBoardTable } from "./park-board-table.tsx";
import { ParkStatCards } from "./park-stat-cards.tsx";
import { useSelection } from "./selection-context.tsx";

// visx + d3 are heavy and the chart isn't crawler content (the same numbers
// live in the SSR'd board table), so split it out of the critical park-page
// chunk and stream it in after first paint.
const ParkWaitChart = lazyWithReload(
  () => import("./park-wait-chart.tsx").then((m) => ({ default: m.ParkWaitChart })),
  "park-wait-chart",
);

// The analytics grid is chart-heavy and lives below the fold, so split it out
// of the critical park-page chunk and stream it in after the board renders.
const ParkAnalytics = lazyWithReload(
  () => import("./park-analytics.tsx").then((m) => ({ default: m.ParkAnalytics })),
  "park-analytics",
);

export function ParkDashboard({ parkSlug }: { parkSlug: string }) {
  const trpc = useTRPC();
  const parksQ = useQuery(trpc.parks.list.queryOptions());
  const parks = parksQ.data;

  const activeSlug = parkSlug;

  const boardQ = useQuery({
    ...trpc.parks.board.queryOptions({ parkSlug: activeSlug ?? "" }),
    enabled: !!activeSlug,
  });
  const board = boardQ.data;

  // Selection is shared with the persistent map in the dash layout (see
  // `selection-context.tsx`) so clicking a marker drives the chart and the
  // selection survives navigation.
  const { selected, setSelected } = useSelection();

  // Nothing is selected by default — the chart shows the busiest few series and
  // the park average on its own. We only clear a stale selection when the park
  // changes and the previously-picked ride isn't on this board.
  React.useEffect(() => {
    if (!board || !selected) return;
    const stillHere = board.some((b) => b.id === selected.id);
    if (!stillHere) setSelected(null);
  }, [board, selected, setSelected]);

  const park = parks?.find((p) => p.slug === activeSlug);
  const operatorSlug = park?.operatorSlug;
  const timezone = park?.timezone;

  // "Updated x ago" is computed from the current clock, so the server HTML and
  // the first client render would disagree and trip a hydration mismatch. Only
  // render it once we've hydrated on the client.
  const hydrated = useHydrated();

  return (
    <div
      className="flex flex-col gap-4 py-4 md:gap-6 md:py-6"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}
    >
      {/* The page identity already shows in the sticky bar on mobile, so this
          in-body header would just repeat it — desktop only. */}
      <div className="hidden flex-col gap-2 px-4 md:flex md:flex-row md:items-end md:justify-between lg:px-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight text-white md:text-foreground">
            {board ? parks?.find((p) => p.slug === activeSlug)?.name : "Loading park…"}
          </h2>
          <p className="text-sm text-blue-100/90 md:text-muted-foreground">
            Live wait times, ride status, and Lightning Lane availability.
            {hydrated &&
              board &&
              (() => {
                const latest = board.reduce<string | null>((m, b) => {
                  if (!b.observedAt) return m;
                  return !m || b.observedAt > m ? b.observedAt : m;
                }, null);
                if (!latest) return null;
                const diff = Date.now() - new Date(latest).getTime();
                const min = Math.floor(diff / 60_000);
                const label =
                  min < 1 ? "just now" : min < 60 ? `${min}m ago` : `${Math.floor(min / 60)}h ago`;
                return <span className="ml-2 text-xs">Updated {label}</span>;
              })()}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-4 lg:px-6">
        <NotificationPrompt />
        {/* The at-a-glance stat bar leads the dashboard, above the map + chart. */}
        <ParkStatCards
          board={board}
          loading={boardQ.isLoading || !activeSlug}
          operatorSlug={operatorSlug}
          className="rounded-2xl border shadow-md"
        />
        {/* Map and wait chart share a row at equal width; the board table spans
            the full column underneath them. The map cell is a shared-layout
            slot — the live map morphs in from the overview hero. */}
        {/* `[&>*]:min-w-0` makes the two tracks `minmax(0,1fr)` instead of
            `minmax(auto,1fr)`: without it the chart card's intrinsic min-content
            (chart container + the header toolbar) blows the column past 1fr
            and overflows the content card at lg+. */}
        <div className="grid items-stretch gap-4 lg:grid-cols-2 lg:[&>*]:min-w-0">
          {/* Card-like surface to match the chart container, but no drop shadow:
              the 3D shelf border carries the depth, a box-shadow under it would
              double up and read as a floating panel. */}
          <MapSlot className="border-3d btn-3d-outline relative isolate h-[320px] overflow-hidden rounded-4xl border-t-3 bg-card lg:h-auto lg:min-h-[460px] dark:border-border" />
          {/* The chart is a `React.lazy` boundary that DOES server-render (React
              ships the resolved subtree), but its chunk isn't loaded yet when the
              client hydrates — so the client falls back to this skeleton, the
              server's chart markup is torn out, and the resulting `removeChild`
              throw aborts hydration of the whole page. Render the skeleton on the
              server AND the first client render (gate on `hydrated`); the lazy
              chart then mounts cleanly after hydration. It isn't crawler content
              — the same numbers ship in the SSR'd board table below. */}
          {hydrated ? (
            <ChartErrorBoundary
              label="wait-chart"
              fallback={
                <div className="flex h-[320px] w-full items-center justify-center rounded-2xl border text-sm text-muted-foreground lg:h-auto lg:min-h-[460px]">
                  Chart unavailable
                </div>
              }
            >
              <React.Suspense
                fallback={
                  <Skeleton className="h-[320px] w-full rounded-2xl lg:h-auto lg:min-h-[460px]" />
                }
              >
                <ParkWaitChart
                  parkSlug={activeSlug ?? null}
                  focusedId={selected?.id ?? null}
                  onClearFocus={() => setSelected(null)}
                  operatorSlug={operatorSlug}
                />
              </React.Suspense>
            </ChartErrorBoundary>
          ) : (
            <Skeleton className="h-[320px] w-full rounded-2xl lg:h-auto lg:min-h-[460px]" />
          )}
        </div>
      </div>

      <div className="px-4 lg:px-6">
        <ParkBoardTable
          board={board}
          loading={boardQ.isLoading || !activeSlug}
          parkSlug={activeSlug ?? null}
          selectedId={selected?.id ?? null}
          onSelect={(item) => setSelected({ id: item.id, name: item.name })}
          operatorSlug={operatorSlug}
          timezone={timezone}
        />
      </div>

      <div className="px-4 lg:px-6">
        {/* Same hazard as the chart above: a server-rendered `React.lazy`
            boundary whose chunk isn't ready at hydration. Keep it client-only. */}
        {hydrated ? (
          <ChartErrorBoundary
            label="analytics"
            fallback={
              <div className="flex h-[200px] w-full items-center justify-center rounded-2xl border text-sm text-muted-foreground">
                Analytics unavailable
              </div>
            }
          >
            <React.Suspense fallback={<Skeleton className="h-[640px] w-full rounded-2xl" />}>
              <ParkAnalytics parkSlug={activeSlug ?? null} />
            </React.Suspense>
          </ChartErrorBoundary>
        ) : (
          <Skeleton className="h-[640px] w-full rounded-2xl" />
        )}
      </div>
    </div>
  );
}
