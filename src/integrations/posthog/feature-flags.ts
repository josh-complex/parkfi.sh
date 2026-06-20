/**
 * PostHog feature flags.
 *
 * Central registry of flag keys + typed hooks. We already initialize PostHog in
 * provider.tsx; this just gives the rest of the app a single, typed place to
 * read flags.
 *
 * `living-layer` gates the entire new in-park location/AR experience in the UI.
 * IMPORTANT: a feature flag only controls what the CLIENT shows. The Living
 * Layer's DB tables and server code are additive and dark on their own (the
 * worker step is off unless LIVING_ENABLED=1), so this flag is the user-facing
 * switch for rolling the new surfaces out gradually — it does NOT, and cannot,
 * gate the schema. Existing pages never read this flag, so they are unaffected
 * whether it is on or off.
 */
import { usePostHog } from "@posthog/react";
import { useEffect, useState } from "react";

export const FeatureFlag = {
  /** The in-park location/AR "Living Layer" experience (docs/plans/living-layer). */
  LIVING_LAYER: "living-layer",
} as const;

export type FeatureFlagKey = (typeof FeatureFlag)[keyof typeof FeatureFlag];

/**
 * True when the Living Layer UI should be shown to this user. Defaults to
 * `false` until PostHog resolves (and stays false if PostHog isn't configured),
 * so the new surfaces stay hidden by default and the current app is untouched.
 *
 * SSR-safe by construction: PostHog is only `init()`-ed in the browser, so the
 * client has no `isFeatureEnabled` during SSR. `@posthog/react`'s
 * `useFeatureFlagEnabled` reads the flag *during render*, which throws on the
 * server. Instead we evaluate the flag in a client-only effect and start at
 * `false` — so the server render and the first client render agree (no
 * hydration mismatch), then the value flips once flags load. We also subscribe
 * to `onFeatureFlags` so it re-evaluates after `identify()` reloads flags.
 */
export function useLivingLayerEnabled(): boolean {
  const posthog = usePostHog();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!posthog || typeof posthog.isFeatureEnabled !== "function") return;
    const update = () => setEnabled(posthog.isFeatureEnabled(FeatureFlag.LIVING_LAYER) ?? false);
    update();
    // Returns an unsubscribe fn; fires whenever flags (re)load, e.g. post-identify.
    return posthog.onFeatureFlags?.(update);
  }, [posthog]);

  return enabled;
}
