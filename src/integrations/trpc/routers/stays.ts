import { z } from "zod";

import { config } from "#/server/parks/config.ts";
import { fetchResortAvailability } from "#/server/stays/availability.ts";
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
   * Live resort availability + per-night pricing for a stay. Proxies Disney's
   * public resort-availability API server-side and joins to the catalog.
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
      const offers = await fetchResortAvailability(
        input,
        AbortSignal.timeout(config.fetchTimeoutMs),
      );
      return { checkInDate: input.checkInDate, checkOutDate: input.checkOutDate, offers };
    }),
} satisfies TRPCRouterRecord;
