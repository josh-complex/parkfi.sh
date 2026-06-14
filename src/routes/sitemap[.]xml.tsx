import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { SITE_URL } from "#/lib/seo.ts";

/** Public, indexable pages that always exist regardless of DB state. */
const STATIC_PATHS = ["/", "/tickets", "/dining", "/predictions", "/stays", "/disclaimers"];

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

  const entries: SitemapEntry[] = [...STATIC_PATHS.map((path) => ({ path })), ...parkEntries];
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
