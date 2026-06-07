import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { publicProcedure } from "../init.ts";

import type { TRPCRouterRecord } from "@trpc/server";

export const diningRouter = {
  restaurants: publicProcedure.query(async () => {
    const result = await db.execute<{
      facility_id: string;
      name: string;
      cuisine: string | null;
      experience_type: string | null;
      price_range: string | null;
      park_resort: string | null;
    }>(sql`
      SELECT facility_id, name, cuisine, experience_type, price_range, park_resort
      FROM restaurant_dim
      WHERE priority = true AND active = true AND bookable = true
      ORDER BY name
    `);
    return result.rows.map((r) => ({
      facilityId: r.facility_id,
      name: r.name,
      cuisine: r.cuisine,
      experienceType: r.experience_type,
      priceRange: r.price_range,
      parkResort: r.park_resort,
    }));
  }),

  availability: publicProcedure
    .input(
      z.object({
        facilityId: z.string().optional(),
        days: z.number().int().min(1).max(90).default(30),
        partySize: z.number().int().min(1).max(8).default(2),
      }),
    )
    .query(async ({ input }) => {
      const facilityFilter = input.facilityId
        ? sql`AND d.facility_id = ${input.facilityId}`
        : sql``;

      const result = await db.execute<{
        facility_id: string;
        name: string;
        service_date: string;
        observed_at: string;
        available: boolean;
        offer_count: string;
        meal_periods: string[] | null;
      }>(sql`
        WITH latest_ts AS (
          SELECT facility_id, service_date, party_size, max(observed_at) AS observed_at
          FROM dining_obs
          WHERE service_date >= current_date
            AND service_date < current_date + ${input.days}::int
            AND party_size = ${input.partySize}
            ${facilityFilter}
          GROUP BY facility_id, service_date, party_size
        ),
        snapshot AS (
          SELECT d.facility_id, d.service_date,
                 lt.observed_at,
                 bool_or(d.meal_period <> '') AS available,
                 count(*) FILTER (WHERE d.meal_period <> '') AS offer_count,
                 array_agg(DISTINCT d.meal_period) FILTER (WHERE d.meal_period <> '') AS meal_periods
          FROM dining_obs d
          JOIN latest_ts lt
            ON lt.facility_id = d.facility_id
            AND lt.service_date = d.service_date
            AND lt.party_size = d.party_size
            AND lt.observed_at = d.observed_at
          GROUP BY d.facility_id, d.service_date, lt.observed_at
        )
        SELECT r.facility_id, r.name,
               s.service_date, s.observed_at, s.available,
               s.offer_count, s.meal_periods
        FROM restaurant_dim r
        JOIN snapshot s ON s.facility_id = r.facility_id
        WHERE r.priority = true AND r.active = true AND r.bookable = true
        ORDER BY r.name, s.service_date
      `);

      // Group flat rows by restaurant
      const byFacility = new Map<
        string,
        {
          facilityId: string;
          name: string;
          days: Array<{
            date: string;
            available: boolean;
            offerCount: number;
            mealPeriods: string[];
            observedAt: string;
          }>;
        }
      >();

      for (const row of result.rows) {
        if (!byFacility.has(row.facility_id)) {
          byFacility.set(row.facility_id, {
            facilityId: row.facility_id,
            name: row.name,
            days: [],
          });
        }
        byFacility.get(row.facility_id)!.days.push({
          date: String(row.service_date).slice(0, 10),
          available: row.available,
          offerCount: Number(row.offer_count),
          mealPeriods: row.meal_periods ?? [],
          observedAt: row.observed_at,
        });
      }

      return [...byFacility.values()];
    }),
} satisfies TRPCRouterRecord;
