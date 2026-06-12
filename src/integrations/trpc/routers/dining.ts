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
      image_url: string | null;
      detail_url: string | null;
      source: number;
      walkup_wait_list: boolean;
      mobile_order: boolean;
      character_dining: boolean;
      fine_dining: boolean;
      annual_pass_discount: boolean;
      disney_visa_discount: boolean;
      dining_plan_qs: boolean;
      dining_plan_ts: boolean;
      has_menu: boolean;
      entity_type: string;
      location_type: string | null;
    }>(sql`
      SELECT r.facility_id, r.name, r.cuisine, r.experience_type, r.price_range, r.park_resort,
             r.image_url, r.detail_url, r.source,
             r.walkup_wait_list, r.mobile_order, r.character_dining, r.fine_dining,
             r.annual_pass_discount, r.disney_visa_discount, r.dining_plan_qs, r.dining_plan_ts,
             (m.facility_id IS NOT NULL AND m.item_count > 0) AS has_menu,
             r.entity_type,
             dl.location_type
      FROM restaurant_dim r
      LEFT JOIN dining_menu_snapshot m ON m.facility_id = r.facility_id
      LEFT JOIN dining_location dl ON dl.id = r.park_resort_id
      WHERE r.priority = true AND r.active = true AND r.bookable = true
      ORDER BY r.park_resort NULLS LAST, r.name
    `);
    return result.rows.map((r) => ({
      facilityId: r.facility_id,
      name: r.name,
      cuisine: r.cuisine,
      experienceType: r.experience_type,
      priceRange: r.price_range,
      parkResort: r.park_resort,
      imageUrl: r.image_url,
      detailUrl: r.detail_url,
      source: Number(r.source),
      walkupWaitList: r.walkup_wait_list,
      mobileOrder: r.mobile_order,
      characterDining: r.character_dining,
      fineDining: r.fine_dining,
      annualPassDiscount: r.annual_pass_discount,
      disneyVisaDiscount: r.disney_visa_discount,
      diningPlanQs: r.dining_plan_qs,
      diningPlanTs: r.dining_plan_ts,
      hasMenu: r.has_menu,
      dinnerShow: r.entity_type === "dinner-show",
      requiresParkTicket: r.location_type === "theme-park" || r.location_type === "water-park",
    }));
  }),

  /**
   * Curated "Disney Picks" shelves — pure catalog (no availability), spanning the
   * full active bookable Disney set rather than just the priority sweep. Groups
   * venues by the finder taxonomy arrays / attribute flags into a handful of
   * ordered buckets; only non-empty buckets are returned.
   */
  picks: publicProcedure.query(async () => {
    const result = await db.execute<{
      facility_id: string;
      name: string;
      cuisine: string | null;
      park_resort: string | null;
      price_range: string | null;
      image_url: string | null;
      detail_url: string | null;
      character_dining: boolean;
      fine_dining: boolean;
      dining_interests: string[] | null;
      disney_favorites: string[] | null;
    }>(sql`
      SELECT facility_id, name, cuisine, park_resort, price_range, image_url, detail_url,
             character_dining, fine_dining, dining_interests, disney_favorites
      FROM restaurant_dim
      WHERE source = 3 AND active = true AND bookable = true
      ORDER BY name
    `);

    const venues = result.rows.map((r) => ({
      facilityId: r.facility_id,
      name: r.name,
      cuisine: r.cuisine,
      parkResort: r.park_resort,
      priceRange: r.price_range,
      imageUrl: r.image_url,
      detailUrl: r.detail_url,
      characterDining: r.character_dining,
      fineDining: r.fine_dining,
      diningInterests: r.dining_interests ?? [],
      disneyFavorites: r.disney_favorites ?? [],
    }));
    type Venue = (typeof venues)[number];

    // Ordered shelf definitions. `match` decides membership; the first few keys
    // are high-signal experiences, the franchise shelves come after.
    const BUCKETS: Array<{
      key: string;
      title: string;
      subtitle: string;
      match: (v: Venue) => boolean;
    }> = [
      {
        key: "character",
        title: "Character Dining",
        subtitle: "Meet the characters over a meal",
        match: (v) => v.characterDining || v.diningInterests.includes("character-dining-rec"),
      },
      {
        key: "signature",
        title: "Signature & Fine Dining",
        subtitle: "Special-occasion table service",
        match: (v) => v.fineDining || v.diningInterests.includes("fine-signature-dining-rec"),
      },
      {
        key: "events",
        title: "Dining Events",
        subtitle: "Dessert parties, brunches & more",
        match: (v) => v.diningInterests.includes("dining-events-rec"),
      },
      {
        key: "star-wars",
        title: "Star Wars Dining",
        subtitle: "A galaxy far, far away",
        match: (v) => v.disneyFavorites.includes("star-wars-rec"),
      },
      {
        key: "princess",
        title: "Princess Dining",
        subtitle: "Dine with Disney royalty",
        match: (v) => v.disneyFavorites.includes("disney-princesses-rec"),
      },
      {
        key: "mickey-friends",
        title: "Mickey & Friends",
        subtitle: "Classic Disney favorites",
        match: (v) => v.disneyFavorites.includes("mickey-friends-rec"),
      },
      {
        key: "pixar",
        title: "Pixar Dining",
        subtitle: "From Toy Story to Coco",
        match: (v) => v.disneyFavorites.includes("pixar-rec"),
      },
    ];

    return BUCKETS.map((b) => ({
      key: b.key,
      title: b.title,
      subtitle: b.subtitle,
      venues: venues.filter(b.match).map((v) => ({
        facilityId: v.facilityId,
        name: v.name,
        cuisine: v.cuisine,
        parkResort: v.parkResort,
        priceRange: v.priceRange,
        imageUrl: v.imageUrl,
        detailUrl: v.detailUrl,
      })),
    })).filter((b) => b.venues.length > 0);
  }),

  /**
   * Operating hours for a single date (default: today), keyed by facility. Reads
   * the weekly-refreshed `dining_schedule` window. The client compares the
   * returned start/end times against the current park-local time to drive
   * "open now / open late / open for breakfast" badges and filters, so the
   * server stays time-agnostic and the UI never goes stale between refetches.
   */
  hours: publicProcedure
    .input(z.object({ date: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const dateFilter = input?.date ? sql`= ${input.date}::date` : sql`= current_date`;
      const result = await db.execute<{
        facility_id: string;
        schedule_type: string;
        start_time: string;
        end_time: string;
      }>(sql`
        SELECT facility_id, schedule_type, start_time, end_time
        FROM dining_schedule
        WHERE schedule_date ${dateFilter}
        ORDER BY facility_id, start_time
      `);

      const byFacility = new Map<
        string,
        Array<{ scheduleType: string; startTime: string; endTime: string }>
      >();
      for (const r of result.rows) {
        if (!byFacility.has(r.facility_id)) byFacility.set(r.facility_id, []);
        byFacility.get(r.facility_id)!.push({
          scheduleType: r.schedule_type,
          startTime: r.start_time,
          endTime: r.end_time,
        });
      }
      return [...byFacility.entries()].map(([facilityId, schedules]) => ({
        facilityId,
        schedules,
      }));
    }),

  /**
   * Current menu for one venue — the `dining_menu_item` rows whose `observed_at`
   * matches the venue's `dining_menu_snapshot` pointer (the live generation),
   * grouped meal-period → group → item in capture order. Returns null `menu`
   * when the venue has no captured menu yet.
   */
  menu: publicProcedure.input(z.object({ facilityId: z.string() })).query(async ({ input }) => {
    const snap = await db.execute<{
      observed_at: string;
      item_count: number;
      first_seen_at: string;
      last_checked_at: string;
    }>(sql`
        SELECT observed_at, item_count, first_seen_at, last_checked_at
        FROM dining_menu_snapshot
        WHERE facility_id = ${input.facilityId}
      `);
    const meta = snap.rows[0];
    if (!meta || meta.item_count === 0) {
      return { facilityId: input.facilityId, lastCheckedAt: null, mealPeriods: [] };
    }

    const items = await db.execute<{
      meal_period: string;
      group_name: string | null;
      item_type: string | null;
      title: string;
      description: string | null;
      price: number | null;
      price_type: string | null;
      currency: string | null;
    }>(sql`
        SELECT i.meal_period, i.group_name, i.item_type, i.title, i.description, i.price, i.price_type, i.currency
        FROM dining_menu_item i
        JOIN dining_menu_snapshot s
          ON s.facility_id = i.facility_id AND s.observed_at = i.observed_at
        WHERE i.facility_id = ${input.facilityId}
        ORDER BY i.id
      `);

    // Group preserving capture order: meal period → group → items.
    type Item = {
      title: string;
      description: string | null;
      price: number | null;
      priceType: string | null;
      currency: string | null;
    };
    type Group = { groupName: string | null; itemType: string | null; items: Array<Item> };
    const periods: Array<{ mealPeriod: string; groups: Array<Group> }> = [];
    const periodIdx = new Map<string, number>();
    const groupIdx = new Map<string, number>();
    for (const r of items.rows) {
      let pi = periodIdx.get(r.meal_period);
      if (pi === undefined) {
        pi = periods.length;
        periodIdx.set(r.meal_period, pi);
        periods.push({ mealPeriod: r.meal_period, groups: [] });
      }
      const gkey = `${pi}|${r.group_name ?? ""}|${r.item_type ?? ""}`;
      let gi = groupIdx.get(gkey);
      if (gi === undefined) {
        gi = periods[pi]!.groups.length;
        groupIdx.set(gkey, gi);
        periods[pi]!.groups.push({ groupName: r.group_name, itemType: r.item_type, items: [] });
      }
      periods[pi]!.groups[gi]!.items.push({
        title: r.title,
        description: r.description,
        price: r.price === null ? null : Number(r.price),
        priceType: r.price_type,
        currency: r.currency,
      });
    }

    return {
      facilityId: input.facilityId,
      lastCheckedAt: meta.last_checked_at,
      mealPeriods: periods,
    };
  }),

  /**
   * Recent menu price moves (the append-only `dining_menu_price_change` log),
   * newest first, joined to the venue name. Optionally scoped to one venue.
   * Empty until ≥2 catalog runs have observed a price change.
   */
  menuChanges: publicProcedure
    .input(
      z
        .object({
          facilityId: z.string().optional(),
          sinceDays: z.number().int().min(1).max(120).default(30),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const sinceDays = input?.sinceDays ?? 30;
      const limit = input?.limit ?? 50;
      const facilityFilter = input?.facilityId
        ? sql`AND c.facility_id = ${input.facilityId}`
        : sql``;
      const result = await db.execute<{
        facility_id: string;
        name: string;
        meal_period: string;
        group_name: string | null;
        title: string;
        old_price: number | null;
        new_price: number | null;
        price_type: string | null;
        currency: string | null;
        changed_at: string;
      }>(sql`
        SELECT c.facility_id, r.name, c.meal_period, c.group_name, c.title,
               c.old_price, c.new_price, c.price_type, c.currency, c.changed_at
        FROM dining_menu_price_change c
        JOIN restaurant_dim r ON r.facility_id = c.facility_id
        WHERE c.changed_at >= now() - make_interval(days => ${sinceDays})
          ${facilityFilter}
        ORDER BY c.changed_at DESC
        LIMIT ${limit}
      `);
      return result.rows.map((r) => ({
        facilityId: r.facility_id,
        name: r.name,
        mealPeriod: r.meal_period,
        groupName: r.group_name,
        title: r.title,
        oldPrice: r.old_price === null ? null : Number(r.old_price),
        newPrice: r.new_price === null ? null : Number(r.new_price),
        priceType: r.price_type,
        currency: r.currency,
        changedAt: r.changed_at,
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
