import * as React from "react";
import { SearchIcon } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { cn } from "#/lib/utils.ts";

export type SegPos = "first" | "middle" | "last";

/**
 * Popover styling for the search-bar segments — overrides the default soft
 * `shadow-lg`/ring with the same hard 3D bottom shadow + `--btn-3d` border the
 * bar's buttons use, so the open popover reads as part of the same surface.
 */
export const coreSearchPopoverClass =
  "border border-(--btn-3d) shadow-[0_3px_0_0_var(--btn-3d)] ring-0 [--btn-3d:color-mix(in_oklch,var(--border),black_12%)] dark:border-border dark:shadow-none";

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
    "group relative top-0 flex min-w-0 flex-col justify-center gap-0.5 border border-(--btn-3d) bg-background px-5 py-2.5 text-left align-top text-sm whitespace-nowrap outline-none transition-[box-shadow,top,background-color,border-color,color] duration-150 ease-out dark:border-border",
    "[--btn-3d:color-mix(in_oklch,var(--border),black_12%)] [--btn-glare:oklch(1_0_0/0.55)] [--btn-glare-hover:oklch(1_0_0/0.8)]",
    "dark:bg-input/30 dark:[--btn-3d:transparent] dark:[--btn-glare:oklch(1_0_0/0.08)] dark:[--btn-glare-hover:oklch(1_0_0/0.16)]",
    "shadow-[0_3px_0_0_var(--btn-3d),inset_0_1px_0_0_var(--btn-glare)]",
    "hover:-top-px hover:z-10 hover:bg-muted hover:shadow-[0_4px_0_0_var(--btn-3d),inset_0_1px_0_0_var(--btn-glare-hover)]",
    "focus-visible:border-ring focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/30",
    "-ml-px first:ml-0",
    pos === "first" && "rounded-l-full pl-7",
    pos === "last" && "rounded-r-full pr-7",
    active &&
      "top-[3px] z-10 bg-primary text-primary-foreground [--btn-3d:color-mix(in_oklch,var(--primary),black_32%)] [--btn-glare:color-mix(in_oklch,var(--primary),black_32%)] shadow-[0_0_0_0_var(--btn-3d),inset_0_1px_0_0_var(--btn-glare)] hover:top-[3px] hover:bg-primary hover:shadow-[0_0_0_0_var(--btn-3d),inset_0_1px_0_0_var(--btn-glare)]",
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
