"use client";

import * as React from "react";
import { ChevronRightIcon, InfoIcon } from "lucide-react";

import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip.tsx";
import { cn } from "#/lib/utils.ts";

import { formatPriceCents, isUniversal, paidLineInfo, paidLineProduct } from "./lightning-lane.ts";
import type { BoardItem } from "./types.ts";

function formatReturnWindow(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `from ${fmt(start)}`;
  if (end) return `until ${fmt(end)}`;
  return null;
}

function ReturnWindowCell({
  item,
  operatorSlug,
}: {
  item: BoardItem;
  operatorSlug: string | null | undefined;
}) {
  const ll = paidLineInfo(item, operatorSlug);
  if (!ll.has) return <span className="text-muted-foreground">—</span>;
  const window = formatReturnWindow(ll.returnStart, ll.returnEnd);
  if (!window) return <span className="text-muted-foreground">—</span>;
  return <span className="tabular-nums">{window}</span>;
}

function PaidLineHeader({ operatorSlug }: { operatorSlug: string | null | undefined }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {paidLineProduct(operatorSlug)}
      <Tooltip>
        <TooltipTrigger
          className="text-muted-foreground hover:text-foreground inline-flex cursor-help"
          aria-label="About this column"
        >
          <InfoIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-pretty">
          {isUniversal(operatorSlug) ? (
            <span>
              Shown here is Universal’s free <strong>Virtual Line</strong> return time. Paid{" "}
              <strong>Express</strong> is a separate park-wide pass — see the Ticket Pricing page
              for its dates and prices.
            </span>
          ) : (
            <span>
              Disney has two Lightning Lane tiers. <strong>Multi</strong> = included in the Multi
              Pass bundle (one price, most rides). <strong>Single</strong> = Individual Lightning
              Lane, bought per ride and demand-priced — only the top headliners (the $ amount). A
              ride is one tier or the other.
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    </span>
  );
}

type StatusFilter = "ALL" | "OPERATING" | "DOWN" | "CLOSED";

const FILTER_LABELS: Record<StatusFilter, string> = {
  ALL: "All statuses",
  OPERATING: "Operating",
  DOWN: "Down",
  CLOSED: "Closed",
};

const STATUS_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  OPERATING: "secondary",
  DOWN: "destructive",
  REFURBISHMENT: "destructive",
  CLOSED: "outline",
  UNKNOWN: "outline",
};

function StatusBadge({ status }: { status: string | null }) {
  const label = status ?? "UNKNOWN";
  return <Badge variant={STATUS_BADGE[label] ?? "outline"}>{label.toLowerCase()}</Badge>;
}

/**
 * Attraction name cell: a leading thumbnail + a secondary tags/height line when
 * Disney enrichment (`meta`) is present; rows without meta (Universal, or
 * un-enriched) keep the plain text-only look.
 */
function AttractionCell({ item }: { item: BoardItem }) {
  const meta = item.meta;
  const subtitle = [meta?.tags?.join(" · "), meta?.heightRequirement].filter(Boolean).join(" · ");
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {meta?.imageThumbUrl ? (
        <img
          src={meta.imageThumbUrl}
          alt=""
          loading="lazy"
          className="size-9 shrink-0 rounded object-cover"
        />
      ) : null}
      <div className="min-w-0">
        <span className="block truncate">{item.name}</span>
        {subtitle ? (
          <span className="text-muted-foreground block truncate text-xs font-normal">
            {subtitle}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PaidLineCell({
  item,
  operatorSlug,
}: {
  item: BoardItem;
  operatorSlug: string | null | undefined;
}) {
  const ll = paidLineInfo(item, operatorSlug);
  if (!ll.has) return <span className="text-muted-foreground">—</span>;
  const price = formatPriceCents(ll.priceCents, item.lightningLane.currency);
  return (
    <div className="flex items-center gap-2">
      {ll.state ? (
        <Badge variant={ll.soldOut ? "destructive" : "secondary"}>
          {ll.state.toLowerCase().replace("_", " ")}
        </Badge>
      ) : (
        <Badge variant="outline">offered</Badge>
      )}
      {price ? <span className="tabular-nums">{price}</span> : null}
      {ll.kind ? (
        <span
          className="text-muted-foreground text-xs uppercase"
          title={
            ll.kind === "Single"
              ? "Individual Lightning Lane — bought per ride, demand-priced"
              : "Included in the Lightning Lane Multi Pass bundle"
          }
        >
          {ll.kind}
        </span>
      ) : null}
    </div>
  );
}

export function ParkBoardTable({
  board,
  loading,
  selectedId,
  onSelect,
  operatorSlug,
  className,
}: {
  board: Array<BoardItem> | undefined;
  loading: boolean;
  selectedId: number | null;
  onSelect: (item: BoardItem) => void;
  operatorSlug: string | null | undefined;
  className?: string;
}) {
  const [filter, setFilter] = React.useState<StatusFilter>("ALL");
  const [linesOnly, setLinesOnly] = React.useState(true);

  const rides = React.useMemo(
    () => (board ?? []).filter((b) => b.entityType === "ATTRACTION"),
    [board],
  );

  const hasLineRides = React.useMemo(
    () => rides.some((r) => r.supportsQueueTypes.includes(1)),
    [rides],
  );

  const rows = React.useMemo(() => {
    const sorted = [...rides].sort((a, b) => {
      const scoreA = a.standbyWait ?? a.histStandbyWait ?? -1;
      const scoreB = b.standbyWait ?? b.histStandbyWait ?? -1;
      return scoreB - scoreA;
    });
    const lineFiltered =
      linesOnly && hasLineRides ? sorted.filter((r) => r.supportsQueueTypes.includes(1)) : sorted;
    if (filter === "ALL") return lineFiltered;
    if (filter === "CLOSED")
      return lineFiltered.filter((r) => r.status === "CLOSED" || r.status == null);
    return lineFiltered.filter((r) => r.status === filter);
  }, [rides, filter, linesOnly, hasLineRides]);

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <CardTitle>Live Ride Board</CardTitle>
        <CardDescription>
          {loading ? "Loading…" : `${rows.length} attractions · select a ride to chart its history`}
        </CardDescription>
        <CardAction>
          <div className="flex items-center gap-2">
            {hasLineRides && (
              <Button
                variant={linesOnly ? "default" : "outline"}
                size="sm"
                onClick={() => setLinesOnly((v) => !v)}
              >
                Lines only
              </Button>
            )}
            <Select
              value={filter}
              onValueChange={(v) => v && setFilter(v as StatusFilter)}
              items={FILTER_LABELS}
            >
              <SelectTrigger size="sm" className="w-36" aria-label="Filter by status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FILTER_LABELS) as Array<StatusFilter>).map((key) => (
                  <SelectItem key={key} value={key}>
                    {FILTER_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardAction>
      </CardHeader>
      <div className="min-h-0 flex-1 overflow-x-auto px-2 pb-2 sm:px-6 sm:pb-4">
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-muted-foreground py-12 text-center text-sm">
            No attractions match this filter.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Attraction</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Standby</TableHead>
                <TableHead>
                  <PaidLineHeader operatorSlug={operatorSlug} />
                </TableHead>
                <TableHead>Next return</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => (
                <TableRow
                  key={item.id}
                  onClick={() => onSelect(item)}
                  data-state={item.id === selectedId ? "selected" : undefined}
                  className={cn("cursor-pointer", item.id === selectedId && "bg-muted/60")}
                >
                  <TableCell className="max-w-0 w-full font-medium">
                    <AttractionCell item={item} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={item.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.standbyWait != null ? (
                      `${item.standbyWait} min`
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <PaidLineCell item={item} operatorSlug={operatorSlug} />
                  </TableCell>
                  <TableCell>
                    <ReturnWindowCell item={item} operatorSlug={operatorSlug} />
                  </TableCell>
                  <TableCell>
                    <ChevronRightIcon
                      className={cn(
                        "size-4",
                        item.id === selectedId ? "text-foreground" : "text-muted-foreground",
                      )}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </Card>
  );
}
