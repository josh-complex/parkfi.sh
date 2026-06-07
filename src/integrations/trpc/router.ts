import { createTRPCRouter } from "./init";
import { diningRouter } from "./routers/dining.ts";
import { parksRouter } from "./routers/parks.ts";
import { ticketsRouter } from "./routers/tickets.ts";

export const trpcRouter = createTRPCRouter({
  parks: parksRouter,
  tickets: ticketsRouter,
  dining: diningRouter,
});
export type TRPCRouter = typeof trpcRouter;
