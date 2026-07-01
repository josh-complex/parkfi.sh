import { z } from "zod";

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
    .input(z.object({ from: coord, to: coord }))
    .query(async ({ input }) => fetchRoute(input.from, input.to)),
} satisfies TRPCRouterRecord;
