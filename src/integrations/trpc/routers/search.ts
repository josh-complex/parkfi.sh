import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { UOR_PARKS, WDW_PARKS } from "#/lib/parks.ts";
import { RESORT_CATALOG } from "#/server/stays/resort-catalog.generated.ts";
import { publicProcedure } from "../init.ts";

import type { TRPCRouterRecord } from "@trpc/server";

// park slug → upstream park code (MK/EP/USF…), the key `product_dim.park_scope`
// is indexed by. Built once from the static catalog so the index query can map
// each park row to its admission pricing.
const SLUG_TO_CODE = new Map<string, string>(
  [...WDW_PARKS, ...UOR_PARKS].flatMap((p) => (p.slug ? [[p.slug, p.code] as const] : [])),
);

/**
 * The omni-search is a "canned" index: the searchable corpus (parks,
 * attractions, priority dining, published posts) is small and slow-changing, so
 * we ship it to the client once and filter in-memory there. That keeps typing
 * instant (no per-keystroke round-trips) and lets React Query cache the payload
 * across opens. Each row carries enough card metadata (thumbnail, context line)
 * for a rich result list. See `OmniSearch` for the client-side matching.
 */
export const searchRouter = {
  index: publicProcedure.query(async () => {
    const [parks, attractions, dining, blogPosts, ticketPrices] = await Promise.all([
      db.execute<{ id: string; name: string; slug: string; resort_name: string | null }>(sql`
        SELECT p.id, p.name, p.slug, r.name AS resort_name
        FROM parks p
        LEFT JOIN resorts r ON r.id = p.resort_id
        WHERE p.active = true
        ORDER BY p.name
      `),
      db.execute<{
        id: string;
        name: string;
        slug: string;
        park_slug: string;
        park_name: string;
        category: string | null;
        land: string | null;
        image_thumb_url: string | null;
      }>(sql`
        SELECT a.id, a.name, a.slug, p.slug AS park_slug, p.name AS park_name,
               a.category, m.land, m.image_thumb_url
        FROM attractions a
        JOIN parks p ON p.id = a.park_id
        LEFT JOIN attraction_meta m ON m.attraction_id = a.id
        WHERE a.active = true AND a.entity_type = 'ATTRACTION'
        ORDER BY a.name
      `),
      db.execute<{
        facility_id: string;
        name: string;
        park_resort: string | null;
        cuisine: string | null;
        price_range: string | null;
        image_url: string | null;
      }>(sql`
        SELECT facility_id, name, park_resort, cuisine, price_range, image_url
        FROM restaurant_dim
        WHERE priority = true AND active = true
        ORDER BY name
      `),
      db.execute<{
        id: string;
        slug: string;
        title: string;
        dek: string;
        hero_image_url: string | null;
      }>(sql`
        SELECT id, slug, title, dek, hero_image_url
        FROM blog_post
        WHERE status = 'published'
        ORDER BY published_at DESC NULLS LAST
      `),
      // Today's cheapest single-park, 1-day adult admission per park code. WDW
      // date-prices admission (latest snapshot for today's service_date);
      // Universal's 1-day admission is a flat list price with no per-date feed,
      // so we COALESCE down to `list_price_cents`. Express is excluded — it's an
      // add-on, not admission.
      db.execute<{ code: string; price_cents: number }>(sql`
        WITH adm AS (
          SELECT d.sku, unnest(d.park_scope) AS code, d.list_price_cents
          FROM product_dim d
          WHERE d.duration_days = 1 AND d.age_group = 'ADULT'
            AND d.residency = 'STD' AND d.park_to_park = false
            AND d.family <> 'EXPRESS' AND d.active = true
        ),
        today AS (
          SELECT DISTINCT ON (sp.sku) sp.sku, sp.price_cents
          FROM sku_price_obs sp
          WHERE sp.service_date = current_date
          ORDER BY sp.sku, sp.observed_at DESC
        )
        SELECT a.code, min(COALESCE(t.price_cents, a.list_price_cents)) AS price_cents
        FROM adm a
        LEFT JOIN today t ON t.sku = a.sku
        WHERE COALESCE(t.price_cents, a.list_price_cents) IS NOT NULL
        GROUP BY a.code
      `),
    ]);

    const priceByCode = new Map(ticketPrices.rows.map((r) => [r.code, Number(r.price_cents)]));

    return {
      parks: parks.rows.map((p) => {
        const code = SLUG_TO_CODE.get(p.slug);
        const cents = code ? priceByCode.get(code) : undefined;
        return {
          type: "park" as const,
          id: p.id,
          name: p.name,
          slug: p.slug,
          resortName: p.resort_name,
          // today's "from" admission price, in cents (null when unpriced)
          ticketPriceCents: cents ?? null,
        };
      }),
      attractions: attractions.rows.map((a) => ({
        type: "attraction" as const,
        id: a.id,
        name: a.name,
        // Per-park slug — pairs with `parkSlug` for the nested ride detail URL.
        slug: a.slug,
        parkName: a.park_name,
        parkSlug: a.park_slug,
        category: a.category,
        land: a.land,
        imageUrl: a.image_thumb_url,
      })),
      dining: dining.rows.map((d) => ({
        type: "dining" as const,
        id: d.facility_id,
        name: d.name,
        parkName: d.park_resort,
        cuisine: d.cuisine,
        priceRange: d.price_range,
        imageUrl: d.image_url,
      })),
      blogPosts: blogPosts.rows.map((b) => ({
        type: "blog" as const,
        id: b.id,
        title: b.title,
        slug: b.slug,
        dek: b.dek,
        imageUrl: b.hero_image_url,
      })),
      // Resort hotels are a static catalog (the `/stays` browse set), so they
      // ship straight from `RESORT_CATALOG` rather than a DB query — they land
      // on `/resort/$slug`.
      resorts: RESORT_CATALOG.map((r) => ({
        type: "resort" as const,
        id: r.id,
        name: r.name,
        slug: r.slug,
        tier: r.tier,
        area: r.area,
        imageUrl: r.image,
      })),
    };
  }),

  /**
   * Server-side menu-item search. Menu items number in the thousands and change
   * far more often than the canned `index` corpus, so they don't ship to the
   * client — the omni-search calls this per (debounced) query instead. Matches
   * item titles in each venue's live menu generation, dedupes the same item
   * across meal periods, and ranks prefix hits first. See `OmniSearch`.
   */
  menuItems: publicProcedure
    .input(z.object({ q: z.string(), limit: z.number().int().min(1).max(20).default(8) }))
    .query(async ({ input }) => {
      const q = input.q.trim();
      if (q.length < 2) return [];
      // Escape LIKE metacharacters so a user's "%" / "_" matches literally.
      const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
      const result = await db.execute<{
        facility_id: string;
        restaurant_name: string;
        park_resort: string | null;
        title: string;
        price: number | null;
        currency: string | null;
      }>(sql`
        WITH matches AS (
          SELECT i.facility_id, r.name AS restaurant_name, r.park_resort,
                 i.title, i.price, i.currency,
                 row_number() OVER (
                   PARTITION BY i.facility_id, lower(i.title)
                   ORDER BY i.price NULLS LAST
                 ) AS rn,
                 (lower(i.title) LIKE lower(${escaped}) || '%') AS prefix
          FROM dining_menu_item i
          JOIN dining_menu_snapshot s
            ON s.facility_id = i.facility_id AND s.observed_at = i.observed_at
          JOIN restaurant_dim r ON r.facility_id = i.facility_id
          WHERE r.active = true
            AND i.title ILIKE '%' || ${escaped} || '%' ESCAPE '\\'
        )
        SELECT facility_id, restaurant_name, park_resort, title, price, currency
        FROM matches
        WHERE rn = 1
        ORDER BY prefix DESC, length(title), title
        LIMIT ${input.limit}
      `);
      return result.rows.map((r) => ({
        facilityId: r.facility_id,
        restaurantName: r.restaurant_name,
        parkResort: r.park_resort,
        title: r.title,
        price: r.price === null ? null : Number(r.price),
        currency: r.currency,
      }));
    }),
} satisfies TRPCRouterRecord;
