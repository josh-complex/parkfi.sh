"use client";

import { toast } from "sonner";

import { AchievementCard, LevelUpCard } from "./achievement-toast.tsx";

import { TIER_BY_ID, type LevelInfo } from "#/lib/achievements.ts";
import { pushToastExpand } from "#/lib/toast-expand.ts";
import { vibrateLevelUp, vibrateUnlock } from "#/lib/vibrate.ts";

// Shared shelf-and-squish morph (matches the standard toasts via .achv-toast in
// styles.css) is on the toast <li>; `TOAST_CLASS` opts each card into it.
const TOAST_CLASS = "achv-toast";
// Small gap between cards so their squish-ins (and duration-driven exits)
// cascade a beat apart rather than firing in unison.
const ENTRY_STAGGER_MS = 110;
const UNLOCK_MS = 6000;
// How long the fully-assembled level-up stack rests before it starts clearing.
const CELEBRATION_HOLD_MS = 8000;

// Bumped once per level-up celebration so its cards get fresh toast ids. Reusing
// a stable id right after `toast.dismiss()` collides with the same toast still
// animating out — sonner takes its "update existing" path on a component that's
// already latched to unmount, so the re-fired card never re-appears. Fresh ids
// dodge that entirely (the celebration owns the stack, so it needs no dedupe).
let celebrationSeq = 0;

const LEVEL_KEY = "parkfi:achv:level";

function readCelebratedLevel(): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number(window.localStorage.getItem(LEVEL_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function writeCelebratedLevel(level: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LEVEL_KEY, String(level));
  } catch {
    /* private mode / disabled storage — the session still celebrates once */
  }
}

/**
 * Forget the last-celebrated level so the next unlock (or ping) re-fires the
 * gold level-up celebration for the caller's current level — the client half of
 * a level reset (server XP/level is derived from unlocks, so revoking those is
 * the other half). QA/dev tooling only.
 */
export function resetCelebratedLevel(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEVEL_KEY);
  } catch {
    /* private mode / disabled storage — nothing was persisted to clear */
  }
}

/**
 * The single funnel every unlock is celebrated through — tracker pings, app
 * events, and the pending-unlocks replay on mount all call this, so the
 * toast/haptic/level-up logic lives in exactly one place.
 */
export function showUnlockToasts(
  unlockIds: string[],
  opts: { xp: number; level: LevelInfo; onShown?: (ids: string[]) => void },
): void {
  // Resolve to catalog entries once (skipping unknown/removed ids), keeping the
  // tier index around for the tier-scaled haptic.
  const entries = unlockIds.flatMap((id) => {
    const ref = TIER_BY_ID.get(id);
    return ref ? [{ family: ref.family, tier: ref.tier, tierIndex: ref.tierIndex }] : [];
  });

  const leveledUp = opts.level.level > readCelebratedLevel();

  if (leveledUp) {
    // Celebration: the green card(s) that earned it with the gold level-up
    // riding on top, all unfurled together. Clear whatever else is in the stack
    // first so those own the moment, and force-expand the toaster so they show
    // at once instead of collapsing (released once they've all exited).
    const seq = (celebrationSeq += 1);
    toast.dismiss();
    const releaseExpand = pushToastExpand();
    writeCelebratedLevel(opts.level.level);

    // Green unlock card(s) first (older → below), then the gold level-up on top,
    // each a beat later so their squish-ins cascade. Equal durations mean the
    // exits cascade the same way, gold lingering last.
    entries.forEach((entry, i) => {
      setTimeout(() => {
        toast.custom(() => <AchievementCard entry={{ family: entry.family, tier: entry.tier }} />, {
          id: `achv:${entry.tier.id}#${seq}`,
          className: TOAST_CLASS,
          duration: CELEBRATION_HOLD_MS,
        });
        vibrateUnlock(entry.tierIndex + 1);
      }, i * ENTRY_STAGGER_MS);
    });

    const levelDelay = entries.length * ENTRY_STAGGER_MS;
    setTimeout(() => {
      toast.custom(() => <LevelUpCard level={opts.level} />, {
        id: `achv:levelup#${seq}`,
        className: TOAST_CLASS,
        duration: CELEBRATION_HOLD_MS,
      });
      vibrateLevelUp();
    }, levelDelay);

    // Collapse back only after the last card has fully animated out.
    setTimeout(releaseExpand, levelDelay + CELEBRATION_HOLD_MS + 800);
  } else {
    // Plain unlock(s): one vibrant green card each, staggered so the stack
    // animates in rather than slamming.
    entries.forEach((entry, i) => {
      setTimeout(() => {
        toast.custom(() => <AchievementCard entry={{ family: entry.family, tier: entry.tier }} />, {
          id: `achv:${entry.tier.id}`,
          className: TOAST_CLASS,
          duration: UNLOCK_MS,
        });
        vibrateUnlock(entry.tierIndex + 1);
      }, i * ENTRY_STAGGER_MS);
    });
  }

  // Ack the full original set (even ids we couldn't resolve to a catalog tier)
  // so a stale/removed tier id doesn't keep coming back via pendingUnlocks.
  if (unlockIds.length > 0) opts.onShown?.(unlockIds);
}
