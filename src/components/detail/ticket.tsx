"use client";

import * as React from "react";
import type { CSSProperties, ReactNode } from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "#/lib/utils.ts";

/**
 * The notch radius, in px. Shared by every die-cut — the crease's semicircles
 * and the corners' quarter circles — and by the dashed tear lines' inset,
 * which has to clear them.
 *
 * One radius for all of them because they are all the same cut: a roll ticket
 * is nicked at each end of its tear line, so the notch that lands mid-edge on
 * the fold lands on the corner point at the edges this stub was torn along.
 * That is also why the face is squared off (see the face's classes below) —
 * a quarter circle only reads as a nick against a right angle.
 */
const NOTCH = 18;

/**
 * The ticket's top-half height before it has been measured — a two-line name's
 * worth. The page's `--crease` fallback (see `DetailHero`) is the same number.
 */
export const TICKET_DEFAULT_CREASE = 104;

/**
 * Half-width of the die-cut's antialiasing band, in CSS px, as a fallback for
 * a 1× screen. A mask gradient has no antialiaser of its own — it is sampled
 * per device pixel — so the soft ramp between "hole" and "ticket" *is* the
 * cut's antialiasing, and it has to be one device pixel wide. Spelled in CSS
 * px, that's `0.5 / dpr`; left at 0.5 for SSR and corrected on mount. Too wide
 * and the ramp stops reading as an edge and starts reading as what it
 * literally is: a half-transparent yellow line traced around every cut.
 */
const NOTCH_AA = 0.5;

/**
 * Every die-cut in the stub, as one mask over the whole ticket: semicircles at
 * either side of the crease, quarter circles at the four corners, six radial
 * gradients intersected, so each one is a real hole in the element (the
 * wrapper's drop-shadows then trace the masked outline, so the shelf bends
 * around the cuts instead of running straight across them). On a phone the top
 * pair is cut over the hero photo, which shows through them.
 *
 * One masked element rather than a masked half per side of the crease: two
 * masked boxes meeting on the same line leave a hairline seam, and their two
 * half-notches meet mid-rim with a visible jog wherever that line lands on a
 * fractional device pixel. The crease rides `--ticket-crease`, which the ticket
 * measures for itself, and the ramp rides `--ticket-aa` (see `NOTCH_AA`).
 *
 * `-webkit-` twin included: Safari still needs the prefixed pair, and its
 * composite keyword is `source-in` rather than `intersect`. Order matters —
 * the unprefixed `mask` shorthand resets the prefixed composite in browsers
 * that alias the two, so the longhands come after the shorthands.
 */
const NOTCH_MASK = (() => {
  const hole = (x: string, y: string, r: number) =>
    `radial-gradient(circle at ${x} ${y}, transparent calc(${r}px - var(--ticket-aa)), #000 calc(${r}px + var(--ticket-aa)))`;
  const pair = (y: string, r: number) => [hole("0", y, r), hole("100%", y, r)];
  const mask = [
    ...pair("var(--ticket-crease)", NOTCH),
    ...pair("0", NOTCH),
    ...pair("100%", NOTCH),
  ].join(", ");
  return {
    WebkitMask: mask,
    mask,
    WebkitMaskComposite: "source-in",
    maskComposite: "intersect",
  } as CSSProperties;
})();

/**
 * A tear line: a dashed rule running between the two die-cuts that mark its
 * ends, held clear of them by the notch radius. Positioned by the caller — the
 * crease straddles the boundary between the stub's two halves, and the edge
 * perforations run on the edges themselves, which is where the corner cuts are
 * centred and so where the tear went.
 */
const PERF = "pointer-events-none absolute inset-x-5 border-t-2 border-dashed";

export interface TicketFact {
  label: string;
  /** Never empty — a page with fewer than three real facts fills the cell with
   *  its most useful stable metadata instead (see the plan's §4.9). */
  value: ReactNode;
  /**
   * The unabridged version of a value the cell had to compact ("$$ ($15 to
   * $34.99 per adult)" behind "$15–$35"). A third of a phone-width ticket is
   * about eleven characters wide — anything longer wraps to four lines and
   * pushes the ticket's whole bottom half out of shape — so the long form
   * lives in the tooltip instead of the cell.
   */
  hint?: string;
}

/**
 * How much of the facts row's leftover width a fact earns.
 *
 * Flexbox shares free space by `flex-grow`, and an equal share is the wrong
 * answer here: "Avg wait · 20 min" is finished at sixty pixels while "Longest ·
 * 60 · Buzz Lightyear's Space Ranger Spin" is still hyphenating itself down
 * four lines beside it. Weighting by the value's own length hands the room to
 * whichever fact is actually using it, without the ticket needing to know which
 * page it is on or which of its three cells is the verbose one.
 *
 * Quarter-of-a-character granularity, floored at 1: the point is a coarse
 * ordering ("this one is roughly three times the other"), not a second layout
 * engine running beside the real one.
 *
 * A non-string value (a node carrying a chip) falls back to the minimum —
 * there is nothing to measure, and guessing wide would starve the cells either
 * side to feed a cell that may not need it.
 */
function factWeight(f: TicketFact): number {
  const text = typeof f.value === "string" || typeof f.value === "number" ? String(f.value) : "";
  return Math.max(1, Math.round(text.length / 4));
}

/**
 * The detail-page identity block: a die-cut ticket stub on brand yellow,
 * overlapping the hero's torn bottom edge. It carries the name, one line of
 * place, and exactly three facts — plus an optional row of chips and keys.
 *
 * Its ink is `--ink-on-yellow` in **both** themes: the stub is yellow in dark
 * mode too, so theme-swapping the text would put white on yellow.
 *
 * `heroKey` tags the title as the map-card flight's landing pad
 * (`card-flight.ts` looks outside the hero for it when the hero renders no
 * title of its own), and `titleHidden` is the flight's "hold this transparent
 * but laid out" style while its clones are still in the air.
 */
export function Ticket({
  title,
  subtitle,
  facts,
  chips,
  keys,
  footer,
  heroKey,
  titleHidden,
  onCreaseHeight,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  facts: Array<TicketFact>;
  /** Row of `TicketChip`s under the facts — cap at 4 plus a "+N". */
  chips?: ReactNode;
  /** Keys under the chips (Call, Official site…). */
  keys?: ReactNode;
  /**
   * A block on the stub's lower half, under the facts and keys, separated by a
   * hairline — the park page's showtimes list. It rides *inside* the ticket
   * rather than in a card below it because "what starts next" is the same kind
   * of fact as "what is the longest wait": a reading of this park, right now.
   */
  footer?: ReactNode;
  heroKey?: string;
  titleHidden?: CSSProperties;
  /**
   * Reports the top half's height whenever it changes. The phone layout hangs
   * the ticket's crease exactly on the hero's bottom edge, which means pulling
   * the stub up by this much — and it isn't a constant: the title wraps to one,
   * two or three lines depending on the venue's name. Reported unrounded: the
   * page pulls the stub up by this and the hero grows by it, so any rounding
   * here lands the crease a fraction of a pixel off the photo's edge, and that
   * fraction shows as a hairline through the notches.
   */
  onCreaseHeight?: (height: number) => void;
  className?: string;
}) {
  const topRef = React.useRef<HTMLDivElement>(null);
  // The crease's own position, for the notch mask and the face's gradient. Kept
  // here as well as reported up, so the ticket cuts its notches in the right
  // place on every page (the desktop layout never asks for the height).
  const [crease, setCrease] = React.useState(TICKET_DEFAULT_CREASE);
  React.useLayoutEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const report = () => {
      // Unrounded: the page pulls the stub up by this and grows the hero by it,
      // so a rounded value lands the crease a fraction of a pixel off the
      // photo's edge — and that fraction shows as a seam through the notches.
      const h = el.getBoundingClientRect().height;
      setCrease(h);
      onCreaseHeight?.(h);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onCreaseHeight]);

  // One device pixel of ramp on the die-cut, once there's a `window` to ask.
  // Not a layout effect: it changes nothing about layout, and it must not run
  // during hydration, when the markup still carries the 1x fallback.
  const [aa, setAa] = React.useState(NOTCH_AA);
  React.useEffect(() => {
    setAa(NOTCH_AA / Math.min(Math.max(window.devicePixelRatio || 1, 1), 3));
  }, []);

  return (
    <div
      // Tagged for the hero it overlaps: the gallery dots sit on that hero's
      // bottom edge and have to clear this stub's right edge (see `--dots-left`
      // in `DetailHero`).
      data-ticket
      className={cn("relative z-10 text-ink-on-yellow", className)}
      style={
        {
          "--ticket-crease": `${crease}px`,
          "--ticket-aa": `${aa}px`,
          // On the wrapper, not the masked face: a drop-shadow filter traces
          // the masked outline, so the shelf bends around the notches instead
          // of running straight across them.
          filter:
            "drop-shadow(0 3px 0 var(--ticket-shelf)) drop-shadow(0 10px 18px rgb(0 0 0 / 0.16))",
        } as CSSProperties
      }
    >
      <div
        // Square, not rounded: the corner cuts are quarter circles centred on
        // the corner points, and a radius smaller than the cut is swallowed by
        // it while a radius larger than it leaves a hooked sliver hanging over
        // the hole. A torn ticket has square corners and a nick in each anyway.
        className="flex flex-col"
        style={{
          ...NOTCH_MASK,
          // Lighter at the top, ramping to full brand yellow as it reaches the
          // crease, then a flat cream from the perforation down. One fill for
          // both halves, so there is no join to show — and the hard stop lands
          // exactly on the crease the notches are cut at, which is why the two
          // stops share `var(--ticket-crease)` rather than being nudged apart.
          backgroundImage:
            "linear-gradient(to bottom, var(--ticket-top), var(--brand-yellow) var(--ticket-crease), var(--ticket-bottom) var(--ticket-crease))",
        }}
      >
        <div
          ref={topRef}
          className="relative flex flex-col gap-1 px-5 pb-4 pt-5 md:px-6 md:pb-5 md:pt-6"
        >
          {/* The torn top edge: fainter than the crease, because it is where
              this ticket left the strip rather than the fold it is meant to be
              torn along next. */}
          <span aria-hidden className={cn(PERF, "top-0 border-ink-on-yellow/22")} />
          <p
            data-hero-title={heroKey ? "" : undefined}
            data-hero-for={heroKey}
            style={titleHidden}
            className={cn(
              "font-black leading-[1.05] tracking-[-0.02em] text-balance",
              // A long name ("Private Dining at Disney's Grand Floridian Resort
              // & Spa") takes four lines at 26px, and the phone hero grows by
              // every one of them — the stub's top half *is* the hero's extra
              // height. Two steps down keeps the worst case to three lines.
              title.length > 46
                ? "text-[20px] md:text-[26px]"
                : title.length > 28
                  ? "text-[23px] md:text-[29px]"
                  : "text-[26px] md:text-[32px]",
            )}
          >
            {title}
          </p>
          {/* Always rendered, so the block under it can't shift up when the
              subtitle lands late (the title above is a flight landing target). */}
          <p className="text-sm font-semibold leading-snug text-pretty text-ink-on-yellow/70">
            {subtitle || " "}
          </p>
        </div>
        <div className="relative flex flex-col gap-3.5 px-5 pb-[18px] pt-4 md:px-6 md:pb-[22px] md:pt-5">
          {/* The crease: a dashed rule straddling the fold (hence the -1px),
              held clear of the notches at either end. */}
          <span aria-hidden className={cn(PERF, "-top-px border-ink-on-yellow/35")} />
          {/* And the torn bottom edge, matching the top one. */}
          <span aria-hidden className={cn(PERF, "bottom-0 border-ink-on-yellow/22")} />
          {/* Content-proportional, not equal thirds. Every cell starts at its
              own content width (`basis-auto`) and then takes a share of the
              leftover weighted by how long its value is (`factWeight`), so the
              fact that needs the room gets most of it rather than a third of
              it. `flex-wrap` is the release valve when even that isn't
              enough. */}
          {/* Dropped entirely when a page has none, rather than left as an empty
              row: the pin catalog holds ten thousand pins whose only recorded
              attribute is a name, and a stub with a 14px gap where its facts
              would be reads as a stub that failed to load them. Three is still
              the target (plan §4.9) — this is the floor, not a licence. */}
          {facts.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {facts.map((f) => (
                <div
                  key={f.label}
                  style={{ flexGrow: factWeight(f) }}
                  className="flex min-w-0 shrink basis-auto flex-col gap-0.5"
                  title={f.hint}
                >
                  <span className="truncate text-[10px] font-bold uppercase tracking-[0.06em] text-ink-on-yellow/60">
                    {f.label}
                  </span>
                  <span className="text-[13px] font-bold leading-[1.25] text-balance hyphens-auto md:text-[15px]">
                    {f.value}
                  </span>
                </div>
              ))}
            </div>
          )}
          {(chips || keys) && (
            <div className="flex flex-col gap-2.5">
              {chips && <div className="flex flex-wrap gap-1.5">{chips}</div>}
              {keys}
            </div>
          )}
          {footer && (
            <div className="flex flex-col gap-3 border-t border-ink-on-yellow/12 pt-3.5">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A tag on the ticket. `accent` inverts it (ink field, yellow text) and is
 * spent on at most one chip per ticket — the freshness flag, or the ride's
 * category.
 */
export function TicketChip({
  children,
  accent = false,
  onPress,
  className,
  ...props
}: React.ComponentProps<"span"> & {
  accent?: boolean;
  /** Makes the chip a real button (the freshness chip jumps into the menu). */
  onPress?: () => void;
}) {
  const classes = cn(
    "rounded-full px-2.5 py-1 text-xs",
    accent
      ? "bg-ink-on-yellow font-bold text-brand-yellow"
      : "border border-ink-on-yellow/35 font-semibold",
    onPress && "cursor-pointer",
    className,
  );
  if (onPress) {
    return (
      <button type="button" onClick={onPress} className={classes} title={props.title}>
        {children}
      </button>
    );
  }
  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
}

const STATUS_DOT = {
  open: "bg-emerald-400",
  down: "bg-red-400",
  closed: "bg-white/50",
} as const;

/**
 * The stub's state pill — a coloured dot and a few words on the ticket's ink,
 * sitting beside the place line in every `subtitle`: "Open til 11 PM",
 * "Closed · Opens 9 AM Thu", "Temporarily down".
 *
 * Printed once rather than per page (2026-09-17, Josh): the park, ride and
 * venue stubs each carried their own copy of this class string, and it needs
 * two corrections that are easy to lose in a copy.
 *
 * Rubik splits its em 935 above the baseline and 250 below, so a line box
 * reserves ~2.8px under an 11px baseline that only a "p" ever reaches into:
 * the band the eye actually reads — cap height down to the baseline — sits
 * about 1.1px *above* the line box's geometric centre. Two things follow, and
 * both are deliberate:
 *
 * - **The padding is lopsided**, 4px over 2px rather than 3 and 3. Centring
 *   the box leaves the words riding high in the pill, which at this size reads
 *   as a misprint.
 * - **The dot is lifted a pixel** (`mb-0.5` — flexbox centres an item's
 *   *margin* box, so 2px of bottom margin raises it by 1). It is a circle, so
 *   `items-center` puts it on the geometric centre, which is exactly the line
 *   the words don't sit on. Without this it hangs visibly below them.
 *
 * **The line-height is pinned** (`text-[11px]/[15px]`) so that arithmetic
 * holds: an arbitrary `text-[Npx]` sets only the font size, so this used to
 * inherit whatever `leading-*` the subtitle above it happened to carry — the
 * pill's height, and both corrections with it, moved with its surroundings.
 */
export function TicketStatusChip({
  tone,
  children,
  className,
}: {
  tone: keyof typeof STATUS_DOT;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink-on-yellow px-2.5 pt-1 pb-0.5 text-[11px]/[15px] font-bold text-brand-yellow",
        className,
      )}
    >
      <span className={cn("mb-0.5 size-1.5 shrink-0 rounded-full", STATUS_DOT[tone])} />
      {children}
    </span>
  );
}

/**
 * One titled block on the stub's lower half — the park page's hours and
 * showtimes, the venue page's hours. A small uppercase heading in the ticket's
 * own ink, an optional right-hand count, rows, and an optional closing line.
 *
 * It exists so those lists are printed once rather than per page: three
 * components were each carrying their own copy of the stub's type scale
 * (`text-[11px] font-bold tracking-[0.06em] text-ink-on-yellow/60`) and drifting
 * from it one edit at a time.
 */
export function TicketBlock({
  title,
  meta,
  note,
  gap = "default",
  className,
  children,
}: {
  title: string;
  /** Right-hand line in the heading row — "Next 4 days", "3 still to come". */
  meta?: ReactNode;
  /** A closing line under the rows ("2 more shows later today."). */
  note?: ReactNode;
  /** `"tight"` for a column of dates, which reads as a table rather than a stack. */
  gap?: "default" | "tight";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-bold tracking-[0.06em] text-ink-on-yellow/60 uppercase">
          {title}
        </h3>
        {meta && (
          <span className="shrink-0 text-xs font-semibold text-ink-on-yellow/55">{meta}</span>
        )}
      </div>
      <div className={cn("flex flex-col", gap === "tight" ? "gap-1" : "gap-1.5")}>{children}</div>
      {note && <p className="text-xs text-ink-on-yellow/55">{note}</p>}
    </div>
  );
}

/**
 * A row inside a `TicketBlock`: a fixed lead cell (a weekday, a clock time),
 * the line itself, and an optional tail (an extra-hours time, a countdown
 * pill). The row owns the spacing and the lead's width; the caller inks its own
 * line, because a date range wants `tabular-nums` where a show's name wants a
 * clamp.
 *
 * `render` makes the row a link — a show row navigates to its ride. There is no
 * muted token to hover into on the stub (the field is the ticket's own cream),
 * so a pressable row warms with the ink it is already printed in.
 */
export function TicketRow({
  lead,
  tail,
  highlight,
  pressable,
  className,
  render,
  children,
  ...props
}: useRender.ComponentProps<"div"> & {
  lead?: ReactNode;
  tail?: ReactNode;
  /** Picks the row out of the list — today, among the days ahead. */
  highlight?: boolean;
  /** Hover ink for a row `render` has made navigable. */
  pressable?: boolean;
}) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "-mx-1 flex items-center gap-2.5 rounded-xl px-2",
          highlight && "bg-ink-on-yellow/8 py-1.5",
          pressable && "hover:bg-ink-on-yellow/6",
          className,
        ),
        children: (
          <>
            {lead != null && (
              <span
                className={cn(
                  "w-16 shrink-0 text-[13px] tabular-nums",
                  highlight ? "font-extrabold" : "font-bold text-ink-on-yellow/85",
                )}
              >
                {lead}
              </span>
            )}
            <span className="min-w-0 flex-1 text-[13px]">{children}</span>
            {tail != null && <span className="shrink-0 text-[11.5px]">{tail}</span>}
          </>
        ),
      },
      props,
    ),
    render,
  });
}
