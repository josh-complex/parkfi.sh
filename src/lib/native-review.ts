import { isNative } from "#/lib/platform.ts";

/**
 * Native in-app store-review prompt (`@capacitor-community/in-app-review`).
 *
 * Both App Store and Play cap how often their sheet actually appears (a few
 * times a year), silently no-op'ing extra calls — but we still self-throttle so
 * we only *spend* one of those scarce prompts at a genuine high point (an
 * achievement unlock, a ride recap), and never twice in one session or within a
 * long cooldown. Never prompt on web (there's no store to review).
 *
 * The gate is deliberately conservative: a review prompt at a bad moment is a
 * one-star risk, so we'd rather under-ask.
 */

const LAST_KEY = "parkfi:review:lastPromptedAt";
const COUNT_KEY = "parkfi:review:euphoriaCount";
// Don't ask again for ~60 days once we've asked (the OS cap is stricter still).
const COOLDOWN_MS = 60 * 24 * 60 * 60 * 1000;
// Require a few celebratory moments before the first ask, so we're not begging a
// brand-new user who's seen nothing yet.
const MIN_EUPHORIA = 3;

let askedThisSession = false;

function readNum(key: string): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number(window.localStorage.getItem(key) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function writeNum(key: string, v: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(v));
  } catch {
    /* storage disabled — worst case the throttle resets next launch */
  }
}

/**
 * Record that a celebratory moment happened and, if the gate is satisfied,
 * request the native review sheet. Call this from unlock/recap handlers — it's
 * cheap and self-throttling, so callers don't need their own guards. Returns
 * whether a prompt was actually requested (mostly for tests/telemetry).
 */
export async function maybeRequestReview(): Promise<boolean> {
  if (!isNative() || askedThisSession) return false;

  const count = readNum(COUNT_KEY) + 1;
  writeNum(COUNT_KEY, count);
  if (count < MIN_EUPHORIA) return false;

  const last = readNum(LAST_KEY);
  if (last && Date.now() - last < COOLDOWN_MS) return false;

  askedThisSession = true;
  writeNum(LAST_KEY, Date.now());
  try {
    const { InAppReview } = await import("@capacitor-community/in-app-review");
    await InAppReview.requestReview();
    return true;
  } catch {
    /* plugin unavailable / OS declined — best-effort */
    return false;
  }
}
