"use client";

import { Sparkle } from "#/components/achievements/achievement-toast.tsx";
import { cn } from "#/lib/utils.ts";

import type { LevelInfo } from "#/lib/achievements.ts";

/**
 * Gold level coin — the level number in a chip. `sm` rides the corner of the
 * mobile avatar; `md` sits in the desktop user button. Styling lives in
 * `.achv-level-coin` (styles.css) so it matches the gold level-up toast.
 */
export function LevelBadge({
  level,
  size = "md",
  className,
}: {
  level: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      aria-label={`Level ${level}`}
      className={cn(
        "achv-level-coin inline-grid shrink-0 place-items-center rounded-full font-black tabular-nums",
        size === "sm"
          ? "size-4.5 text-[0.6rem]"
          : size === "lg"
            ? "size-14 text-2xl"
            : "size-6 text-xs",
        className,
      )}
    >
      {level}
    </span>
  );
}

/**
 * Level title + XP-to-next progress, surfaced in the user popover / mobile
 * drawer so the level and XP read at a glance without opening the Badges page.
 * Same gold `.achv-hero` treatment as the Achievements page's level card, just
 * compacted to fit a menu.
 */
export function LevelDetails({ level, className }: { level: LevelInfo; className?: string }) {
  const pct = level.forNext
    ? Math.min(100, Math.round((level.intoLevel / level.forNext) * 100))
    : 100;
  return (
    <div className={cn("achv-hero space-y-1.5 rounded-2xl p-3", className)}>
      <Sparkle className="achv-sparkle--tl" />
      <Sparkle className="achv-sparkle--br" />
      <div className="flex items-center gap-2.5">
        <LevelBadge level={level.level} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[0.65rem] font-bold tracking-widest uppercase opacity-70">
            Level {level.level}
          </p>
          <p className="truncate text-sm font-bold">{level.title}</p>
        </div>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: "oklch(0 0 0 / 0.12)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: "oklch(0.3 0.08 66)" }}
        />
      </div>
      <p className="text-[0.7rem] font-medium tabular-nums opacity-70">
        {level.forNext != null
          ? `${level.intoLevel.toLocaleString()} / ${level.forNext.toLocaleString()} XP to level ${level.level + 1}`
          : `${level.xp.toLocaleString()} XP · max level`}
      </p>
    </div>
  );
}
