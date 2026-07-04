/**
 * Living Layer — dev/armchair-mode helpers (M0).
 *
 * You cannot iterate on a location game by standing in a park all day. These
 * helpers let the whole loop be driven from the desk: inject a synthetic ride
 * status (to fire the Darkness engine deterministically) and stash a spoofed
 * position. They are HARD-GATED behind LIVING_DEV and refuse to run in
 * production, so they can never be reached on a live deployment.
 */
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { attractionStatusObs } from "#/db/schema.ts";
import { Source } from "#/server/parks/codes.ts";

import { LIVING_DEV } from "./config.ts";

/** Throws FORBIDDEN unless dev mode is explicitly enabled. */
export function assertDevEnabled(): void {
  if (!LIVING_DEV) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Living Layer dev mode is disabled (set LIVING_DEV=1).",
    });
  }
}

/**
 * Inject a synthetic attraction-status observation. This writes a real
 * `attraction_status_obs` row exactly like the worker would, which on the next
 * reconcile makes the Darkness engine spawn (status=DOWN) or seal (status back to
 * OPERATING) — the in-meeting fallback for the live mic-drop.
 */
export async function injectStatus(attractionId: number, status: number): Promise<void> {
  assertDevEnabled();
  await db
    .insert(attractionStatusObs)
    .values({
      observedAt: new Date(),
      attractionId,
      status,
      source: Source.THEMEPARKS_WIKI,
    })
    .onConflictDoNothing();
}

/**
 * Run a one-shot Darkness reconcile on demand (so a dev doesn't have to wait for
 * the worker tick). Imported lazily to avoid pulling the engine into the web
 * bundle's hot path.
 */
export async function reconcileNow(): Promise<{ spawned: number; expired: number }> {
  assertDevEnabled();
  const { reconcileDarkness } = await import("./darkness.ts");
  return reconcileDarkness();
}

/** Count of currently-active marks in a park — for dev assertions/UI. */
export async function activeMarkCount(parkId: number): Promise<number> {
  assertDevEnabled();
  const r = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM mark WHERE park_id = ${parkId} AND state = 'active'`,
  );
  return Number(r.rows[0]?.n ?? 0);
}
