import { createTRPCRouter } from "./init";
import { parksRouter } from "./routers/parks.ts";
import { ticketsRouter } from "./routers/tickets.ts";

export const trpcRouter = createTRPCRouter({
  parks: parksRouter,
  tickets: ticketsRouter,
});
export type TRPCRouter = typeof trpcRouter;
