import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { UOR_PARKS, WDW_PARKS } from "#/lib/parks.ts";
import { publicProcedure } from "../init.ts";

import type { TRPCRouterRecord } from "@trpc/server";

// Each resort's date-priced "from price to skip/enter" product. WDW date-prices
// admission (Lightning Lane isn't in this feed); Universal date-prices Express
// (its 1-day admission is a flat list price), so that's what the calendar shows.

function parkLabel(
  parks: Array<{ code: string; label: string }>,
  code: string | null,
): string | null {
  if (!code) return null;
  return parks.find((p) => p.code === code)?.label ?? code;
}

function wdwProduct(
  parkHopper: boolean,
  ageGroup: "ADULT" | "CHILD",
  park: string | null,
): { label: string; filter: SQL } {
  const ageStr = ageGroup === "CHILD" ? "Child" : "Adult";
  const parts = [
    parkHopper ? "Park Hopper" : "1-Day",
    ageStr,
    parkLabel(WDW_PARKS, park),
    "Ticket",
  ];
  const parkCond = park ? sql` AND d.park_scope && ARRAY[${park}]::text[]` : sql``;
  return {
    label: parts.filter(Boolean).join(" "),
    filter: sql`d.duration_days = 1 AND d.age_group = ${ageGroup} AND d.residency = 'STD' AND d.park_to_park = ${parkHopper}${parkCond}`,
  };
}

function uorProduct(
  ageGroup: "ADULT" | "CHILD",
  park: string | null,
): { label: string; filter: SQL } {
  const ageStr = ageGroup === "CHILD" ? "Child" : "Adult";
  const parts = ["1-Day", ageStr, parkLabel(UOR_PARKS, park), "Express Pass"];
  // age_group IS NULL covers Express SKUs that don't encode adult/child in the part number
  const parkCond = park ? sql` AND d.park_scope && ARRAY[${park}]::text[]` : sql``;
  return {
    label: parts.filter(Boolean).join(" "),
    filter: sql`d.family = 'EXPRESS' AND d.variable_priced = true AND (d.age_group = ${ageGroup} OR d.age_group IS NULL)${parkCond}`,
  };
}

export const ticketsRouter = {
  /**
   * Per-date pricing calendar for a resort: the cheapest qualifying product for
   * each service date, from the latest snapshot. `available` is true if any
   * qualifying SKU was sellable that day. Returns the product label so the UI
   * can title itself (admission for WDW, Express for UOR).
   */
  priceCalendar: publicProcedure
    .input(
      z.object({
        resort: z.enum(["WDW", "UOR"]).default("WDW"),
        days: z.number().int().min(1).max(365).default(120),
        pastDays: z.number().int().min(0).max(365).default(90),
        parkHopper: z.boolean().default(false),
        ageGroup: z.enum(["ADULT", "CHILD"]).default("ADULT"),
        park: z.string().nullable().default(null),
      }),
    )
    .query(async ({ input }) => {
      const product =
        input.resort === "UOR"
          ? uorProduct(input.ageGroup, input.park)
          : wdwProduct(input.parkHopper, input.ageGroup, input.park);
      const result = await db.execute<{
        service_date: Date | string;
        price_cents: number;
        available: boolean | null;
        observed_at: string | null;
      }>(sql`
        WITH latest AS (
          SELECT DISTINCT ON (sp.sku, sp.service_date)
                 sp.sku, sp.service_date, sp.price_cents, sp.available, sp.observed_at
          FROM sku_price_obs sp
          JOIN product_dim d ON d.sku = sp.sku
          WHERE d.resort = ${input.resort}
            AND ${product.filter}
            AND sp.service_date >= current_date - ${input.pastDays}::int
            AND sp.service_date < current_date + ${input.days}::int
          ORDER BY sp.sku, sp.service_date, sp.observed_at DESC
        )
        SELECT service_date,
               min(price_cents) AS price_cents,
               bool_or(available) AS available,
               max(observed_at) AS observed_at
        FROM latest
        WHERE price_cents IS NOT NULL
        GROUP BY service_date
        ORDER BY service_date
      `);
      const lastUpdatedAt = result.rows.reduce<string | null>((m, r) => {
        if (!r.observed_at) return m;
        const s = String(r.observed_at);
        return !m || s > m ? s : m;
      }, null);
      return {
        resort: input.resort,
        productLabel: product.label,
        lastUpdatedAt,
        days: result.rows.map((r) => ({
          date: (r.service_date instanceof Date
            ? r.service_date.toISOString()
            : String(r.service_date)
          ).slice(0, 10),
          priceCents: Number(r.price_cents),
          available: r.available ?? true,
        })),
      };
    }),
} satisfies TRPCRouterRecord;
