import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { suppressedFields } from "#/server/content/suppression.ts";
import { buildDiningDeepLink } from "#/server/notifications/diningFormat.ts";
import { config } from "#/server/parks/config.ts";
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
      dining_package: boolean;
      annual_pass_discount: boolean;
      disney_visa_discount: boolean;
      dining_plan_qs: boolean;
      dining_plan_ts: boolean;
      has_menu: boolean;
      entity_type: string;
      location_type: string | null;
      priority: boolean;
      bookable: boolean;
    }>(sql`
      SELECT r.facility_id, r.name, r.cuisine, r.experience_type, r.price_range, r.park_resort,
             r.image_url, r.detail_url, r.source,
             r.walkup_wait_list, r.mobile_order, r.character_dining, r.fine_dining,
             r.dining_package,
             r.annual_pass_discount, r.disney_visa_discount, r.dining_plan_qs, r.dining_plan_ts,
             (m.facility_id IS NOT NULL AND m.item_count > 0) AS has_menu,
             r.entity_type,
             dl.location_type,
             r.priority, r.bookable
      FROM restaurant_dim r
      LEFT JOIN dining_menu_snapshot m ON m.facility_id = r.facility_id
      LEFT JOIN dining_location dl ON split_part(dl.id, ';', 1) = r.park_resort_id
      WHERE r.active = true
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
      diningPackage: r.dining_package,
      annualPassDiscount: r.annual_pass_discount,
      disneyVisaDiscount: r.disney_visa_discount,
      diningPlanQs: r.dining_plan_qs,
      diningPlanTs: r.dining_plan_ts,
      hasMenu: r.has_menu,
      dinnerShow: r.entity_type === "dinner-show",
      requiresParkTicket: r.location_type === "theme-park" || r.location_type === "water-park",
      // The availability sweep only covers priority && bookable venues; the board
      // renders a reservation grid for those and a mobile-order badge for the
      // rest (snack carts, quick service).
      availabilityEligible: r.priority && r.bookable,
      bookable: r.bookable,
    }));
  }),

  /**
   * Single-venue header row for the restaurant detail page (`/dining/$facilityId`).
   * Same column set as `restaurants`, scoped to one facility and not gated on
   * `priority`/`bookable` so any catalog venue with a URL resolves. Returns null
   * when the facility is unknown or inactive.
   */
  venue: publicProcedure.input(z.object({ facilityId: z.string() })).query(async ({ input }) => {
    const result = await db.execute<{
      facility_id: string;
      name: string;
      cuisine: string | null;
      experience_type: string | null;
      price_range: string | null;
      park_resort: string | null;
      image_url: string | null;
      detail_url: string | null;
      url_friendly_id: string | null;
      entity_type: string;
      character_dining: boolean;
      fine_dining: boolean;
      dining_package: boolean;
      walkup_wait_list: boolean;
      mobile_order: boolean;
      annual_pass_discount: boolean;
      disney_visa_discount: boolean;
      trip_advisor_award: boolean;
      dining_plan_qs: boolean;
      dining_plan_ts: boolean;
      land: string | null;
      map_pin: string | null;
      latitude: number | null;
      longitude: number | null;
      maximum_party_size: number | null;
      dining_interests: string[] | null;
      disney_favorites: string[] | null;
      entertainment_type: string[] | null;
      priority: boolean;
      bookable: boolean;
      has_menu: boolean;
      last_checked_at: string | null;
      first_seen_at: string;
      location_type: string | null;
    }>(sql`
      SELECT r.facility_id, r.name, r.cuisine, r.experience_type, r.price_range, r.park_resort,
             r.image_url, r.detail_url, r.url_friendly_id, r.entity_type,
             r.character_dining, r.fine_dining, r.dining_package,
             r.walkup_wait_list, r.mobile_order,
             r.annual_pass_discount, r.disney_visa_discount, r.trip_advisor_award,
             r.dining_plan_qs, r.dining_plan_ts,
             r.land, r.map_pin, r.latitude, r.longitude, r.maximum_party_size,
             r.dining_interests, r.disney_favorites, r.entertainment_type,
             r.priority, r.bookable,
             (m.facility_id IS NOT NULL AND m.item_count > 0) AS has_menu,
             m.last_checked_at,
             r.first_seen_at,
             dl.location_type
      FROM restaurant_dim r
      LEFT JOIN dining_menu_snapshot m ON m.facility_id = r.facility_id
      LEFT JOIN dining_location dl ON split_part(dl.id, ';', 1) = r.park_resort_id
      WHERE r.facility_id = ${input.facilityId} AND r.active = true
      LIMIT 1
    `);
    const r = result.rows[0];
    if (!r) return null;
    // Reversible content suppression from the removal-request flow.
    const suppressed = await suppressedFields("restaurant", input.facilityId);
    if (suppressed.has("*")) return null;
    return {
      facilityId: r.facility_id,
      name: r.name,
      cuisine: r.cuisine,
      experienceType: r.experience_type,
      priceRange: r.price_range,
      parkResort: r.park_resort,
      imageUrl: suppressed.has("image") ? null : r.image_url,
      detailUrl: r.detail_url,
      urlFriendlyId: r.url_friendly_id,
      dinnerShow: r.entity_type === "dinner-show",
      characterDining: r.character_dining,
      fineDining: r.fine_dining,
      diningPackage: r.dining_package,
      walkupWaitList: r.walkup_wait_list,
      mobileOrder: r.mobile_order,
      annualPassDiscount: r.annual_pass_discount,
      disneyVisaDiscount: r.disney_visa_discount,
      tripAdvisorAward: r.trip_advisor_award,
      diningPlanQs: r.dining_plan_qs,
      diningPlanTs: r.dining_plan_ts,
      land: r.land,
      mapPin: r.map_pin,
      latitude: r.latitude,
      longitude: r.longitude,
      maximumPartySize: r.maximum_party_size,
      diningInterests: r.dining_interests ?? [],
      disneyFavorites: r.disney_favorites ?? [],
      entertainmentType: r.entertainment_type ?? [],
      hasMenu: r.has_menu,
      lastCheckedAt: r.last_checked_at,
      firstSeenAt: r.first_seen_at,
      requiresParkTicket: r.location_type === "theme-park" || r.location_type === "water-park",
      // `dining.availability` only returns rows for swept venues (priority &&
      // bookable); the detail page gates its inline reservation UI on this.
      availabilityEligible: r.priority && r.bookable,
    };
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
      bookable: boolean;
      mobile_order: boolean;
      dining_interests: string[] | null;
      disney_favorites: string[] | null;
    }>(sql`
      SELECT facility_id, name, cuisine, park_resort, price_range, image_url, detail_url,
             character_dining, fine_dining, bookable, mobile_order,
             dining_interests, disney_favorites
      FROM restaurant_dim
      WHERE source = 3 AND active = true
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
      bookable: r.bookable,
      mobileOrder: r.mobile_order,
      diningInterests: r.dining_interests ?? [],
      disneyFavorites: r.disney_favorites ?? [],
    }));
    type Venue = (typeof venues)[number];

    // Snack/cart signal from the venue name + cuisine (Disney files carts as
    // plain "Quick Service" restaurants, so there's no facility-type flag to key
    // on — we match the treat vocabulary instead).
    const SNACK_RE =
      /ice cream|churro|popcorn|pretzel|funnel|sweet|dessert|bakery|candy|snack|treat|frozen|sundae|cookie|donut|gelato|coffee|refreshment|kiosk|\bcart\b/i;
    const isSnack = (v: Venue) => SNACK_RE.test(`${v.name} ${v.cuisine ?? ""}`);

    // Ordered shelf definitions. `match` decides membership; the first few keys
    // are high-signal reservable experiences, then franchise shelves, then the
    // dedicated cart / quick-service shelves (non-bookable venues).
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
      // Dedicated non-bookable (cart / quick-service) shelves.
      {
        key: "sweet-treats",
        title: "Snacks & Sweet Treats",
        subtitle: "Ice cream, churros, popcorn & more",
        match: (v) => !v.bookable && isSnack(v),
      },
      {
        key: "mobile-order",
        title: "Mobile Ordering",
        subtitle: "Order ahead & skip the line",
        match: (v) => v.mobileOrder,
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
   * Dining venues located at a given resort hotel (exact `park_resort` text
   * match — the finder catalog stores the resort's display name verbatim, same
   * string as `RESORT_CATALOG[].name`). Powers the resort detail page's "Eats
   * here" shelf; same card fields as `picks` plus `bookable` so the shelf can
   * split table-service restaurants from quick-service / carts.
   */
  byResort: publicProcedure.input(z.object({ resortName: z.string() })).query(async ({ input }) => {
    const result = await db.execute<{
      facility_id: string;
      name: string;
      cuisine: string | null;
      park_resort: string | null;
      price_range: string | null;
      image_url: string | null;
      detail_url: string | null;
      bookable: boolean;
      mobile_order: boolean;
    }>(sql`
      SELECT facility_id, name, cuisine, park_resort, price_range, image_url, detail_url,
             bookable, mobile_order
      FROM restaurant_dim
      WHERE active = true AND park_resort = ${input.resortName}
      ORDER BY name
    `);
    return result.rows.map((r) => ({
      facilityId: r.facility_id,
      name: r.name,
      cuisine: r.cuisine,
      parkResort: r.park_resort,
      priceRange: r.price_range,
      imageUrl: r.image_url,
      detailUrl: r.detail_url,
      bookable: r.bookable,
      mobileOrder: r.mobile_order,
    }));
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

  /**
   * Venues with recent menu activity, newest first — the price-change log AND
   * the item lifecycle log (added / removed) unioned and rolled up per
   * facility. Carries the card fields the browse shelf needs, a per-type
   * breakdown for the activity badges, and a short sample of the touched item
   * titles (preferring newly-added items for the subtitle).
   */
  recentlyUpdated: publicProcedure
    .input(
      z
        .object({
          sinceDays: z.number().int().min(1).max(120).default(30),
          limit: z.number().int().min(1).max(50).default(12),
          // Restrict to one shelf: true = table-service restaurants,
          // false = quick-service & carts. Omitted returns both, so each shelf
          // can fetch its own `limit` instead of splitting a shared budget.
          bookable: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const sinceDays = input?.sinceDays ?? 30;
      const limit = input?.limit ?? 12;
      const bookable = input?.bookable;
      const result = await db.execute<{
        facility_id: string;
        name: string;
        cuisine: string | null;
        park_resort: string | null;
        price_range: string | null;
        image_url: string | null;
        bookable: boolean;
        change_count: string;
        added_count: string;
        removed_count: string;
        price_count: string;
        last_changed_at: string;
        sample_titles: string[] | null;
        added_titles: string[] | null;
      }>(sql`
        WITH activity AS (
          SELECT facility_id, title, changed_at, 'price' AS kind
          FROM dining_menu_price_change
          WHERE changed_at >= now() - make_interval(days => ${sinceDays})
          UNION ALL
          SELECT facility_id, title, changed_at, change_type AS kind
          FROM dining_menu_event
          WHERE changed_at >= now() - make_interval(days => ${sinceDays})
        )
        SELECT r.facility_id, r.name, r.cuisine, r.park_resort, r.price_range, r.image_url,
               r.bookable,
               count(*) AS change_count,
               count(*) FILTER (WHERE a.kind = 'added') AS added_count,
               count(*) FILTER (WHERE a.kind = 'removed') AS removed_count,
               count(*) FILTER (WHERE a.kind = 'price') AS price_count,
               max(a.changed_at) AS last_changed_at,
               (array_agg(a.title ORDER BY a.changed_at DESC))[1:8] AS sample_titles,
               (array_agg(a.title ORDER BY a.changed_at DESC)
                  FILTER (WHERE a.kind = 'added'))[1:6] AS added_titles
        FROM activity a
        JOIN restaurant_dim r ON r.facility_id = a.facility_id
        WHERE r.active = true
          ${bookable === undefined ? sql`` : sql`AND r.bookable = ${bookable}`}
        GROUP BY r.facility_id, r.name, r.cuisine, r.park_resort, r.price_range, r.image_url,
                 r.bookable
        ORDER BY last_changed_at DESC
        LIMIT ${limit}
      `);
      return result.rows.map((r) => {
        // Prefer newly-added items for the subtitle (they read as "what's new"),
        // falling back to whatever was touched. Collapse duplicates (same item
        // across meal periods) to a short unique list.
        const added = [...new Set(r.added_titles ?? [])];
        const sample = added.length ? added : [...new Set(r.sample_titles ?? [])];
        return {
          facilityId: r.facility_id,
          name: r.name,
          cuisine: r.cuisine,
          parkResort: r.park_resort,
          priceRange: r.price_range,
          imageUrl: r.image_url,
          // Split the shelf: bookable = table-service restaurants, non-bookable =
          // quick-service & carts (Aloha Isle, popcorn carts, kiosks…).
          bookable: r.bookable,
          changeCount: Number(r.change_count),
          addedCount: Number(r.added_count),
          removedCount: Number(r.removed_count),
          priceCount: Number(r.price_count),
          lastChangedAt: r.last_changed_at,
          sampleTitles: sample.slice(0, 3),
        };
      });
    }),

  /**
   * Recent item lifecycle events for one venue (the `dining_menu_event` log) —
   * added / removed within the window, newest first. Powers the "New!" badges
   * on the menu (adds introduced within the last month) and the "recently
   * removed" note on the venue page. Kept separate from `menuChanges` (price
   * moves) so each surface fetches only what it renders.
   */
  recentItemEvents: publicProcedure
    .input(
      z.object({
        facilityId: z.string(),
        sinceDays: z.number().int().min(1).max(120).default(30),
        limit: z.number().int().min(1).max(500).default(300),
      }),
    )
    .query(async ({ input }) => {
      const result = await db.execute<{
        change_type: string;
        meal_period: string;
        group_name: string | null;
        title: string;
        price: number | null;
        currency: string | null;
        changed_at: string;
      }>(sql`
        SELECT change_type, meal_period, group_name, title, price, currency, changed_at
        FROM dining_menu_event
        WHERE facility_id = ${input.facilityId}
          AND changed_at >= now() - make_interval(days => ${input.sinceDays})
        ORDER BY changed_at DESC
        LIMIT ${input.limit}
      `);
      return result.rows.map((r) => ({
        changeType: r.change_type as "added" | "removed",
        mealPeriod: r.meal_period,
        groupName: r.group_name,
        title: r.title,
        price: r.price === null ? null : Number(r.price),
        currency: r.currency,
        changedAt: r.changed_at,
      }));
    }),

  /**
   * Full history for a single menu item, keyed by (facility, title slug). The
   * slug mirrors the client's `slugifyMenuItem`, recomputed in SQL so the item
   * detail deep link resolves. Returns the item's current live-menu occurrence
   * (null if it's been removed), its price-point series, and its first-seen
   * date.
   */
  menuItem: publicProcedure
    .input(z.object({ facilityId: z.string(), slug: z.string() }))
    .query(async ({ input }) => {
      const fid = input.facilityId;
      // Mirror of client `slugifyMenuItem`: lowercase, non-alphanumerics → "-",
      // trim leading/trailing dashes.
      const slugOf = (col: string) =>
        sql.raw(`trim(both '-' from regexp_replace(lower(${col}), '[^a-z0-9]+', '-', 'g'))`);

      // Current live-menu occurrence (prefer a priced row; there may be several
      // across meal periods — take the first by capture order).
      const curRes = await db.execute<{
        title: string;
        description: string | null;
        price: number | null;
        price_type: string | null;
        currency: string | null;
        meal_period: string;
        group_name: string | null;
        item_type: string | null;
      }>(sql`
        SELECT i.title, i.description, i.price, i.price_type, i.currency,
               i.meal_period, i.group_name, i.item_type
        FROM dining_menu_item i
        JOIN dining_menu_snapshot s
          ON s.facility_id = i.facility_id AND s.observed_at = i.observed_at
        WHERE i.facility_id = ${fid} AND ${slugOf("i.title")} = ${input.slug}
        ORDER BY (i.price IS NULL), i.id
        LIMIT 1
      `);
      const cur = curRes.rows[0] ?? null;

      // Events touching this slug.
      const evRes = await db.execute<{
        change_type: string;
        title: string;
        changed_at: string;
      }>(sql`
        SELECT change_type, title, changed_at
        FROM dining_menu_event
        WHERE facility_id = ${fid} AND ${slugOf("title")} = ${input.slug}
        ORDER BY changed_at DESC
      `);
      const events = evRes.rows;

      // Resolve the item's display title + lifecycle status. The live
      // occurrence wins; otherwise the most recent 'removed' event does.
      let title: string | null = null;
      let status: "active" | "removed" = "active";
      if (cur) {
        title = cur.title;
      } else {
        const removedEv = events.find((e) => e.change_type === "removed");
        title = removedEv?.title ?? events[0]?.title ?? null;
        status = "removed";
      }
      if (!title) {
        // Nothing on record under this slug at this venue.
        return null;
      }

      // Price history for this item, oldest first.
      const pcRes = await db.execute<{
        old_price: number | null;
        new_price: number | null;
        currency: string | null;
        changed_at: string;
      }>(sql`
        SELECT old_price, new_price, currency, changed_at
        FROM dining_menu_price_change
        WHERE facility_id = ${fid} AND lower(title) = ${title.toLowerCase()}
        ORDER BY changed_at ASC
      `);

      // First-seen: earliest 'added' event under any of the item's names.
      const firstSeenAt =
        events
          .filter((e) => e.change_type === "added")
          .map((e) => e.changed_at)
          .sort()[0] ?? null;

      // When we have no 'added' event, fall back to when we first captured this
      // venue's menu — an honest "since we began tracking" date to anchor the
      // pre-change price against, so the series doesn't collapse onto the first
      // change's own timestamp (which draws as a confusing vertical line).
      const snapRes = await db.execute<{ first_seen_at: string | null }>(sql`
        SELECT first_seen_at FROM dining_menu_snapshot WHERE facility_id = ${fid} LIMIT 1
      `);
      const snapshotFirstSeen = snapRes.rows[0]?.first_seen_at ?? null;

      // Stitch the price series: anchor at the oldest known price, then one point
      // per move, then the current price so the line ends at "today".
      const points: Array<{ t: number; price: number }> = [];
      const changes = pcRes.rows;
      const now = Date.now();
      if (changes.length > 0) {
        const first = changes[0];
        const changeT = Date.parse(first.changed_at);
        // Prefer a real earlier timestamp for the pre-change price; if we have
        // none, back it off a day so the two points don't share an x.
        const anchorSrc = firstSeenAt ?? snapshotFirstSeen;
        const anchorT = anchorSrc ? Date.parse(anchorSrc) : NaN;
        const anchor =
          Number.isFinite(anchorT) && anchorT < changeT ? anchorT : changeT - 86_400_000;
        if (first.old_price != null) points.push({ t: anchor, price: Number(first.old_price) });
        for (const c of changes) {
          if (c.new_price != null)
            points.push({ t: Date.parse(c.changed_at), price: Number(c.new_price) });
        }
      }
      if (cur?.price != null) {
        const last = points[points.length - 1];
        // Append the live price so the line runs to today; when it matches the
        // last observed move, still extend the flat run rather than duplicate.
        if (!last) {
          points.push({ t: now, price: Number(cur.price) });
        } else if (last.price !== Number(cur.price)) {
          points.push({ t: now, price: Number(cur.price) });
        } else if (now - last.t > 3_600_000) {
          points.push({ t: now, price: Number(cur.price) });
        }
      }

      const lastChangedAt =
        events[0]?.changed_at ?? (changes.length ? changes[changes.length - 1].changed_at : null);

      return {
        facilityId: fid,
        slug: input.slug,
        title,
        status,
        current: cur
          ? {
              title: cur.title,
              description: cur.description,
              price: cur.price === null ? null : Number(cur.price),
              priceType: cur.price_type,
              currency: cur.currency,
              mealPeriod: cur.meal_period,
              groupName: cur.group_name,
              itemType: cur.item_type,
            }
          : null,
        firstSeenAt,
        lastChangedAt,
        priceHistory: points,
      };
    }),

  /**
   * Other venues whose current menu carries an item with the same name (same
   * title slug), excluding the venue we came from. Powers the "Also found at"
   * cross-links on the item detail page — many items (DOLE Whip, Mickey
   * pretzels) recur verbatim across the resort, and the shared slug means each
   * row deep-links straight to that venue's copy of the item.
   */
  menuItemElsewhere: publicProcedure
    .input(z.object({ facilityId: z.string(), slug: z.string() }))
    .query(async ({ input }) => {
      const slugOf = (col: string) =>
        sql.raw(`trim(both '-' from regexp_replace(lower(${col}), '[^a-z0-9]+', '-', 'g'))`);

      // One row per other venue: the priced occurrence of this item on its
      // current live menu, joined to the restaurant for name/location.
      const res = await db.execute<{
        facility_id: string;
        name: string;
        park_resort: string | null;
        image_url: string | null;
        title: string;
        price: number | null;
        currency: string | null;
        price_type: string | null;
      }>(sql`
        SELECT DISTINCT ON (i.facility_id)
               r.facility_id, r.name, r.park_resort, r.image_url,
               i.title, i.price, i.currency, i.price_type
        FROM dining_menu_item i
        JOIN dining_menu_snapshot s
          ON s.facility_id = i.facility_id AND s.observed_at = i.observed_at
        JOIN restaurant_dim r ON r.facility_id = i.facility_id
        WHERE ${slugOf("i.title")} = ${input.slug}
          AND i.facility_id <> ${input.facilityId}
          AND r.active = true
        ORDER BY i.facility_id, (i.price IS NULL), i.id
      `);

      return res.rows
        .map((r) => ({
          facilityId: r.facility_id,
          name: r.name,
          parkResort: r.park_resort,
          imageUrl: r.image_url,
          title: r.title,
          price: r.price === null ? null : Number(r.price),
          currency: r.currency,
          priceType: r.price_type,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
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
      // Injected into the `latest_ts` CTE, which selects `FROM dining_obs`
      // unaliased — so the column must be unqualified (no `d.` prefix).
      const facilityFilter = input.facilityId ? sql`AND facility_id = ${input.facilityId}` : sql``;

      const result = await db.execute<{
        facility_id: string;
        name: string;
        service_date: string;
        observed_at: string;
        available: boolean;
        offer_count: string;
        earliest_offer_time: string | null;
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
                 min(d.offer_time) FILTER (WHERE d.meal_period <> '') AS earliest_offer_time,
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
               s.offer_count, s.earliest_offer_time, s.meal_periods
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
            // MDE deep link pre-scoped to this venue/party/date, anchored on the
            // day's earliest offer time — null on "none available" days.
            deepLink: string | null;
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
        const date = String(row.service_date).slice(0, 10);
        byFacility.get(row.facility_id)!.days.push({
          date,
          available: row.available,
          offerCount: Number(row.offer_count),
          mealPeriods: row.meal_periods ?? [],
          observedAt: row.observed_at,
          deepLink:
            row.available && row.earliest_offer_time
              ? buildDiningDeepLink({
                  facilityId: row.facility_id,
                  partySize: input.partySize,
                  serviceDate: date,
                  offerTime: row.earliest_offer_time,
                  completionDeepLink: `${config.appBaseUrl}/dining/${row.facility_id}`,
                })
              : null,
        });
      }

      return [...byFacility.values()];
    }),
} satisfies TRPCRouterRecord;
