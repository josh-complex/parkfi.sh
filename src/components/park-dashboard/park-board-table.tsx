"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowUpDownIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  GemIcon,
  InfoIcon,
  SlidersHorizontalIcon,
  ZapIcon,
} from "lucide-react";

import {
  RideAlertButton,
  type RideAlertEntry,
} from "#/components/notifications/ride-alert-button.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { useIsMobile } from "#/hooks/use-mobile.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "#/components/ui/drawer.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { MAP_FILTER_PILL, MAP_FILTER_STACK } from "#/components/rides/ride-filter-button.tsx";
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
import { formatTimeInZone } from "#/lib/format-time.ts";
import { useHydrated } from "#/lib/use-hydrated.ts";
import { cn } from "#/lib/utils.ts";

import {
  baseRideName,
  formatPriceCents,
  isSingleRiderName,
  isUniversal,
  normalizeRideName,
  paidLineInfo,
  paidLineProduct,
} from "./lightning-lane.ts";
import { Sparkline } from "./sparkline.tsx";
import type { BoardItem } from "./types.ts";

function formatReturnWindow(
  start: string | null,
  end: string | null,
  timeZone: string | null | undefined,
): string | null {
  if (!start && !end) return null;
  const fmt = (iso: string) => formatTimeInZone(iso, timeZone);
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `from ${fmt(start)}`;
  if (end) return `until ${fmt(end)}`;
  return null;
}

function ReturnWindowCell({
  item,
  operatorSlug,
  timeZone,
}: {
  item: BoardItem;
  operatorSlug: string | null | undefined;
  timeZone: string | null | undefined;
}) {
  const ll = paidLineInfo(item, operatorSlug);
  if (!ll.has) return <span className="text-muted-foreground">—</span>;
  const window = formatReturnWindow(ll.returnStart, ll.returnEnd, timeZone);
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

/** Lower rank sorts first: operating rides on top, then troubled, then closed. */
const STATUS_RANK: Record<string, number> = {
  OPERATING: 0,
  DOWN: 1,
  REFURBISHMENT: 2,
  CLOSED: 3,
  UNKNOWN: 4,
};

function StatusBadge({ status }: { status: string | null }) {
  const label = status ?? "UNKNOWN";
  return <Badge variant={STATUS_BADGE[label] ?? "outline"}>{label.toLowerCase()}</Badge>;
}

function SingleRiderBadge() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="outline"
            className="text-muted-foreground shrink-0 cursor-help px-1.5 py-0 text-[10px] font-medium"
          />
        }
      >
        Singles Allowed
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-pretty">
        Offers a single rider line — fill empty seats to wait less, but your group is split up.
      </TooltipContent>
    </Tooltip>
  );
}

function AttractionCell({ item, singleRider }: { item: BoardItem; singleRider?: boolean }) {
  const meta = item.meta;
  const subtitle = [meta?.tags?.join(" · "), meta?.heightRequirement].filter(Boolean).join(" · ");
  return (
    <div className="flex min-w-0 items-center gap-3">
      {meta?.imageThumbUrl ? (
        <img
          src={meta.imageThumbUrl}
          alt=""
          loading="lazy"
          className="size-11 shrink-0 rounded-lg object-cover"
        />
      ) : null}
      <div className="min-w-0">
        <span className="block truncate font-medium">{item.name}</span>
        {subtitle || singleRider ? (
          <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs font-normal">
            {subtitle ? <span className="truncate">{subtitle}</span> : null}
            {singleRider ? <SingleRiderBadge /> : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function StandbyValue({ item, className }: { item: BoardItem; className?: string }) {
  if (item.standbyWait == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("tabular-nums", className)}>
      {item.standbyWait}
      <span className="text-muted-foreground text-xs font-normal"> min</span>
    </span>
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

type SortKey = "standby-desc" | "standby-asc" | "name" | "status";

const SORT_LABELS: Record<SortKey, string> = {
  "standby-desc": "Longest wait first",
  "standby-asc": "Shortest wait first",
  name: "Name (A–Z)",
  status: "Status",
};

const SORT_STATE: Record<SortKey, SortingState> = {
  "standby-desc": [{ id: "standby", desc: true }],
  "standby-asc": [{ id: "standby", desc: false }],
  name: [{ id: "attraction", desc: false }],
  status: [{ id: "status", desc: false }],
};

function sortingToKey(sorting: SortingState): SortKey {
  const s = sorting[0];
  if (!s) return "standby-desc";
  if (s.id === "standby") return s.desc ? "standby-desc" : "standby-asc";
  if (s.id === "attraction") return "name";
  if (s.id === "status") return "status";
  return "standby-desc";
}

function SortHeader({
  label,
  sorted,
  onClick,
}: {
  label: React.ReactNode;
  sorted: false | "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mx-1 -my-2 inline-flex items-center gap-1 rounded px-1 py-2 font-medium text-foreground transition-colors hover:text-foreground active:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUpIcon className="size-3.5" />
      ) : sorted === "desc" ? (
        <ArrowDownIcon className="size-3.5" />
      ) : (
        <ChevronsUpDownIcon className="size-3.5 opacity-40" />
      )}
    </button>
  );
}

export function ParkBoardTable({
  board,
  loading,
  parkSlug,
  selectedId,
  onSelect,
  operatorSlug,
  timezone,
  className,
}: {
  board: Array<BoardItem> | undefined;
  loading: boolean;
  parkSlug: string | null;
  selectedId: number | null;
  onSelect: (item: BoardItem) => void;
  operatorSlug: string | null | undefined;
  timezone: string | null | undefined;
  className?: string;
}) {
  const [filter, setFilter] = React.useState<StatusFilter>("ALL");
  const [sorting, setSorting] = React.useState<SortingState>(SORT_STATE["standby-desc"]);
  const isMobile = useIsMobile();
  // The sparkline history query is NOT awaited in the route loader, so under
  // SSR streaming the HTML shell flushes with empty sparklines while the fetch
  // is still in flight — but its result is then streamed into the client cache
  // before hydration. The client's first render would draw the loaded `<svg>`
  // where the server emitted the empty `<div>—</div>`, a structural mismatch
  // that throws (`removeChild` on null) and aborts hydration of the whole page.
  // Gate the query on hydration so the server and first client render agree on
  // the empty state, then it fetches and the sparklines fill in after mount.
  const hydrated = useHydrated();

  const trpc = useTRPC();
  const { data: session } = authClient.useSession();
  const loggedIn = !!session?.user;
  const alertsQ = useQuery({ ...trpc.rideAlerts.list.queryOptions(), enabled: loggedIn });
  const alertByAttraction = React.useMemo(() => {
    const m = new Map<number, RideAlertEntry>();
    for (const park of alertsQ.data?.parks ?? []) {
      for (const a of park.alerts) {
        m.set(a.attractionId, {
          id: a.id,
          mode: a.mode,
          thresholdMin: a.thresholdMin,
          changeDelta: a.changeDelta,
        });
      }
    }
    return m;
  }, [alertsQ.data]);

  // 24h standby series for the per-row sparklines (shares the cache with the
  // chart when it's on the default standby/24h view).
  const sparkQ = useQuery({
    ...trpc.parks.parkHistory.queryOptions({
      parkSlug: parkSlug ?? "",
      queueType: 1,
      hours: 24,
    }),
    enabled: !!parkSlug && hydrated,
  });
  const sparkByRide = React.useMemo(() => {
    const points = sparkQ.data?.points ?? [];
    // Park-closed flags are shared across every ride (calendar is park-level);
    // the Sparkline sinks those buckets to the baseline and bridges true mid-day
    // gaps, so the line stays continuous and never breaks.
    const closed = points.map((p) => Boolean(p.closed));
    const m = new Map<number, { values: Array<number | null>; closed: Array<boolean> }>();
    for (const ride of sparkQ.data?.rides ?? []) {
      m.set(ride.id, {
        values: points.map((p) => {
          const v = p[String(ride.id)];
          return typeof v === "number" ? v : null;
        }),
        closed,
      });
    }
    return m;
  }, [sparkQ.data]);

  const allRides = React.useMemo(
    () => (board ?? []).filter((b) => b.entityType === "ATTRACTION"),
    [board],
  );

  // Two kinds of junk rows ship in the feed alongside the real attractions:
  //  1. Standalone "<Ride> Single Rider" rows (Universal broadly; Disney for a
  //     few, e.g. Remy's Ratatouille / Test Track) — collapse them, flagging the
  //     parent ride as accepting single riders.
  //  2. Un-enriched "ghost" duplicates with a null category (a second record for
  //     a ride or character-meet that never got geo/metadata, e.g. a second
  //     "Soarin' Across America" or an ATTRACTION twin of a character-meet SHOW).
  // We drop both; ghosts are detected by category since every real attraction
  // gets one during enrichment. Single-rider rows are read for the badge first
  // (they're also null-category), then dropped.
  const { rides, singleRiderIds } = React.useMemo(() => {
    const idByName = new Map<string, number>();
    for (const r of allRides) idByName.set(normalizeRideName(r.name), r.id);
    const singleRiderIds = new Set<number>();
    const rides = allRides.filter((r) => {
      if (isSingleRiderName(r.name)) {
        // Flag the parent when one is on the board (it may be absent, e.g. closed
        // for refurbishment), then hide the single-rider row itself.
        const baseId = idByName.get(normalizeRideName(baseRideName(r.name)));
        if (baseId != null) singleRiderIds.add(baseId);
        return false;
      }
      return r.category != null;
    });
    return { rides, singleRiderIds };
  }, [allRides]);

  // The board shows only rides with a standby line — a Disney concept. Universal's
  // per-ride line is the free Virtual Line, so every ride qualifies there.
  const lineFilter = React.useMemo(
    () => !isUniversal(operatorSlug) && rides.some((r) => r.supportsQueueTypes.includes(1)),
    [rides, operatorSlug],
  );

  // Status / lines-only filtering happens before the table so the row count and
  // sort apply to the visible set; sorting itself is owned by the table.
  const data = React.useMemo(() => {
    const lineFiltered = lineFilter ? rides.filter((r) => r.supportsQueueTypes.includes(1)) : rides;
    if (filter === "ALL") return lineFiltered;
    if (filter === "CLOSED")
      return lineFiltered.filter((r) => r.status === "CLOSED" || r.status == null);
    return lineFiltered.filter((r) => r.status === filter);
  }, [rides, filter, lineFilter]);

  const columns = React.useMemo<Array<ColumnDef<BoardItem>>>(
    () => [
      {
        id: "attraction",
        accessorFn: (r) => r.name,
        header: "Attraction",
        cell: ({ row }) => (
          <AttractionCell item={row.original} singleRider={singleRiderIds.has(row.original.id)} />
        ),
        sortingFn: (a, b) => a.original.name.localeCompare(b.original.name),
      },
      {
        id: "trend",
        header: "24h trend",
        enableSorting: false,
        cell: ({ row }) => {
          const series = sparkByRide.get(row.original.id);
          const down = row.original.status === "DOWN" || row.original.status === "REFURBISHMENT";
          return (
            <Sparkline
              data={series?.values ?? []}
              closed={series?.closed}
              color={down ? "var(--destructive)" : "var(--primary)"}
            />
          );
        },
      },
      {
        id: "status",
        accessorFn: (r) => r.status ?? "UNKNOWN",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
        sortingFn: (a, b) =>
          (STATUS_RANK[a.original.status ?? "UNKNOWN"] ?? 9) -
          (STATUS_RANK[b.original.status ?? "UNKNOWN"] ?? 9),
      },
      {
        id: "standby",
        accessorFn: (r) => r.standbyWait ?? undefined,
        header: "Standby",
        sortUndefined: "last",
        cell: ({ row }) => <StandbyValue item={row.original} className="text-right text-base" />,
        meta: { align: "right" } as const,
      },
      {
        id: "paidline",
        header: () => <PaidLineHeader operatorSlug={operatorSlug} />,
        enableSorting: false,
        cell: ({ row }) => <PaidLineCell item={row.original} operatorSlug={operatorSlug} />,
      },
      // Universal's per-ride paid return time is a Disney (Lightning Lane)
      // concept — omit the "Next Available LL" column there.
      ...(isUniversal(operatorSlug)
        ? []
        : [
            {
              id: "return",
              header: "Next Available LL",
              enableSorting: false,
              cell: ({ row }) => (
                <ReturnWindowCell
                  item={row.original}
                  operatorSlug={operatorSlug}
                  timeZone={timezone}
                />
              ),
            } as ColumnDef<BoardItem>,
          ]),
      {
        id: "alert",
        header: () => <span className="sr-only">Alert</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <RideAlertButton
              attractionId={row.original.id}
              attractionName={row.original.name}
              alert={alertByAttraction.get(row.original.id)}
              loggedIn={loggedIn}
            />
          </div>
        ),
      },
      {
        id: "chevron",
        header: () => null,
        enableSorting: false,
        cell: ({ row }) =>
          parkSlug ? (
            <Link
              to="/park/$slug/ride/$rideSlug"
              params={{ slug: parkSlug, rideSlug: row.original.slug }}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Open ${row.original.name} details`}
              className="inline-flex"
            >
              <ChevronRightIcon
                className={cn(
                  "size-4 transition-colors hover:text-foreground",
                  row.original.id === selectedId ? "text-foreground" : "text-muted-foreground",
                )}
              />
            </Link>
          ) : (
            <ChevronRightIcon
              className={cn(
                "size-4",
                row.original.id === selectedId ? "text-foreground" : "text-muted-foreground",
              )}
            />
          ),
      },
    ],
    [sparkByRide, operatorSlug, alertByAttraction, loggedIn, selectedId, parkSlug, singleRiderIds],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => String(row.id),
  });

  const sortedRows = table.getRowModel().rows;

  // Changing sort/filter reshuffles the list, so snap back to the section start
  // (heading) rather than leaving the user stranded mid-list looking at a
  // reordered set with no anchor.
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const scrollToBoardStart = React.useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    // rAF so a closing mobile drawer doesn't cancel the smooth scroll.
    requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);
  const handleFilter = React.useCallback(
    (f: StatusFilter) => {
      setFilter(f);
      scrollToBoardStart();
    },
    [scrollToBoardStart],
  );
  const handleSortKey = React.useCallback(
    (k: SortKey) => {
      setSorting(SORT_STATE[k]);
      scrollToBoardStart();
    },
    [scrollToBoardStart],
  );

  return (
    <div
      ref={wrapperRef}
      className={cn("flex flex-col gap-4", className)}
      style={{ scrollMarginTop: "calc(var(--safe-top) + 4rem)" }}
    >
      {/* Section heading — matches the drawer/section headings elsewhere in the
          dash (title + muted subtext), no card chrome. */}
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-lg font-semibold tracking-tight">Live Ride Board</h3>
          <p className="text-muted-foreground text-sm">
            {loading
              ? "Loading…"
              : `${data.length} attractions · select a ride to chart its history`}
          </p>
        </div>
        {/* Desktop controls live beside the heading; mobile gets a FAB (below). */}
        <div className="hidden md:block">
          <Select
            value={filter}
            onValueChange={(v) => v && handleFilter(v as StatusFilter)}
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
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : sortedRows.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center text-sm">
          No attractions match this filter.
        </div>
      ) : isMobile ? (
        <MobileCardList
          rows={sortedRows.map((r) => r.original)}
          selectedId={selectedId}
          parkSlug={parkSlug}
          operatorSlug={operatorSlug}
          timezone={timezone}
          sparkByRide={sparkByRide}
          alertByAttraction={alertByAttraction}
          loggedIn={loggedIn}
          singleRiderIds={singleRiderIds}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((header) => {
                    const align =
                      (header.column.columnDef.meta as { align?: string } | undefined)?.align ??
                      "left";
                    const canSort = header.column.getCanSort();
                    return (
                      <TableHead
                        key={header.id}
                        className={cn(
                          header.column.id === "alert" && "w-10 text-center",
                          header.column.id === "chevron" && "w-8",
                          align === "right" && "text-right",
                        )}
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <SortHeader
                            label={flexRender(header.column.columnDef.header, header.getContext())}
                            sorted={header.column.getIsSorted()}
                            onClick={() => header.column.toggleSorting()}
                          />
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {sortedRows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={() => onSelect(row.original)}
                  data-state={row.original.id === selectedId ? "selected" : undefined}
                  className={cn(
                    "h-16 cursor-pointer",
                    row.original.id === selectedId && "bg-muted/60",
                  )}
                >
                  {row.getVisibleCells().map((cell) => {
                    const align =
                      (cell.column.columnDef.meta as { align?: string } | undefined)?.align ??
                      "left";
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          cell.column.id === "attraction" && "max-w-0 w-full",
                          cell.column.id === "alert" && "text-center",
                          align === "right" && "text-right",
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Mobile-only sort/filter FAB, center-bottom, above the safe area. */}
      {isMobile && !loading && (
        <MobileControls
          sortKey={sortingToKey(sorting)}
          onSortKey={handleSortKey}
          filter={filter}
          onFilter={handleFilter}
        />
      )}
    </div>
  );
}

function MobileCardList({
  rows,
  selectedId,
  parkSlug,
  operatorSlug,
  timezone,
  sparkByRide,
  alertByAttraction,
  loggedIn,
  singleRiderIds,
}: {
  rows: Array<BoardItem>;
  selectedId: number | null;
  parkSlug: string | null;
  operatorSlug: string | null | undefined;
  timezone: string | null | undefined;
  sparkByRide: Map<number, { values: Array<number | null>; closed: Array<boolean> }>;
  alertByAttraction: Map<number, RideAlertEntry>;
  loggedIn: boolean;
  singleRiderIds: Set<number>;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((item) => {
        const meta = item.meta;
        const down = item.status === "DOWN" || item.status === "REFURBISHMENT";
        // "Open with a live wait" gets the wait time; everything else (closed,
        // down, or open-but-no-standby like a virtual-line-only ride) shows the
        // status badge — so a row never falls back to a bare em-dash.
        const openWithWait = item.status === "OPERATING" && item.standbyWait != null;
        const series = sparkByRide.get(item.id);
        const hasTrend = (series?.values ?? []).filter((v) => v != null).length >= 2;
        const subtitle = [meta?.tags?.join(" · "), meta?.heightRequirement]
          .filter(Boolean)
          .join(" · ");
        // Whole card is the link to the ride detail page — interactive children
        // (the alert bell) stop the click so they don't trigger navigation.
        const body = (
          <>
            <div className="flex items-stretch gap-3">
              {/* Media rail — bleeds to the card's top & left edges (the card
                  clips it to its rounded corner) and stretches the full height
                  of the name + trend rows beside it. */}
              {meta?.imageThumbUrl ? (
                <img
                  src={meta.imageThumbUrl}
                  alt=""
                  loading="lazy"
                  className="w-24 shrink-0 self-stretch object-cover"
                />
              ) : null}
              <div
                className={cn(
                  "flex min-w-0 flex-1 flex-col justify-center gap-2 py-3 pr-3",
                  meta?.imageThumbUrl ? null : "pl-3",
                )}
              >
                {/* Name / subtext with the alert bell pinned to the row end. */}
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="line-clamp-2 font-medium leading-snug">{item.name}</span>
                    {subtitle || singleRiderIds.has(item.id) ? (
                      <span className="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1.5 text-xs font-normal">
                        {subtitle ? <span className="line-clamp-1">{subtitle}</span> : null}
                        {singleRiderIds.has(item.id) ? <SingleRiderBadge /> : null}
                      </span>
                    ) : null}
                  </div>
                  <div
                    className="-mr-1 flex shrink-0 items-center"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <RideAlertButton
                      attractionId={item.id}
                      attractionName={item.name}
                      alert={alertByAttraction.get(item.id)}
                      loggedIn={loggedIn}
                    />
                  </div>
                </div>
                {/* Trend + live status: sparkline on the left, current wait or
                    the status badge on the right. */}
                <div className="flex items-center justify-between gap-3">
                  {hasTrend ? (
                    <Sparkline
                      data={series?.values ?? []}
                      closed={series?.closed}
                      width={110}
                      height={26}
                      color={down ? "var(--destructive)" : "var(--primary)"}
                    />
                  ) : (
                    <span className="text-muted-foreground text-xs">No recent trend</span>
                  )}
                  {openWithWait ? (
                    <StandbyValue item={item} className="text-lg font-semibold" />
                  ) : (
                    <StatusBadge status={item.status} />
                  )}
                </div>
              </div>
            </div>
            {/* Lightning Lane / Express — a tinted footer strip, shown only when
                the ride actually has a paid line. Product + tier read as a label
                on the left; the live availability (and return window, when
                posted) sit as chips on the right. */}
            <PaidLineFooter item={item} operatorSlug={operatorSlug} timeZone={timezone} />
          </>
        );

        const className = cn(
          "flex flex-col overflow-hidden rounded-2xl border bg-card text-left transition-colors",
          item.id === selectedId ? "border-primary bg-muted/50" : "hover:bg-muted/40",
        );

        return parkSlug ? (
          <Link
            key={item.id}
            to="/park/$slug/ride/$rideSlug"
            params={{ slug: parkSlug, rideSlug: item.slug }}
            className={cn("cursor-pointer", className)}
          >
            {body}
          </Link>
        ) : (
          <div key={item.id} className={className}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Mobile card footer for the paid-line info — a tinted strip with the product +
 * tier as a label and the live availability / return window as chips. Rides with
 * no paid line get an explicit "none offered" note so the row reads complete.
 */
function PaidLineFooter({
  item,
  operatorSlug,
  timeZone,
}: {
  item: BoardItem;
  operatorSlug: string | null | undefined;
  timeZone: string | null | undefined;
}) {
  const ll = paidLineInfo(item, operatorSlug);
  if (!ll.has) {
    return (
      <div className="border-border/50 bg-muted/30 text-muted-foreground/70 flex items-center gap-1.5 border-t px-3 py-2.5 text-xs">
        <ZapIcon className="text-muted-foreground/40 size-3.5" />
        No {paidLineProduct(operatorSlug)} offered
      </div>
    );
  }
  const price = formatPriceCents(ll.priceCents, item.lightningLane.currency);
  const window = formatReturnWindow(ll.returnStart, ll.returnEnd, timeZone);
  // Single (Individual Lightning Lane) is the à-la-carte premium tier — flag it
  // with a gold gem so it reads apart from the bundled Multi pass.
  const premium = ll.kind === "Single";
  return (
    <div className="border-border/50 bg-muted/30 flex items-center justify-between gap-2 border-t px-3 py-2.5 text-xs">
      <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
        <ZapIcon className="text-primary size-3.5" />
        {paidLineProduct(operatorSlug)}
        {ll.kind ? (
          <>
            <span className="text-muted-foreground/40 mx-0.5">·</span>
            <span className="text-muted-foreground/70">{ll.kind}</span>
            {premium ? (
              <GemIcon className="size-3.5 fill-amber-400 text-amber-500" aria-label="Premium" />
            ) : null}
          </>
        ) : null}
      </span>
      <div className="flex items-center gap-2.5">
        {/* The row's mere presence means the line is offered, so no affirmative
            chip — only surface the exception (sold out). */}
        {ll.soldOut ? <Badge variant="destructive">sold out</Badge> : null}
        {price ? <span className="tabular-nums">{price}</span> : null}
        {window ? <span className="text-muted-foreground tabular-nums">{window}</span> : null}
      </div>
    </div>
  );
}

function MobileControls({
  sortKey,
  onSortKey,
  filter,
  onFilter,
}: {
  sortKey: SortKey;
  onSortKey: (k: SortKey) => void;
  filter: StatusFilter;
  onFilter: (f: StatusFilter) => void;
}) {
  const filterActive = filter !== "ALL";
  return (
    <div
      className={MAP_FILTER_STACK}
      style={{ bottom: "calc(var(--safe-bottom) + var(--bottom-nav-height) + 1.4rem)" }}
    >
      {/* Left-anchored stacked pills matching the map's Filter button exactly. */}
      {/* Sort */}
      <Drawer>
        <DrawerTrigger className={MAP_FILTER_PILL}>
          <ArrowUpDownIcon />
          Sort
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Sort rides</DrawerTitle>
            <DrawerDescription>Choose how the ride board is ordered.</DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-1 px-4 pb-4">
            {(Object.keys(SORT_LABELS) as Array<SortKey>).map((key) => (
              <DrawerClose key={key} asChild>
                <Button
                  variant={sortKey === key ? "secondary" : "ghost"}
                  className="justify-start"
                  onClick={() => onSortKey(key)}
                >
                  {SORT_LABELS[key]}
                </Button>
              </DrawerClose>
            ))}
          </div>
        </DrawerContent>
      </Drawer>

      {/* Filter */}
      <Drawer>
        <DrawerTrigger className={MAP_FILTER_PILL}>
          <SlidersHorizontalIcon />
          Filter
          {filterActive ? <span className="size-1.5 rounded-full bg-primary" /> : null}
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Filter rides</DrawerTitle>
            <DrawerDescription>Narrow the board by status.</DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-4 px-4 pb-4">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs font-medium uppercase">Status</span>
              {(Object.keys(FILTER_LABELS) as Array<StatusFilter>).map((key) => (
                <DrawerClose key={key} asChild>
                  <Button
                    variant={filter === key ? "secondary" : "ghost"}
                    className="justify-start"
                    onClick={() => onFilter(key)}
                  >
                    {FILTER_LABELS[key]}
                  </Button>
                </DrawerClose>
              ))}
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
