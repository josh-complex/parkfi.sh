import * as React from "react";
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
  "border-3d shadow-[0_3px_0_0_var(--btn-3d)] ring-0 btn-3d-outline dark:border-border dark:shadow-none";

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
      if (target?.closest?.('[data-slot="popover-content"]')) return;
      closeRef.current();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open]);
}

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
    "group relative top-0 flex min-w-0 flex-col justify-center gap-0.5 border-3d shadow-3d bg-background px-5 py-2.5 text-left align-top text-sm whitespace-nowrap outline-none after:absolute after:inset-x-0 after:top-0 after:-bottom-1 after:rounded-[inherit] after:content-[''] transition-[box-shadow,top,background-color,border-color,color] duration-150 ease-out",
    "btn-3d-outline dark:border-border dark:bg-input/30",
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
      className={cn(
        "hover:bg-accent hover:text-accent-foreground flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm outline-none transition-colors",
        selected && "font-medium",
      )}
    >
      <span className="truncate">{label}</span>
      {selected && <CheckIcon className="size-4 shrink-0" />}
    </button>
  );
}

/**
 * One core-search field: a toggle-styled trigger that opens its children in a
 * popover, styled to read as part of the same bar surface.
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
