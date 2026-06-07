"use client";

import {
  ActivityIcon,
  ClockIcon,
  TicketIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react";

import { Badge } from "#/components/ui/badge.tsx";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";

import { isUniversal, paidLineInfo, paidLineProduct } from "./lightning-lane.ts";
import type { BoardItem } from "./types.ts";

function mean(xs: Array<number>): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function ParkStatCards({
  board,
  loading,
  operatorSlug,
}: {
  board: Array<BoardItem> | undefined;
  loading: boolean;
  operatorSlug: string | null | undefined;
}) {
  if (loading || !board) {
    return (
      <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[140px] rounded-xl" />
        ))}
      </div>
    );
  }

  const rides = board.filter((b) => b.entityType === "ATTRACTION");
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
  const llPrices = llInfos
    .map((ll) => ll.priceCents)
    .filter((p): p is number => typeof p === "number");
  const avgLlDollars = llPrices.length > 0 ? mean(llPrices) / 100 : null;
  const llLabel = paidLineProduct(operatorSlug);

  const operatingPct = rides.length > 0 ? Math.round((operating.length / rides.length) * 100) : 0;

  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Rides Operating</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {operating.length}
            <span className="text-muted-foreground text-lg"> / {rides.length}</span>
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <ActivityIcon />
              {operatingPct}%
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {issues.length === 0 ? "All systems nominal" : `${issues.length} down or in refurb`}
          </div>
          <div className="text-muted-foreground">Live across the park</div>
        </CardFooter>
      </Card>

      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Average Wait</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {waits.length > 0 ? `${avgWait} min` : "—"}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <ClockIcon />
              {waits.length} posted
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {avgWait >= 45 ? (
              <>
                Heavy crowds right now <TrendingUpIcon className="size-4" />
              </>
            ) : (
              <>
                Lines moving steadily <TrendingDownIcon className="size-4" />
              </>
            )}
          </div>
          <div className="text-muted-foreground">Standby, operating rides only</div>
        </CardFooter>
      </Card>

      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Longest Wait</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {longest?.standbyWait != null ? `${longest.standbyWait} min` : "—"}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <TrendingUpIcon />
              Peak
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {longest?.name ?? "No waits posted"}
          </div>
          <div className="text-muted-foreground">Highest standby line in the park</div>
        </CardFooter>
      </Card>

      <Card className="@container/card">
        <CardHeader>
          <CardDescription>{llLabel}</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {llInfos.length > 0 ? (
              <>
                {llSoldOut}
                <span className="text-muted-foreground text-lg"> / {llInfos.length} sold out</span>
              </>
            ) : (
              "—"
            )}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <TicketIcon />
              {isUniversal(operatorSlug)
                ? "park-wide"
                : avgLlDollars != null
                  ? `$${avgLlDollars.toFixed(0)} single`
                  : "n/a"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {llInfos.length === 0
              ? `No ${llLabel} at this park`
              : llSoldOut === llInfos.length
                ? "All return times gone"
                : `${llInfos.length - llSoldOut} still available`}
          </div>
          <div className="text-muted-foreground">
            {isUniversal(operatorSlug)
              ? "Rides offering Express"
              : "Rides offering Multi or Single LL"}
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
