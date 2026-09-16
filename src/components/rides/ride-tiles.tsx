import * as React from "react";
import { Link } from "@tanstack/react-router";

import { WaitBadge } from "#/components/rides/wait-badge.tsx";
import { Image, useCfImages, useDataSaver } from "#/components/ui/image.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { RailCard, RailCardBody, RailCardMedia, RailCardTitle } from "#/components/ui/rail.tsx";
import {
  useElementWidth,
  useRowHeight,
  useViewportWidth,
  useWindowList,
} from "#/components/ui/window-list.tsx";
import { preloadImage } from "#/lib/image-preload.ts";
import { disneyResizeUrl, HERO_IMAGE, resolveImageUrls } from "#/lib/image.ts";
import { formatParkName } from "#/lib/parks.ts";

import type { LaterWindow, Ride } from "./waits-data.ts";
import { formatLaterWindow } from "./waits-data.ts";

/**
 * The tiles' own art box, taller than the 3:2 every shelf card in the app wears.
 *
 * A shelf card is one item in a row you scan past; a tile is the board's whole
 * answer, sitting in a grid of its peers with nothing else competing for the
 * column. Square art gives the photograph roughly a third more height at the
 * same width, which is what a page of them needed to stop reading as a table
 * with pictures glued on. Deliberately *not* a change to `RAIL_MEDIA_ASPECT` —
 * that number is shared by every rail in the app and a taller shelf card would
 * push every shelf's text down the page.
 */
const TILE_MEDIA_ASPECT = "aspect-square";
const TILE_MEDIA_RATIO = 1;

/**
 * How the tile grid steps up — by the width of the *grid*, not of the window.
 *
 * Container queries rather than breakpoints because the grid no longer owns the
 * page: with the map open it runs in a column a little over half the width, and
 * a `xl:grid-cols-4` there lays out four 180px cards beside a map. The
 * container-query classes and `TILE_COLUMNS` below must say the same thing —
 * the windowed grid sets its own `grid-template-columns` from the numbers, and
 * these classes carry the skeleton and the pre-hydration render.
 */
export const TILE_GRID =
  "grid grid-cols-2 gap-x-4 gap-y-7 @[36rem]:grid-cols-3 @[58rem]:grid-cols-4 @[76rem]:grid-cols-5";

/** `TILE_GRID`'s steps as numbers, in px, widest first. */
const TILE_COLUMNS: ReadonlyArray<{ min: number; cols: number }> = [
  { min: 1216, cols: 5 }, // @76rem
  { min: 928, cols: 4 }, //  @58rem
  { min: 576, cols: 3 }, //  @36rem
  { min: 0, cols: 2 },
];

/** `gap-x-4` / `gap-y-7`, in px. The row gap has to live inside each row's
 *  height, not between rows — the window positions rows absolutely. */
const TILE_GAP_X = 16;
const TILE_GAP_Y = 28;

/** Title line + meta line + the card's own `gap-2`, under art of a known ratio. */
const TILE_BODY_HEIGHT = 46;

/** The column count for a grid this wide. Falls back to the narrowest step
 *  before the grid has been measured, which is also what SSR renders. */
function tileColumns(gridWidth: number): number {
  return (TILE_COLUMNS.find((b) => gridWidth >= b.min) ?? TILE_COLUMNS.at(-1)!).cols;
}

function RideTile({
  ride,
  later,
  eager,
}: {
  ride: Ride;
  later: LaterWindow | null;
  eager?: boolean;
}) {
  const cf = useCfImages();
  const dataSaver = useDataSaver();
  // On intent (hover / focus / touch), warm the ride's detail-page hero at low
  // priority so tapping through shows it instantly. Resolves the exact URL
  // ride-detail's <Image> will request (same HERO_IMAGE transform, same
  // dataSaver state) so it's a cache hit, not a wasted second fetch.
  const warmHero = () => {
    if (!ride.imageHeroUrl) return;
    const heroSrc = disneyResizeUrl(ride.imageHeroUrl, HERO_IMAGE.resizeWidth);
    const { src, srcSet } = resolveImageUrls(heroSrc, {
      cf,
      sizes: HERO_IMAGE.sizes,
      widths: HERO_IMAGE.widths,
      quality: HERO_IMAGE.quality,
      dataSaver,
    });
    preloadImage(src, { srcSet, sizes: HERO_IMAGE.sizes });
  };
  const laterLine = formatLaterWindow(ride.standbyWait, later);
  return (
    <Link
      to="/park/$slug/ride/$rideSlug"
      params={{ slug: ride.parkSlug, rideSlug: ride.slug }}
      onPointerEnter={warmHero}
      onFocus={warmHero}
      className="block"
    >
      <RailCard>
        <RailCardMedia className={TILE_MEDIA_ASPECT}>
          {ride.imageCardUrl ? (
            <Image
              src={ride.imageCardUrl}
              alt={ride.imageAlt ?? ride.name}
              loading={eager ? "eager" : "lazy"}
              aspect={TILE_MEDIA_RATIO}
              placeholder={ride.imageThumbhash}
              className="size-full object-cover group-hover:scale-105"
            />
          ) : null}
          <WaitBadge ride={ride} className="absolute top-2 left-2" />
        </RailCardMedia>
        <RailCardBody>
          <RailCardTitle>{ride.name}</RailCardTitle>
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[11px] font-bold tracking-[0.04em] text-wash-muted uppercase">
              {formatParkName(ride.parkName)}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {laterLine ?? ride.land ?? ""}
            </span>
          </span>
        </RailCardBody>
      </RailCard>
    </Link>
  );
}

/** A tile-shaped blank — used for the grid's loading state and its windowing. */
function TileGhost() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className={`${TILE_MEDIA_ASPECT} w-full rounded-2xl`} />
      <Skeleton className="h-4 w-3/4 rounded-md" />
      <Skeleton className="h-3 w-1/2 rounded-md" />
    </div>
  );
}

/** The grid's loading state: one screenful of tile-shaped blanks. */
export function RideTilesSkeleton({ count = 20 }: { count?: number }) {
  return (
    <div className="@container" aria-hidden>
      <div className={TILE_GRID}>
        {Array.from({ length: count }).map((_, i) => (
          <TileGhost key={i} />
        ))}
      </div>
    </div>
  );
}

/**
 * The tiles view: one responsive grid of the whole filtered board.
 *
 * Not a shelf per park (deviation D1) — once the strip owns the park dimension,
 * a rail *per* park has nothing left to group.
 *
 * Windowed at every width. Two hundred-odd tiles is two hundred-odd decoded
 * card images if they all stay mounted, which is what a mount-and-keep scheme
 * (the old `LazyMount` chunks) ends up doing — its idle queue reveals the whole
 * tail whether or not anyone scrolls there. The window mounts a grid row
 * only while it is near the viewport and unmounts it after, so the page holds a
 * screenful of images however far you scroll.
 *
 * Every row is the same height — art of a fixed ratio under a one-line title —
 * so one row is measured and that number stands for all of them (`useRowHeight`
 * explains why per-row measurement is the wrong tool here). The exception to
 * the windowing is the hydration render, which still emits every tile so the
 * SSR'd markup, and the crawler reading it, keeps all 200 attraction links; the
 * window takes over one layout effect later, before any off-screen image has
 * been fetched.
 */
export function RideTiles({
  rides,
  laterById,
}: {
  rides: ReadonlyArray<Ride>;
  /** ride id → its best remaining window today; empty until W5's rollup lands. */
  laterById?: ReadonlyMap<number, LaterWindow>;
}) {
  // The grid's own width decides the column count, not the window's: with the
  // map pane open this grid is a little over half the page. It falls back to
  // the viewport for the first frame, before the element has been measured —
  // which is the same number it used to run on.
  const viewport = useViewportWidth();
  const width = React.useRef<HTMLElement | null>(null);
  const gridWidth = useElementWidth(width);
  const cols = tileColumns(gridWidth > 0 ? gridWidth : viewport);
  const rowCount = Math.ceil(rides.length / cols);

  const cardWidth = gridWidth > 0 ? (gridWidth - TILE_GAP_X * (cols - 1)) / cols : 0;
  // The opening guess, good to a few px: art of a known ratio at the width the
  // grid actually gives a card, plus the two text lines and the row gap. A real
  // row replaces it as soon as one mounts.
  const guess =
    (cardWidth > 0 ? cardWidth / TILE_MEDIA_RATIO : 150) + TILE_BODY_HEIGHT + TILE_GAP_Y;
  const [rowHeight, measureRow] = useRowHeight(guess);

  const { ref, start, end, totalSize, ready } = useWindowList({
    count: rowCount,
    rowHeight,
    // Three rows ahead, so a row is in the DOM — and its images are fetching —
    // well before it is scrolled to.
    overscan: 3,
  });
  // One element measured two ways: the window needs its position on screen,
  // the row height needs its width.
  const setRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      ref.current = el;
      width.current = el;
    },
    [ref],
  );

  const tile = (ride: Ride, eager: boolean) => (
    <RideTile key={ride.id} ride={ride} later={laterById?.get(ride.id) ?? null} eager={eager} />
  );

  if (!ready) {
    // The hydration / no-JS render: plain CSS grid, its columns read off the
    // container it sits in rather than off the window.
    return (
      <div ref={setRef} className="@container w-full">
        <div className={TILE_GRID}>{rides.map((r, i) => tile(r, i < 5))}</div>
      </div>
    );
  }

  const rows: Array<React.ReactNode> = [];
  for (let row = start; row < end; row++) {
    const from = row * cols;
    rows.push(
      <div
        key={row}
        ref={measureRow}
        className="absolute top-0 left-0 grid w-full"
        style={{
          transform: `translateY(${row * rowHeight}px)`,
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          columnGap: TILE_GAP_X,
          // The row gap lives inside the measured box, so a measured row is
          // exactly the distance to the next one.
          paddingBottom: TILE_GAP_Y,
        }}
      >
        {rides.slice(from, from + cols).map((r, i) => tile(r, from + i < 5))}
      </div>,
    );
  }

  return (
    <div ref={setRef} className="relative w-full" style={{ height: totalSize }}>
      {rows}
    </div>
  );
}
