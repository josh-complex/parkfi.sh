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
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import posthog from "posthog-js";

import { ConnectionLost } from "#/components/connection-lost.tsx";
import { RideTiles, RideTilesSkeleton } from "#/components/rides/ride-tiles.tsx";
import { WaitBadge } from "#/components/rides/wait-badge.tsx";
import { WaitsBlurbs } from "#/components/rides/waits-blurbs.tsx";
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
import { queryUnavailable } from "#/hooks/use-online-status.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
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
import {
  applySearchToFilter,
  filterToSearch,
  type WaitsSearch,
  type WaitsSort,
  type WaitsView,
} from "./waits-search.ts";

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

const VIEW_STORAGE_KEY = "waits-view";

/** Tailwind's `lg` — at or above this the filter rail is on screen, below it the
 *  same controls live in the phone drawer. */
const RAIL_BREAKPOINT = 1024;

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

function useRideColumns(eagerCount: number, laterById: ReadonlyMap<number, LaterWindow>) {
  const hasLater = laterById.size > 0;
  return React.useMemo<Array<ColumnDef<Ride>>>(() => {
    const cols: Array<ColumnDef<Ride>> = [
      {
        id: "name",
        header: "Attraction",
        accessorFn: (r) => r.name,
        cell: ({ row }) => <AttractionCell ride={row.original} eager={row.index < eagerCount} />,
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
  }, [eagerCount, laterById, hasLater]);
}

/** The name cell: the photo, the ride name as a real link, and — on a phone,
 *  where the park has no column — the park it's in under it. */
function AttractionCell({ ride, eager }: { ride: Ride; eager?: boolean }) {
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
            "size-12 shrink-0 rounded-xl object-cover lg:size-16",
            closed && "opacity-60",
          )}
        />
      ) : (
        <div className="size-12 shrink-0 rounded-xl bg-muted lg:size-16" />
      )}
      <div className="min-w-0">
        <Link
          to="/park/$slug/ride/$rideSlug"
          params={{ slug: ride.parkSlug, rideSlug: ride.slug }}
          // The whole row navigates; this keeps the name a real link for
          // keyboard, middle-click and crawlers without firing twice.
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "block truncate font-medium hover:underline lg:text-base",
            closed && "text-muted-foreground",
          )}
        >
          {ride.name}
        </Link>
        <div className="flex min-w-0 items-center gap-1.5 lg:hidden">
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
}: {
  rides: Array<Ride>;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  laterById: ReadonlyMap<number, LaterWindow>;
  eagerCount?: number;
}) {
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const columns = useRideColumns(eagerCount, laterById);
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
    <TableHeader className="hidden lg:table-header-group">
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
    viewport >= RAIL_BREAKPOINT ? ROW_HEIGHT.lg : ROW_HEIGHT.base,
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

/** Sort chooser — shared bottom drawer, styled to its surface via `variant`. */
function SortDrawer({
  sortKey,
  sortDir,
  onSort,
  variant,
}: {
  sortKey: WaitsSort;
  sortDir: SortDir;
  onSort: (key: WaitsSort, dir: SortDir) => void;
  variant: "ghost" | "outline" | "pill";
}) {
  return (
    <Drawer>
      {variant === "pill" ? (
        <DrawerTrigger className={MAP_FILTER_PILL}>
          <ArrowUpDownIcon />
          Sort
        </DrawerTrigger>
      ) : (
        <DrawerTrigger asChild>
          <Button
            variant={variant}
            size="sm"
            className={cn("min-h-10", variant === "ghost" && "rounded-full")}
          >
            <ArrowUpDownIcon data-icon="inline-start" />
            Sort
          </Button>
        </DrawerTrigger>
      )}
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
 * Filter chooser — the phone's face on the rail. It renders the *same*
 * `RideFilterControls` the desktop rail does, with the same parks and types, so
 * a filter can't exist on one and not the other (§3).
 */
function FilterDrawer({
  variant,
  parks,
  categories,
  activeCount,
}: {
  variant: "ghost" | "outline" | "pill";
  parks: RideFilterControlsProps["parks"];
  categories: RideFilterControlsProps["categories"];
  activeCount: number;
}) {
  return (
    <Drawer>
      {variant === "pill" ? (
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
      ) : (
        <DrawerTrigger asChild>
          <Button
            variant={variant}
            size="sm"
            className={cn("min-h-10", variant === "ghost" && "rounded-full")}
          >
            <SlidersHorizontalIcon data-icon="inline-start" />
            Filter
          </Button>
        </DrawerTrigger>
      )}
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
  // Desktop: the two states side by side, so the alternative is visible rather
  // than hidden behind one ambiguous icon.
  return (
    <div
      className="btn-3d-outline border-3d shadow-3d flex min-h-10 shrink-0 items-center gap-1 rounded-4xl bg-background p-1 dark:border-[color-mix(in_oklch,var(--border),white_25%)]"
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
            onClick={() => onView(v)}
            className={cn(
              "rounded-4xl px-3.5 py-1.5 text-[13px] font-semibold transition",
              on
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {v === "list" ? "List" : "Tiles"}
          </button>
        );
      })}
    </div>
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
  const [view, setView] = React.useState<WaitsView>(search.view ?? "list");

  /* — URL ⇄ state (§4) ------------------------------------------------------
     One value, two homes. `lastSyncedRef` records the key we last reconciled,
     so each effect can tell its own echo from a real change: a filter click
     writes the URL, the URL change comes back, and the reader sees its own key
     and stops. A Back button arrives with a key nobody wrote, and flows the
     other way. */
  const desired = React.useMemo(
    () => filterToSearch(filter, view, sortKey, sortDir),
    [filter, view, sortKey, sortDir],
  );
  const desiredKey = searchKey(desired);
  const urlKey = searchKey(search);
  const lastSyncedRef = React.useRef<string | null>(null);
  const mountedRef = React.useRef(false);
  // The split's top edge, and the flag the park strip raises to say "this change
  // came from above the fold — leave the page where it is" (see `holdScroll`).
  const splitRef = React.useRef<HTMLDivElement>(null);
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
   * Only from `lg`, where that layout exists at all (below it the rail is a
   * drawer and the controls float over the list), and only when the page isn't
   * already parked there — so typing in the rail's search box scrolls once, on
   * the first keystroke, and then holds still.
   */
  const parkAtResults = React.useCallback(() => {
    if (typeof window === "undefined" || window.innerWidth < RAIL_BREAKPOINT) return;
    const el = splitRef.current;
    if (!el) return;
    // A custom property comes back as authored, not resolved — the masthead
    // writes px, but `styles.css`'s pre-measurement default is in rem.
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--site-header-height")
      .trim();
    const n = parseFloat(raw) || 0;
    const masthead = raw.endsWith("rem") ? n * 16 : n;
    const top = Math.max(0, window.scrollY + el.getBoundingClientRect().top - masthead - 16);
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
    setView(search.view ?? "list");
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
    // else that moves the board (view, sort, rail, chips) lives at the divider
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

  // Read the remembered view after mount, but only when the URL didn't say —
  // the param wins when present (§4). SSR renders the URL's view (or the
  // default), so server and first client render agree.
  React.useEffect(() => {
    if (search.view) return;
    try {
      const v = localStorage.getItem(VIEW_STORAGE_KEY);
      // "grid" is the pre-rebuild name for what is now "tiles".
      if (v === "tiles" || v === "grid") setView("tiles");
      else if (v === "list") setView("list");
    } catch {
      /* private mode / disabled storage — keep the default */
    }
    // Only ever on mount; a later URL change is the reader effect's business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Sorted fresh on every refetch, not frozen at first paint. The order used to
  // be ranked once and held across polls so rows couldn't jump under a reading
  // finger — but a board sorted by "Now" that never re-sorts is lying about
  // what it is: at 6pm it was still showing the 2pm ordering with 6pm numbers
  // inside it. The list re-ranks; `RideListTable` animates each row to its new
  // seat instead, which answers the jumping without freezing the truth.
  const results = React.useMemo(
    () => [...filtered].sort(rideComparator(sortKey, sortDir)),
    [filtered, sortKey, sortDir],
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
  const chips: Array<{ label: string; remove: () => void }> = [
    ...selectedPulses.map((p) => ({
      label: p.name,
      remove: () => onToggleParkFrom("chip")(p.slug),
    })),
    ...[...filter.categories].map((key) => ({
      label: RIDE_CATEGORIES.find((c) => c.key === key)?.label ?? key,
      remove: () =>
        setFilter((f) => {
          const next = new Set(f.categories);
          next.delete(key);
          return { ...f, categories: next };
        }),
    })),
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

  // Reported once per settled filter, not once per keystroke — the interesting
  // fact is what someone ended up asking for and how much it found. `source` is
  // read off the viewport rather than threaded through the filter state,
  // because the rail and the drawer are the same component writing the same
  // value: which one the user touched *is* which one is on screen.
  React.useEffect(() => {
    if (!active || isLoading) return;
    const t = setTimeout(
      () =>
        posthog.capture("waits_filter_applied", {
          keys: Object.keys(desired).filter((k) => !["view", "sort", "dir"].includes(k)),
          resultCount: results.length,
          source: window.innerWidth >= RAIL_BREAKPOINT ? "rail" : "drawer",
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

      <div className={cn(PAGE_WIDTH, "flex flex-col gap-5 pt-6 pb-28")}>
        {/* ── The split ── */}
        <div ref={splitRef} className="grid items-start gap-7 lg:grid-cols-[300px_minmax(0,1fr)]">
          <WaitsFilterRail
            parks={pulses}
            categories={categoryOptions}
            count={results.length}
            total={all.length}
          />

          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex items-end justify-between gap-3">
              <h2 className="text-xl font-extrabold tracking-[-0.015em]">
                {active ? `${results.length} attractions` : "Every attraction"}
              </h2>
              {/* One cluster, one chrome: view, sort and (below `lg`, where the
                  rail is in a drawer) filter are the three controls that act on
                  the list underneath, so they sit together over it and wear the
                  same outline key at the same height. */}
              <div className="hidden items-center gap-2 md:flex">
                <ViewToggle view={view} onView={setViewPersist} variant="segmented" />
                <SortDrawer
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={setSort}
                  variant="outline"
                />
                <div className="lg:hidden">
                  <FilterDrawer
                    variant="outline"
                    parks={pulses}
                    categories={categoryOptions}
                    activeCount={chips.length}
                  />
                </div>
              </div>
            </div>

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
                <EmptyTitle>No attraction fits that</EmptyTitle>
                <EmptyDescription className="max-w-md">
                  All {all.length} attractions are still here — this combination of filters just
                  doesn&rsquo;t match any of them. Loosen one, or start over.
                </EmptyDescription>
                <Button size="sm" className="mt-2" onClick={() => setFilter(EMPTY_RIDE_FILTER)}>
                  Clear all
                </Button>
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
              />
            )}
          </div>
        </div>
      </div>

      {/* Mobile controls — left-anchored stacked pills, matching the map's
          bottom-left Filter button exactly. The rail has nowhere to go on a
          phone, so it stays these (§2.3). The list/tiles toggle mirrors them
          on the right. */}
      {!isLoading && results.length > 0 && (
        <>
          <div
            className={MAP_FILTER_STACK}
            style={{ bottom: "calc(var(--safe-bottom) + var(--bottom-nav-height) + 1.4rem)" }}
          >
            <SortDrawer sortKey={sortKey} sortDir={sortDir} onSort={setSort} variant="pill" />
            <FilterDrawer
              variant="pill"
              parks={pulses}
              categories={categoryOptions}
              activeCount={chips.length}
            />
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
