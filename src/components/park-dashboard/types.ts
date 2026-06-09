import type { inferRouterOutputs } from "@trpc/server";

import type { TRPCRouter } from "#/integrations/trpc/router.ts";

type Outputs = inferRouterOutputs<TRPCRouter>;

/** One attraction row from `parks.board`. */
export type BoardItem = Outputs["parks"]["board"][number];
/** One park from `parks.list`. */
export type ParkListItem = Outputs["parks"]["list"][number];
/** One hourly bucket from `parks.history`. */
export type HistoryPoint = Outputs["parks"]["history"][number];
/** Whole-park, per-ride pivoted history from `parks.parkHistory`. */
export type ParkHistory = Outputs["parks"]["parkHistory"];
/** One ride summary (id/name/peak) from `parks.parkHistory`. */
export type ParkHistoryRide = ParkHistory["rides"][number];
