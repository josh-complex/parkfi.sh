"use client";

import type { ReactNode } from "react";

import { cn } from "#/lib/utils.ts";

/**
 * The page's **job** block — the one thing a visitor came to do (book a table,
 * time a ride, see what's open now). A pale blue field with the blue moved onto
 * the pressable things inside it: no shelf and no gradient, because the panel
 * itself isn't pressable (see the plan's §2.2 and deviation D1).
 */
export function WashPanel({
  title,
  meta,
  children,
  className,
}: {
  title: string;
  /** Right-hand line in the header row — a count, a typical figure. */
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface-wash flex flex-col gap-3.5 p-4 md:gap-4.5 md:p-6", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="min-w-0 text-[22px] font-extrabold tracking-[-0.01em] text-wash-fg md:text-[26px] md:tracking-[-0.015em]">
          {title}
        </h2>
        {meta && (
          <span className="shrink-0 text-right text-[13px] font-semibold text-balance text-wash-muted">
            {meta}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * The reference block (mint) and the exit block (peach) — same shape as the
 * wash panel, different job. `pad="tight"` is for a panel that frames a map,
 * where the frame should read as a mount rather than a margin.
 */
export function TintPanel({
  tone,
  title,
  meta,
  children,
  pad = "default",
  size = "default",
  className,
}: {
  tone: "mint" | "peach";
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  pad?: "default" | "tight";
  /**
   * `"lg"` gives the panel the weight of the page's wash block — more air and a
   * heading a step up. For a tint panel that is carrying the column rather than
   * sitting beside something bigger (the park page's "Skip the line").
   */
  size?: "default" | "lg";
  className?: string;
}) {
  const large = size === "lg";
  return (
    <section
      className={cn(
        "flex flex-col",
        large ? "gap-4" : "gap-3",
        tone === "mint" ? "surface-mint" : "surface-peach",
        pad === "tight" ? "p-2.5" : large ? "p-5 md:p-6" : "p-4 md:p-5",
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-3 gap-y-2",
          pad === "tight" && "px-2 pt-1",
        )}
      >
        <h2
          className={cn(
            "min-w-0 font-extrabold tracking-[-0.01em] text-balance",
            large ? "text-[22px] md:text-[26px] md:tracking-[-0.015em]" : "text-lg md:text-xl",
            tone === "mint" ? "text-mint-fg" : "text-peach-fg",
          )}
        >
          {title}
        </h2>
        {meta && <div className="ml-auto shrink-0">{meta}</div>}
      </div>
      {children}
    </section>
  );
}

/** The uppercase kicker on a tint panel's header row (period name, area). */
export function TintMeta({ tone, children }: { tone: "mint" | "peach"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "text-xs font-bold uppercase tracking-[0.06em]",
        tone === "mint" ? "text-mint-label" : "text-peach-sub",
      )}
    >
      {children}
    </span>
  );
}

/**
 * A stat that is read, not pressed: flat, no shelf, no border. The 3D chrome is
 * reserved for things that navigate or act (deviation D1).
 */
export function FactTile({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5 rounded-2xl bg-muted px-3.5 py-3", className)}>
      <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-[15px] leading-snug font-semibold text-balance">{value}</span>
    </div>
  );
}

/** A full-width section under the two columns (the chart blocks). */
export function SectionHeading({
  title,
  description,
  className,
}: {
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <h2 className="text-[22px] font-extrabold tracking-[-0.015em] md:text-2xl">{title}</h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

/**
 * The flat card the detail-page charts sit in — the app's `Card` wears the 3D
 * shelf, which belongs on keys, so chart cards get a hairline `--card-edge`
 * instead.
 */
export function DetailCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3.5 rounded-[22px] border border-card-edge bg-card p-5",
        className,
      )}
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-[15px] font-bold">{title}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}
