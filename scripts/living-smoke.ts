/**
 * Living Layer — end-to-end smoke test (M1 + M2) against a real Postgres.
 *
 * Proves the mic-drop loop without any dev server:
 *   1. create a throwaway fixture park + attraction (its own data — never
 *      touches a real ride's status),
 *   2. seed realms from it (M1),
 *   3. inject a DOWN status → reconcile → assert an active encounter mark
 *      appears at that attraction (M2 — the mic-drop),
 *   4. inject OPERATING (+ age the mark past the grace) → reconcile → assert it
 *      faded.
 *
 * SAFETY: uses fixtures with a `zzz-living-smoke` slug and cleans up EVERYTHING
 * it created in a `finally` (including any system marks created during the run),
 * so it leaves the database exactly as it found it. Requires DATABASE_URL. It
 * applies the (idempotent, additive) Living Layer migration itself, so it's a
 * single command — no separate migrate step needed.
 *
 *   bun scripts/living-smoke.ts
 */
import { readFileSync } from "node:fs";

import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"] });

import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import {
  attractionMeta,
  attractionStatusObs,
  attractions,
  mark,
  parks,
  realm,
} from "#/db/schema.ts";
import { reconcileDimming } from "#/server/living/dimming.ts";
import { seedRealmsForPark } from "#/server/living/realms.ts";
import { AttractionStatus, Source } from "#/server/parks/codes.ts";

const SLUG = "zzz-living-smoke-park";
const runStart = new Date();

function check(label: string, ok: boolean): void {
  console.log(`${ok ? "✓ PASS" : "✗ FAIL"}  ${label}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  // --- apply the migration (idempotent CREATE IF NOT EXISTS / ON CONFLICT) -
  const migrationSql = readFileSync(
    new URL("../drizzle/20260620120000_living_layer/migration.sql", import.meta.url),
    "utf8",
  );
  await db.execute(sql.raw(migrationSql));
  check("migration applied (idempotent)", true);

  // --- fixtures -----------------------------------------------------------
  const [park] = await db
    .insert(parks)
    .values({ name: "Living Smoke Park", slug: SLUG, timezone: "America/New_York" })
    .returning({ id: parks.id });
  const parkId = park.id;

  const [att] = await db
    .insert(attractions)
    .values({
      parkId,
      name: "Smoke Mountain",
      slug: "zzz-smoke-mountain",
      category: "thrill", // non-null — required (ghost-dup filter)
      latitude: 28.4187,
      longitude: -81.5812,
    })
    .returning({ id: attractions.id });
  const attractionId = att.id;

  await db.insert(attractionMeta).values({
    attractionId,
    land: "Smokeland",
    source: Source.THEMEPARKS_WIKI,
  });

  // --- M1: seed realms ----------------------------------------------------
  const seeded = await seedRealmsForPark(parkId);
  check("M1 seedRealmsForPark created a realm for the land", seeded.realms === 1);

  // --- M2: inject DOWN → reconcile → expect a spawn -----------------------
  await db.insert(attractionStatusObs).values({
    observedAt: new Date(),
    attractionId,
    status: AttractionStatus.DOWN,
    source: Source.THEMEPARKS_WIKI,
  });
  const r1 = await reconcileDimming();
  check("M2 reconcile spawned at least one mark", r1.spawned >= 1);

  const active = await db
    .select({
      id: mark.id,
      type: mark.type,
      snap: mark.liveStateSnapshot,
      expiresAt: mark.expiresAt,
    })
    .from(mark)
    .where(
      and(eq(mark.attractionId, attractionId), eq(mark.state, "active"), eq(mark.isSystem, true)),
    );
  check("M2 an active system encounter mark exists at the ride", active.length === 1);
  check("M2 the mark carries a DOWN live-state snapshot", active[0]?.snap?.status === "DOWN");
  check(
    "M2 the spawn has a future expires_at (TTL applied)",
    active[0]?.expiresAt != null && active[0].expiresAt.getTime() > Date.now(),
  );

  // --- M2: ride recovers → mark LINGERS (does not despawn immediately) -----
  await db.insert(attractionStatusObs).values({
    observedAt: new Date(),
    attractionId,
    status: AttractionStatus.OPERATING,
    source: Source.THEMEPARKS_WIKI,
  });
  const r2 = await reconcileDimming();
  const afterRecovery = await db
    .select({ id: mark.id })
    .from(mark)
    .where(and(eq(mark.attractionId, attractionId), eq(mark.state, "active")));
  check(
    "M2 spawn lingers after the ride recovers (no immediate despawn)",
    afterRecovery.length === 1,
  );
  check("M2 nothing was expired on recovery", r2.expired === 0);

  // --- M2: TTL elapses → mark fades --------------------------------------
  // Simulate the TTL running out by pushing expires_at into the past.
  await db
    .update(mark)
    .set({ expiresAt: sql`now() - interval '1 minute'` })
    .where(eq(mark.attractionId, attractionId));
  const r3 = await reconcileDimming();
  check("M2 reconcile despawned the mark once its TTL elapsed", r3.expired >= 1);

  const stillActive = await db
    .select({ id: mark.id })
    .from(mark)
    .where(and(eq(mark.attractionId, attractionId), eq(mark.state, "active")));
  check("M2 no active marks remain after TTL", stillActive.length === 0);
}

async function cleanup() {
  // Remove everything this run created, in FK-safe order. Also delete any system
  // marks created during the run (reconcile is global, so a real DOWN ride could
  // have spawned one too — leave the DB exactly as we found it).
  const rows = await db.select({ id: parks.id }).from(parks).where(eq(parks.slug, SLUG));
  await db.delete(mark).where(and(eq(mark.isSystem, true), gte(mark.createdAt, runStart)));
  for (const p of rows) {
    const atts = await db
      .select({ id: attractions.id })
      .from(attractions)
      .where(eq(attractions.parkId, p.id));
    for (const a of atts) {
      await db.delete(mark).where(eq(mark.attractionId, a.id));
      await db.delete(attractionStatusObs).where(eq(attractionStatusObs.attractionId, a.id));
      await db.delete(attractionMeta).where(eq(attractionMeta.attractionId, a.id));
    }
    await db.delete(realm).where(eq(realm.parkId, p.id));
    await db.delete(attractions).where(eq(attractions.parkId, p.id));
    await db.delete(parks).where(eq(parks.id, p.id));
  }
  console.log("• cleanup complete — fixtures and run marks removed");
}

try {
  await main();
} catch (err) {
  console.error("smoke run threw:", err);
  process.exitCode = 1;
} finally {
  await cleanup().catch((e) => console.error("cleanup failed:", e));
  process.exit(process.exitCode ?? 0);
}
