import { createTRPCRouter } from "./init";
import { diningRouter } from "./routers/dining.ts";
import { notificationsRouter } from "./routers/notifications.ts";
import { parksRouter } from "./routers/parks.ts";
import { rideAlertsRouter } from "./routers/rideAlerts.ts";
import { staysRouter } from "./routers/stays.ts";
import { ticketsRouter } from "./routers/tickets.ts";

export const trpcRouter = createTRPCRouter({
  parks: parksRouter,
  tickets: ticketsRouter,
  dining: diningRouter,
  stays: staysRouter,
  notifications: notificationsRouter,
  rideAlerts: rideAlertsRouter,
});
export type TRPCRouter = typeof trpcRouter;
