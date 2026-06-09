"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "#/integrations/trpc/react.ts";

import { MapSlot } from "#/components/park-map/map-stage.tsx";
import { NotificationPrompt } from "#/components/notifications/notification-prompt.tsx";

import { ParkBoardTable } from "./park-board-table.tsx";
import { ParkStatCards } from "./park-stat-cards.tsx";
import { ParkWaitChart } from "./park-wait-chart.tsx";
import { useSelection } from "./selection-context.tsx";
import type { BoardItem } from "./types.ts";

/** Default attraction to chart: the operating ride with the longest standby line. */
function pickDefault(board: Array<BoardItem>): BoardItem | null {
  const rides = board.filter((b) => b.entityType === "ATTRACTION");
  const withWait = rides
    .filter((b) => typeof b.standbyWait === "number")
    .sort((a, b) => (b.standbyWait ?? 0) - (a.standbyWait ?? 0));
  return withWait[0] ?? rides[0] ?? null;
}

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

  // When a park's board loads (or the park changes), default the charted ride
  // if the current selection isn't present in this board.
  React.useEffect(() => {
    if (!board) return;
    const stillHere = selected && board.some((b) => b.id === selected.id);
    if (!stillHere) {
      const def = pickDefault(board);
      setSelected(def ? { id: def.id, name: def.name } : null);
    }
  }, [board, selected, setSelected]);

  const operatorSlug = parks?.find((p) => p.slug === activeSlug)?.operatorSlug;

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

      <div className="flex flex-col gap-4 px-4 lg:px-6">
        <NotificationPrompt />
        {/* Map and wait chart share a row at equal width; the board table spans
            the full column underneath them. The map cell is a shared-layout
            slot — the live map morphs in from the overview hero. */}
        <div className="grid items-stretch gap-4 lg:grid-cols-2">
          <MapSlot className="relative h-[320px] overflow-hidden rounded-2xl border shadow-md lg:h-auto lg:min-h-[460px]" />
          <ParkWaitChart
            parkSlug={activeSlug ?? null}
            focusedId={selected?.id ?? null}
            operatorSlug={operatorSlug}
            className="shadow-md"
          />
        </div>
        <ParkStatCards
          board={board}
          loading={boardQ.isLoading || !activeSlug}
          operatorSlug={operatorSlug}
          className="rounded-2xl border shadow-md"
        />
      </div>

      <div className="px-4 lg:px-6">
        <ParkBoardTable
          board={board}
          loading={boardQ.isLoading || !activeSlug}
          parkSlug={activeSlug ?? null}
          selectedId={selected?.id ?? null}
          onSelect={(item) => setSelected({ id: item.id, name: item.name })}
          operatorSlug={operatorSlug}
        />
      </div>
    </div>
  );
}
