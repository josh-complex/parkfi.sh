"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "#/integrations/trpc/react.ts";
import { Route } from "#/routes/index.tsx";

import { ParkBoardTable } from "./park-board-table.tsx";
import { ParkStatCards } from "./park-stat-cards.tsx";
import { ParkWaitChart } from "./park-wait-chart.tsx";
import type { BoardItem } from "./types.ts";

/** Default attraction to chart: the operating ride with the longest standby line. */
function pickDefault(board: Array<BoardItem>): BoardItem | null {
  const rides = board.filter((b) => b.entityType === "ATTRACTION");
  const withWait = rides
    .filter((b) => typeof b.standbyWait === "number")
    .sort((a, b) => (b.standbyWait ?? 0) - (a.standbyWait ?? 0));
  return withWait[0] ?? rides[0] ?? null;
}

export function ParkDashboard() {
  const trpc = useTRPC();
  const parksQ = useQuery(trpc.parks.list.queryOptions());
  const parks = parksQ.data;

  const { park: parkSlug } = Route.useSearch();
  const activeSlug = parkSlug ?? parks?.[0]?.slug;

  const boardQ = useQuery({
    ...trpc.parks.board.queryOptions({ parkSlug: activeSlug ?? "" }),
    enabled: !!activeSlug,
  });
  const board = boardQ.data;

  const [selected, setSelected] = React.useState<{ id: number; name: string } | null>(null);

  // When a park's board loads (or the park changes), default the charted ride
  // if the current selection isn't present in this board.
  React.useEffect(() => {
    if (!board) return;
    const stillHere = selected && board.some((b) => b.id === selected.id);
    if (!stillHere) {
      const def = pickDefault(board);
      setSelected(def ? { id: def.id, name: def.name } : null);
    }
  }, [board, selected]);

  const operatorSlug = parks?.find((p) => p.slug === activeSlug)?.operatorSlug;

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="flex flex-col gap-2 px-4 sm:flex-row sm:items-end sm:justify-between lg:px-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight">
            {board ? parks?.find((p) => p.slug === activeSlug)?.name : "Loading park…"}
          </h2>
          <p className="text-muted-foreground text-sm">
            Live wait times, ride status, and Lightning Lane pricing.
            {board &&
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

      <div className="px-4 lg:px-6">
        <ParkWaitChart
          attractionId={selected?.id ?? null}
          attractionName={selected?.name ?? null}
          operatorSlug={operatorSlug}
        />
        <ParkStatCards
          board={board}
          loading={boardQ.isLoading || !activeSlug}
          operatorSlug={operatorSlug}
          className="rounded-b-lg border border-t-0 shadow-xs"
        />
      </div>

      <div className="px-4 lg:px-6">
        <ParkBoardTable
          board={board}
          loading={boardQ.isLoading || !activeSlug}
          selectedId={selected?.id ?? null}
          onSelect={(item) => setSelected({ id: item.id, name: item.name })}
          operatorSlug={operatorSlug}
        />
      </div>
    </div>
  );
}
