"use client";

import * as React from "react";
import type { CSSProperties, ReactNode } from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "#/lib/utils.ts";

/** The notch radius, in px. Shared by the mask and the dashed cut line's inset. */
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
 * Die-cut semicircles at either side of the crease, as one mask over the whole
 * ticket: two radial gradients intersected, so each notch is a real hole in the
 * element (the wrapper's drop-shadows then trace the masked outline, so the
 * shelf bends around the notches instead of running straight across them).
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
  const hole = (x: string) =>
    `radial-gradient(circle at ${x} var(--ticket-crease), transparent calc(${NOTCH}px - var(--ticket-aa)), #000 calc(${NOTCH}px + var(--ticket-aa)))`;
  const mask = `${hole("0")}, ${hole("100%")}`;
  return {
    WebkitMask: mask,
    mask,
    WebkitMaskComposite: "source-in",
    maskComposite: "intersect",
  } as CSSProperties;
})();

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
        className="flex flex-col rounded-[22px] md:rounded-3xl"
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
        <div ref={topRef} className="flex flex-col gap-1 px-5 pb-4 pt-5 md:px-6 md:pb-5 md:pt-6">
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
          {/* The perforation: a dashed rule straddling the crease (hence the
              -1px), held clear of the notches at either end. */}
          <span
            aria-hidden
            className="absolute inset-x-5 -top-px border-t-2 border-dashed border-ink-on-yellow/35"
          />
          {/* Content-proportional, not equal thirds. Every cell starts at its
              own content width (`basis-auto`) and then takes a share of the
              leftover weighted by how long its value is (`factWeight`), so the
              fact that needs the room gets most of it rather than a third of
              it. `flex-wrap` is the release valve when even that isn't
              enough. */}
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
