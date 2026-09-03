import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { renderOgCard, titleizeSlug, type OgChip } from "#/server/og/card.tsx";

interface ParkStats {
  name: string;
  resortName: string | null;
  imageUrl: string | null;
  total: number;
  operating: number;
  avgWait: number | null;
  longestWait: number | null;
}

async function loadStats(slug: string): Promise<ParkStats | null> {
  try {
    const result = await db.execute<{
      name: string;
      resort_name: string | null;
      image_url: string | null;
      total: number;
      operating: number;
      avg_wait: number | null;
      longest_wait: number | null;
    }>(sql`
      WITH latest_standby AS (
        SELECT DISTINCT ON (q.attraction_id) q.attraction_id, q.wait_min
        FROM queue_obs q
        JOIN attractions a ON a.id = q.attraction_id
        WHERE a.park_id = (SELECT id FROM parks WHERE slug = ${slug})
          AND q.queue_type = 1 AND q.observed_at >= now() - INTERVAL '24 hours'
        ORDER BY q.attraction_id, q.observed_at DESC
      ),
      latest_status AS (
        SELECT DISTINCT ON (s.attraction_id) s.attraction_id, s.status
        FROM attraction_status_obs s
        JOIN attractions a ON a.id = s.attraction_id
        WHERE a.park_id = (SELECT id FROM parks WHERE slug = ${slug})
        ORDER BY s.attraction_id, s.observed_at DESC
      )
      SELECT p.name, p.image_url, r.name AS resort_name,
             count(*) FILTER (WHERE a.entity_type = 'ATTRACTION')             AS total,
             count(*) FILTER (WHERE ls.status = 1)                            AS operating,
             avg(lsb.wait_min) FILTER (WHERE ls.status = 1
                                        AND lsb.wait_min IS NOT NULL)::int    AS avg_wait,
             max(lsb.wait_min) FILTER (WHERE ls.status = 1)                   AS longest_wait
      FROM parks p
      LEFT JOIN resorts r ON r.id = p.resort_id
      LEFT JOIN attractions a ON a.park_id = p.id AND a.active = true
      LEFT JOIN latest_status ls ON ls.attraction_id = a.id
      LEFT JOIN latest_standby lsb ON lsb.attraction_id = a.id
      WHERE p.slug = ${slug}
      GROUP BY p.name, p.image_url, r.name
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      name: row.name,
      resortName: row.resort_name,
      imageUrl: row.image_url,
      total: Number(row.total),
      operating: Number(row.operating),
      avgWait: row.avg_wait,
      longestWait: row.longest_wait,
    };
  } catch {
    return null;
  }
}

async function renderJpeg(slug: string): Promise<Buffer> {
  const stats = await loadStats(slug);
  const chips: Array<OgChip> = [];
  if (stats?.avgWait != null) chips.push({ value: `${stats.avgWait} min`, label: "Average wait" });
  if (stats && stats.total > 0)
    chips.push({ value: `${stats.operating}/${stats.total}`, label: "Rides operating" });
  if (stats?.longestWait != null && chips.length < 3)
    chips.push({ value: `${stats.longestWait} min`, label: "Longest wait" });
  return renderOgCard({
    title: stats?.name ?? titleizeSlug(slug),
    subtitle: stats?.resortName ?? "Live wait times, forecasts & dining",
    chips,
    imageUrl: stats?.imageUrl,
  });
}

export const Route = createFileRoute("/og/park/$slug/card.jpg")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Parse the slug from the path: `/og/park/<slug>/card.jpg`.
        const path = new URL(request.url).pathname;
        const slug = path.replace(/^\/og\/park\//, "").replace(/\/card\.jpg$/, "");
        const jpeg = await renderJpeg(slug);
        return new Response(new Uint8Array(jpeg), {
          headers: {
            "content-type": "image/jpeg",
            // .jpg extension → Cloudflare caches it by default; long edge TTL,
            // short browser TTL, served stale while the live stats refresh.
            "cache-control": "public, max-age=300, s-maxage=600, stale-while-revalidate=600",
          },
        });
      },
    },
  },
});
