"use client";

import * as React from "react";
import { TrendingDownIcon, TrendingUpIcon } from "lucide-react";

import { Skeleton } from "#/components/ui/skeleton.tsx";
import { cn } from "#/lib/utils.ts";

import { isSingleRiderName, paidLineInfo, paidLineProduct } from "./lightning-lane.ts";
import type { BoardItem } from "./types.ts";

function mean(xs: Array<number>): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function StatItem({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-xs font-medium uppercase tracking-wider text-blue-200/80">{label}</span>
      <span className="text-xl font-semibold tabular-nums leading-tight text-white">{value}</span>
      {sub && <span className="line-clamp-1 text-xs text-blue-200/70">{sub}</span>}
    </div>
  );
}

export function ParkStatCards({
  board,
  loading,
  operatorSlug,
  className,
}: {
  board: Array<BoardItem> | undefined;
  loading: boolean;
  operatorSlug: string | null | undefined;
  className?: string;
}) {
  if (loading || !board) {
    return (
      <div
        className={cn(
          "grid grid-cols-2 gap-6 border-t border-primary bg-primary px-6 py-5 lg:grid-cols-4",
          className,
        )}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-20 bg-blue-300/30" />
            <Skeleton className="h-6 w-16 bg-blue-300/30" />
            <Skeleton className="h-3 w-28 bg-blue-300/30" />
          </div>
        ))}
      </div>
    );
  }

  // Exclude single-rider rows and un-enriched "ghost" duplicates (null category)
  // — both duplicate a real ride and would double-count the tallies. (Mirrors the
  // board table's filtering so the counts match what's listed.)
  const rides = board.filter(
    (b) => b.entityType === "ATTRACTION" && b.category != null && !isSingleRiderName(b.name),
  );
  const operating = rides.filter((b) => b.status === "OPERATING");
  const issues = rides.filter((b) => b.status === "DOWN" || b.status === "REFURBISHMENT");
  const waits = operating
    .map((b) => b.standbyWait)
    .filter((w): w is number => typeof w === "number");
  const avgWait = Math.round(mean(waits));

  const longest = operating.reduce<BoardItem | null>((best, b) => {
    if (typeof b.standbyWait !== "number") return best;
    if (!best || (best.standbyWait ?? -1) < b.standbyWait) return b;
    return best;
  }, null);

  const llInfos = rides.map((r) => paidLineInfo(r, operatorSlug)).filter((ll) => ll.has);
  const llSoldOut = llInfos.filter((ll) => ll.soldOut).length;
  const llLabel = paidLineProduct(operatorSlug);

  const operatingPct = rides.length > 0 ? Math.round((operating.length / rides.length) * 100) : 0;

  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-6 border-t border-primary bg-primary px-6 py-5 lg:grid-cols-4",
        className,
      )}
    >
      <StatItem
        label="Rides Operating"
        value={
          <>
            {operating.length}
            <span className="text-base font-normal text-blue-200/70"> / {rides.length}</span>
          </>
        }
        sub={
          issues.length === 0
            ? `${operatingPct}% operational`
            : `${issues.length} down or in refurb · ${operatingPct}%`
        }
      />

      <StatItem
        label="Average Wait"
        value={waits.length > 0 ? `${avgWait} min` : "—"}
        sub={
          waits.length > 0 ? (
            avgWait >= 45 ? (
              <span className="inline-flex items-center gap-1">
                Heavy crowds <TrendingUpIcon className="size-3" />
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                Moving steadily <TrendingDownIcon className="size-3" />
              </span>
            )
          ) : (
            "No waits posted"
          )
        }
      />

      <StatItem
        label="Longest Wait"
        value={longest?.standbyWait != null ? `${longest.standbyWait} min` : "—"}
        sub={longest?.name ?? "No waits posted"}
      />

      <StatItem
        label={llLabel}
        value={
          llInfos.length > 0 ? (
            <>
              {llSoldOut}
              <span className="text-base font-normal text-blue-200/70">
                {" "}
                / {llInfos.length} sold out
              </span>
            </>
          ) : (
            "—"
          )
        }
        sub={
          llInfos.length === 0
            ? `No ${llLabel} at this park`
            : llSoldOut === llInfos.length
              ? "All return times gone"
              : `${llInfos.length - llSoldOut} still available`
        }
      />
    </div>
  );
}
