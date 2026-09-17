import { z } from "zod";

import { config } from "#/server/parks/config.ts";
import {
  buildPartyKey,
  fetchResortAvailability,
  readCheapestCheckInDays,
  readStayObs,
  readStayPriceHistory,
  upsertStayQuery,
  writeStayObs,
} from "#/server/stays/availability.ts";
import { RESORT_CATALOG } from "#/server/stays/resort-catalog.generated.ts";
import { publicProcedure } from "../init.ts";

import type { TRPCRouterRecord } from "@trpc/server";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** The (dates, party) search dims shared by `availability` and `priceHistory`. */
const stayDims = {
  // Which Disney store to price against. Defaults to WDW so existing callers
  // (and the WDW-only browse UI) are unchanged; DLR reads pass "dlr".
  store: z.enum(["wdw", "dlr"]).default("wdw"),
  checkInDate: isoDate,
  checkOutDate: isoDate,
  adults: z.number().int().min(1).max(10).default(2),
  children: z.number().int().min(0).max(10).default(0),
  childAges: z.array(z.number().int().min(0).max(17)).max(10).default([]),
  accessible: z.boolean().default(false),
  floridaResident: z.boolean().default(false),
  postalCode: z
    .string()
    .regex(/^\d{5}$/, "expected a 5-digit ZIP")
    .optional(),
} as const;

export const staysRouter = {
  /**
   * The static resort catalog — names, images, tier, and area. Drives the
   * pre-search browse sections (no dates required), so it's a plain constant.
   */
  catalog: publicProcedure.query(() => RESORT_CATALOG),

  /**
   * Resort availability + per-night pricing for a stay, served stale-while-fresh
   * from `stay_obs`. Disney's resort API is slow, so we don't call it on every
   * request: a fresh cached generation (< STAYS_CACHE_TTL_MS) returns instantly,
   * and only a miss/stale tuple fetches live (then writes the obs the next reader
   * serves from). Either way we bump `stay_query.last_requested_at` so the sweep
   * keeps this tuple warm.
   */
  availability: publicProcedure.input(z.object(stayDims)).query(async ({ input }) => {
    const partyKey = buildPartyKey(input);
    const cached = await readStayObs(input, partyKey, config.staysCacheTtlMs);
    let offers = cached;
    if (!offers) {
      offers = await fetchResortAvailability(input, AbortSignal.timeout(config.fetchTimeoutMs));
      await writeStayObs(input, partyKey, offers);
    }
    // Record demand so the sweeper keeps this tuple warm (best-effort: a cache
    // bookkeeping failure must not fail an otherwise-good availability read).
    await upsertStayQuery(input, partyKey).catch((err) => {
      console.error("[stays] upsertStayQuery failed:", err);
    });
    return {
      checkInDate: input.checkInDate,
      checkOutDate: input.checkOutDate,
      offers,
      cached: cached != null,
    };
  }),

  /**
   * Observed nightly-rate history for one resort at a fixed (dates, party)
   * tuple — every `stay_obs` tick the sweep has recorded, oldest first. Powers
   * the "is now a good time to book?" trend on the resort detail page. Pure read
   * of cached observations (no live Disney call), so it's cheap to poll.
   */
  priceHistory: publicProcedure
    .input(z.object({ resortId: z.string().min(1), ...stayDims }))
    .query(async ({ input }) => {
      const partyKey = buildPartyKey(input);
      const points = await readStayPriceHistory(input.resortId, input, partyKey);
      return { points };
    }),

  /**
   * The cheapest check-in date to start a stay at one resort, for each of the
   * next `days` days, at one party — the resort page's rate calendar.
   *
   * Dateless by design: `priceHistory` answers "how has *this* stay moved", and
   * this answers "which day should the stay start". So it takes the party dims
   * without the dates, and `buildPartyKey` (which never reads them) is handed a
   * pair of placeholders rather than the input growing two ignored fields that
   * a caller would reasonably expect to matter.
   *
   * It reports only what the sweep has actually priced — see
   * `readCheapestCheckInDays` for why a missing date is neither cheap nor
   * expensive, and why the card must not draw it as though it were.
   */
  cheapestDays: publicProcedure
    .input(
      z.object({
        resortId: z.string().min(1),
        store: stayDims.store,
        adults: stayDims.adults,
        children: stayDims.children,
        childAges: stayDims.childAges,
        accessible: stayDims.accessible,
        floridaResident: stayDims.floridaResident,
        postalCode: stayDims.postalCode,
        days: z.number().int().min(7).max(90).default(60),
      }),
    )
    .query(async ({ input }) => {
      const partyKey = buildPartyKey({ ...input, checkInDate: "", checkOutDate: "" });
      const days = await readCheapestCheckInDays(input.resortId, partyKey, input.days);
      return { days };
    }),
} satisfies TRPCRouterRecord;
