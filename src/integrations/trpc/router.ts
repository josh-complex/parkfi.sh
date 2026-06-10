import { createTRPCRouter } from "./init";
import { diningRouter } from "./routers/dining.ts";
import { notificationsRouter } from "./routers/notifications.ts";
import { parksRouter } from "./routers/parks.ts";
import { rideAlertsRouter } from "./routers/rideAlerts.ts";
import { stayAlertsRouter } from "./routers/stayAlerts.ts";
import { staysRouter } from "./routers/stays.ts";
import { ticketsRouter } from "./routers/tickets.ts";

export const trpcRouter = createTRPCRouter({
  parks: parksRouter,
  tickets: ticketsRouter,
  dining: diningRouter,
  stays: staysRouter,
  notifications: notificationsRouter,
  rideAlerts: rideAlertsRouter,
  stayAlerts: stayAlertsRouter,
});
export type TRPCRouter = typeof trpcRouter;
