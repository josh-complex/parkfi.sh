/**
 * Living Layer — realm seeding (M1).
 *
 * Promotes "land" (today only `attraction_meta.land`) into first-class `realm`
 * rows with a `boundary` polygon derived from the convex hull of each land's
 * attraction coordinates. Idempotent: re-running upserts by (park_id, slug).
 *
 * Intended to be called from the monthly geo cron (services/geo) AFTER
 * attraction geo enrichment, so realms refresh alongside the rest of the geo
 * data. Safe to run standalone. Reads only existing tables; writes only `realm`.
 */
import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { realm } from "#/db/schema.ts";
import { activeParkIds } from "#/server/parks/ingest.ts";

import { convexHull, type LngLat } from "./geofence.ts";

import type { GeoPolygon } from "#/db/schema.ts";

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "unknown"
  );
}

export interface SeedRealmsResult {
  parkId: number;
  realms: number;
}

/**
 * Seed/refresh realms for one park from its attractions' `land` + coordinates.
 *
 * Note the `category IS NOT NULL` filter: un-enriched duplicate attraction rows
 * carry a null category and would otherwise pollute land membership and hull
 * geometry (project memory: ghost-duplicate-attractions).
 */
export async function seedRealmsForPark(parkId: number): Promise<SeedRealmsResult> {
  const rows = (
    await db.execute<{ land: string; lng: number; lat: number }>(sql`
      SELECT am.land AS land, a.longitude AS lng, a.latitude AS lat
      FROM attractions a
      JOIN attraction_meta am ON am.attraction_id = a.id
      WHERE a.park_id = ${parkId}
        AND a.active = true
        AND a.category IS NOT NULL
        AND am.land IS NOT NULL
        AND a.latitude IS NOT NULL
        AND a.longitude IS NOT NULL
    `)
  ).rows;

  // Group coordinates by land name.
  const byLand = new Map<string, LngLat[]>();
  for (const r of rows) {
    const pts = byLand.get(r.land) ?? [];
    pts.push([Number(r.lng), Number(r.lat)]);
    byLand.set(r.land, pts);
  }

  let count = 0;
  for (const [land, pts] of byLand) {
    const hull = convexHull(pts);
    // A polygon needs >=3 distinct points; below that we seed without a boundary
    // (realmForPoint falls back to a centroid radius until the next refresh).
    const boundary: GeoPolygon | null =
      hull.length >= 3 ? { type: "Polygon", coordinates: [[...hull, hull[0]]] } : null;

    await db
      .insert(realm)
      .values({ parkId, name: land, slug: slugify(land), boundary })
      .onConflictDoUpdate({
        target: [realm.parkId, realm.slug],
        set: { name: land, boundary },
      });
    count++;
  }

  return { parkId, realms: count };
}

/**
 * Seed/refresh realms for every active park — no park id needed. Reuses the
 * worker's `activeParkIds()` so it stays in sync with what actually gets polled.
 * Intended for `scripts/seed-realms.ts` and the monthly geo cron.
 */
export async function seedAllRealms(): Promise<{
  parks: number;
  realms: number;
  perPark: SeedRealmsResult[];
}> {
  const parkIds = await activeParkIds();
  const perPark: SeedRealmsResult[] = [];
  for (const parkId of parkIds) {
    perPark.push(await seedRealmsForPark(parkId));
  }
  return {
    parks: parkIds.length,
    realms: perPark.reduce((n, r) => n + r.realms, 0),
    perPark,
  };
}
