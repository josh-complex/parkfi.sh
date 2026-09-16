import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

import { Image } from "#/components/ui/image.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { cn } from "#/lib/utils.ts";

import type { ParkPulse } from "./waits-data.ts";

/**
 * The hour-over-hour arrow on a park card and on a mover row. Down is good
 * here (queues falling), so it's green; a park that hasn't moved says so in
 * words rather than showing a flat arrow nobody can read.
 *
 * The number carries its own `m`: an arrow and a bare "3" beside a "25 min"
 * pill reads as a position, a rank, anything but minutes.
 *
 * `onArt` is the park card's palette — the card is a photo under a dark scrim
 * at every theme, so the arrow takes the light-on-dark greens and reds there
 * rather than the theme-aware pair the mover rows want.
 *
 * `verbose` is for a row with width to spend: the same figure said in words
 * ("dropped 45 min") from `xl`, the shorthand below it. Both are rendered and
 * one is shown, so the switch costs no JavaScript and no layout measurement;
 * the arrow and both spans are hidden from assistive tech and the wrapper
 * carries the whole phrase once, so the row is announced a single way at every
 * width.
 */
export function Delta({
  value,
  className,
  onArt,
  verbose,
}: {
  value: number;
  className?: string;
  onArt?: boolean;
  verbose?: boolean;
}) {
  if (value === 0) return <span className={cn("font-semibold opacity-70", className)}>steady</span>;
  const Icon = value < 0 ? ArrowDownIcon : ArrowUpIcon;
  const word = value < 0 ? "dropped" : "climbed";
  return (
    <span
      aria-label={verbose ? `${word} ${Math.abs(value)} minutes` : undefined}
      className={cn(
        "inline-flex items-center gap-0.5 font-bold tabular-nums",
        verbose && "xl:gap-1",
        value < 0
          ? onArt
            ? "text-emerald-300"
            : "text-emerald-700 dark:text-emerald-400"
          : onArt
            ? "text-red-300"
            : "text-red-700 dark:text-red-400",
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {verbose ? (
        <>
          <span aria-hidden className="xl:hidden">
            {Math.abs(value)}m
          </span>
          <span aria-hidden className="hidden xl:inline">
            {word} {Math.abs(value)} min
          </span>
        </>
      ) : (
        `${Math.abs(value)}m`
      )}
    </span>
  );
}

/**
 * How many card-shaped blanks the strip holds while `allRides` resolves. Ten,
 * the resort's park count: the columns are `1fr`, so a short ghost row would
 * lay the blanks out wider than the cards that replace them and the whole band
 * would re-flow under the reader at the moment the data lands.
 */
const GHOST_CARDS = 10;
/** The card's fixed height, and the CF box width its art asks for. */
const CARD_HEIGHT = 94;
const ART_BOX_WIDTH = 200;

/**
 * One park card: the park's own hero photo, full-bleed under a scrim, with the
 * name on top of it and the live pulse across the bottom. The art *is* the
 * card — a photo band with a solid body below read as two objects stacked, and
 * cost the strip 20px of height it didn't have to spend.
 */
function ParkCard({
  park,
  on,
  onToggle,
}: {
  park: ParkPulse;
  on: boolean;
  onToggle: (slug: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={park.name}
      onClick={() => onToggle(park.slug)}
      style={{ height: CARD_HEIGHT }}
      className={cn(
        "border-3d shadow-3d relative top-0 flex w-full min-w-0 shrink-0 flex-col overflow-hidden rounded-[18px] bg-neutral-800 p-2.5 text-left text-white transition-[box-shadow,top,border-color] duration-150 ease-out",
        // A key rises off its shelf on hover and sinks into it when pressed —
        // the same `top` + shelf pair `buttonVariants` uses. Swapping only the
        // shadow made the card look like it grew *downward* on hover, which is
        // the opposite of what a raised key does.
        "not-aria-pressed:hover:-top-px not-aria-pressed:hover:shadow-3d-hover",
        "aria-pressed:top-[3px] aria-pressed:shadow-3d-active aria-pressed:[--btn-glare:var(--btn-3d)]",
        // Selected keeps its blue ledge — that one is the state, and it should
        // read as a key pressed into the page.
        //
        // Unselected is the chrome's ghost key — the faint light rim and the
        // shallow shelf under it, both out of `btn-3d-ghost`'s one variable.
        // (`btn-3d-outline` would mix that from `--border`, a pale plank under
        // every card on navy; a dark ledge instead only made a second dark edge
        // against a dark field. Neither is what this wanted.) Same for the pick
        // posters.
        on ? "btn-3d-primary" : "btn-3d-ghost",
        // A shut park still gets a card — a strip whose width changes with the
        // day's hours is worse than a quiet one (open question 4).
        park.closed && !on && "opacity-75",
      )}
    >
      {park.imageUrl && (
        <Image
          src={park.imageUrl}
          alt=""
          boxWidth={ART_BOX_WIDTH}
          aspect={ART_BOX_WIDTH / CARD_HEIGHT}
          placeholder={park.imageThumbhash}
          className={cn(
            "absolute inset-0 size-full object-cover",
            park.closed && "grayscale-[0.65]",
          )}
        />
      )}
      {/* Two layers, both needed: the gradient keeps the type legible over a
          bright sky, and the selected tint is what a pressed card *is* now that
          the whole face is a photograph. */}
      <span
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/50 to-black/40"
      />
      {on && <span aria-hidden className="absolute inset-0 bg-primary/55" />}

      <span className="relative truncate text-[12.5px] font-bold [text-shadow:0_1px_3px_rgb(0_0_0_/_0.75)]">
        {park.name}
      </span>
      <span className="relative mt-auto flex flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-1.5">
          {park.closed ? (
            <span className="text-[19px] leading-none font-extrabold">Closed</span>
          ) : park.avg == null ? (
            // Open with no average to show. Not a rare edge: it is every
            // Horror Nights night (the houses run, and they are kept out of the
            // average on purpose), the first stretch of any hard-ticket evening
            // or early entry, and any park whose queues haven't started posting
            // yet. "Open" is the honest headline there — an em dash where a
            // number goes reads as a park we've lost track of.
            <span className="text-[19px] leading-none font-extrabold">Open</span>
          ) : (
            <span className="flex items-baseline gap-1 text-[21px] leading-none font-extrabold tabular-nums">
              <span>
                {park.avg}
                {/* The unit rides on the number: a bare "15" beside a faint
                    "avg" reads as a count of something (open rides, parks). */}
                <span className="text-[14px]">m</span>
              </span>
              <span className="text-[10.5px] font-semibold opacity-80">avg</span>
            </span>
          )}
          {park.delta != null && !park.closed && (
            <Delta value={park.delta} onArt className="text-[11px]" />
          )}
        </span>
        {/* "0 open" under "Closed" is just the same fact twice; under "Open" it
            is a contradiction. An open park with nothing posting says so. */}
        <span className="truncate text-[11px] font-semibold opacity-85">
          {park.open > 0 ? `${park.open} open` : park.closed ? "closed today" : "no waits yet"}
        </span>
      </span>
    </button>
  );
}

/**
 * The band's park row: one card per park, each one a park's live pulse *and*
 * the board's park filter. Pressing a card never navigates (§2) — the park
 * detail pages own the per-park story; this strip only narrows the board
 * underneath.
 *
 * It sits *inside* the dark band, at the top of it: the cards are the thing
 * that chooses what the panel below is about, so the choice and its answer read
 * as one object. (They used to sit above the band on the page background, which
 * made the parks look like page furniture and the band like an unrelated
 * advert.) Everything here is therefore drawn for a dark field at both themes —
 * see the ledge note on the card.
 *
 * The layout is one grid at three sizes, never a fixed track against a flexible
 * container: a phone scrolls a two-row band of 164px cards (bleeding to the
 * screen edge, so a partial card advertises the scroll the way `ChipRail` and
 * the shelves do), and from `md` up the columns become `1fr` and the band ends
 * exactly where the page does — two rows, or one once ten of them still clear
 * the width a park name needs.
 */
export function ParkStrip({
  parks,
  selected,
  onToggle,
  loading,
}: {
  parks: ReadonlyArray<ParkPulse>;
  selected: ReadonlySet<string>;
  onToggle: (slug: string) => void;
  loading?: boolean;
}) {
  // Two rows rather than one on anything but a wide desktop: a phone shows four
  // or five parks in the space one row gave it two, and ten cards in a single
  // line meant scrolling past most of the resort to reach Epic Universe.
  //
  // The `-my-1 py-1` gives the cards' 3D shelf (and its 4px hover rise, and the
  // 3px sink when pressed) room inside the scroll box: vertical overflow is
  // clipped in a horizontal scroller, and a card whose shelf is sliced off
  // reads as a rendering bug.
  const shell = cn(
    "-mx-4 -my-1 grid auto-cols-[164px] grid-flow-col grid-rows-2 gap-2.5 overflow-x-auto px-4 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
    // From `md` the columns are `1fr` instead of a fixed 164px, so the row
    // ends exactly where the column does: the fixed track either overran the
    // container (a card sliced off against a hidden scrollbar, no affordance
    // that anything was there) or fell short of it (a band of dead space on
    // the right). A fr track can do neither.
    "md:mx-0 md:auto-cols-fr md:overflow-x-visible md:px-0",
    // One row once ten cards can still hold the 142px floor a park name needs:
    // 10 tracks + 9 gaps inside the page's 1552px of content is 146px each,
    // and the last viewport where that holds is 1560px.
    "min-[1560px]:grid-rows-1",
  );

  if (loading) {
    return (
      <div className={shell} aria-hidden>
        {Array.from({ length: GHOST_CARDS }).map((_, i) => (
          <Skeleton
            key={i}
            style={{ height: CARD_HEIGHT }}
            className="w-full min-w-0 shrink-0 rounded-[18px] bg-white/10"
          />
        ))}
      </div>
    );
  }

  return (
    <div className={shell} role="group" aria-label="Filter the board by park">
      {parks.map((p) => (
        <ParkCard key={p.slug} park={p} on={selected.has(p.slug)} onToggle={onToggle} />
      ))}
    </div>
  );
}
