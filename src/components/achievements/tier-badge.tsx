"use client";

import { LockIcon } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * Stable hue (0–360) per achievement family, hashed from its key. Gives each
 * shelf its own color identity so a page of 20+ families doesn't read as one
 * monotone ramp. Exported for the /activity tiles and chips, which reuse the
 * same per-family color identity.
 */
export function hueForFamily(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Backing gradient for a tier tile: pale + near-gray at rank 0, deep and
 *  saturated at rank 1 — the "intensifies as you level up" effect. */
export function tierGradient(hue: number, rank: number): string {
  const l = 0.95 - 0.34 * rank;
  const c = 0.02 + 0.19 * rank;
  return `linear-gradient(155deg, oklch(${(l + 0.07).toFixed(3)} ${(c * 1.05).toFixed(3)} ${(hue + 16) % 360}) 0%, oklch(${l.toFixed(3)} ${c.toFixed(3)} ${hue}) 100%)`;
}

/**
 * A single tier medallion — the family emoji over a color-ramped tile, shown
 * in the achievements shelves. `rank` (0 = first tier, 1 = last tier in the
 * family) drives how saturated/deep the background reads; locked tiers are
 * desaturated and dimmed with a lock glyph. `next` rings the very next tier
 * the player is working toward.
 */
export function TierBadge({
  familyKey,
  icon,
  name,
  description,
  rank,
  unlocked,
  next,
}: {
  familyKey: string;
  icon: string;
  name: string;
  description: string;
  rank: number;
  unlocked: boolean;
  next?: boolean;
}) {
  const hue = hueForFamily(familyKey);
  const dark = rank > 0.5;

  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        className={cn(
          "relative flex aspect-square w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl p-2 text-center shadow-sm outline-none transition-transform active:scale-95",
          !unlocked && "opacity-45 saturate-0",
          // `ring-inset` (not an offset ring) so the highlight stays inside the
          // tile's own box — an offset ring gets clipped top/bottom by the
          // carousel viewport's `overflow-hidden`.
          next && "ring-2 ring-inset ring-primary",
        )}
        style={{ backgroundImage: tierGradient(hue, rank) }}
      >
        <span className="text-3xl leading-none" aria-hidden>
          {icon}
        </span>
        <span
          className={cn(
            "line-clamp-2 text-[0.65rem] leading-tight font-semibold text-balance",
            // The tile color is computed from hue+rank and never changes with the
            // app theme, so the label ink must key off the tile's lightness, not
            // `--foreground` (which flips to near-white in dark mode and vanishes
            // on these pale low-rank tiles).
            dark ? "text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]" : "text-black/80",
          )}
        >
          {name}
        </span>
        {!unlocked && (
          <LockIcon
            className={cn(
              "absolute top-1.5 right-1.5 size-3",
              dark ? "text-white/70" : "text-black/40",
            )}
          />
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-56 text-pretty">
        <p className="font-medium">{name}</p>
        <p>{description}</p>
      </TooltipContent>
    </Tooltip>
  );
}
