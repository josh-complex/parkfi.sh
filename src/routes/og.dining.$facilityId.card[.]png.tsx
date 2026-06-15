import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { renderOgCard, type OgChip } from "#/server/og/card.tsx";

interface VenueStats {
  name: string;
  parkResort: string | null;
  cuisine: string | null;
  priceRange: string | null;
  itemCount: number;
}

async function loadStats(facilityId: string): Promise<VenueStats | null> {
  try {
    const result = await db.execute<{
      name: string;
      park_resort: string | null;
      cuisine: string | null;
      price_range: string | null;
      item_count: number | null;
    }>(sql`
      SELECT r.name, r.park_resort, r.cuisine, r.price_range, m.item_count
      FROM restaurant_dim r
      LEFT JOIN dining_menu_snapshot m ON m.facility_id = r.facility_id
      WHERE r.facility_id = ${facilityId} AND r.active = true
      LIMIT 1
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      name: row.name,
      parkResort: row.park_resort,
      cuisine: row.cuisine,
      priceRange: row.price_range,
      itemCount: Number(row.item_count ?? 0),
    };
  } catch {
    return null;
  }
}

async function renderPng(facilityId: string): Promise<Buffer> {
  const stats = await loadStats(facilityId);
  const chips: Array<OgChip> = [];
  if (stats?.priceRange) chips.push({ value: stats.priceRange, label: "Price" });
  if (stats && stats.itemCount > 0)
    chips.push({ value: String(stats.itemCount), label: "Menu items" });
  return renderOgCard({
    title: stats?.name ?? "Dining",
    subtitle: stats
      ? [stats.cuisine, stats.parkResort].filter(Boolean).join(" · ") || "Menus & reservations"
      : "Menus & reservations",
    chips,
  });
}

export const Route = createFileRoute("/og/dining/$facilityId/card.png")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Path: `/og/dining/<facilityId>/card.png`.
        const path = new URL(request.url).pathname;
        const facilityId = path.replace(/^\/og\/dining\//, "").replace(/\/card\.png$/, "");
        const png = await renderPng(facilityId);
        return new Response(new Uint8Array(png), {
          headers: {
            "content-type": "image/png",
            "cache-control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
          },
        });
      },
    },
  },
});
