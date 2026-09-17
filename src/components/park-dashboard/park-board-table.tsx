"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type Table as ReactTable,
} from "@tanstack/react-table";
import { ArrowUpDownIcon, GemIcon, GhostIcon, SlidersHorizontalIcon, ZapIcon } from "lucide-react";

import {
  RideAlertButton,
  type RideAlertEntry,
} from "#/components/notifications/ride-alert-button.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Image } from "#/components/ui/image.tsx";
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
import { SortRows, type SortDir, type SortOption } from "#/components/ui/sort-menu.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip.tsx";
import { formatTimeInZone } from "#/lib/format-time.ts";
import { useHydrated } from "#/lib/use-hydrated.ts";
import { cn } from "#/lib/utils.ts";

import {
  baseRideName,
  formatPriceCents,
  isHauntedHouse,
  isSingleRiderName,
  isUniversal,
  normalizeRideName,
  paidLineInfo,
  paidLineLive,
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

function StandbyValue({ item, className }: { item: BoardItem; className?: string }) {
  if (item.standbyWait == null) return <span className="text-muted-foreground">—</span>;
  return (
    // `whitespace-nowrap` or the " min" breaks onto its own line whenever the
    // row's right-hand cluster gets tight — which, next to a paid-line chip, is
    // most of the time.
    <span className={cn("tabular-nums whitespace-nowrap", className)}>
      {item.standbyWait}
      <span className="text-muted-foreground text-xs font-normal"> min</span>
    </span>
  );
}

/**
 * Universal's "accepts Express Pass" marker, from the operator's own per-ride
 * flag (`attraction_meta.express_pass`). Express is a park-wide add-on with no
 * per-ride live number — the wait board's EXPRESS queue is a static placard the
 * operator's app never shows — so this is a capability, not a wait.
 */
function ExpressAcceptedBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1", className)}
      title="Accepts Universal Express Pass"
    >
      <ZapIcon className="text-primary size-3" aria-hidden />
      Express
    </Badge>
  );
}

// The board's sort state lives as TanStack's `SortingState` (one column id +
// direction); these map it to/from the shared drawer's (key, dir) model so the
// mobile drawer and the desktop column-header toggles stay in lock-step.
type BoardSortKey = "standby" | "attraction" | "status";

const BOARD_SORTS: ReadonlyArray<SortOption<BoardSortKey>> = [
  {
    key: "standby",
    label: "Wait",
    directional: true,
    defaultDir: "desc",
    ascHint: "shortest first",
    descHint: "longest first",
  },
  {
    key: "attraction",
    label: "Name",
    directional: true,
    defaultDir: "asc",
    ascHint: "A–Z",
    descHint: "Z–A",
  },
  { key: "status", label: "Status", directional: true, defaultDir: "asc" },
];

const DEFAULT_SORTING: SortingState = [{ id: "standby", desc: true }];

/**
 * The desktop sort menu. The phone's drawer (`BOARD_SORTS`) offers the same
 * three keys as a key + direction pair; a `<Select>` has one axis, so the
 * directions are spelled out as their own options and encoded `key:dir`.
 */
const SORT_LABELS = {
  "standby:desc": "Longest wait",
  "standby:asc": "Shortest wait",
  "attraction:asc": "Name A–Z",
  "attraction:desc": "Name Z–A",
  "status:asc": "Status",
} as const;

function sortValue(sorting: SortingState): keyof typeof SORT_LABELS {
  const { key, dir } = sortingToOption(sorting);
  const value = `${key}:${dir}`;
  return value in SORT_LABELS ? (value as keyof typeof SORT_LABELS) : "standby:desc";
}

function sortingToOption(sorting: SortingState): { key: BoardSortKey; dir: SortDir } {
  const s = sorting[0];
  if (!s) return { key: "standby", dir: "desc" };
  const key: BoardSortKey = s.id === "attraction" || s.id === "status" ? s.id : "standby";
  return { key, dir: s.desc ? "desc" : "asc" };
}

/**
 * The width, in CSS pixels, below which a row drops to its compact furniture:
 * a 112px photo, a short sparkline, and the paid line moved to its own strip
 * under the row instead of a chip inside it.
 *
 * The *board's own box* decides, not the viewport (2026-09-17, Josh). This
 * used to be `useIsMobile()` — a `< 768px` viewport check — which meant the
 * row grew its furniture at exactly the width where the park page's grid
 * halved the column it sits in, and the photo, sparkline, price chip and wait
 * (all of them `shrink-0`) ran off the right of the page from `md` to about
 * 1000px. A row needs ~558px inside the card for the full set: 160 photo + 14
 * gap + a 168 sparkline + a nowrap price chip + the wait. 576 is that with
 * headroom, and it matches the `@xl/board` variants the markup uses for the
 * same switch, so the CSS and the measured half never disagree.
 */
const DENSE_BELOW = 576;

/**
 * Whether the board is drawing its compact rows, measured off the element the
 * rows live in.
 *
 * Starts `false` — the server has no box to measure, and a `true` default
 * would ship SSR HTML asking the preload scanner for 112px covers that the
 * first client paint then replaces with 160px ones.
 */
function useDenseBoard(ref: React.RefObject<HTMLElement | null>) {
  const [dense, setDense] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setDense(el.getBoundingClientRect().width < DENSE_BELOW);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return dense;
}

export function ParkBoardTable({
  board,
  loading,
  parkSlug,
  selectedId,
  onSelect,
  operatorSlug,
  timezone,
  controls = "floating",
  className,
}: {
  board: Array<BoardItem> | undefined;
  loading: boolean;
  parkSlug: string | null;
  selectedId: number | null;
  onSelect: (item: BoardItem) => void;
  operatorSlug: string | null | undefined;
  timezone: string | null | undefined;
  /**
   * Where the phone's sort/filter controls live. `floating` is the dash's
   * bottom-left FAB stack, matching the map's own filter pill. `inline` puts
   * them in the board's heading row instead — which is what a page that already
   * floats something of its own over the nav island has to use, or the two
   * stacks collide (the park page's action bar, plan §3.1).
   */
  controls?: "floating" | "inline";
  className?: string;
}) {
  const [filter, setFilter] = React.useState<StatusFilter>("ALL");
  const [sorting, setSorting] = React.useState<SortingState>(DEFAULT_SORTING);
  // Doubles as the scroll anchor for sort/filter (see `scrollToBoardStart`).
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const dense = useDenseBoard(wrapperRef);
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

  // Haunted houses run on their own hard-ticket event nights, so they sit in a
  // section of their own below the rides: all day they'd otherwise be ten dead
  // CLOSED rows in the middle of an operating board, and on an event night
  // they're the only thing posting a wait. `allHouses` (pre status-filter)
  // decides whether the section exists and what its summary says; `houseRows`
  // is what the filter left to draw.
  const allHouses = React.useMemo(() => rides.filter(isHauntedHouse), [rides]);
  const houseRows = React.useMemo(() => data.filter(isHauntedHouse), [data]);
  const boardRows = React.useMemo(
    () => (allHouses.length > 0 ? data.filter((r) => !isHauntedHouse(r)) : data),
    [data, allHouses],
  );
  const houseSummary = React.useMemo(() => {
    const noun = allHouses.length === 1 ? "house" : "houses";
    const open = allHouses.filter((h) => h.status === "OPERATING" && h.standbyWait != null);
    if (open.length === 0) return `${allHouses.length} ${noun} · no waits posted right now`;
    const longest = Math.max(...open.map((h) => h.standbyWait ?? 0));
    return `${open.length} of ${allHouses.length} ${noun} open · longest ${longest} min`;
  }, [allHouses]);

  // Sort definitions only — no `header`, no `cell`.
  //
  // The board used to be an eight-column table (attraction, trend, status,
  // standby, the paid line, its return window, an alert bell and a chevron),
  // which meant eight header cells and six cell components to say four things.
  // It is one row per ride now (see `RideRow`), so TanStack is left doing the
  // only job that was ever hard: keeping the rides and the houses in one sort
  // order. These three ids are what the sort control offers (`BOARD_SORTS`).
  const columns = React.useMemo<Array<ColumnDef<BoardItem>>>(
    () => [
      {
        id: "attraction",
        accessorFn: (r) => r.name,
        sortingFn: (a, b) => a.original.name.localeCompare(b.original.name),
      },
      {
        id: "status",
        accessorFn: (r) => r.status ?? "UNKNOWN",
        sortingFn: (a, b) =>
          (STATUS_RANK[a.original.status ?? "UNKNOWN"] ?? 9) -
          (STATUS_RANK[b.original.status ?? "UNKNOWN"] ?? 9),
      },
      {
        id: "standby",
        accessorFn: (r) => r.standbyWait ?? undefined,
        sortUndefined: "last",
      },
    ],
    [],
  );

  // One sort state, two tables: the rides board and the houses section reorder
  // together, so the sort control still reads as one control over one board.
  const table = useBoardTable(boardRows, columns, sorting, setSorting);
  const houseTable = useBoardTable(houseRows, columns, sorting, setSorting);

  // Changing sort/filter reshuffles the list, so snap back to the section start
  // (heading) rather than leaving the user stranded mid-list looking at a
  // reordered set with no anchor.
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
  const handleSort = React.useCallback(
    (key: BoardSortKey, dir: SortDir) => {
      setSorting([{ id: key, desc: dir === "desc" }]);
      scrollToBoardStart();
    },
    [scrollToBoardStart],
  );

  return (
    <>
      {/* `@container/board` is what the rows size themselves against — and it
          is also a containing block for any `position: fixed` descendant, so
          the floating control stack is a *sibling* of it rather than a child
          (it would otherwise pin itself to the board instead of the viewport).
          `wrapperRef` measures this same element, so the CSS half of the
          switch and the measured half never see different widths. */}
      <div
        ref={wrapperRef}
        className={cn("@container/board flex flex-col gap-4", className)}
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
                : `${boardRows.length} attractions · select a ride to chart its history`}
            </p>
          </div>
          {/* Phone controls, when the page can't spare the floating stack. */}
          {controls === "inline" && !loading && (
            <BoardControls
              sort={sortingToOption(sorting)}
              onSort={handleSort}
              filter={filter}
              onFilter={handleFilter}
              className="flex gap-2 @xl/board:hidden"
            />
          )}
          {/* Desktop controls live beside the heading; mobile gets a FAB (below).
            Sort is a control of its own now — the rows replaced a table, so
            there are no column headers left to click. */}
          <div className="hidden items-center gap-2 @xl/board:flex">
            <Select
              value={sortValue(sorting)}
              onValueChange={(v) => {
                if (!v) return;
                const [key, dir] = v.split(":") as [BoardSortKey, SortDir];
                handleSort(key, dir);
              }}
              items={SORT_LABELS}
            >
              <SelectTrigger size="sm" className="w-44" aria-label="Sort rides">
                <SelectValue placeholder="Longest wait" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABELS) as Array<keyof typeof SORT_LABELS>).map((key) => (
                  <SelectItem key={key} value={key}>
                    {SORT_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
        ) : boardRows.length === 0 && houseRows.length === 0 ? (
          <div className="text-muted-foreground py-12 text-center text-sm">
            No attractions match this filter.
          </div>
        ) : (
          <>
            {boardRows.length === 0 ? (
              <div className="text-muted-foreground py-8 text-center text-sm">
                No rides match this filter.
              </div>
            ) : (
              <BoardRows
                table={table}
                dense={dense}
                selectedId={selectedId}
                onSelect={onSelect}
                parkSlug={parkSlug}
                operatorSlug={operatorSlug}
                timezone={timezone}
                sparkByRide={sparkByRide}
                alertByAttraction={alertByAttraction}
                loggedIn={loggedIn}
                singleRiderIds={singleRiderIds}
              />
            )}

            {/* Hard-ticket event attractions get their own heading — same shape as
              the board's, so the two read as sections of one page. */}
            {allHouses.length > 0 ? (
              <div className="mt-2 flex flex-col gap-4 border-t pt-6">
                <div className="flex flex-col gap-0.5">
                  <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                    <GhostIcon className="text-muted-foreground size-4.5" aria-hidden />
                    Halloween Horror Nights
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    {houseSummary} · event nights only, separate ticket
                  </p>
                </div>
                {houseRows.length === 0 ? (
                  <div className="text-muted-foreground py-8 text-center text-sm">
                    No houses match this filter.
                  </div>
                ) : (
                  <BoardRows
                    table={houseTable}
                    dense={dense}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    parkSlug={parkSlug}
                    operatorSlug={operatorSlug}
                    timezone={timezone}
                    sparkByRide={sparkByRide}
                    alertByAttraction={alertByAttraction}
                    loggedIn={loggedIn}
                    singleRiderIds={singleRiderIds}
                  />
                )}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Mobile-only sort/filter FAB, center-bottom, above the safe area. */}
      {dense && !loading && controls === "floating" && (
        <BoardControls
          sort={sortingToOption(sorting)}
          onSort={handleSort}
          filter={filter}
          onFilter={handleFilter}
          className={MAP_FILTER_STACK}
          style={{ bottom: "calc(var(--safe-bottom) + var(--bottom-nav-height) + 1.4rem)" }}
        />
      )}
    </>
  );
}

/** The board's table instance — one per section, sharing the parent's sort state. */
function useBoardTable(
  data: Array<BoardItem>,
  columns: Array<ColumnDef<BoardItem>>,
  sorting: SortingState,
  onSortingChange: React.Dispatch<React.SetStateAction<SortingState>>,
): ReactTable<BoardItem> {
  return useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => String(row.id),
  });
}

/**
 * One section's rows.
 *
 * There is one layout now, not a desktop table and a mobile card list. The
 * table's eight columns were mostly restating each other — a status column
 * beside a standby column beside two Lightning Lane columns — so each ride is
 * one row built around the two things a guest actually reads it for: the
 * photograph that tells them what it is, and the trend line that tells them
 * whether the wait is going their way.
 *
 * Deliberately two lines and not one. A single-line row was the first attempt
 * and it does not fit: the board sits in the page's right column, which is
 * about 670px of usable width at 1440 — and a trend, a wait, a paid-line chip
 * and a bell laid out beside the name leave the name around 130px, which
 * truncates "TRON Lightcycle / Run" to "TRON…". Stacking the numbers under the
 * name costs about 20px of row height and gives the name the whole width back.
 * Desktop pulls the paid line up onto the trend line as one chip; the phone
 * keeps it as a footer strip, where there is no width for it inline.
 *
 * Sorting moved with it: there are no column headers to click, so the sort
 * control sits beside the status filter in the board's heading at every width
 * (see `ParkBoardTable`).
 */
function BoardRows({
  table,
  dense,
  selectedId,
  onSelect,
  parkSlug,
  operatorSlug,
  timezone,
  sparkByRide,
  alertByAttraction,
  loggedIn,
  singleRiderIds,
}: {
  table: ReactTable<BoardItem>;
  dense: boolean;
  selectedId: number | null;
  onSelect: (item: BoardItem) => void;
  parkSlug: string | null;
  operatorSlug: string | null | undefined;
  timezone: string | null | undefined;
  sparkByRide: Map<number, { values: Array<number | null>; closed: Array<boolean> }>;
  alertByAttraction: Map<number, RideAlertEntry>;
  loggedIn: boolean;
  singleRiderIds: Set<number>;
}) {
  return (
    <div className="flex flex-col gap-2.5 md:gap-2">
      {table.getRowModel().rows.map((row, index) => (
        <RideRow
          key={row.id}
          item={row.original}
          index={index}
          dense={dense}
          selected={row.original.id === selectedId}
          onSelect={onSelect}
          parkSlug={parkSlug}
          operatorSlug={operatorSlug}
          timezone={timezone}
          series={sparkByRide.get(row.original.id)}
          alert={alertByAttraction.get(row.original.id)}
          loggedIn={loggedIn}
          singleRider={singleRiderIds.has(row.original.id)}
        />
      ))}
    </div>
  );
}

function RideRow({
  item,
  index,
  dense,
  selected,
  onSelect,
  parkSlug,
  operatorSlug,
  timezone,
  series,
  alert,
  loggedIn,
  singleRider,
}: {
  item: BoardItem;
  index: number;
  dense: boolean;
  selected: boolean;
  onSelect: (item: BoardItem) => void;
  parkSlug: string | null;
  operatorSlug: string | null | undefined;
  timezone: string | null | undefined;
  series: { values: Array<number | null>; closed: Array<boolean> } | undefined;
  alert: RideAlertEntry | undefined;
  loggedIn: boolean;
  singleRider: boolean;
}) {
  const meta = item.meta;
  const down = item.status === "DOWN" || item.status === "REFURBISHMENT";
  // "Open with a live wait" gets the wait time; everything else (closed, down,
  // or open-but-no-standby like a virtual-line-only ride) shows the status
  // badge — so a row never falls back to a bare em-dash.
  const openWithWait = item.status === "OPERATING" && item.standbyWait != null;
  const hasTrend = (series?.values ?? []).filter((v) => v != null).length >= 2;
  const subtitle = [meta?.tags?.join(" · "), meta?.heightRequirement].filter(Boolean).join(" · ");

  const body = (
    <>
      {/* Vertical padding only. The row's box is the hover/selected wash and
          nothing else — there is no frame for the content to sit inside — so
          insetting it horizontally just narrowed every ride name and shrank
          the photo for no edge to clear. */}
      <div className="flex items-stretch gap-3.5 py-2">
        {/* The photo is its own object now, not a rail bled into the row's
            corner: the row lost its card (no border, no fill), so an image
            clipped to two of its corners had nothing left to be clipped *by*
            and read as a torn edge. It is rounded on all four and wider than
            the old 96px rail — the picture is half of what the row is for. */}
        {meta?.imageThumbUrl ? (
          <Image
            src={meta.imageThumbUrl}
            alt=""
            // The first screenful loads eagerly so the preload scanner grabs
            // these from the SSR HTML — lazy images wait for layout/JS.
            loading={index < 6 ? "eager" : "lazy"}
            boxWidth={dense ? 112 : 160}
            placeholder={meta.imageThumbhash}
            // Height comes from the row (`self-stretch`), so the floor is what
            // keeps a ride with no tag line from getting a letterbox: without
            // it the shortest rows crop the photo to a strip.
            className="min-h-22 w-28 shrink-0 self-stretch rounded-[14px] object-cover @xl/board:min-h-26 @xl/board:w-40"
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2.5 py-2">
          {/* Name / subtext, with the alert bell pinned to the row's end. */}
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <span className="line-clamp-2 leading-snug font-medium @xl/board:line-clamp-1">
                {item.name}
              </span>
              {subtitle || singleRider ? (
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs font-normal text-muted-foreground">
                  {subtitle ? <span className="line-clamp-1">{subtitle}</span> : null}
                  {singleRider ? <SingleRiderBadge /> : null}
                </span>
              ) : null}
            </div>
            <div
              // No negative pull any more — it existed to eat the row's old
              // right padding, and without that it would hang the bell over
              // the edge.
              className="flex shrink-0 items-center"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <RideAlertButton
                attractionId={item.id}
                attractionName={item.name}
                alert={alert}
                loggedIn={loggedIn}
              />
            </div>
          </div>
          {/* Trend and live state: the sparkline on the left, the wait (or the
              status, when there is no wait) on the right, and — where there's
              width for it — the paid line as one chip between them. */}
          <div className="flex items-center justify-between gap-3">
            {hasTrend ? (
              <Sparkline
                data={series?.values ?? []}
                closed={series?.closed}
                // Wider on a desktop, where the row has the width to spend: the
                // trend is the whole reason this replaced a "24h trend" column
                // squeezed between two others.
                width={dense ? 110 : 168}
                height={dense ? 32 : 40}
                color={down ? "var(--destructive)" : "var(--primary)"}
              />
            ) : (
              <span className="text-xs text-muted-foreground">No recent trend</span>
            )}
            <div className="flex shrink-0 items-center gap-3">
              <span className="hidden @xl/board:block">
                <PaidLineChip item={item} operatorSlug={operatorSlug} timeZone={timezone} />
              </span>
              {openWithWait ? (
                <StandbyValue item={item} className="text-lg font-semibold" />
              ) : (
                <StatusBadge status={item.status} />
              )}
            </div>
          </div>
        </div>
      </div>
      {/* Phone: the paid line as a tinted strip under the row, because the
          trend line has no width left to carry it. */}
      <PaidLineFooter
        item={item}
        operatorSlug={operatorSlug}
        timeZone={timezone}
        className="mb-2 @xl/board:hidden"
      />
    </>
  );

  // No border and no fill. Thirty-five bordered cards inside a bordered card is
  // three nested frames deep before any content, and the photos already give
  // every row a hard edge of its own. What's left is a hover/selected wash,
  // which is the only thing the frame was really doing.
  const className = cn(
    "flex flex-col rounded-[18px] text-left transition-colors",
    selected ? "bg-muted" : "hover:bg-muted/50",
  );

  return parkSlug ? (
    <Link
      to="/park/$slug/ride/$rideSlug"
      params={{ slug: parkSlug, rideSlug: item.slug }}
      onClick={() => onSelect(item)}
      className={cn("cursor-pointer", className)}
    >
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * The paid line on a desktop row: one chip, where the table gave it two whole
 * columns plus a header tooltip explaining them.
 *
 * That the chip is there at all means the line is offered, so there is no
 * "offered" badge; what's worth a glance is that the return times have run out,
 * its price, or when it next returns.
 *
 * A premium tier (Individual Lightning Lane, bought per ride) gets both, in
 * that order — "$19.00 · 8:20 PM". The two are one decision there: the price is
 * what you'd pay and the time is what you'd get for it, and a price on its own
 * can't be judged. The bundled Multi tier has no per-ride price to weigh, so it
 * shows the time alone.
 *
 * "No return times" and not "sold out", matching the Skip the line panel: the
 * product is still on sale, it is the windows that have gone — and beside a
 * price, "sold out" reads as a contradiction. The window's *start* only
 * — "7:20 PM", not "7:20 PM – 8:20 PM" — because the chip shares a line with
 * the trend and the wait, and the end of the window is never the thing that
 * decides anything. Rides with no paid line get no chip rather than an em-dash;
 * a column of dashes was most of what the old columns drew.
 */
function PaidLineChip({
  item,
  operatorSlug,
  timeZone,
}: {
  item: BoardItem;
  operatorSlug: string | null | undefined;
  timeZone: string | null | undefined;
}) {
  const ll = paidLineInfo(item, operatorSlug);
  const express = ll.expressPass === true;
  const price = formatPriceCents(ll.priceCents, item.lightningLane.currency);
  const window = formatReturnWindow(ll.returnStart, ll.returnEnd, timeZone);
  const next = ll.returnStart ? formatTimeInZone(ll.returnStart, timeZone) : null;
  // Nothing posted means no chip — not a bolt and the word "available" (see
  // `paidLineLive`). At Universal that's most rides most of the time, and the
  // one thing worth saying about them is whether Express gets you in, so the
  // Express badge takes the slot instead.
  const detail = !paidLineLive(ll)
    ? null
    : ll.soldOut
      ? "no return times"
      : price && next
        ? `${price} · ${next}`
        : (price ?? next ?? ll.kind);
  if (!detail) return express ? <ExpressAcceptedBadge /> : null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-flex cursor-help items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
              ll.soldOut
                ? "border-destructive/30 text-destructive"
                : "border-border text-muted-foreground",
            )}
          />
        }
      >
        <ZapIcon
          className={cn("size-3.5", ll.soldOut ? "text-destructive" : "text-primary")}
          aria-hidden
        />
        {ll.soldOut ? detail : <span className="tabular-nums">{detail}</span>}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-pretty">
        {paidLineProduct(operatorSlug)}
        {ll.kind ? ` · ${ll.kind}` : ""}
        {ll.kind === "Single"
          ? " — an Individual Lightning Lane, bought per ride and demand-priced."
          : ll.kind === "Multi"
            ? " — included in the Lightning Lane Multi Pass bundle."
            : ""}
        {window ? ` Next return ${window}.` : ""}
        {express ? " Also accepts Universal Express Pass." : ""}
      </TooltipContent>
    </Tooltip>
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
  className,
}: {
  item: BoardItem;
  operatorSlug: string | null | undefined;
  timeZone: string | null | undefined;
  className?: string;
}) {
  const ll = paidLineInfo(item, operatorSlug);
  const express = ll.expressPass === true;
  if (!paidLineLive(ll)) {
    // Nothing posted. A ride that accepts Express Pass still earns the strip —
    // it's the line an Express holder walks into.
    if (express) {
      return (
        <div
          className={cn(
            "bg-muted/50 flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs",
            className,
          )}
        >
          <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
            <ZapIcon className="text-primary size-3.5" />
            Express
          </span>
          <span className="text-muted-foreground">accepted</span>
        </div>
      );
    }
    return (
      <div
        className={cn(
          "bg-muted/40 text-muted-foreground/70 flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs",
          className,
        )}
      >
        <ZapIcon className="text-muted-foreground/40 size-3.5" />
        {/* "Offered" is about the ride, "posted right now" is about the hour —
            and a ride that has the queue but isn't running one today is the
            second, not the first. */}
        {ll.has
          ? `No ${paidLineProduct(operatorSlug)} posted right now`
          : `No ${paidLineProduct(operatorSlug)} offered`}
      </div>
    );
  }
  const price = formatPriceCents(ll.priceCents, item.lightningLane.currency);
  const window = formatReturnWindow(ll.returnStart, ll.returnEnd, timeZone);
  // Single (Individual Lightning Lane) is the à-la-carte premium tier — flag it
  // with a gold gem so it reads apart from the bundled Multi pass.
  const premium = ll.kind === "Single";
  return (
    <div
      className={cn(
        "bg-muted/50 flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs",
        className,
      )}
    >
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
        {ll.soldOut ? <Badge variant="destructive">no return times</Badge> : null}
        {price ? <span className="tabular-nums">{price}</span> : null}
        {window ? <span className="text-muted-foreground tabular-nums">{window}</span> : null}
        {express ? <ExpressAcceptedBadge /> : null}
      </div>
    </div>
  );
}

/**
 * The board's sort and filter drawers, as a pair of pills. The caller decides
 * where they sit — the floating stack over the nav island, or inline in the
 * board's heading row (see `ParkBoardTable`'s `controls`).
 */
function BoardControls({
  sort,
  onSort,
  filter,
  onFilter,
  className,
  style,
}: {
  sort: { key: BoardSortKey; dir: SortDir };
  onSort: (key: BoardSortKey, dir: SortDir) => void;
  filter: StatusFilter;
  onFilter: (f: StatusFilter) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const filterActive = filter !== "ALL";
  return (
    <div className={className} style={style}>
      {/* Pills matching the map's Filter button exactly. */}
      {/* Sort */}
      <Drawer>
        <DrawerTrigger className={MAP_FILTER_PILL}>
          <ArrowUpDownIcon />
          Sort
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Sort rides</DrawerTitle>
            <DrawerDescription>
              Choose how the ride board is ordered. Tap again to flip the direction.
            </DrawerDescription>
          </DrawerHeader>
          <SortRows
            options={BOARD_SORTS}
            activeKey={sort.key}
            activeDir={sort.dir}
            onChange={onSort}
          />
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
