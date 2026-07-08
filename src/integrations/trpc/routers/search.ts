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
 * Parks with today's "from" admission price. Small (≈10 rows) and shared by the
 * lean `defaults` query and the full `index`, so the pre-search view can load
 * this alone without dragging in the thousands of attraction/dining rows.
 */
async function fetchParks() {
  const [parks, ticketPrices] = await Promise.all([
    db.execute<{
      id: string;
      name: string;
      slug: string;
      resort_name: string | null;
      image_url: string | null;
    }>(sql`
      SELECT p.id, p.name, p.slug, p.image_url, r.name AS resort_name
      FROM parks p
      LEFT JOIN resorts r ON r.id = p.resort_id
      WHERE p.active = true
      ORDER BY p.name
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

  return parks.rows.map((p) => {
    const code = SLUG_TO_CODE.get(p.slug);
    const cents = code ? priceByCode.get(code) : undefined;
    return {
      type: "park" as const,
      id: p.id,
      name: p.name,
      slug: p.slug,
      resortName: p.resort_name,
      imageUrl: p.image_url,
      // today's "from" admission price, in cents (null when unpriced)
      ticketPriceCents: cents ?? null,
    };
  });
}

/** Newest published posts, capped when `limit` is given (pre-search default). */
async function fetchLatestPosts(limit?: number) {
  const blogPosts = await db.execute<{
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
    ${limit == null ? sql`` : sql`LIMIT ${limit}`}
  `);
  return blogPosts.rows.map((b) => ({
    type: "blog" as const,
    id: b.id,
    title: b.title,
    slug: b.slug,
    dek: b.dek,
    imageUrl: b.hero_image_url,
  }));
}

/**
 * The omni-search runs entirely server-side. The empty-state drawer loads a lean
 * `defaults` set (a few parks + latest posts); once the user types, a single
 * debounced `query` call fuzzy-matches every section against the DB — backed by
 * pg_trgm GIN indexes (see drizzle/20260708170000_search_name_trgm) so each
 * keystroke is an indexed lookup, not a corpus shipped to the client and
 * filtered in-memory. Every section is capped so no query is unbounded.
 */

/** Per-section row cap for `search.query`. Keeps every section bounded. */
const MAX_PER_SECTION = 25;

/**
 * Reusable fuzzy predicate + ranking for a text column, built for a pg_trgm GIN
 * index. Matches substrings (`ILIKE '%q%'`) and near-misses (the `<%`
 * word-similarity operator — the query's trigrams vs the closest *word* in the
 * value, so "aloa"→"Aloha Isle", "cosmc"→"Cosmic Ray's"). Ranks exact-prefix
 * hits first, then by word similarity, then shortest name. Both `ILIKE` and `<%`
 * are served by the `gin_trgm_ops` index. `escaped` has LIKE metacharacters
 * neutralised; `raw` is the user's text for the similarity operators.
 */
function fuzzy(col: string, raw: string, escaped: string) {
  const c = sql.raw(col);
  const like = `%${escaped}%`;
  const prefix = `${escaped}%`;
  return {
    where: sql`(${c} ILIKE ${like} ESCAPE '\\' OR ${raw} <% ${c})`,
    order: sql`(${c} ILIKE ${prefix} ESCAPE '\\') DESC, word_similarity(${raw}, ${c}) DESC, length(${c}), ${c}`,
  };
}

export const searchRouter = {
  /**
   * Lean pre-search set: just the handful of parks + latest posts the drawer
   * shows before the user types. Loads fast so the drawer opens instantly, while
   * the full fuzzy `query` runs only once the user actually searches.
   */
  defaults: publicProcedure.query(async () => {
    const [parks, blogPosts] = await Promise.all([fetchParks(), fetchLatestPosts(6)]);
    return { parks, blogPosts };
  }),

  /**
   * Server-side fuzzy omni-search. One call per (debounced) keystroke; matches
   * parks, attractions, all active dining (NO priority gate — snack carts and
   * quick-service now surface), live menu items, resorts, and published posts.
   * Each section is independently capped at `limit` (≤ 100). Backed by pg_trgm
   * so it stays an indexed lookup at any catalog size.
   */
  query: publicProcedure
    .input(
      z.object({
        q: z.string(),
        limit: z.number().int().min(1).max(MAX_PER_SECTION).default(MAX_PER_SECTION),
      }),
    )
    .query(async ({ input }) => {
      const q = input.q.trim();
      const empty = {
        parks: [],
        attractions: [],
        dining: [],
        menuItems: [],
        resorts: [],
        blogPosts: [],
      };
      if (q.length < 2) return empty;
      const limit = input.limit;
      // Neutralise LIKE metacharacters so a user's "%"/"_" matches literally.
      const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
      const like = `%${escaped}%`;

      const attrFuzzy = fuzzy("a.name", q, escaped);
      const dineFuzzy = fuzzy("r.name", q, escaped);
      const blogFuzzy = fuzzy("title", q, escaped);
      const prefix = `${escaped}%`;

      const [allParks, attractions, dining, menuItems, blogPosts] = await Promise.all([
        fetchParks(),
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
          WHERE a.active = true AND a.entity_type = 'ATTRACTION' AND ${attrFuzzy.where}
          ORDER BY ${attrFuzzy.order}
          LIMIT ${limit}
        `),
        db.execute<{
          facility_id: string;
          name: string;
          park_resort: string | null;
          cuisine: string | null;
          price_range: string | null;
          image_url: string | null;
          character_dining: boolean;
          dinner_show: boolean;
          dining_package: boolean;
          mobile_order: boolean;
          bookable: boolean;
          requires_park_ticket: boolean;
        }>(sql`
          SELECT r.facility_id, r.name, r.park_resort, r.cuisine, r.price_range, r.image_url,
                 r.character_dining,
                 (r.entity_type = 'dinner-show') AS dinner_show,
                 r.dining_package, r.mobile_order, r.bookable,
                 (dl.location_type IN ('theme-park', 'water-park')) AS requires_park_ticket
          FROM restaurant_dim r
          LEFT JOIN dining_location dl ON split_part(dl.id, ';', 1) = r.park_resort_id
          WHERE r.active = true AND ${dineFuzzy.where}
          ORDER BY ${dineFuzzy.order}
          LIMIT ${limit}
        `),
        db.execute<{
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
                   (lower(i.title) LIKE lower(${prefix})) AS prefix
            FROM dining_menu_item i
            JOIN dining_menu_snapshot s
              ON s.facility_id = i.facility_id AND s.observed_at = i.observed_at
            JOIN restaurant_dim r ON r.facility_id = i.facility_id
            WHERE r.active = true
              AND i.title ILIKE ${like} ESCAPE '\\'
          )
          SELECT facility_id, restaurant_name, park_resort, title, price, currency
          FROM matches
          WHERE rn = 1
          ORDER BY prefix DESC, length(title), title
          LIMIT ${limit}
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
            AND (${blogFuzzy.where} OR dek ILIKE ${like} ESCAPE '\\')
          ORDER BY ${blogFuzzy.order}
          LIMIT ${limit}
        `),
      ]);

      // Parks are a tiny fixed set (≈10) already loaded with today's "from"
      // price, so we filter them in-memory rather than round-trip a fuzzy query.
      const needle = q.toLowerCase();
      const parks = allParks
        .filter(
          (p) =>
            p.name.toLowerCase().includes(needle) || !!p.resortName?.toLowerCase().includes(needle),
        )
        .slice(0, limit);

      // Resort hotels are a static catalog (the `/stays` browse set), matched
      // in-memory here rather than via a DB query — they land on `/resort/$slug`.
      const resorts = RESORT_CATALOG.filter(
        (r) => r.name.toLowerCase().includes(needle) || r.area?.toLowerCase().includes(needle),
      )
        .slice(0, limit)
        .map((r) => ({
          type: "resort" as const,
          id: r.id,
          name: r.name,
          slug: r.slug,
          tier: r.tier,
          area: r.area,
          imageUrl: r.image,
        }));

      return {
        parks,
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
          characterDining: d.character_dining,
          dinnerShow: d.dinner_show,
          diningPackage: d.dining_package,
          // Carts/quick-service surface now; flag them so the client can badge a
          // non-bookable venue as "Mobile order" rather than "reservations".
          mobileOrder: d.mobile_order,
          bookable: d.bookable,
          requiresParkTicket: d.requires_park_ticket ?? false,
        })),
        menuItems: menuItems.rows.map((r) => ({
          facilityId: r.facility_id,
          restaurantName: r.restaurant_name,
          parkResort: r.park_resort,
          title: r.title,
          price: r.price === null ? null : Number(r.price),
          currency: r.currency,
        })),
        resorts,
        blogPosts: blogPosts.rows.map((b) => ({
          type: "blog" as const,
          id: b.id,
          title: b.title,
          slug: b.slug,
          dek: b.dek,
          imageUrl: b.hero_image_url,
        })),
      };
    }),
} satisfies TRPCRouterRecord;
