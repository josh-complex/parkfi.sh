"use client";

import { cn } from "#/lib/utils.ts";

/**
 * The detail system's wait pill (plan §6): hot over 45 minutes, warm from 25,
 * cool at or under 24. The mid tier is **amber, not yellow** — yellow on these
 * pages means "this is the thing to press" and nothing else (deviation D2).
 *
 * Colour is never the only signal: the pill always carries the number.
 */
export function WaitPill({ minutes, className }: { minutes: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-[10px] px-2.5 py-1 text-[13px] font-extrabold tabular-nums",
        minutes > 45
          ? "bg-wait-hot text-white"
          : minutes >= 25
            ? "bg-wait-warm text-ink-on-yellow"
            : "bg-wait-cool text-white",
        className,
      )}
    >
      {minutes}
    </span>
  );
}
