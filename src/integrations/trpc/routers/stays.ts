import { z } from "zod";

import { config } from "#/server/parks/config.ts";
import {
  buildPartyKey,
  fetchResortAvailability,
  readStayObs,
  upsertStayQuery,
  writeStayObs,
} from "#/server/stays/availability.ts";
import { RESORT_CATALOG } from "#/server/stays/resort-catalog.generated.ts";
import { publicProcedure } from "../init.ts";

import type { TRPCRouterRecord } from "@trpc/server";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

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
  availability: publicProcedure
    .input(
      z.object({
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
      }),
    )
    .query(async ({ input }) => {
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
} satisfies TRPCRouterRecord;
