import { createTRPCRouter } from "./init";
import { parksRouter } from "./routers/parks.ts";

export const trpcRouter = createTRPCRouter({
  parks: parksRouter,
});
export type TRPCRouter = typeof trpcRouter;
