/**
 * Living Layer — runtime configuration & kill switches.
 *
 * SAFETY: every Living Layer system is OFF by default. The worker's Darkness
 * reconcile step is a hard no-op unless `LIVING_ENABLED=1`, and the dev-only
 * tRPC procedures refuse to run unless `LIVING_DEV=1`. This guarantees that
 * deploying this code changes nothing about the existing application until the
 * flags are deliberately set.
 */

/** Master switch for server-side Living Layer work (the worker Darkness step). */
export const LIVING_ENABLED = process.env.LIVING_ENABLED === "1";

/** Enables the dev/armchair-mode tRPC procedures (spoofing, event injection). */
export const LIVING_DEV = process.env.LIVING_DEV === "1" || process.env.NODE_ENV !== "production";

export const livingConfig = {
  /**
   * How long a spawned "Darkness" mark sticks around before it despawns
   * (`LIVING_SPAWN_TTL_MS`, default 30 min). The TTL is (re)stamped on every
   * reconcile while the ride is still DOWN, so a spawn persists for as long as
   * the ride is broken, then LINGERS this long after the ride recovers before
   * fading — giving players who got the nudge time to actually reach it. Should
   * comfortably exceed the worker poll interval so a spawn can't expire between
   * ticks while its ride is still down.
   */
  spawnTtlMs: Number(process.env.LIVING_SPAWN_TTL_MS ?? 30 * 60_000),
} as const;
