import { createFileRoute } from "@tanstack/react-router";
import { desc, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { blogPost } from "#/db/schema.ts";
import { SITE_NAME, SITE_URL } from "#/lib/seo.ts";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function buildFeed(): Promise<string> {
  let items = "";
  try {
    const rows = await db
      .select({
        slug: blogPost.slug,
        title: blogPost.title,
        dek: blogPost.dek,
        publishedAt: blogPost.publishedAt,
      })
      .from(blogPost)
      .where(eq(blogPost.status, "published"))
      .orderBy(desc(blogPost.publishedAt))
      .limit(50);

    items = rows
      .map((p) => {
        const url = `${SITE_URL}/blog/${p.slug}`;
        const date = p.publishedAt ? new Date(p.publishedAt).toUTCString() : "";
        return `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <description>${escapeXml(p.dek)}</description>
      ${date ? `<pubDate>${date}</pubDate>` : ""}
    </item>`;
      })
      .join("\n");
  } catch {
    // DB unavailable — serve an empty but valid feed rather than 500.
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${SITE_NAME} — Orlando Theme Park News &amp; Analysis</title>
    <link>${SITE_URL}/blog</link>
    <description>Daily analysis of Walt Disney World and Universal Orlando news.</description>
${items}
  </channel>
</rss>
`;
}

export const Route = createFileRoute("/blog/rss.xml")({
  server: {
    handlers: {
      GET: async () => {
        const xml = await buildFeed();
        return new Response(xml, {
          headers: {
            "content-type": "application/rss+xml; charset=utf-8",
            "cache-control": "public, s-maxage=900, stale-while-revalidate=86400",
          },
        });
      },
    },
  },
});
