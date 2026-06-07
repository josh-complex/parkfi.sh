"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { Label } from "#/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

import { ParkBoardTable } from "./park-board-table.tsx";
import { ParkStatCards } from "./park-stat-cards.tsx";
import { ParkWaitChart } from "./park-wait-chart.tsx";
import type { BoardItem, ParkListItem } from "./types.ts";

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

  const [parkSlug, setParkSlug] = React.useState<string | undefined>(undefined);
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

  // Reset the selection when switching parks so the effect re-picks a default.
  const onParkChange = (slug: string) => {
    setParkSlug(slug);
    setSelected(null);
  };

  const byResort = groupByResort(parks ?? []);
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
        <div className="flex flex-col gap-1.5">
          <Label className="text-muted-foreground text-xs">Park</Label>
          <Select
            value={activeSlug}
            onValueChange={(v) => v && onParkChange(v)}
            items={(parks ?? []).map((p) => ({ value: p.slug, label: p.name }))}
            disabled={!parks}
          >
            <SelectTrigger className="w-64" aria-label="Select a park">
              <SelectValue placeholder="Select a park" />
            </SelectTrigger>
            <SelectContent>
              {byResort.map((group) => (
                <SelectGroup key={group.resort}>
                  <SelectLabel>{group.resort}</SelectLabel>
                  {group.parks.map((p) => (
                    <SelectItem key={p.slug} value={p.slug}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <ParkStatCards
        board={board}
        loading={boardQ.isLoading || !activeSlug}
        operatorSlug={operatorSlug}
      />

      <div className="px-4 lg:px-6">
        <div className="grid items-start gap-4 lg:grid-cols-[3fr_2fr]">
          <ParkWaitChart
            attractionId={selected?.id ?? null}
            attractionName={selected?.name ?? null}
            operatorSlug={operatorSlug}
          />
          <ParkBoardTable
            board={board}
            loading={boardQ.isLoading || !activeSlug}
            selectedId={selected?.id ?? null}
            onSelect={(item) => setSelected({ id: item.id, name: item.name })}
            operatorSlug={operatorSlug}
          />
        </div>
      </div>
    </div>
  );
}

function groupByResort(
  parks: Array<ParkListItem>,
): Array<{ resort: string; parks: Array<ParkListItem> }> {
  const map = new Map<string, Array<ParkListItem>>();
  for (const p of parks) {
    const key = p.resortName ?? "Other";
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  return [...map.entries()].map(([resort, parks]) => ({ resort, parks }));
}
