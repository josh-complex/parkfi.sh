import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckIcon, SearchIcon } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { cn } from "#/lib/utils.ts";

export type SegPos = "first" | "middle" | "last";

/**
 * Popover styling for the search-bar segments — overrides the default soft
 * `shadow-lg`/ring with the same hard 3D bottom shadow + `--btn-3d` border the
 * bar's buttons use, so the open popover reads as part of the same surface.
 */
export const coreSearchPopoverClass =
  "border-3d shadow-[0_3px_0_0_var(--btn-3d)] ring-0 btn-3d-outline dark:border-[color-mix(in_oklch,var(--border),white_25%)] dark:shadow-none";

/**
 * Close an open search popover when the page scrolls (a sticky bar would
 * otherwise leave the popover floating mid-page). Scrolls that originate inside
 * a popover's own scroll area (e.g. a long option list) are ignored.
 */
export function useCloseOnScroll(open: boolean, close: () => void) {
  const closeRef = React.useRef(close);
  closeRef.current = close;
  React.useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      const target = e.target as HTMLElement | null;
      // A scroll inside the popup itself — a long option list — isn't the page
      // moving out from under it.
      if (target?.closest?.('[data-slot="popover-content"], [data-core-search-panel]')) return;
      closeRef.current();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open]);
}

/**
 * Every cell in a core-search bar is the same width, whatever it holds — a
 * three-word park name or the word "All". Sized fields let the bar read as one
 * instrument instead of a ragged row that reflows each time a value changes,
 * and they give long values (`Universal Islands of Adventure`) real room before
 * `truncate` takes over. It steps down with the viewport so a four-field bar
 * still clears a `md` screen without forcing the page to scroll sideways.
 */
export const coreSegWidth = "w-40 lg:w-48 xl:w-52";

/**
 * Shared styling for a hero "core search" segment — the same fancy toggle-group
 * emboss our filter `ToggleGroup` uses (`src/components/ui/toggle.tsx`), scaled
 * up: a 3D bottom shadow + inset top glare, a border that tracks the shadow
 * color (`--btn-3d`), lifting on hover and sinking into a filled `primary` pill
 * while its popover is open. Segments connect into one bar via shared borders +
 * fully-rounded outer ends. Used by both the Dining and Stays search bars.
 */
export function coreSegClass(pos: SegPos, active: boolean) {
  return cn(
    "group relative top-0 flex min-w-0 flex-col justify-center gap-0.5 border-3d shadow-3d bg-background px-5 py-2.5 text-left align-top text-sm whitespace-nowrap outline-none after:absolute after:inset-x-0 after:top-0 after:-bottom-1 after:rounded-[inherit] after:content-[''] transition-[box-shadow,top,background-color,border-color,color,border-top-width,margin-top] duration-150 ease-out",
    coreSegWidth,
    "btn-3d-outline dark:border-[color-mix(in_oklch,var(--border),white_25%)] dark:bg-input/30",
    "hover:-top-px hover:z-10 hover:bg-muted hover:shadow-3d-hover",
    "focus-visible:border-ring focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/30",
    "-ml-px first:ml-0",
    pos === "first" && "rounded-l-full pl-7",
    pos === "last" && "rounded-r-full pr-7",
    active &&
      "top-[3px] z-10 bg-primary text-primary-foreground [--btn-3d:color-mix(in_oklch,var(--primary),black_32%)] [--btn-glare:color-mix(in_oklch,var(--primary),black_32%)] shadow-3d-active hover:top-[3px] hover:bg-primary hover:shadow-3d-active",
  );
}

/**
 * Two-line segment content: the field heading (always full foreground / inherits
 * the active fill's foreground) stacked over its current value, which is lighter
 * weight and dims to muted only when unset (and not active).
 */
export function SegContent({
  label,
  value,
  muted,
  active,
}: {
  label: string;
  value: string;
  muted: boolean;
  active: boolean;
}) {
  return (
    <>
      <span className="text-xs font-semibold">{label}</span>
      <span className={cn("truncate font-normal", muted && !active && "text-muted-foreground")}>
        {value}
      </span>
    </>
  );
}

/** A selectable option row inside a core-search popover. */
export function CoreSearchOption({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40",
        selected && "font-medium text-primary",
      )}
    >
      <span className="truncate">{label}</span>
      {selected && <CheckIcon className="size-4 shrink-0" />}
    </button>
  );
}

/**
 * The body of a core-search panel: one scrolling column of options, with an
 * optional note at the top.
 *
 * A single list, never a grid. Options here are one short phrase each and the
 * lists run long (every cuisine, every park), and laying them into columns asks
 * the reader to work out the reading order before they can look for their
 * answer — "African" under "Seafood" beside "American" is three orderings at
 * once. A column that scrolls is the shape a list already has.
 */
export function CoreSearchPanel({
  hint,
  children,
}: {
  /** Optional note above the list — how it's ordered, what it covers. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      {hint && (
        <span className="border-b border-border/70 px-4 pt-3 pb-2.5 text-xs text-muted-foreground">
          {hint}
        </span>
      )}
      <div className="flex max-h-[min(20rem,55vh)] flex-col gap-0.5 overflow-y-auto p-1.5">
        {children}
      </div>
    </div>
  );
}

/** One field of a {@link CoreSearchBar}. */
export interface CoreField<K extends string> {
  key: K;
  /** The field heading — "Where", "Party size". */
  label: string;
  /** Its current value, shown under the heading. */
  value: string;
  /** The value is a default ("All cuisines"), so it renders muted. */
  muted?: boolean;
  /** What the panel shows while this field is open. */
  panel: React.ReactNode;
}

function segPos(index: number, count: number): SegPos {
  if (index === 0) return "first";
  return index === count - 1 ? "last" : "middle";
}

/**
 * A core-search bar: the row of fields, and **one** panel shared by all of them.
 *
 * The sharing is the point. Per-field popovers meant that moving from Cuisine
 * to Party size tore one panel down and built another somewhere else, which at
 * this size — a big pale card under a big pale bar — read as a flicker rather
 * than a move. Here the panel never unmounts while the bar is open: opening a
 * different field re-points it, and motion carries the box (and its height, as
 * a nine-item list gives way to a three-item one) across to the new field while
 * the contents cross-fade. It's one object that follows the reader along the
 * bar.
 *
 * That's also why this is hand-rolled rather than a `Popover`: a popover closes
 * on any press outside its own trigger, so a click on the *next* field would
 * unmount the panel a frame before reopening it — exactly the flicker the
 * shared panel exists to remove. Dismissal is handled here instead: a press
 * outside the whole bar, Escape (which returns focus to the open field), or a
 * scroll.
 */
export function CoreSearchBar<K extends string>({
  fields,
  open,
  onOpenChange,
  action,
  panelWidth = 288,
  className,
}: {
  fields: ReadonlyArray<CoreField<K>>;
  /** The open field, or null when the bar is at rest. */
  open: K | null;
  onOpenChange: (key: K | null) => void;
  /** Optional trailing control — the submit key. */
  action?: React.ReactNode;
  /**
   * One width for every field's panel, in px. Shared rather than per-field so
   * that moving along the bar is a slide and nothing reflows mid-animation;
   * size it to the longest list's longest label.
   */
  panelWidth?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const rowRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const segs = React.useRef(new Map<K, HTMLButtonElement>());
  const [left, setLeft] = React.useState(0);
  // Set when a field is opened from the keyboard, so focus follows into the
  // panel; a mouse opens it without moving focus off the bar.
  const [pullFocus, setPullFocus] = React.useState(false);
  const panelId = React.useId();
  const active = fields.find((f) => f.key === open) ?? null;

  const close = React.useCallback(() => onOpenChange(null), [onOpenChange]);
  useCloseOnScroll(open !== null, close);

  /**
   * Park the panel's left edge under a field, pulled back in when the last
   * field would hang it off the end of the bar. Measured from the live DOM
   * rather than tracked in state: the fields are `coreSegWidth`, which steps
   * down at two breakpoints, so their offsets are a function of the viewport.
   */
  const positionUnder = React.useCallback(
    (seg: HTMLButtonElement | undefined) => {
      const row = rowRef.current;
      if (!seg || !row) return;
      const max = Math.max(0, row.offsetWidth - panelWidth);
      setLeft(Math.min(Math.max(seg.offsetLeft, 0), max));
    },
    [panelWidth],
  );

  // Re-park on resize. Opening is handled at the click instead (see the button
  // below): measuring in an effect would mount the panel at the *previous*
  // field's offset and then animate it across, so the first open of the day
  // would fly in from wherever the bar was last used.
  React.useEffect(() => {
    if (open === null) return;
    const onResize = () => positionUnder(segs.current.get(open));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, positionUnder]);

  React.useEffect(() => {
    if (open === null || !pullFocus) return;
    setPullFocus(false);
    panelRef.current?.querySelector<HTMLElement>("button, [href], [tabindex]")?.focus();
  }, [open, pullFocus]);

  React.useEffect(() => {
    if (open === null) return;
    // Capture phase, so a press lands here before anything inside the page can
    // swallow it — but only presses genuinely outside the bar *and* its panel
    // close it. A press on another field is inside, which is what lets the
    // panel slide instead of closing and reopening.
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      segs.current.get(open)?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  const slide = reduce
    ? { duration: 0 }
    : ({ type: "spring", stiffness: 520, damping: 44, mass: 0.7 } as const);

  return (
    <div ref={wrapRef} className={cn("relative mx-auto flex w-fit items-stretch gap-2", className)}>
      <div ref={rowRef} className="flex">
        {fields.map((field, i) => {
          const isOpen = field.key === open;
          return (
            <button
              key={field.key}
              ref={(el) => {
                if (el) segs.current.set(field.key, el);
                else segs.current.delete(field.key);
              }}
              type="button"
              aria-haspopup="true"
              aria-expanded={isOpen}
              aria-controls={isOpen ? panelId : undefined}
              onClick={(e) => {
                // Park the panel before the state change that mounts (or
                // moves) it, so both land in one commit and it never animates
                // from a stale position. `detail === 0` means Enter or Space
                // rather than a pointer — the one case where focus should
                // follow into the panel, since the panel sits after the whole
                // row in the tab order.
                positionUnder(e.currentTarget);
                setPullFocus(e.detail === 0);
                onOpenChange(isOpen ? null : field.key);
              }}
              className={coreSegClass(segPos(i, fields.length), isOpen)}
            >
              <SegContent
                label={field.label}
                value={field.value}
                muted={!!field.muted}
                active={isOpen}
              />
            </button>
          );
        })}
      </div>

      {action}

      <AnimatePresence initial={false}>
        {active && (
          <motion.div
            key="core-search-panel"
            ref={panelRef}
            id={panelId}
            role="group"
            aria-label={active.label}
            data-core-search-panel=""
            // `layout` rather than an animated `x`: the panel's position comes
            // from `left` and its height from its contents, and a layout
            // animation is the one thing that can carry both at once. Animating
            // a transform instead would slide the box while its height jumped.
            layout
            style={{ left, width: panelWidth }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ layout: slide, opacity: { duration: reduce ? 0 : 0.12 } }}
            className={cn(
              "absolute top-full z-30 mt-2.5 overflow-hidden rounded-3xl bg-popover text-popover-foreground",
              coreSearchPopoverClass,
            )}
          >
            {/* `popLayout` pops the outgoing list out of flow the instant the
                new one mounts, so the panel takes the incoming height straight
                away and the `layout` animation above has something to travel
                to. `layout="position"` keeps the list from stretching while
                that height animates. */}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={active.key}
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.14 }}
              >
                {active.panel}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * One core-search field as a self-contained popover — the original shape, still
 * used where a bar's fields open unlike things (the ticket calendar's picker).
 * A bar whose fields are all option lists wants {@link CoreSearchBar} instead,
 * so the panel is shared and moves between them.
 */
export function CoreSearchSegment({
  pos,
  label,
  value,
  muted,
  open,
  onOpenChange,
  align = "start",
  contentClassName,
  children,
}: {
  pos: SegPos;
  label: string;
  value: string;
  muted: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  align?: "start" | "center" | "end";
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <button type="button" className={coreSegClass(pos, open)}>
            <SegContent label={label} value={value} muted={muted} active={open} />
          </button>
        }
      />
      <PopoverContent
        align={align}
        className={cn(
          "max-h-80 w-64 overflow-y-auto p-1.5",
          coreSearchPopoverClass,
          contentClassName,
        )}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The circular submit button that sits beside the search bar. Stretches to the
 * bar's height (via the parent's `items-stretch`) and stays a perfect circle.
 */
export function CoreSearchButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="self-stretch">
      <Button
        type="button"
        size="icon"
        onClick={onClick}
        aria-label="Search"
        className="aspect-square h-full w-auto rounded-full border-(--btn-3d) [--btn-glare:transparent]"
      >
        <SearchIcon className="size-5" />
      </Button>
    </div>
  );
}
