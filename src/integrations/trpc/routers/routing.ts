import { z } from "zod";

import { VALHALLA_LANGUAGES } from "#/lib/units.ts";
import { fetchRoute } from "#/server/routing/valhalla.ts";
import { publicProcedure } from "../init.ts";

import type { TRPCRouterRecord } from "@trpc/server";

// [lng, lat] — matches the project's GeoJSON convention end-to-end.
const coord = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const routingRouter = {
  /**
   * Pedestrian route between two points on OSM footpaths, via our self-hosted
   * Valhalla engine. A query (not a mutation) so it can be edge-cached like the
   * other read-only routers.
   */
  route: publicProcedure
    .input(
      z.object({
        from: coord,
        to: coord,
        // Units for the turn narrative; distances always come back in metres. The
        // client picks this from the guest's locale so "300 feet" matches the
        // chrome (see lib/units.ts).
        units: z.enum(["miles", "kilometers"]).default("kilometers"),
        // Narrative language, also locale-picked client-side (§5) — validated
        // against Valhalla's shipped set so junk never reaches the engine.
        language: z.enum(VALHALLA_LANGUAGES).default("en-US"),
      }),
    )
    .query(async ({ input }) => fetchRoute(input.from, input.to, input.units, input.language)),
} satisfies TRPCRouterRecord;
