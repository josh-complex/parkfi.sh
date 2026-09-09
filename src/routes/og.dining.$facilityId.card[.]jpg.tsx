import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { renderOgCard, type OgBadge, type OgChip } from "#/server/og/card.tsx";

interface VenueStats {
  name: string;
  parkResort: string | null;
  cuisine: string | null;
  priceRange: string | null;
  imageUrl: string | null;
  characterDining: boolean;
  fineDining: boolean;
  itemCount: number;
}

async function loadStats(facilityId: string): Promise<VenueStats | null> {
  try {
    const result = await db.execute<{
      name: string;
      park_resort: string | null;
      cuisine: string | null;
      price_range: string | null;
      image_url: string | null;
      character_dining: boolean;
      fine_dining: boolean;
      item_count: number | null;
    }>(sql`
      SELECT r.name, r.park_resort, r.cuisine, r.price_range, r.image_url,
             r.character_dining, r.fine_dining, m.item_count
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
      imageUrl: row.image_url,
      characterDining: row.character_dining,
      fineDining: row.fine_dining,
      itemCount: Number(row.item_count ?? 0),
    };
  } catch {
    return null;
  }
}

/**
 * Squeeze a finder price descriptor into a chip. The raw value
 * ("$$$ ($35 to $59.99 per adult)") is far too wide at the chip's 52px value
 * size — it swallowed the whole bottom row and pushed the other chips off the
 * card. Tier symbols become the value, the dollar figures a compact label.
 */
function priceChip(priceRange: string): OgChip | null {
  const tier = /^\$+/.exec(priceRange.trim())?.[0];
  if (!tier) return null;
  const detail = /\(([^)]*)\)/.exec(priceRange)?.[1] ?? "";
  const amounts = [...detail.matchAll(/\$\s*([\d.]+)/g)].map((m) => Math.round(Number(m[1])));
  const perAdult = /per adult/i.test(detail);
  let label = "Price";
  if (amounts.length >= 2) label = `$${amounts[0]}\u2013$${amounts[1]}`;
  else if (amounts.length === 1)
    label = /under|less/i.test(detail) ? `Under $${amounts[0]}` : `$${amounts[0]}+`;
  if (amounts.length > 0 && perAdult) label += " / adult";
  return { value: tier, label };
}

async function renderJpeg(facilityId: string): Promise<Buffer> {
  const stats = await loadStats(facilityId);
  const chips: Array<OgChip> = [];
  const price = stats?.priceRange ? priceChip(stats.priceRange) : null;
  if (price) chips.push(price);
  if (stats && stats.itemCount > 0)
    chips.push({ value: String(stats.itemCount), label: "Menu items" });
  let badge: OgBadge | null = null;
  if (stats?.characterDining) badge = { label: "Character Dining", tone: "neutral" };
  else if (stats?.fineDining) badge = { label: "Fine Dining", tone: "neutral" };
  return renderOgCard({
    title: stats?.name ?? "Dining",
    subtitle: stats
      ? [stats.cuisine, stats.parkResort].filter(Boolean).join(" · ") || "Menus & reservations"
      : "Menus & reservations",
    chips,
    badge,
    imageUrl: stats?.imageUrl,
  });
}

export const Route = createFileRoute("/og/dining/$facilityId/card.jpg")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Path: `/og/dining/<facilityId>/card.jpg`.
        const path = new URL(request.url).pathname;
        const facilityId = path.replace(/^\/og\/dining\//, "").replace(/\/card\.jpg$/, "");
        const jpeg = await renderJpeg(facilityId);
        return new Response(new Uint8Array(jpeg), {
          headers: {
            "content-type": "image/jpeg",
            "cache-control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
          },
        });
      },
    },
  },
});
