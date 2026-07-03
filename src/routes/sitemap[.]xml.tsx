import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { SITE_URL } from "#/lib/seo.ts";
import { RESORT_CATALOG } from "#/server/stays/resort-catalog.generated.ts";

/** Public, indexable pages that always exist regardless of DB state. */
const STATIC_PATHS = [
  "/",
  "/welcome",
  "/map",
  "/tickets",
  "/dining",
  "/predictions",
  "/stays",
  "/pins",
  "/blog",
  "/privacy",
  "/disclaimers",
];

interface SitemapEntry {
  path: string;
  lastmod?: string;
}

async function buildSitemap(): Promise<string> {
  let parkEntries: SitemapEntry[] = [];
  try {
    // lastmod = the park's most recent observation, so search engines recrawl
    // pages that actually changed instead of on a blind schedule.
    const result = await db.execute<{ slug: string; lastmod: string | null }>(sql`
      SELECT p.slug,
             max(q.observed_at) AS lastmod
      FROM parks p
      LEFT JOIN attractions a ON a.park_id = p.id
      LEFT JOIN queue_obs q ON q.attraction_id = a.id
        AND q.observed_at >= now() - INTERVAL '7 days'
      WHERE p.active = true
      GROUP BY p.slug
      ORDER BY p.slug
    `);
    parkEntries = result.rows.map((r) => ({
      path: `/park/${r.slug}`,
      lastmod: r.lastmod ?? undefined,
    }));
  } catch {
    // DB unavailable — still serve the static sitemap rather than 500.
  }

  let rideEntries: SitemapEntry[] = [];
  try {
    // One URL per active attraction, lastmod = its most recent observation.
    const result = await db.execute<{
      park_slug: string;
      ride_slug: string;
      lastmod: string | null;
    }>(sql`
      SELECT p.slug AS park_slug, a.slug AS ride_slug, max(q.observed_at) AS lastmod
      FROM attractions a
      JOIN parks p ON p.id = a.park_id
      LEFT JOIN queue_obs q ON q.attraction_id = a.id
        AND q.observed_at >= now() - INTERVAL '7 days'
      WHERE a.active = true AND a.entity_type = 'ATTRACTION' AND p.active = true
      GROUP BY p.slug, a.slug
      ORDER BY p.slug, a.slug
    `);
    rideEntries = result.rows.map((r) => ({
      path: `/park/${r.park_slug}/ride/${r.ride_slug}`,
      lastmod: r.lastmod ?? undefined,
    }));
  } catch {
    // DB unavailable — skip rides.
  }

  let diningEntries: SitemapEntry[] = [];
  try {
    const result = await db.execute<{ facility_id: string; lastmod: string | null }>(sql`
      SELECT r.facility_id, m.last_checked_at AS lastmod
      FROM restaurant_dim r
      LEFT JOIN dining_menu_snapshot m ON m.facility_id = r.facility_id
      WHERE r.active = true
      ORDER BY r.facility_id
    `);
    diningEntries = result.rows.map((r) => ({
      path: `/dining/${r.facility_id}`,
      lastmod: r.lastmod ?? undefined,
    }));
  } catch {
    // DB unavailable — skip dining.
  }

  // Resort hotels are a static catalog, so they're always enumerable.
  const resortEntries: SitemapEntry[] = RESORT_CATALOG.map((r) => ({
    path: `/resort/${r.slug}`,
  }));

  let pinEntries: SitemapEntry[] = [];
  try {
    // Pin detail pages. Only pins with at least one reference image — imageless
    // rows render a thin, near-empty page that would dilute crawl quality.
    const result = await db.execute<{ id: string; lastmod: string | null }>(sql`
      SELECT p.id, p.updated_at AS lastmod
      FROM pin p
      WHERE EXISTS (SELECT 1 FROM pin_image i WHERE i.pin_id = p.id)
      ORDER BY p.updated_at DESC
      LIMIT 10000
    `);
    pinEntries = result.rows.map((r) => ({
      path: `/pins/${r.id}`,
      lastmod: r.lastmod ?? undefined,
    }));
  } catch {
    // DB unavailable — skip pins.
  }

  let blogEntries: SitemapEntry[] = [];
  try {
    const result = await db.execute<{ slug: string; lastmod: string | null }>(sql`
      SELECT slug, published_at AS lastmod
      FROM blog_post
      WHERE status = 'published'
      ORDER BY published_at DESC
      LIMIT 1000
    `);
    blogEntries = result.rows.map((r) => ({
      path: `/blog/${r.slug}`,
      lastmod: r.lastmod ?? undefined,
    }));
  } catch {
    // Blog table may not exist yet — skip.
  }

  const entries: SitemapEntry[] = [
    ...STATIC_PATHS.map((path) => ({ path })),
    ...parkEntries,
    ...rideEntries,
    ...diningEntries,
    ...resortEntries,
    ...pinEntries,
    ...blogEntries,
  ];
  const urls = entries
    .map(({ path, lastmod }) => {
      const lm = lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : "";
      return `  <url><loc>${SITE_URL}${path}</loc>${lm}</url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const xml = await buildSitemap();
        return new Response(xml, {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
          },
        });
      },
    },
  },
});
