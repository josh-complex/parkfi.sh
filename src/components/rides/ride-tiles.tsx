import * as React from "react";
import { Link } from "@tanstack/react-router";

import { WaitBadge } from "#/components/rides/wait-badge.tsx";
import { Image, useCfImages, useDataSaver } from "#/components/ui/image.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import {
  RailCard,
  RailCardBody,
  RailCardMedia,
  RailCardTitle,
  RAIL_MEDIA_ASPECT,
  RAIL_MEDIA_RATIO,
} from "#/components/ui/rail.tsx";
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

/** How the tile grid steps up — roughly the shelf's card width at each size. */
export const TILE_GRID = "grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";

/**
 * `TILE_GRID`'s column count, as a number the window can slice rides with.
 * These two must say the same thing — the windowed grid sets its own
 * `grid-template-columns` from this list so they cannot drift apart, and
 * `TILE_GRID` stays for the skeleton and the pre-hydration render.
 */
const TILE_COLUMNS: ReadonlyArray<{ min: number; cols: number }> = [
  { min: 1536, cols: 5 }, // 2xl
  { min: 1280, cols: 4 }, // xl
  { min: 768, cols: 3 }, //  md
  { min: 0, cols: 2 },
];

/** `gap-4`, in px — it has to live inside each row's height, not between rows. */
const TILE_GAP = 16;

/** Title line + meta line + the card's own `gap-2`, under art of a known ratio. */
const TILE_BODY_HEIGHT = 46;

function tileColumns(viewport: number): number {
  return (TILE_COLUMNS.find((b) => viewport >= b.min) ?? TILE_COLUMNS.at(-1)!).cols;
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
        <RailCardMedia>
          {ride.imageCardUrl ? (
            <Image
              src={ride.imageCardUrl}
              alt={ride.imageAlt ?? ride.name}
              loading={eager ? "eager" : "lazy"}
              aspect={RAIL_MEDIA_RATIO}
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
      <Skeleton className={`${RAIL_MEDIA_ASPECT} w-full rounded-2xl`} />
      <Skeleton className="h-4 w-3/4 rounded-md" />
      <Skeleton className="h-3 w-1/2 rounded-md" />
    </div>
  );
}

/** The grid's loading state: one screenful of tile-shaped blanks. */
export function RideTilesSkeleton({ count = 20 }: { count?: number }) {
  return (
    <div className={TILE_GRID} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <TileGhost key={i} />
      ))}
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
  const viewport = useViewportWidth();
  const cols = tileColumns(viewport);
  const rowCount = Math.ceil(rides.length / cols);

  const width = React.useRef<HTMLElement | null>(null);
  const gridWidth = useElementWidth(width);
  const cardWidth = gridWidth > 0 ? (gridWidth - TILE_GAP * (cols - 1)) / cols : 0;
  // The opening guess, good to a few px: art of a known ratio at the width the
  // grid actually gives a card, plus the two text lines and the row gap. A real
  // row replaces it as soon as one mounts.
  const guess = (cardWidth > 0 ? cardWidth / RAIL_MEDIA_RATIO : 150) + TILE_BODY_HEIGHT + TILE_GAP;
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
    return (
      <div ref={setRef} className={TILE_GRID}>
        {rides.map((r, i) => tile(r, i < 5))}
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
          columnGap: TILE_GAP,
          // The row gap lives inside the measured box, so a measured row is
          // exactly the distance to the next one.
          paddingBottom: TILE_GAP,
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
