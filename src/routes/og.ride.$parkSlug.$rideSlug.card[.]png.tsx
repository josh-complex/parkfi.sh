import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { renderOgCard, titleizeSlug, type OgBadge, type OgChip } from "#/server/og/card.tsx";

// Queue-type codes (mirrors server/parks/codes.ts): 1 STANDBY, 3 RETURN_TIME
// (Disney LL Multi / Universal Virtual Line), 4 PAID_RETURN_TIME (LL Single).
const STANDBY = 1;
const RETURN_TIME = 3;
const PAID_RETURN_TIME = 4;
// Queue-availability state codes: 1 AVAILABLE, 3 SOLD_OUT.
const STATE_AVAILABLE = 1;
const STATE_SOLD_OUT = 3;

interface RideStats {
  name: string;
  parkName: string;
  operatorSlug: string | null;
  land: string | null;
  imageUrl: string | null;
  standbyWait: number | null;
  status: number | null;
  /** Capability flags + current state for the paid/virtual line. */
  supportTypes: Array<number>;
  llState: number | null;
  returnState: number | null;
}

async function loadStats(parkSlug: string, rideSlug: string): Promise<RideStats | null> {
  try {
    const result = await db.execute<{
      name: string;
      park_name: string;
      operator_slug: string | null;
      land: string | null;
      image_url: string | null;
      standby_wait: number | null;
      status: number | null;
      support_types: Array<number> | null;
      ll_state: number | null;
      return_state: number | null;
    }>(sql`
      WITH park AS (SELECT id, name, operator_id FROM parks WHERE slug = ${parkSlug}),
      ride AS (
        SELECT id, name FROM attractions
        WHERE park_id = (SELECT id FROM park) AND slug = ${rideSlug} AND active = true
        LIMIT 1
      )
      SELECT r.name,
             (SELECT name FROM park) AS park_name,
             (SELECT o.slug FROM operators o WHERE o.id = (SELECT operator_id FROM park)) AS operator_slug,
             m.land,
             coalesce(m.image_hero_url, m.image_thumb_url) AS image_url,
             (SELECT q.wait_min FROM queue_obs q
              WHERE q.attraction_id = r.id AND q.queue_type = ${STANDBY}
                AND q.observed_at >= now() - INTERVAL '24 hours'
              ORDER BY q.observed_at DESC LIMIT 1) AS standby_wait,
             (SELECT s.status FROM attraction_status_obs s
              WHERE s.attraction_id = r.id
              ORDER BY s.observed_at DESC LIMIT 1) AS status,
             (SELECT array_agg(DISTINCT s.queue_type) FROM attraction_queue_support s
              WHERE s.attraction_id = r.id) AS support_types,
             (SELECT q.state FROM queue_obs q
              WHERE q.attraction_id = r.id AND q.queue_type = ${PAID_RETURN_TIME}
                AND q.observed_at >= now() - INTERVAL '24 hours'
              ORDER BY q.observed_at DESC LIMIT 1) AS ll_state,
             (SELECT q.state FROM queue_obs q
              WHERE q.attraction_id = r.id AND q.queue_type = ${RETURN_TIME}
                AND q.observed_at >= now() - INTERVAL '24 hours'
              ORDER BY q.observed_at DESC LIMIT 1) AS return_state
      FROM ride r
      LEFT JOIN attraction_meta m ON m.attraction_id = r.id
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      name: row.name,
      parkName: row.park_name,
      operatorSlug: row.operator_slug,
      land: row.land,
      imageUrl: row.image_url,
      standbyWait: row.standby_wait,
      status: row.status,
      supportTypes: (row.support_types ?? []).map(Number),
      llState: row.ll_state,
      returnState: row.return_state,
    };
  } catch {
    return null;
  }
}

/**
 * Operator-aware paid/virtual line chip. Disney rides advertise "Lightning
 * Lane"; Universal rides only ever offer a free Virtual Line, so we never label
 * them Lightning Lane. Returns null when the ride has no such queue.
 */
function paidLineChip(stats: RideStats): OgChip | null {
  const isUniversal = stats.operatorSlug === "universal";
  if (isUniversal) {
    const has = stats.supportTypes.includes(RETURN_TIME) || stats.returnState != null;
    if (!has) return null;
    const value =
      stats.returnState === STATE_AVAILABLE
        ? "Available"
        : stats.returnState === STATE_SOLD_OUT
          ? "Full"
          : "Offered";
    return { value, label: "Virtual Line" };
  }
  const single = stats.supportTypes.includes(PAID_RETURN_TIME);
  const multi = stats.supportTypes.includes(RETURN_TIME);
  if (!single && !multi) return null;
  const state = single ? stats.llState : stats.returnState;
  const value =
    state === STATE_AVAILABLE ? "Available" : state === STATE_SOLD_OUT ? "Sold out" : "Offered";
  return { value, label: single ? "Lightning Lane (Single)" : "Lightning Lane" };
}

async function renderPng(parkSlug: string, rideSlug: string): Promise<Buffer> {
  const stats = await loadStats(parkSlug, rideSlug);
  const chips: Array<OgChip> = [];
  let badge: OgBadge | null = null;

  if (stats) {
    if (stats.standbyWait != null)
      chips.push({ value: `${stats.standbyWait} min`, label: "Standby now" });
    const paid = paidLineChip(stats);
    if (paid && chips.length < 3) chips.push(paid);

    // STATUS codes: 1 OPERATING, 2 DOWN, 3 CLOSED, 4 REFURBISHMENT.
    if (stats.status === 1) badge = { label: "Open", tone: "open" };
    else if (stats.status === 2) badge = { label: "Down", tone: "down" };
    else if (stats.status === 4) badge = { label: "Refurb", tone: "neutral" };
    else if (stats.status === 3) badge = { label: "Closed", tone: "neutral" };
  }

  const subtitle = stats
    ? [stats.land, stats.parkName].filter(Boolean).join(" · ") || stats.parkName
    : titleizeSlug(parkSlug);

  return renderOgCard({
    title: stats?.name ?? titleizeSlug(rideSlug),
    subtitle,
    chips,
    badge,
    imageUrl: stats?.imageUrl,
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
