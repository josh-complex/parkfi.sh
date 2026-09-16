import * as React from "react";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowUpDownIcon,
  LayoutGridIcon,
  ListIcon,
  MapIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import posthog from "posthog-js";

import { ConnectionLost } from "#/components/connection-lost.tsx";
import { RideTiles, RideTilesSkeleton } from "#/components/rides/ride-tiles.tsx";
import { WaitBadge } from "#/components/rides/wait-badge.tsx";
import { WaitsBlurbs } from "#/components/rides/waits-blurbs.tsx";
import { WaitsFilterModal } from "#/components/rides/waits-filter-modal.tsx";
import { WaitsFilterRail } from "#/components/rides/waits-filter-rail.tsx";
import { BoardTableSkeleton } from "#/components/skeletons.tsx";
import {
  MAP_FILTER_PILL,
  MAP_FILTER_STACK,
  MAP_FILTER_STACK_RIGHT,
  RideFilterControls,
  RideFilterFooter,
  type RideFilterControlsProps,
} from "#/components/rides/ride-filter-button.tsx";
import {
  EMPTY_RIDE_FILTER,
  RIDE_CATEGORIES,
  rideFilterActive,
  rideMatchesFilter,
  rideTypeKey,
  useRideFilter,
} from "#/components/rides/ride-filter.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import { useRowHeight, useViewportWidth, useWindowList } from "#/components/ui/window-list.tsx";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "#/components/ui/drawer.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import {
  SortRows,
  TableSortHeader,
  type SortDir,
  type SortOption,
} from "#/components/ui/sort-menu.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table.tsx";
import { useIsMobile } from "#/hooks/use-mobile.ts";
import { queryUnavailable } from "#/hooks/use-online-status.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { lazyWithReload } from "#/lib/lazy-with-reload.tsx";
import { Image } from "#/components/ui/image.tsx";
import { PAGE_WIDTH } from "#/components/page-container.tsx";
import { cn } from "#/lib/utils.ts";
import { formatParkName } from "#/lib/parks.ts";

import {
  buildPicks,
  buildProfileLookups,
  formatLaterWindow,
  parkPulses,
  parkRank,
  splitMovers,
  type LaterWindow,
  type Ride,
} from "./waits-data.ts";
import { TOOLBAR_STICKY, UNDER_TOOLBAR_HEIGHT, UNDER_TOOLBAR_TOP } from "./waits-chrome.ts";
import { filterToFrame, framesEqual, type MapFrame } from "./waits-frame.ts";
import {
  applySearchToFilter,
  filterToSearch,
  type WaitsSearch,
  type WaitsSort,
  type WaitsView,
} from "./waits-search.ts";

/**
 * The map pane, loaded only when someone asks for it. MapLibre plus a basemap
 * style is the heaviest thing this page can pull, and the board's whole job —
 * every ride, every wait, every filter — is done without it.
 */
const WaitsMap = lazyWithReload(
  () => import("./waits-map.tsx").then((m) => ({ default: m.WaitsMap })),
  "waits-map",
);

const SORTS: ReadonlyArray<SortOption<WaitsSort>> = [
  {
    key: "wait",
    label: "Wait",
    directional: true,
    defaultDir: "desc",
    ascHint: "shortest first",
    descHint: "longest first",
  },
  {
    key: "name",
    label: "Name",
    directional: true,
    defaultDir: "asc",
    ascHint: "A–Z",
    descHint: "Z–A",
  },
  {
    key: "park",
    label: "Park",
    directional: true,
    defaultDir: "asc",
    ascHint: "resort order",
    descHint: "reversed",
  },
];

const DEFAULT_DIR: Record<WaitsSort, SortDir> = { wait: "desc", name: "asc", park: "asc" };

/** Where the list/tiles preference lives — see the view state below. */
const VIEW_STORAGE_KEY = "waits-view";

/** `useLayoutEffect` on the client, a no-op-safe `useEffect` while rendering
 *  on the server (React warns about the layout variant there). */
const useIsoLayoutEffect =
  typeof document !== "undefined" ? React.useLayoutEffect : React.useEffect;

/** Chips for one multi-select filter collapse into a count at this many. */
const COLLAPSE_CHIPS_AT = 3;

/**
 * Tailwind's `md`, and `useIsMobile`'s own breakpoint — at or above it the
 * controls sit in the cluster over the results, the filters open as a modal,
 * and the map pane runs beside the list. Below it the controls are floating
 * pills, the filters are a bottom drawer, and there is no map at all (the
 * bottom nav's Map tab is the phone's map).
 */
const SPLIT_BREAKPOINT = 768;

/** Tailwind's `lg` — the width at which a list row grows its wide layout
 *  (bigger photo, the park/land/type columns). */
const WIDE_ROW_BREAKPOINT = 1024;

/** The board's own route, for typed search reads and writes (§4). */
const waitsRoute = getRouteApi("/_app/_dash/");

/**
 * How often the board re-reads the live feeds. Matched to the ingestion
 * worker's own 60s tick (and to the ticker's poll) — anything faster only asks
 * the edge for a reading the origin doesn't have yet. `CACHE.TRPC_LIVE` collapses
 * every concurrent poller into one origin hit per 30s, so this costs the origin
 * nothing per extra reader. The park strip draws the cycle as a hairline.
 */
const LIVE_POLL_MS = 60_000;

/**
 * A stable string for a search object, used to decide which way state and URL
 * should flow. Key order is normalised so `{a,b}` and `{b,a}` compare equal.
 */
function searchKey(s: WaitsSearch): string {
  return Object.entries(s)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join("&");
}

/**
 * The board's one ordering, shared by the list and the tiles. Ties always break
 * to the name so a re-sort of the same data can never shuffle equal rows past
 * each other — with the order now recomputed on every poll, an unstable tie
 * would read as rows twitching for no reason.
 */
function rideComparator(sortKey: WaitsSort, sortDir: SortDir): (a: Ride, b: Ride) => number {
  const byName = (a: Ride, b: Ride) => a.name.localeCompare(b.name);
  const asc = sortDir === "asc";
  if (sortKey === "wait") {
    return asc
      ? // Shortest first; a ride with no posted wait sinks to the bottom.
        (a, b) => (a.standbyWait ?? Infinity) - (b.standbyWait ?? Infinity) || byName(a, b)
      : // Longest first; it sinks here too, which is why shows and character
        // meets end up together at the tail either way.
        (a, b) => (b.standbyWait ?? -1) - (a.standbyWait ?? -1) || byName(a, b);
  }
  if (sortKey === "park") {
    // Resort order, the strip's order — not alphabetical, which would put Animal
    // Kingdom before Magic Kingdom and read as a second, contradictory ordering
    // of the same eight cards.
    return (a, b) => {
      const d = parkRank(a.parkSlug) - parkRank(b.parkSlug);
      return (asc ? d : -d) || byName(a, b);
    };
  }
  return asc ? byName : (a, b) => b.name.localeCompare(a.name);
}

/* ── The results table ────────────────────────────────────────────────────── */

/**
 * The list view's columns. Same stack as the park page's live board — TanStack
 * Table column defs rendered through the `ui/table` primitives — so the two
 * boards behave and look like one component family.
 *
 * `manualSorting` (below): the board has already sorted every ride into one
 * order, and the tiles view shows that same order, so the table must not
 * re-sort. The column heads drive the *board's* sort instead, which is the same
 * state the Sort drawer writes.
 *
 * Park, land, type and height are desktop-only — below `lg` the row collapses
 * to the phone line (photo · name over park · wait) through `hidden
 * lg:table-cell` rather than a second set of markup, so a phone ships one DOM
 * and the server renders the same HTML at every width.
 */
type RideColumnMeta = {
  /** Display gate for the `<th>`/`<td>` — which breakpoint the column appears at. */
  className?: string;
  /**
   * The same column's `<col>`: its pinned width, and `w-0` below the breakpoint
   * where its cells are hidden.
   *
   * The table is `table-fixed`, so *these* are the column widths — full stop.
   * Nothing a cell contains can widen a column. That is the point: the list is
   * windowed, so only a dozen-odd rows are ever mounted, and a content-sized
   * column would re-measure to whichever dozen those are and twitch on every
   * scroll. The one column with no width here is the attraction, which takes
   * whatever the others leave and truncates inside it.
   */
  col?: string;
  align?: "right";
};

function useRideColumns(
  eagerCount: number,
  laterById: ReadonlyMap<number, LaterWindow>,
  /**
   * The list is sharing its width with the map pane. The wide columns are
   * pinned to px widths (see `col` above) chosen for a list that owned the
   * page — side by side with a map they add up to more than the column they
   * live in, and the attraction name loses whatever they overrun. So the
   * compact table is the *phone* row at every width: photo, name, the park and
   * land under it, the wait on the right. Nothing is lost, only re-stacked.
   */
  compact: boolean,
) {
  const hasLater = laterById.size > 0;
  return React.useMemo<Array<ColumnDef<Ride>>>(() => {
    const cols: Array<ColumnDef<Ride>> = [
      {
        id: "name",
        header: "Attraction",
        accessorFn: (r) => r.name,
        cell: ({ row }) => (
          <AttractionCell ride={row.original} eager={row.index < eagerCount} compact={compact} />
        ),
      },
      {
        id: "park",
        header: "Park",
        accessorFn: (r) => r.parkName,
        cell: ({ row }) => (
          <span className="block max-w-[144px] truncate font-semibold text-wash-fg">
            {formatParkName(row.original.parkName)}
          </span>
        ),
        meta: {
          className: "hidden lg:table-cell",
          col: "w-0 lg:w-[168px]",
        } satisfies RideColumnMeta,
      },
      {
        id: "land",
        header: "Land",
        enableSorting: false,
        // The land is the column that yields, and it yields hard. Left to size
        // itself, a name like "The Wizarding World of Harry Potter™ — Ministry
        // of Magic™" took a third of the row and left the *attraction* — the
        // thing the row is about, and the only cell that's a link — truncated to
        // "Harry…". The ceiling here is deliberately tighter than the land names
        // want: every cell but the attraction is content-sized, so the attraction
        // is exactly whatever the others don't take, and this is the only one
        // with slack worth taking back. Hover gives the full land name.
        cell: ({ row }) => (
          <span
            title={row.original.land ?? undefined}
            className="block max-w-[120px] truncate text-muted-foreground xl:max-w-[145px] 2xl:max-w-[175px]"
          >
            {row.original.land ?? "—"}
          </span>
        ),
        meta: {
          className: "hidden lg:table-cell",
          col: "w-0 lg:w-[144px] xl:w-[169px] 2xl:w-[199px]",
        } satisfies RideColumnMeta,
      },
      {
        id: "type",
        header: "Type",
        enableSorting: false,
        cell: ({ row }) => {
          const category = RIDE_CATEGORIES.find((c) => c.key === rideTypeKey(row.original));
          return (
            <span className="block max-w-[104px] truncate text-muted-foreground">
              {category ? `${category.emoji} ${category.label}` : "—"}
            </span>
          );
        },
        meta: {
          className: "hidden xl:table-cell",
          col: "w-0 xl:w-[128px]",
        } satisfies RideColumnMeta,
      },
      {
        id: "height",
        header: "Height",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block max-w-[144px] truncate text-muted-foreground">
            {row.original.heightRequirement ?? "—"}
          </span>
        ),
        meta: {
          className: "hidden 2xl:table-cell",
          col: "w-0 2xl:w-[168px]",
        } satisfies RideColumnMeta,
      },
      {
        id: "wait",
        header: "Now",
        accessorFn: (r) => r.standbyWait ?? undefined,
        cell: ({ row }) => <WaitBadge ride={row.original} />,
        meta: { col: "w-[88px]", align: "right" } satisfies RideColumnMeta,
      },
    ];
    if (compact) return cols.filter((c) => c.id === "name" || c.id === "wait");
    // "Shortest later" is entirely the profiles rollup's output (§6). Until that
    // exists the column is *absent* rather than a column of dashes — an empty
    // column is a promise the data can't keep.
    if (hasLater) {
      cols.push({
        id: "later",
        header: "Shortest later",
        enableSorting: false,
        cell: ({ row }) => {
          const line = formatLaterWindow(row.original.standbyWait, laterById.get(row.original.id));
          return (
            <span
              className={cn(
                "block max-w-[104px] truncate text-xs",
                line ? "font-semibold" : "text-muted-foreground",
              )}
            >
              {line ?? "no better window"}
            </span>
          );
        },
        meta: {
          className: "hidden lg:table-cell",
          col: "w-0 lg:w-[128px]",
        } satisfies RideColumnMeta,
      });
    }
    return cols;
  }, [eagerCount, laterById, hasLater, compact]);
}

/** The name cell: the photo, the ride name as a real link, and — on a phone,
 *  where the park has no column — the park it's in under it. */
function AttractionCell({
  ride,
  eager,
  compact,
}: {
  ride: Ride;
  eager?: boolean;
  /** No park/land columns to defer to — keep the phone's stacked line at every
   *  width, and the photo at its phone size. */
  compact?: boolean;
}) {
  const closed = ride.status !== "OPERATING";
  return (
    <div className="flex min-w-0 items-center gap-3 lg:gap-4">
      {ride.imageThumbUrl ? (
        <Image
          src={ride.imageThumbUrl}
          alt={ride.imageAlt ?? ride.name}
          loading={eager ? "eager" : "lazy"}
          boxWidth={64}
          aspect={1}
          placeholder={ride.imageThumbhash}
          className={cn(
            "size-12 shrink-0 rounded-xl object-cover",
            !compact && "lg:size-16",
            closed && "opacity-60",
          )}
        />
      ) : (
        <div className={cn("size-12 shrink-0 rounded-xl bg-muted", !compact && "lg:size-16")} />
      )}
      <div className="min-w-0">
        <Link
          to="/park/$slug/ride/$rideSlug"
          params={{ slug: ride.parkSlug, rideSlug: ride.slug }}
          // The whole row navigates; this keeps the name a real link for
          // keyboard, middle-click and crawlers without firing twice.
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "block truncate font-medium hover:underline",
            !compact && "lg:text-base",
            closed && "text-muted-foreground",
          )}
        >
          {ride.name}
        </Link>
        <div className={cn("flex min-w-0 items-center gap-1.5", !compact && "lg:hidden")}>
          <span className="truncate text-[11px] font-bold tracking-[0.04em] text-wash-muted uppercase">
            {formatParkName(ride.parkName)}
          </span>
          {ride.land && <span className="truncate text-xs text-muted-foreground">{ride.land}</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * A row's height, phone and `lg`, as the window's opening guess: the photo
 * (`size-12` / `size-16`) plus the cell's vertical padding plus the hairline. A
 * real row is measured as soon as one mounts and that number is then used for
 * every row, so these only have to carry the first paint.
 */
const ROW_HEIGHT = { base: 70, lg: 89 } as const;

/**
 * The row, able to animate to a new seat. `TableRow` is a plain `<tr>` with the
 * board's chrome on it, and `motion.create` keeps that chrome rather than
 * forcing a parallel `motion.tr` that would drift from it.
 */
const MotionRow = motion.create(TableRow);

/**
 * Short and firm. A live board re-sorts on a 60-second tick, so the movement has
 * to be quick enough not to still be running when the reader looks away and
 * damped enough not to overshoot into the row above.
 */
const REORDER = { type: "spring", stiffness: 520, damping: 44, mass: 0.7 } as const;

/**
 * The whole filtered board as one table. It used to be one table per park; the
 * strip owns that dimension now, so this is a single flat list running the full
 * content width and spending it on columns the tiles can't show at all — the
 * park, the land, the type, and (from `2xl`) the height requirement a parent is
 * actually scanning for.
 */
function RideListTable({
  rides,
  sorting,
  onSortingChange,
  laterById,
  eagerCount = 0,
  compact = false,
}: {
  rides: Array<Ride>;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  laterById: ReadonlyMap<number, LaterWindow>;
  eagerCount?: number;
  /** The map pane is open beside the list — see `useRideColumns`. */
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const columns = useRideColumns(eagerCount, laterById, compact);
  const table = useReactTable({
    data: rides,
    columns,
    state: { sorting },
    onSortingChange,
    // The board sorted these already — see `useRideColumns`.
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.id),
  });

  const rows = table.getRowModel().rows;
  // Declared once for the whole table rather than per row, so the columns are a
  // property of the table and not of whatever rows the window happens to hold.
  const cols = (
    <colgroup>
      {table.getVisibleLeafColumns().map((column) => (
        <col
          key={column.id}
          className={(column.columnDef.meta as RideColumnMeta | undefined)?.col}
        />
      ))}
    </colgroup>
  );
  const head = (
    <TableHeader className={cn("hidden", !compact && "lg:table-header-group")}>
      {table.getHeaderGroups().map((hg) => (
        <TableRow key={hg.id} className="hover:bg-transparent">
          {hg.headers.map((header) => {
            const meta = header.column.columnDef.meta as RideColumnMeta | undefined;
            return (
              <TableHead
                key={header.id}
                className={cn(
                  "bg-muted/40 text-xs tracking-wide text-muted-foreground uppercase",
                  meta?.className,
                  meta?.align === "right" && "text-right",
                )}
              >
                {header.isPlaceholder ? null : header.column.getCanSort() ? (
                  <TableSortHeader
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
  );

  const viewport = useViewportWidth();
  const [rowHeight, measureRow] = useRowHeight(
    !compact && viewport >= WIDE_ROW_BREAKPOINT ? ROW_HEIGHT.lg : ROW_HEIGHT.base,
  );
  const { ref, start, end, totalSize, offsetTop, ready } = useWindowList({
    count: rows.length,
    rowHeight,
    // Roughly a screen's worth ahead, so a row's thumbnail is fetching before
    // the row is scrolled to.
    overscan: 8,
  });

  const renderRow = (row: (typeof rows)[number], windowed?: boolean) => (
    <MotionRow
      key={row.id}
      {...(windowed === true ? { ref: measureRow } : null)}
      // `"position"` and not `true`: the rows are re-seated, never resized, and
      // animating size as well would scale the photo and the type inside every
      // row that moved. A row entering or leaving the window is a mount rather
      // than a move, and the spacers keep every row that stays at exactly the
      // document position it already had, so scrolling produces no layout for
      // Motion to animate.
      layout={reduced ? false : "position"}
      transition={REORDER}
      className="cursor-pointer border-border/60"
      onClick={() =>
        void navigate({
          to: "/park/$slug/ride/$rideSlug",
          params: { slug: row.original.parkSlug, rideSlug: row.original.slug },
        })
      }
    >
      {row.getVisibleCells().map((cell) => {
        const meta = cell.column.columnDef.meta as RideColumnMeta | undefined;
        return (
          <TableCell
            key={cell.id}
            className={cn(
              "py-2.5 lg:py-3",
              meta?.className,
              meta?.align === "right" && "text-right",
            )}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        );
      })}
    </MotionRow>
  );

  // Two hundred-odd rows is two hundred-odd thumbnails, and the old
  // mount-and-keep chunking ended up holding every one of them: its idle queue
  // revealed the whole tail whether or not anyone scrolled there. The window
  // holds a screenful instead, at every width, and pays for the rows nobody can
  // see with two spacer rows.
  //
  // Spacers rather than absolutely-positioned rows on purpose: a `<tr>` that
  // leaves the table's own layout takes its cells' widths with it, and the
  // columns here are shared with a `<thead>` that has to keep lining up with
  // them. The columns are pinned to fixed widths in `useRideColumns` for the
  // same reason — a column sized to its content would re-measure to whichever
  // twenty rows happen to be mounted and twitch as you scroll.
  //
  // Both spacers are exact rather than estimated: every row is `rowHeight`
  // tall, measured from a real one, so the space held for the rows outside the
  // window is the space they will take, and a row that stays in the window
  // across a scroll does not move a pixel.
  const padTop = ready ? offsetTop : 0;
  const padBottom = ready ? totalSize - end * rowHeight : 0;

  return (
    // No bleed and no re-inset: the results column already sits inside the
    // page gutter, unlike the old per-park shelves that ran to the screen edge.
    <div className="overflow-hidden rounded-2xl border bg-card">
      <Table className="table-fixed">
        {cols}
        {head}
        <TableBody ref={ref as React.Ref<HTMLTableSectionElement>}>
          {padTop > 0 && <Spacer height={padTop} columns={columns.length} />}
          {/* The hydration render is the whole list — the SSR'd HTML carries
              every attraction name and link, and a window of it would mismatch.
              The window takes over one layout effect later. */}
          {ready
            ? rows.slice(start, end).map((row) => renderRow(row, true))
            : rows.map((row) => renderRow(row))}
          {padBottom > 0 && <Spacer height={padBottom} columns={columns.length} />}
        </TableBody>
      </Table>
    </div>
  );
}

/** The reserved space standing in for the rows above or below the window. */
function Spacer({ height, columns }: { height: number; columns: number }) {
  return (
    <tr aria-hidden>
      <td colSpan={columns} style={{ height, padding: 0, border: 0 }} />
    </tr>
  );
}

/* ── Chrome ───────────────────────────────────────────────────────────────── */

/**
 * A latched control wears its state the way a held one does: down on its shelf,
 * flat, with the top glare gone. Same three classes as `ui/toggle` and the park
 * strip, spelled out here because the toolbar's toggles are plain `Button`s.
 */
const PRESSED_FLAT =
  "aria-pressed:top-[3px] aria-pressed:shadow-3d-active aria-pressed:[--btn-glare:var(--btn-3d)]";

/**
 * Sort chooser, phone — the bottom drawer behind the left-hand pill stack.
 *
 * Desktop gets {@link SortMenu} instead: same rows, hung off the button that
 * opened them. A sheet swinging up from the bottom of a 1400px window to change
 * one dropdown's worth of state was the phone's gesture wearing a mouse's
 * clothes.
 */
function SortDrawer({
  sortKey,
  sortDir,
  onSort,
}: {
  sortKey: WaitsSort;
  sortDir: SortDir;
  onSort: (key: WaitsSort, dir: SortDir) => void;
}) {
  return (
    <Drawer>
      <DrawerTrigger className={MAP_FILTER_PILL}>
        <ArrowUpDownIcon />
        Sort
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Sort attractions</DrawerTitle>
          <DrawerDescription>
            Choose how the board is ordered. Tap again to flip the direction.
          </DrawerDescription>
        </DrawerHeader>
        <SortRows options={SORTS} activeKey={sortKey} activeDir={sortDir} onChange={onSort} />
      </DrawerContent>
    </Drawer>
  );
}

/**
 * Sort chooser, desktop — a popover under the toolbar button.
 *
 * The rows inside are the *same* `SortRows` the drawer renders, so the two
 * faces of one control can't drift apart (§3); only the container differs.
 */
function SortMenu({
  sortKey,
  sortDir,
  onSort,
}: {
  sortKey: WaitsSort;
  sortDir: SortDir;
  onSort: (key: WaitsSort, dir: SortDir) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="min-h-10" />}>
        <ArrowUpDownIcon data-icon="inline-start" />
        Sort
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[17.5rem] gap-0 p-2">
        <SortRows
          options={SORTS}
          activeKey={sortKey}
          activeDir={sortDir}
          onChange={onSort}
          className="px-0 pb-0"
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Filter chooser — the phone's face on the rail. It renders the *same*
 * `RideFilterControls` the desktop rail does, with the same parks and types, so
 * a filter can't exist on one and not the other (§3).
 */
function FilterDrawer({
  parks,
  categories,
  activeCount,
}: {
  parks: RideFilterControlsProps["parks"];
  categories: RideFilterControlsProps["categories"];
  activeCount: number;
}) {
  return (
    <Drawer>
      <DrawerTrigger
        className={cn(
          MAP_FILTER_PILL,
          activeCount > 0 && "btn-3d-primary bg-primary text-primary-foreground",
        )}
      >
        <SlidersHorizontalIcon />
        Filters
        {activeCount > 0 && (
          <span className="rounded-full bg-white/25 px-1.5 text-[11px] font-bold tabular-nums">
            {activeCount}
          </span>
        )}
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="border-b pb-4">
          <DrawerTitle>Filter attractions</DrawerTitle>
        </DrawerHeader>
        <RideFilterControls parks={parks} categories={categories} search />
        <RideFilterFooter />
      </DrawerContent>
    </Drawer>
  );
}

function ViewToggle({
  view,
  onView,
  variant,
}: {
  view: WaitsView;
  onView: (v: WaitsView) => void;
  variant: "segmented" | "pill";
}) {
  const next: WaitsView = view === "tiles" ? "list" : "tiles";
  // Mobile: a right-anchored 3D round button matching the map's controls (and
  // the left Filter/Sort pills' shelf/glare), mirroring the left cluster.
  if (variant === "pill") {
    return (
      <button
        type="button"
        onClick={() => onView(next)}
        aria-label={view === "tiles" ? "Switch to list view" : "Switch to tile view"}
        className="btn-3d-outline border-3d shadow-3d pointer-events-auto flex size-11 items-center justify-center rounded-full bg-background text-foreground transition active:scale-95 dark:border-[color-mix(in_oklch,var(--border),white_25%)] [&>svg]:size-5"
      >
        {view === "tiles" ? <ListIcon /> : <LayoutGridIcon />}
      </button>
    );
  }
  // Desktop: both states side by side, so the alternative is visible rather
  // than hidden behind one ambiguous icon — but as icons, and in neutral ink.
  //
  // Two rewrites, each undoing the same mistake from a different direction.
  // First it was word-labelled segments with the active one filled in the brand
  // blue, which made the smallest decision on the page the loudest thing in the
  // toolbar and put it in direct competition with the Map switch beside it
  // (also blue, and a control that actually changes the results). Then it was
  // the same shape in ink: a raised white capsule with a hard black pill
  // floating inside it, which read as a third *button* parked next to Map and
  // Sort rather than a switch, and the only part you could hit was the 32px
  // circle over the icon you weren't currently looking at.
  //
  // So: a recessed track, not a raised button — the one control in the cluster
  // that goes *into* the bar instead of standing on it, which is what says
  // "switch" before you have read either icon. The thumb is the raised, plain
  // surface the rest of the chrome is made of; the ink is neutral throughout
  // (list and tiles are a display choice: same rows either way). And each
  // segment is a wide lozenge rather than a circle, so the target is the half
  // of the control you were already pointing at.
  return (
    <div
      className="flex shrink-0 items-center gap-1 rounded-full border border-t-3 bg-muted p-1 shadow-[inset_0_1px_2px_oklch(0_0_0/0.07)] dark:bg-input/40"
      role="group"
      aria-label="View"
    >
      {(["list", "tiles"] as const).map((v) => {
        const on = v === view;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={on}
            aria-label={v === "list" ? "List view" : "Tile view"}
            title={v === "list" ? "List view" : "Tile view"}
            onClick={() => onView(v)}
            className={cn(
              "flex h-8 w-12 items-center justify-center rounded-full transition-[background-color,color,box-shadow] duration-150 [&>svg]:size-4",
              on
                ? "bg-background text-foreground shadow-[0_1px_2px_oklch(0_0_0/0.14)] ring-1 ring-border/70"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {v === "list" ? <ListIcon /> : <LayoutGridIcon />}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The map switch.
 *
 * A toggle that wears its state rather than naming the action: pressed and
 * filled while the map is showing, plain while it isn't — so the button says
 * what the board is doing. It is the one control in the cluster that changes
 * *which* attractions are listed, which is why it is also the only one wearing
 * the brand colour.
 *
 * Turning the map off doesn't leave its frame behind. A board still narrowed to
 * a box nobody can see would be a filter with no control, and this page's whole
 * contract is that every narrowing has a chip or a switch you can find.
 *
 * It also *sits down* while it's on. Every other 3D control on the page stands
 * on a shelf and drops onto it while you hold it, so a latched toggle that kept
 * its shelf was a button claiming to be un-pressed in the same breath its fill
 * said otherwise — colour alone carrying a state the whole rest of the chrome
 * spells out in relief. `PRESSED_FLAT` is that relief, and it is the same three
 * classes `ui/toggle` and the park strip's cards already use.
 *
 * Desktop only — see the pane's own gate in the board below.
 */
function MapToggle({ on, onToggle }: { on: boolean; onToggle: (on: boolean) => void }) {
  const label = on ? "Map on — hide it" : "Map — show the board on a map";
  return (
    <Button
      type="button"
      size="sm"
      variant={on ? "default" : "outline"}
      aria-pressed={on}
      aria-label={label}
      className={cn("min-h-10", PRESSED_FLAT)}
      onClick={() => onToggle(!on)}
    >
      <MapIcon data-icon="inline-start" />
      Map
    </Button>
  );
}

/**
 * The board's toolbar publishes its own height, the way the masthead publishes
 * `--site-header-height`, so the two things that stick *under* it — the filter
 * rail and the map pane — clear it without anyone hard-coding a number that
 * drifts the first time the bar wraps or a control changes size.
 *
 * Only published once measured; until then the sticky elements fall back to
 * their own default, which is why they spell one out.
 */
function useToolbarHeight(): [
  ref: React.RefObject<HTMLDivElement | null>,
  style: React.CSSProperties | undefined,
] {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = React.useState(0);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setHeight(el.getBoundingClientRect().height);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const style =
    height > 0
      ? ({ "--waits-bar-height": `${Math.round(height)}px` } as React.CSSProperties)
      : undefined;
  return [ref, style];
}

/** The map pane's own space, held while its chunk loads (and on the server). */
function MapPanePlaceholder() {
  return (
    <div
      className="size-full animate-pulse rounded-[22px] border border-card-edge bg-muted"
      aria-hidden
    />
  );
}

/** One removable filter chip over the results. */
function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="btn-3d-primary border-3d shadow-3d active:shadow-3d-active inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground transition"
    >
      {label}
      <XIcon className="size-3.5" aria-hidden />
      <span className="sr-only">Remove filter</span>
    </button>
  );
}

/**
 * Loading placeholder shown while `allRides` resolves. Mirrors the band + split
 * so the page keeps its shape instead of collapsing to a line of text.
 */
function ResultsSkeleton({ view }: { view: WaitsView }) {
  return view === "tiles" ? <RideTilesSkeleton /> : <BoardTableSkeleton rows={10} />;
}

/* ── The board ────────────────────────────────────────────────────────────── */

/**
 * The Waits page: one cross-park board.
 *
 * A band of live park cards and three blurbs on top; a permanent filter rail
 * and one flat list of every attraction below; list/tiles over the results.
 * The park cards **filter** the board — they never navigate — because the park
 * detail pages already own the per-park story.
 *
 * Everything the page draws comes from one payload (`parks.allRides`, which the
 * route SSRs so crawlers get real ride names and live waits) plus `parks.movers`,
 * which streams in afterwards and is the only thing a single live snapshot
 * can't know: what the wait *was* half an hour ago.
 */
export function CrossParkWaits() {
  const trpc = useTRPC();
  const live = { refetchInterval: LIVE_POLL_MS, refetchIntervalInBackground: false } as const;
  const ridesQ = useQuery({ ...trpc.parks.allRides.queryOptions(), ...live });
  const moversQ = useQuery({ ...trpc.parks.movers.queryOptions(), ...live });
  // What each queue *normally* runs at this hour (§6 rule 3 + "Shortest
  // later"). Rebuilt once a day, so it streams in behind the live data and its
  // absence simply costs the board one pick rule and one column.
  const profilesQ = useQuery(trpc.parks.hourlyProfiles.queryOptions());
  // Park hero art for the strip's cards. Free: the `_dash` loader already
  // prefetches `parks.list` for the layout, so this is a cache read that
  // resolves with the first paint.
  const parksQ = useQuery(trpc.parks.list.queryOptions());
  const { data: rides, isLoading } = ridesQ;
  const unavailable = queryUnavailable(ridesQ);
  const { filter, setFilter } = useRideFilter();

  const search = waitsRoute.useSearch();
  const navigate = waitsRoute.useNavigate();

  const [sortKey, setSortKey] = React.useState<WaitsSort>(search.sort ?? "wait");
  const [sortDir, setSortDir] = React.useState<SortDir>(
    search.dir ?? DEFAULT_DIR[search.sort ?? "wait"],
  );
  /**
   * List or tiles. Not URL state — it is a display preference, not part of what
   * a shared link resolves to (see the note atop `waits-search.ts`) — so it is
   * `localStorage` only, read in the layout effect below. First render is always
   * the default, because the server has no way to know what this reader picked
   * and a hydration that disagreed with its own HTML is worse than one frame.
   */
  const [view, setView] = React.useState<WaitsView>("list");
  const [mapOn, setMapOn] = React.useState(search.map === true);
  /**
   * The map's current viewport, and the board's newest filter: with the pane
   * open, the results are the attractions inside this box. Null whenever the
   * map is off or hasn't reported yet, which narrows nothing.
   *
   * Not in the URL — see `WaitsSearch.map`. It is also the one piece of board
   * state that isn't a *control* anyone set: it is where the map happens to be
   * looking, which is why turning the map off drops it.
   */
  const [frame, setFrame] = React.useState<MapFrame | null>(null);
  /**
   * The map pane is client-only. `?map=1` is a real, shareable URL, so the
   * server renders this page with the pane switched on — and MapLibre wants a
   * document. The placeholder holds the pane's space until mount, and the
   * board's HTML keeps every attraction in it (the frame narrows nothing while
   * it is null), so a crawler on a map link still reads the full list.
   */
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  /**
   * The map is a desktop feature. A phone already has the whole map one tap
   * away in the bottom nav — a second, smaller copy of it inside the Waits page
   * competes with the tab for the same job and costs the results their screen.
   * So on a phone this page is the results, full stop: no pane, no Map pill,
   * and `?map=1` on a shared link simply doesn't narrow anything (the frame
   * never gets set, because nothing is ever looking at one).
   *
   * A real unmount rather than a CSS hide, so the renderer isn't running behind
   * a `display:none` and the frame it last reported is dropped on the way out.
   */
  const isMobile = useIsMobile();
  const showMap = mapOn && !isMobile;

  /* — URL ⇄ state (§4) ------------------------------------------------------
     One value, two homes. `lastSyncedRef` records the key we last reconciled,
     so each effect can tell its own echo from a real change: a filter click
     writes the URL, the URL change comes back, and the reader sees its own key
     and stops. A Back button arrives with a key nobody wrote, and flows the
     other way. */
  const desired = React.useMemo(
    () => filterToSearch(filter, sortKey, sortDir, mapOn),
    [filter, sortKey, sortDir, mapOn],
  );
  const desiredKey = searchKey(desired);
  const urlKey = searchKey(search);
  const lastSyncedRef = React.useRef<string | null>(null);
  const mountedRef = React.useRef(false);
  // The split's top edge, and the flag the park strip raises to say "this change
  // came from above the fold — leave the page where it is" (see `holdScroll`).
  const splitRef = React.useRef<HTMLDivElement>(null);
  // The toolbar measures itself onto the split, where the rail and the map read
  // it to stick clear of it.
  const [toolbarRef, toolbarStyle] = useToolbarHeight();
  const holdScrollRef = React.useRef(false);

  /**
   * Park the results' top edge just under the masthead after a board change.
   *
   * Every one of these changes is a *replace* navigation, and the router's
   * default is to reset the scroll to the top of the document — which threw you
   * out of the results and up past the band every time you flipped a view or
   * touched a filter. `resetScroll: false` stops that; this puts the page
   * somewhere deliberate instead: at the divider, where the rail has its full
   * height and the control you just used is still under your cursor.
   *
   * Only from `md`, where that layout exists at all (below it the filters are a
   * drawer and the controls float over the list), and only when the page isn't
   * already parked there — so typing in the rail's search box scrolls once, on
   * the first keystroke, and then holds still.
   */
  const parkAtResults = React.useCallback(() => {
    if (typeof window === "undefined" || window.innerWidth < SPLIT_BREAKPOINT) return;
    const el = splitRef.current;
    if (!el) return;
    // A custom property comes back as authored, not resolved — the masthead
    // writes px, but `styles.css`'s pre-measurement default is in rem.
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--site-header-height")
      .trim();
    const n = parseFloat(raw) || 0;
    const masthead = raw.endsWith("rem") ? n * 16 : n;
    // The toolbar is sticky and sits in that same gap, so parking the split
    // under the masthead alone would park it under the toolbar instead.
    const bar = toolbarRef.current?.getBoundingClientRect().height ?? 0;
    const top = Math.max(0, window.scrollY + el.getBoundingClientRect().top - masthead - bar - 16);
    if (Math.abs(window.scrollY - top) < 8) return;
    window.scrollTo({ top, behavior: "smooth" });
  }, []);

  // URL → state. Also the initial hydration: the server renders the default
  // board (`/` is canonical for SEO), and a shared filtered link applies its
  // filter on the client's first pass.
  React.useEffect(() => {
    if (urlKey === lastSyncedRef.current) return;
    lastSyncedRef.current = urlKey;
    setFilter((f) => applySearchToFilter(f, search));
    const key = search.sort ?? "wait";
    setSortKey(key);
    setSortDir(search.dir ?? DEFAULT_DIR[key]);
    const map = search.map === true;
    setMapOn(map);
    // A Back out of the map view must not leave its last frame filtering the
    // board it returns to.
    if (!map) setFrame(null);
    // `search` is the value behind `urlKey`; re-running on the object identity
    // would fight the router's structural sharing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);

  // State → URL. Skipped on the very first commit, when the state is still the
  // default and the reader above is the one with something to say.
  React.useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (desiredKey === lastSyncedRef.current) return;
    lastSyncedRef.current = desiredKey;
    void navigate({ to: "/", search: desired, replace: true, resetScroll: false });
    // A park card sits above the results and is a filter you click repeatedly —
    // scrolling it off screen after the first click would be a trap. Everything
    // else that moves the board (sort, rail, chips) lives at the divider
    // or below it, so that's where the page goes.
    if (holdScrollRef.current) holdScrollRef.current = false;
    else parkAtResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desiredKey]);

  const setSort = React.useCallback((key: WaitsSort, dir: SortDir) => {
    setSortKey(key);
    setSortDir(dir);
  }, []);

  // The list view's column heads are a second face on this same sort: TanStack
  // Table wants a `SortingState`, the drawer wants (key, dir), and both have to
  // move the one board. The column ids are the sort keys, so the mapping is a
  // rename either way.
  const sorting = React.useMemo<SortingState>(
    () => [{ id: sortKey, desc: sortDir === "desc" }],
    [sortKey, sortDir],
  );
  const onSortingChange = React.useCallback<OnChangeFn<SortingState>>(
    (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const first = next[0];
      // An empty state means "unsorted", which this board has no notion of —
      // keep whatever is set rather than dropping to an arbitrary order.
      if (!first || !SORTS.some((s) => s.key === first.id)) return;
      setSort(first.id as WaitsSort, first.desc ? "desc" : "asc");
    },
    [sorting, setSort],
  );

  // The remembered view, applied on the first client commit. A *layout* effect,
  // so a tiles reader never sees a frame of the list: the swap lands before the
  // browser paints the hydrated document. Nothing in the URL competes with it
  // any more — the view is this reader's preference and lives only here.
  useIsoLayoutEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_STORAGE_KEY);
      // "grid" is the pre-rebuild name for what is now "tiles".
      if (v === "tiles" || v === "grid") setView("tiles");
      else if (v === "list") setView("list");
    } catch {
      /* private mode / disabled storage — keep the default */
    }
  }, []);

  const setMapShown = React.useCallback((on: boolean) => {
    setMapOn(on);
    if (!on) setFrame(null);
    posthog.capture("waits_map_toggled", { on });
  }, []);

  // `framesEqual` rather than a raw set: MapLibre reports a `moveend` for every
  // camera settle, including the ones that land where they started, and each
  // distinct frame object here re-derives the whole results list.
  const onFrameChange = React.useCallback((next: MapFrame | null) => {
    setFrame((prev) => (framesEqual(prev, next) ? prev : next));
  }, []);

  const setViewPersist = React.useCallback((v: WaitsView) => {
    setView(v);
    posthog.capture("waits_view_toggled", { view: v });
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
  }, []);

  /* — Derivations ---------------------------------------------------------- */

  const all = React.useMemo(() => rides ?? [], [rides]);
  const byId = React.useMemo(() => new Map(all.map((r) => [r.id, r])), [all]);

  // The strip reads every ride, never the filtered set: a park card has to keep
  // showing that park's real average while you're looking at someone else's.
  const parkArt = React.useMemo(
    () =>
      new Map(
        (parksQ.data ?? []).map((p) => [
          p.slug,
          { imageUrl: p.imageUrl, imageAlt: p.imageAlt, imageThumbhash: p.imageThumbhash },
        ]),
      ),
    [parksQ.data],
  );
  const pulses = React.useMemo(
    () => parkPulses(all, moversQ.data?.byPark ?? [], parkArt),
    [all, moversQ.data, parkArt],
  );

  const filtered = React.useMemo(
    () => all.filter((r) => rideMatchesFilter(r, filter)),
    [all, filter],
  );

  /**
   * The map's narrowing, applied on top of the filter and beneath the sort.
   *
   * The map draws its own markers from the renderer's feeds, filtered by the
   * same shared `RideFilter`, so it never sees this list — and in particular is
   * never handed the framed set, which would be a pane that can only ever show
   * what is already inside it.
   */
  const framed = React.useMemo(
    () => (showMap ? filterToFrame(filtered, frame) : filtered),
    [showMap, filtered, frame],
  );

  // Sorted fresh on every refetch, not frozen at first paint. The order used to
  // be ranked once and held across polls so rows couldn't jump under a reading
  // finger — but a board sorted by "Now" that never re-sorts is lying about
  // what it is: at 6pm it was still showing the 2pm ordering with 6pm numbers
  // inside it. The list re-ranks; `RideListTable` animates each row to its new
  // seat instead, which answers the jumping without freezing the truth.
  const results = React.useMemo(
    () => [...framed].sort(rideComparator(sortKey, sortDir)),
    [framed, sortKey, sortDir],
  );

  /* — The band ------------------------------------------------------------- */

  // Picks and movers follow the *park* selection only, not the whole filter:
  // §2.2 makes the strip re-point the panel, and a rider-height filter
  // narrowing "worth walking to" would quietly turn a recommendation into a
  // search result.
  const selectedParks = filter.parks;
  const scopedRides = React.useMemo(
    () => (selectedParks.size === 0 ? all : all.filter((r) => selectedParks.has(r.parkSlug))),
    [all, selectedParks],
  );
  const scopedMovers = React.useMemo(() => {
    const list = moversQ.data?.movers ?? [];
    return selectedParks.size === 0 ? list : list.filter((m) => selectedParks.has(m.parkSlug));
  }, [moversQ.data, selectedParks]);

  // A single clock for the whole band, taken from when the data actually
  // landed, so every "since 2 PM" on the page agrees and nothing re-renders on
  // a tick that changed nothing.
  const dataNow = Math.max(ridesQ.dataUpdatedAt, moversQ.dataUpdatedAt) || Date.now();

  const { usualByRide, laterById } = React.useMemo(
    () => buildProfileLookups({ profiles: profilesQ.data ?? [], rides: all, nowMs: dataNow }),
    [profilesQ.data, all, dataNow],
  );

  const picks = React.useMemo(
    () =>
      buildPicks({
        rides: scopedRides,
        movers: scopedMovers,
        usualByRide,
        selectedParks,
        nowMs: dataNow,
      }),
    [scopedRides, scopedMovers, usualByRide, selectedParks, dataNow],
  );
  const { dropping, climbing } = React.useMemo(
    () => splitMovers(scopedMovers, byId),
    [scopedMovers, byId],
  );

  const onToggleParkFrom = React.useCallback(
    (source: "strip" | "rail" | "chip") => (slug: string) => {
      if (source === "strip") holdScrollRef.current = true;
      setFilter((f) => {
        const next = new Set(f.parks);
        const selected = !next.delete(slug);
        if (selected) next.add(slug);
        posthog.capture("waits_park_toggled", { parkSlug: slug, selected, source });
        return { ...f, parks: next };
      });
    },
    [setFilter],
  );
  const onToggleFromStrip = React.useMemo(() => onToggleParkFrom("strip"), [onToggleParkFrom]);

  /* — Chrome copy ---------------------------------------------------------- */

  // Quick-filter chips only offer types actually present in the data
  // (dine/shop never appear here — `allRides` is scoped to entity_type
  // ATTRACTION; Houses appear only while the event is tagged and standing).
  const categoryOptions = React.useMemo(() => {
    const present = new Set(all.map((r) => rideTypeKey(r)).filter((c) => c != null));
    return RIDE_CATEGORIES.filter((c) => present.has(c.key));
  }, [all]);

  const active = rideFilterActive(filter);
  const selectedPulses = pulses.filter((p) => selectedParks.has(p.slug));
  const selectedNames = selectedPulses.map((p) => p.name);
  const onePark = selectedNames.length === 1 ? selectedNames[0] : undefined;

  // The removable chips over the results — one per live narrowing, each one
  // clearing exactly the control that set it.
  //
  // A *multi-select* narrowing stops spelling its members out once naming them
  // costs more room than counting them: three or more parks collapse to one
  // "3 parks" chip that clears the lot. Two stay named — the common case is a
  // resort's two parks, "Magic Kingdom · EPCOT" says more than "2 parks" in
  // about the same width, and collapsing at two would mean the row never shows
  // a park's name at all. The chip row is a summary of what's applied, not the
  // control: dropping one of three is what the Filters panel is for, and it
  // still lists every box.
  const categoryKeys = [...filter.categories];
  const parkChips =
    selectedPulses.length >= COLLAPSE_CHIPS_AT
      ? [
          {
            label: `${selectedPulses.length} parks`,
            remove: () => setFilter((f) => ({ ...f, parks: new Set<string>() })),
          },
        ]
      : selectedPulses.map((p) => ({
          label: p.name,
          remove: () => onToggleParkFrom("chip")(p.slug),
        }));
  const categoryChips =
    categoryKeys.length >= COLLAPSE_CHIPS_AT
      ? [
          {
            label: `${categoryKeys.length} types`,
            remove: () => setFilter((f) => ({ ...f, categories: new Set<string>() })),
          },
        ]
      : categoryKeys.map((key) => ({
          label: RIDE_CATEGORIES.find((c) => c.key === key)?.label ?? key,
          remove: () =>
            setFilter((f) => {
              const next = new Set(f.categories);
              next.delete(key);
              return { ...f, categories: next };
            }),
        }));

  const chips: Array<{ label: string; remove: () => void }> = [
    ...parkChips,
    ...categoryChips,
    ...(filter.query.trim()
      ? [
          {
            label: `“${filter.query.trim()}”`,
            remove: () => setFilter((f) => ({ ...f, query: "" })),
          },
        ]
      : []),
    ...(filter.openOnly
      ? [{ label: "Open now", remove: () => setFilter((f) => ({ ...f, openOnly: false })) }]
      : []),
    ...(filter.maxWait != null
      ? [
          {
            label: `≤ ${filter.maxWait}m`,
            remove: () => setFilter((f) => ({ ...f, maxWait: null })),
          },
        ]
      : []),
    ...(filter.heightBand != null
      ? [
          {
            label: `${filter.heightBand}" rider`,
            remove: () => setFilter((f) => ({ ...f, heightBand: null })),
          },
        ]
      : []),
    ...(filter.noHeightReq
      ? [{ label: "No minimum", remove: () => setFilter((f) => ({ ...f, noHeightReq: false })) }]
      : []),
    ...(filter.expressPass
      ? [{ label: "Express Pass", remove: () => setFilter((f) => ({ ...f, expressPass: false })) }]
      : []),
    ...(filter.singleRider
      ? [{ label: "Single rider", remove: () => setFilter((f) => ({ ...f, singleRider: false })) }]
      : []),
    ...(filter.childSwap
      ? [{ label: "Child swap", remove: () => setFilter((f) => ({ ...f, childSwap: false })) }]
      : []),
  ];

  // What the Filters badge counts: every live narrowing, collapsed chip or not.
  // Counting the chips instead would have three parks read as "1" — the badge
  // is a tally of boxes ticked, and the panel it opens shows all of them.
  const activeCount =
    chips.length -
    parkChips.length -
    categoryChips.length +
    selectedPulses.length +
    categoryKeys.length;

  // Reported once per settled filter, not once per keystroke — the interesting
  // fact is what someone ended up asking for and how much it found. `source` is
  // read off the viewport rather than threaded through the filter state,
  // because the modal and the drawer are the same component writing the same
  // value: which one the user touched *is* which one is on screen. (The event's
  // vocabulary is stable — "modal" is the old "rail" surface renamed, not a new
  // kind of thing.)
  React.useEffect(() => {
    if (!active || isLoading) return;
    const t = setTimeout(
      () =>
        posthog.capture("waits_filter_applied", {
          keys: Object.keys(desired).filter((k) => !["sort", "dir", "map"].includes(k)),
          resultCount: results.length,
          mapArea: showMap,
          source: window.innerWidth >= SPLIT_BREAKPOINT ? "modal" : "drawer",
        }),
      600,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desiredKey, isLoading]);

  return (
    <div className="flex flex-col">
      {/* ── The band ──
          The page leads with the park cards. The old title row ("Queue times"
          + "N attractions · updated 30s ago" + the view toggle) is gone: the
          cards say what the page is faster than the words did, the count now
          heads the results, the view toggle sits with Sort where it acts, and
          the freshness line moved into the masthead's Live Waits meter, which
          is where the poll cycle actually lives. The h1 stays for crawlers and
          screen readers — the page still needs a name, it just doesn't need to
          spend 60px of the fold saying it.

          The band is full-bleed and owns everything above the results now,
          strip included: it paints the dark field edge to edge and re-applies
          `PAGE_WIDTH` inside itself. It also decides its own height — with
          nothing open it keeps the park cards and drops the panels — so nothing
          out here may reserve space for it. The hairline that used to close the
          band is gone too: the band's own edge is the rule now. */}
      <h1 className="sr-only">Queue times</h1>

      <WaitsBlurbs
        parks={pulses}
        selected={selectedParks}
        onTogglePark={onToggleFromStrip}
        parksLoading={isLoading}
        picks={picks}
        dropping={dropping}
        climbing={climbing}
        parkName={onePark}
        loading={isLoading || moversQ.isLoading}
      />

      <div className={cn(PAGE_WIDTH, "flex flex-col pt-6 pb-4 max-w-480!")}>
        {/* ── The toolbar ──
            The count and every control that acts on the board, in one bar that
            sticks under the masthead. It used to head the results column and
            scroll away with them, which meant that changing your mind about the
            sort — or turning the map off — was a trip back to the top of a
            two-hundred-row list. It is also the one row that belongs to *both*
            columns: it counts what the list is showing and it opens the map
            beside it, so it sits above the split rather than inside either half.

            A floating glass capsule rather than a full-width band with a rule
            under it: the band read as a seam across the page, with card titles
            sliding up under a hard edge. This lifts off the results instead —
            the same move the map's own control chips make — and is deliberately
            *quiet* (no emboss of its own) so the 3D controls inside it stay the
            things the eye lands on. */}
        <div
          ref={toolbarRef}
          className={cn(
            TOOLBAR_STICKY,
            "-mx-3 flex items-center justify-between gap-3 rounded-4xl shadow-lg border border-t-3 bg-background/95 py-2 pr-2 backdrop-blur-xl supports-backdrop-filter:bg-background/80 md:pr-3",
            // The bar's own left padding depends on whether anything is sitting
            // in the corner: a button brings its own inset, a bare heading needs
            // the gutter. Both conditions are media queries (the cluster is
            // `md:`, the Filters slot folds away at `lg` when the rail takes
            // over), so the padding follows them rather than a JS flag.
            "pl-4 md:pl-2",
            !showMap && "lg:pl-5",
          )}
        >
          {/* Filters first, ahead of the count it explains — it is the control
              people come back to, and hunting for it at the far end of a row of
              five was the one bit of this bar that needed a second look. It is
              here only when the rail isn't on screen to hold it: with the map
              off from `lg` the rail *is* the filters, and a button too would be
              a second face on one state. */}
          <div className="flex min-w-0 items-center gap-3">
            <div className={cn("hidden shrink-0 md:block", !showMap && "lg:hidden")}>
              <WaitsFilterModal
                parks={pulses}
                categories={categoryOptions}
                count={results.length}
                total={all.length}
                activeCount={activeCount}
              />
            </div>
            <h2 className="min-w-0 truncate text-lg font-extrabold tracking-[-0.015em] md:text-xl">
              {/* `aria-live`, because for a screen-reader user this number *is*
                  the feedback that a filter or a pan did something (§9). */}
              <span aria-live="polite">
                {active || showMap ? `${results.length} attractions` : "Every attraction"}
              </span>
              {showMap && (
                <span className="ml-2 text-sm font-semibold text-muted-foreground">
                  in this map area
                </span>
              )}
            </h2>
          </div>
          {/* The right cluster is now only **how the board is shown** — list or
              tiles, with or without the map — plus the sort behind a hairline.
              Inside it only Map is filled, because it is the one display control
              that changes which attractions are listed. */}
          <div className="hidden shrink-0 items-center gap-2 md:flex">
            <ViewToggle view={view} onView={setViewPersist} variant="segmented" />
            <MapToggle on={mapOn} onToggle={setMapShown} />
            <div className="mx-0.5 h-6 w-px bg-border" aria-hidden />
            <SortMenu sortKey={sortKey} sortDir={sortDir} onSort={setSort} />
          </div>
        </div>

        {/* ── The split ──
            Two columns on a desktop, and the left one is the same column twice:
            the filter rail while the map is off, the results themselves once
            the map takes the right half (the filters move into the modal —
            a list squeezed between a filter column and a map reads as neither).
            One column on a phone, always the results: the map lives in the
            bottom nav there (see `showMap`). */}
        <div
          ref={splitRef}
          style={toolbarStyle}
          className={cn(
            "grid items-start gap-7",
            showMap
              ? "md:grid-cols-[minmax(0,1fr)_minmax(17rem,42%)]"
              : "lg:grid-cols-[300px_minmax(0,1fr)]",
          )}
        >
          {!showMap && (
            <WaitsFilterRail
              parks={pulses}
              categories={categoryOptions}
              count={results.length}
              total={all.length}
            />
          )}

          <div className="flex min-w-0 flex-col gap-4">
            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-muted-foreground">Filtered by</span>
                {chips.map((c, i) => (
                  <ActiveChip key={`${c.label}-${i}`} label={c.label} onRemove={c.remove} />
                ))}
                <Button variant="outline" size="sm" onClick={() => setFilter(EMPTY_RIDE_FILTER)}>
                  Clear all
                </Button>
              </div>
            )}

            {isLoading && <ResultsSkeleton view={view} />}

            {!isLoading && unavailable && <ConnectionLost onRetry={() => void ridesQ.refetch()} />}

            {!isLoading && !unavailable && results.length === 0 && (
              <Empty className="px-2 py-6 sm:px-12">
                <img
                  src="/img/oops-map.png"
                  alt=""
                  aria-hidden
                  className="-mt-10 -mb-7 w-full max-w-[320px] select-none"
                />
                {/* Two different dead ends, and only one of them is the filter's
                    fault: with the map on, the usual cause is a frame over a car
                    park, and "Clear all" would leave the reader looking at the
                    same empty box. */}
                <EmptyTitle>
                  {showMap && filtered.length > 0
                    ? "Nothing in this part of the map"
                    : "No attraction fits that"}
                </EmptyTitle>
                <EmptyDescription className="max-w-md">
                  {showMap && filtered.length > 0 ? (
                    <>
                      {filtered.length} attractions match your filters — none of them are inside the
                      area the map is showing. Zoom out or drag the map to find them.
                    </>
                  ) : (
                    <>
                      All {all.length} attractions are still here — this combination of filters just
                      doesn&rsquo;t match any of them. Loosen one, or start over.
                    </>
                  )}
                </EmptyDescription>
                {!(showMap && filtered.length > 0) && (
                  <Button size="sm" className="mt-2" onClick={() => setFilter(EMPTY_RIDE_FILTER)}>
                    Clear all
                  </Button>
                )}
              </Empty>
            )}

            {!isLoading && results.length > 0 && view === "tiles" && (
              <RideTiles rides={results} laterById={laterById} />
            )}

            {!isLoading && results.length > 0 && view === "list" && (
              <RideListTable
                rides={results}
                sorting={sorting}
                onSortingChange={onSortingChange}
                laterById={laterById}
                eagerCount={8}
                compact={showMap}
              />
            )}
          </div>

          {/* The pane. Sticky under the toolbar, whose height it reads off the
              split — the same contract the filter rail sticks by, written out
              in `waits-chrome.ts` precisely so the two can't drift from each
              other or from the bar as the page scrolls. */}
          {showMap && (
            <div
              className={cn("sticky w-full min-h-[22rem]", UNDER_TOOLBAR_TOP, UNDER_TOOLBAR_HEIGHT)}
            >
              {mounted ? (
                <React.Suspense fallback={<MapPanePlaceholder />}>
                  <WaitsMap
                    onFrameChange={onFrameChange}
                    parks={selectedParks}
                    className="size-full"
                  />
                </React.Suspense>
              ) : (
                <MapPanePlaceholder />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mobile controls — left-anchored stacked pills, matching the map's
          bottom-left Filter button exactly. The filters have nowhere to go on a
          phone, so they stay these (§2.3). The list/tiles toggle mirrors them
          on the right. No Map pill: the map is the bottom nav's own tab here
          (see `showMap`).

          Gated on the board having *data* rather than on the current results,
          so a filter that finds nothing still leaves you the controls that
          would undo it. */}
      {!isLoading && !unavailable && all.length > 0 && (
        <>
          <div
            className={MAP_FILTER_STACK}
            style={{ bottom: "calc(var(--safe-bottom) + var(--bottom-nav-height) + 1.4rem)" }}
          >
            <SortDrawer sortKey={sortKey} sortDir={sortDir} onSort={setSort} />
            <FilterDrawer parks={pulses} categories={categoryOptions} activeCount={activeCount} />
          </div>
          <div
            className={MAP_FILTER_STACK_RIGHT}
            style={{ bottom: "calc(var(--safe-bottom) + var(--bottom-nav-height) + 1.4rem)" }}
          >
            <ViewToggle view={view} onView={setViewPersist} variant="pill" />
          </div>
        </>
      )}
    </div>
  );
}
