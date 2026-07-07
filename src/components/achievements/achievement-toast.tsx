"use client";

import { cn } from "#/lib/utils.ts";

import type { AchievementFamily, AchievementTier, LevelInfo } from "#/lib/achievements.ts";

/** Four-point twinkle. Two sit at opposite corners of a card and pulse offset. */
function Sparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("achv-sparkle", className)}>
      <path
        fill="currentColor"
        d="M12 0c1 7 5 11 12 12-7 1-11 5-12 12-1-7-5-11-12-12 7-1 11-5 12-12Z"
      />
    </svg>
  );
}

export interface UnlockEntry {
  family: AchievementFamily;
  tier: AchievementTier;
}

/**
 * A single achievement unlock — a vibrant green pill with a big family emoji,
 * corner sparkles, and an XP chip. Rendered via `toast.custom`, so it owns all
 * of its own chrome (see `.achv-card` in styles.css).
 */
export function AchievementCard({ entry }: { entry: UnlockEntry }) {
  const { family, tier } = entry;
  return (
    <div className="achv-card w-full">
      <Sparkle className="achv-sparkle--tl" />
      <Sparkle className="achv-sparkle--br" />
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-4xl leading-none" aria-hidden>
          {family.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="achv-card__title text-[0.95rem] leading-tight font-bold">{tier.name}</p>
          <p className="mt-0.5 text-[0.8rem] leading-snug text-white/85">{tier.description}</p>
        </div>
        <span className="shrink-0 self-start rounded-full bg-white/20 px-2 py-0.5 text-[0.7rem] font-bold tabular-nums">
          +{tier.xp}
        </span>
      </div>
    </div>
  );
}

/**
 * Level-up celebration — a gold card. Rides above the green unlock card that
 * earned it (fired as a separate toast, both unfurled together), so this one
 * just carries the new level.
 */
export function LevelUpCard({ level }: { level: LevelInfo }) {
  return (
    <div className="achv-card achv-card--gold w-full">
      <Sparkle className="achv-sparkle--tl" />
      <Sparkle className="achv-sparkle--br" />
      <div className="flex items-center gap-3">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-full bg-white/30 text-lg font-black tabular-nums"
          aria-hidden
        >
          {level.level}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.68rem] font-bold tracking-widest uppercase opacity-70">Level up</p>
          <p className="achv-card__title text-[0.95rem] leading-tight font-black">{level.title}</p>
        </div>
        <span className="shrink-0 self-start rounded-full bg-black/10 px-2 py-0.5 text-[0.7rem] font-bold tabular-nums">
          {level.xp.toLocaleString()} XP
        </span>
      </div>
    </div>
  );
}
