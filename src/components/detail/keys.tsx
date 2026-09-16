"use client";

import type { ReactNode } from "react";

import { Button } from "#/components/ui/button.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * One day in the wash panel's punch-card week. The selected day is the yellow
 * key; the rest are white discs on the wash with a primary numeral, which is
 * how a row of seven reads as one control rather than seven buttons.
 */
export function PunchDay({
  weekday,
  day,
  count,
  selected,
  label,
  onSelect,
}: {
  /** Short weekday name above the disc ("Sun"). */
  weekday: string;
  /** Day of the month, inside the disc. */
  day: number;
  /** Small figure under the numeral — tables open that day; "—" when none. */
  count: ReactNode;
  selected: boolean;
  /** Accessible name, e.g. "Sunday, Sep 13 — 25 tables". */
  label: string;
  onSelect?: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5">
      <span className="text-[10px] font-bold text-wash-muted">{weekday}</span>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={label}
        title={label}
        onClick={onSelect}
        // Sized by the column it sits in, capped at the designed 44px: seven
        // fixed 44px discs plus their gaps are wider than a 360px phone's
        // wash panel, and they were spilling out of its right edge.
        className={cn(
          "relative top-0 flex aspect-square w-full max-w-11 flex-col items-center justify-center rounded-full leading-none transition-[box-shadow,top,background-color] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
          selected
            ? "bg-brand-yellow text-ink-on-yellow border-3d shadow-3d btn-3d-yellow"
            : "border border-wash-edge bg-background text-primary hover:-top-px",
        )}
      >
        <span className="text-[15px] font-extrabold tabular-nums">{day}</span>
        <span className="mt-0.5 text-[9px] font-bold tabular-nums">{count}</span>
      </button>
    </div>
  );
}

/**
 * A bookable time. A link when we have somewhere to send the guest, an inert
 * key when we don't — same chrome either way, because the row reads as one
 * block of availability.
 */
export function TimeKey({ label, href }: { label: string; href?: string | null }) {
  const className = "rounded-xl px-3 py-2 h-auto text-sm font-bold tabular-nums";
  return href ? (
    <Button className={className} render={<a href={href} target="_blank" rel="noreferrer" />}>
      {label}
    </Button>
  ) : (
    <span
      className={cn(
        className,
        "inline-flex items-center border-3d shadow-3d btn-3d-primary bg-primary text-primary-foreground",
      )}
    >
      {label}
    </span>
  );
}

/** The "+N more" fold at the end of a time row — dashed, so it doesn't read as
 *  another bookable time. */
export function MoreKey({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-dashed border-primary/50 px-3 py-2 text-sm font-bold text-primary transition-colors hover:bg-primary/10"
    >
      {children}
    </button>
  );
}
