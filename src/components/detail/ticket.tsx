"use client";

import * as React from "react";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "#/lib/utils.ts";

/** The notch radius, in px. Shared by the mask and the dashed cut line's inset. */
const NOTCH = 14;

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
          // Lighter at the top, flat brand yellow from the crease down — the
          // two halves' gradients, as one fill, so there is no join to show.
          backgroundImage:
            "linear-gradient(to bottom, var(--ticket-top), var(--brand-yellow) var(--ticket-crease))",
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
          {/* Never a fixed three columns: two facts in a three-column grid leave
              a visibly empty third of the stub, and each cell has to be wide
              enough for its value to wrap to two lines at most. */}
          <div
            className={cn(
              "grid gap-x-3 gap-y-2",
              facts.length >= 3
                ? "grid-cols-3"
                : facts.length === 2
                  ? "grid-cols-2"
                  : "grid-cols-1",
            )}
          >
            {facts.map((f) => (
              <div key={f.label} className="flex min-w-0 flex-col gap-0.5" title={f.hint}>
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
