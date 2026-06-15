import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { renderOgCard, titleizeSlug, type OgChip } from "#/server/og/card.tsx";

interface RideStats {
  name: string;
  parkName: string;
  standbyWait: number | null;
  status: number | null;
}

async function loadStats(parkSlug: string, rideSlug: string): Promise<RideStats | null> {
  try {
    const result = await db.execute<{
      name: string;
      park_name: string;
      standby_wait: number | null;
      status: number | null;
    }>(sql`
      WITH park AS (SELECT id, name FROM parks WHERE slug = ${parkSlug}),
      ride AS (
        SELECT id, name FROM attractions
        WHERE park_id = (SELECT id FROM park) AND slug = ${rideSlug} AND active = true
        LIMIT 1
      )
      SELECT r.name, (SELECT name FROM park) AS park_name,
             (SELECT q.wait_min FROM queue_obs q
              WHERE q.attraction_id = r.id AND q.queue_type = 1
                AND q.observed_at >= now() - INTERVAL '24 hours'
              ORDER BY q.observed_at DESC LIMIT 1) AS standby_wait,
             (SELECT s.status FROM attraction_status_obs s
              WHERE s.attraction_id = r.id
              ORDER BY s.observed_at DESC LIMIT 1) AS status
      FROM ride r
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      name: row.name,
      parkName: row.park_name,
      standbyWait: row.standby_wait,
      status: row.status,
    };
  } catch {
    return null;
  }
}

async function renderPng(parkSlug: string, rideSlug: string): Promise<Buffer> {
  const stats = await loadStats(parkSlug, rideSlug);
  const chips: Array<OgChip> = [];
  if (stats?.standbyWait != null)
    chips.push({ value: `${stats.standbyWait} min`, label: "Standby now" });
  if (stats?.status === 1) chips.push({ value: "Open", label: "Status" });
  return renderOgCard({
    title: stats?.name ?? titleizeSlug(rideSlug),
    subtitle: stats?.parkName ?? titleizeSlug(parkSlug),
    chips,
  });
}

export const Route = createFileRoute("/og/ride/$parkSlug/$rideSlug/card.png")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Path: `/og/ride/<parkSlug>/<rideSlug>/card.png`.
        const path = new URL(request.url).pathname;
        const rest = path.replace(/^\/og\/ride\//, "").replace(/\/card\.png$/, "");
        const [parkSlug = "", rideSlug = ""] = rest.split("/");
        const png = await renderPng(parkSlug, rideSlug);
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
