"use client";

import type { ReactNode } from "react";

import { cn } from "#/lib/utils.ts";

/**
 * A park-page band's header (Direction A): a yellow-dotted kicker naming the
 * band's *time horizon* — now, next, ahead, know — over the band's own
 * headline, with room on the right for the band's controls.
 *
 * The kicker is what carries the page's organising idea: the page reads top to
 * bottom as this minute → the rest of today → which day to come instead →
 * everything that is reference. Without it the bands are just a stack of
 * headings and the order looks arbitrary.
 */
export function BandHeading({
  kicker,
  title,
  meta,
  controls,
  tone = "default",
  className,
}: {
  kicker: string;
  title: string;
  /** Right-hand prose line — a count, a caveat. Drops below `md`. */
  meta?: ReactNode;
  /** Right-hand controls (a segmented control, a key). Stays at every width. */
  controls?: ReactNode;
  /** `invert` for a band on its own dark field (the event band). */
  tone?: "default" | "invert";
  className?: string;
}) {
  const invert = tone === "invert";
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <span
          className={cn(
            "inline-flex items-center gap-2 text-[11px] font-extrabold tracking-[0.14em] uppercase",
            invert ? "text-white/80" : "text-wash-fg",
          )}
        >
          <span className="size-[7px] rounded-full bg-brand-yellow" />
          {kicker}
        </span>
        <h2
          className={cn(
            "mt-1.5 text-[22px] font-extrabold tracking-[-0.015em] text-balance md:text-[26px]",
            invert && "text-white drop-shadow-sm",
          )}
        >
          {title}
        </h2>
      </div>
      {controls}
      {meta && !controls && (
        <span
          className={cn(
            "hidden text-[13px] md:block",
            invert ? "text-white/75" : "text-muted-foreground",
          )}
        >
          {meta}
        </span>
      )}
    </div>
  );
}

/** A band: its heading and its content, spaced as one block. `id` makes it a
 *  scroll target — the ride page's "Wait history" key jumps to its Know band. */
export function Band({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={cn("flex flex-col gap-4", className)}>
      {children}
    </section>
  );
}
