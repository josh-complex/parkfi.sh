"use client";

import type { ReactNode } from "react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "#/components/ui/sheet.tsx";
import { cn } from "#/lib/utils.ts";

/** How wide the sheet opens. `full` leaves only a strip of the page behind it. */
export type SheetWidth = "default" | "wide" | "full";

/**
 * The sheet's own width, as a share of the viewport with a pixel ceiling. These
 * are deliberately generous: the surfaces that open in here are two- and
 * three-column lists (a 160-dish menu, a wait history with four charts), and a
 * narrow sheet wraps every row twice over. The inner `max()` is the floor —
 * whatever the viewport, the panel never opens narrower than two fifths of it,
 * so the pixel ceiling can't shrink into a sliver on a very wide display.
 *
 * Every entry carries `data-[side=right]:` because `ui/sheet.tsx`'s own
 * `data-[side=right]:w-3/4` and `data-[side=right]:sm:max-w-sm` are
 * variant-qualified: an unprefixed `sm:max-w-*` here lands in a different
 * tailwind-merge group, survives the merge, and then loses to the base class at
 * the same specificity — leaving the sheet stuck at 384px.
 */
const WIDTHS: Record<SheetWidth, string> = {
  default:
    "data-[side=right]:sm:w-[min(94vw,max(40vw,1120px))] data-[side=right]:sm:max-w-[min(94vw,max(40vw,1120px))]",
  wide: "data-[side=right]:sm:w-[min(96vw,max(55vw,1440px))] data-[side=right]:sm:max-w-[min(96vw,max(55vw,1440px))]",
  full: "data-[side=right]:sm:w-[calc(100vw-2rem)] data-[side=right]:sm:max-w-[calc(100vw-2rem)]",
};

/**
 * The desktop "after the click" surface — the full menu, a ride's wait history.
 * A right-hand sheet rather than a dialog, so the page stays visible behind it
 * and the reader keeps their place.
 *
 * `ui/sheet.tsx` already portals above the sticky header (`z-[60]`); this
 * widens it well past the default `sm:max-w-sm`, rounds its leading edge, and
 * animates between widths so a reader who wants more room can take it without
 * the content reflowing under a jump. Mobile keeps the bottom `Drawer` — the
 * sheet is never the phone's answer.
 */
export function RightSheet({
  open,
  onOpenChange,
  /** Read by screen readers; the visible header is part of `children`. */
  title,
  /** Likewise — and the dialog warns on every open without one. */
  description,
  width = "default",
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  width?: SheetWidth;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn(
          "data-[side=right]:w-full gap-0 rounded-l-4xl border-l-0 bg-background p-0 shadow-[-24px_0_60px_-30px_rgb(0_0_0/0.45)]",
          // Width rides the same transition the sheet already uses for its
          // entrance, so widening reads as the panel growing, not re-opening.
          "transition-[width,max-width,opacity,transform] duration-200 ease-in-out",
          WIDTHS[width],
          className,
        )}
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        {description && <SheetDescription className="sr-only">{description}</SheetDescription>}
        {children}
      </SheetContent>
    </Sheet>
  );
}
