import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

import { db } from "#/db/index.ts";
import { GEIST_REGULAR_BASE64 } from "#/server/og/geist-font.ts";
import { SITE_NAME } from "#/lib/seo.ts";

const WIDTH = 1200;
const HEIGHT = 630;
const FONT = Buffer.from(GEIST_REGULAR_BASE64, "base64");

/** "magic-kingdom" -> "Magic Kingdom" fallback when the park isn't in the DB. */
function titleizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface ParkStats {
  name: string;
  total: number;
  operating: number;
  avgWait: number | null;
}

async function loadStats(slug: string): Promise<ParkStats | null> {
  try {
    const result = await db.execute<{
      name: string;
      total: number;
      operating: number;
      avg_wait: number | null;
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
      SELECT p.name,
             count(*) FILTER (WHERE a.entity_type = 'ATTRACTION')             AS total,
             count(*) FILTER (WHERE ls.status = 1)                            AS operating,
             avg(lsb.wait_min) FILTER (WHERE ls.status = 1
                                        AND lsb.wait_min IS NOT NULL)::int    AS avg_wait
      FROM parks p
      LEFT JOIN attractions a ON a.park_id = p.id AND a.active = true
      LEFT JOIN latest_status ls ON ls.attraction_id = a.id
      LEFT JOIN latest_standby lsb ON lsb.attraction_id = a.id
      WHERE p.slug = ${slug}
      GROUP BY p.name
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      name: row.name,
      total: Number(row.total),
      operating: Number(row.operating),
      avgWait: row.avg_wait,
    };
  } catch {
    return null;
  }
}

/** A pill stat (label + value) — satori needs explicit flex on multi-child nodes. */
function Chip({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "20px 32px",
        borderRadius: 20,
        background: "rgba(255,255,255,0.10)",
        border: "1px solid rgba(255,255,255,0.18)",
      }}
    >
      <span style={{ fontSize: 52, color: "#ffffff", letterSpacing: -1 }}>{value}</span>
      <span style={{ fontSize: 24, color: "rgba(255,255,255,0.65)" }}>{label}</span>
    </div>
  );
}

function Card({ stats, fallbackName }: { stats: ParkStats | null; fallbackName: string }) {
  const name = stats?.name ?? fallbackName;
  return (
    <div
      style={{
        width: WIDTH,
        height: HEIGHT,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: "linear-gradient(135deg, #0b1f3a 0%, #1c468e 100%)",
        fontFamily: "Geist",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 18, height: 18, borderRadius: 6, background: "#5b9dff" }} />
        <span style={{ fontSize: 30, color: "#ffffff", letterSpacing: 4 }}>
          {SITE_NAME.toUpperCase()}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 96, color: "#ffffff", letterSpacing: -3, lineHeight: 1.05 }}>
          {name}
        </span>
        <span style={{ fontSize: 36, color: "rgba(255,255,255,0.75)" }}>
          Live wait times, forecasts &amp; dining
        </span>
      </div>

      <div style={{ display: "flex", gap: 24 }}>
        {stats?.avgWait != null && <Chip value={`${stats.avgWait} min`} label="Average wait" />}
        {stats && stats.total > 0 && (
          <Chip value={`${stats.operating}/${stats.total}`} label="Rides operating" />
        )}
        <Chip value="parkfi.sh" label="Plan your day" />
      </div>
    </div>
  );
}

async function renderPng(slug: string): Promise<Buffer> {
  const stats = await loadStats(slug);
  const svg = await satori(<Card stats={stats} fallbackName={titleizeSlug(slug)} />, {
    width: WIDTH,
    height: HEIGHT,
    fonts: [{ name: "Geist", data: FONT, weight: 400, style: "normal" }],
  });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } }).render().asPng();
  return png;
}

export const Route = createFileRoute("/og/park/$slug/card.png")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Parse the slug from the path: `/og/park/<slug>/card.png`.
        const path = new URL(request.url).pathname;
        const slug = path.replace(/^\/og\/park\//, "").replace(/\/card\.png$/, "");
        const png = await renderPng(slug);
        return new Response(new Uint8Array(png), {
          headers: {
            "content-type": "image/png",
            // .png extension → Cloudflare caches it by default; long edge TTL,
            // short browser TTL, served stale while the live stats refresh.
            "cache-control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
          },
        });
      },
    },
  },
});
