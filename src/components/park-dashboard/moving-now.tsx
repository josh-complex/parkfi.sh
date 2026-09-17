"use client";

import { Link } from "@tanstack/react-router";
import { BellIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "#/components/ui/button.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { cn } from "#/lib/utils.ts";

import { shortRideName } from "./park-stats.ts";

/** How many movers the strip names; past four it stops being readable at a glance. */
const CHIPS = 4;

/**
 * "Moving now" — the rides at this park whose wait has changed most against its
 * reading half an hour ago, up and down together.
 *
 * Reads the cross-park `parks.movers` query and filters to this park rather
 * than asking for a park-scoped one: the waits page already holds that payload,
 * so on a page opened from there this strip costs nothing. The flip side is a
 * real bound — `movers` keeps the forty biggest swings across every park we
 * track, so a quiet park can have moved without appearing here. That's the
 * right failure: a strip headed "moving now" should only ever show genuine
 * movement.
 */
export function MovingNow({
  parkSlug,
  className,
}: {
  parkSlug: string | null;
  className?: string;
}) {
  const trpc = useTRPC();
  const q = useQuery(trpc.parks.movers.queryOptions());

  const rows = (q.data?.movers ?? []).filter((m) => m.parkSlug === parkSlug).slice(0, CHIPS);
  if (!parkSlug) return null;
  // Hold the strip's height while the query is out. It's only ~65px, but it
  // sits directly above the board, so it moves every one of the 35 rows under
  // it when it lands. (`!q.data`, not `isLoading` — see `ParkAnalytics`.)
  if (!q.data) {
    return <Skeleton className={cn("h-[65px] w-full rounded-[22px]", className)} />;
  }
  if (rows.length === 0) return null;

  return (
    <div
      className={cn(
        "surface-wash flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3",
        className,
      )}
    >
      <div className="shrink-0">
        <span className="block text-[10px] font-bold tracking-[0.06em] text-wash-muted uppercase">
          Moving now
        </span>
        <span className="text-[12.5px] font-bold text-wash-fg">Last 30 min</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap gap-2">
        {rows.map((m) => (
          <Link
            key={m.rideId}
            to="/park/$slug/ride/$rideSlug"
            params={{ slug: parkSlug, rideSlug: m.rideSlug }}
            className="flex items-center gap-2 rounded-xl border border-wash-edge bg-card px-2.5 py-1.5 hover:bg-muted"
            title={`${m.rideName} · ${m.prevWait} → ${m.waitMin} min`}
          >
            <span
              className={cn(
                "text-[12.5px] font-extrabold tabular-nums",
                m.delta > 0 ? "text-wait-hot" : "text-wait-cool",
              )}
            >
              {m.delta > 0 ? "▲" : "▼"} {Math.abs(m.delta)}
            </span>
            <span className="text-[12.5px] font-semibold">{shortRideName(m.rideName)}</span>
          </Link>
        ))}
      </div>
      <Button
        variant="outline"
        className="h-8 shrink-0 text-[12.5px] font-bold"
        render={<Link to="/alerts" />}
      >
        <BellIcon />
        Alert me
      </Button>
    </div>
  );
}
