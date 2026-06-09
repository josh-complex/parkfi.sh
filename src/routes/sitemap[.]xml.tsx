import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { SITE_URL } from "#/lib/seo.ts";

/** Public, indexable pages that always exist regardless of DB state. */
const STATIC_PATHS = ["/", "/tickets", "/dining", "/disclaimers"];

async function buildSitemap(): Promise<string> {
  let parkPaths: string[] = [];
  try {
    const result = await db.execute<{ slug: string }>(
      sql`SELECT slug FROM parks WHERE active = true ORDER BY slug`,
    );
    parkPaths = result.rows.map((r) => `/park/${r.slug}`);
  } catch {
    // DB unavailable — still serve the static sitemap rather than 500.
  }

  const urls = [...STATIC_PATHS, ...parkPaths]
    .map((path) => `  <url><loc>${SITE_URL}${path}</loc></url>`)
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
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
