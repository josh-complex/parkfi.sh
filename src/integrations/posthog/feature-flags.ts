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
import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import { useEffect, useState } from "react";

export const FeatureFlag = {
  /** The in-park location/AR "Living Layer" experience (docs/plans/living-layer). */
  LIVING_LAYER: "living-layer",
  /**
   * Nav QA affordances for testing walking directions off-site (e.g. the
   * quick-destination picker for routing from your real location around home
   * instead of driving to a park). Target it at your own account to dogfood on
   * a phone; off for everyone else.
   */
  NAV_TEST_TOOLS: "nav-test-tools",
  /**
   * Pin trading & collection surfaces. Unlike the other flags this one defaults
   * *on*: when the `pins` flag is absent or enabled the pin features show;
   * setting it off is the kill-switch that hides them (see {@link usePinsEnabled}).
   */
  PINS: "pins",
  /**
   * Route remote images through Cloudflare's on-the-fly resize/format endpoint
   * (`/cdn-cgi/image/…`, see src/lib/image.ts). Gated because it requires
   * "Transformations" to be enabled on the Cloudflare zone — until it is, the
   * `/cdn-cgi/image/` path 404s, so keep this flag off. Consumed via the store
   * below, not a per-image hook (see {@link useCfImagesEnabled}).
   */
  CF_IMAGES: "cf-images",
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

/**
 * True when the nav QA tools should be shown to this user. Same SSR-safe,
 * effect-evaluated pattern as {@link useLivingLayerEnabled} — starts `false`,
 * flips once PostHog resolves the `nav-test-tools` flag. Local dev callers can
 * OR this with `import.meta.env.DEV` so the tools are always on locally.
 */
export function useNavTestToolsEnabled(): boolean {
  const posthog = usePostHog();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!posthog || typeof posthog.isFeatureEnabled !== "function") return;
    const update = () => setEnabled(posthog.isFeatureEnabled(FeatureFlag.NAV_TEST_TOOLS) ?? false);
    update();
    return posthog.onFeatureFlags?.(update);
  }, [posthog]);

  return enabled;
}

/**
 * True when the pin features should be shown. Inverse default of the flags
 * above: starts `true` (pins are a shipped feature, and the server render + first
 * client render must agree), and only flips to `false` if PostHog explicitly
 * resolves the `pins` flag to off — the kill-switch. Absent/unconfigured flag
 * keeps pins visible.
 */
export function usePinsEnabled(): boolean {
  const posthog = usePostHog();
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!posthog || typeof posthog.isFeatureEnabled !== "function") return;
    const update = () => setEnabled(posthog.isFeatureEnabled(FeatureFlag.PINS) ?? true);
    update();
    return posthog.onFeatureFlags?.(update);
  }, [posthog]);

  return enabled;
}

/**
 * The `cf-images` flag, as a module-level store rather than a per-component
 * hook. `<Image>` renders in hundreds of places, so a PostHog subscription per
 * instance would be wasteful; instead {@link CfImagesFlagSync} holds the single
 * subscription and mirrors the flag here, and every `<Image>` reads it cheaply
 * via {@link useCfImagesEnabled}. Starts `false` so the SSR render and first
 * client render agree (no hydration mismatch) and images stay on their origin
 * CDN until the flag resolves on. Reading the store needs no provider ancestor,
 * so isolated renders (Storybook) simply get `false`.
 */
export const cfImagesStore = new Store(false);

/**
 * Mounts once (under `PostHogProvider`) and mirrors the `cf-images` flag into
 * {@link cfImagesStore}. Renders nothing. Same effect-evaluated, client-only
 * pattern as the flag hooks above, so it never touches PostHog during SSR.
 */
export function CfImagesFlagSync(): null {
  const posthog = usePostHog();

  useEffect(() => {
    if (!posthog || typeof posthog.isFeatureEnabled !== "function") return;
    const update = () =>
      cfImagesStore.setState(() => posthog.isFeatureEnabled(FeatureFlag.CF_IMAGES) ?? false);
    update();
    return posthog.onFeatureFlags?.(update);
  }, [posthog]);

  return null;
}

/** Reactive read of the `cf-images` flag for `<Image>`. See {@link cfImagesStore}. */
export function useCfImagesEnabled(): boolean {
  return useStore(cfImagesStore);
}
