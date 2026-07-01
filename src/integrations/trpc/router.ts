import { createTRPCRouter } from "./init";
import { blogRouter } from "./routers/blog.ts";
import { diningRouter } from "./routers/dining.ts";
import { diningAlertsRouter } from "./routers/diningAlerts.ts";
import { forecastRouter } from "./routers/forecast.ts";
import { livingRouter } from "./routers/living.ts";
import { livingDevRouter } from "./routers/livingDev.ts";
import { notificationsRouter } from "./routers/notifications.ts";
import { parksRouter } from "./routers/parks.ts";
import { pinCatalogRouter } from "./routers/pinCatalog.ts";
import { pinCollectionRouter } from "./routers/pinCollection.ts";
import { pinIdentifyRouter } from "./routers/pinIdentify.ts";
import { pinTradeRouter } from "./routers/pinTrade.ts";
import { rideAlertsRouter } from "./routers/rideAlerts.ts";
import { routingRouter } from "./routers/routing.ts";
import { searchRouter } from "./routers/search.ts";
import { stayAlertsRouter } from "./routers/stayAlerts.ts";
import { staysRouter } from "./routers/stays.ts";
import { ticketsRouter } from "./routers/tickets.ts";
import { uploadsRouter } from "./routers/uploads.ts";

export const trpcRouter = createTRPCRouter({
  parks: parksRouter,
  tickets: ticketsRouter,
  dining: diningRouter,
  forecast: forecastRouter,
  stays: staysRouter,
  notifications: notificationsRouter,
  rideAlerts: rideAlertsRouter,
  routing: routingRouter,
  stayAlerts: stayAlertsRouter,
  diningAlerts: diningAlertsRouter,
  uploads: uploadsRouter,
  blog: blogRouter,
  search: searchRouter,
  pinCatalog: pinCatalogRouter,
  pinIdentify: pinIdentifyRouter,
  pinCollection: pinCollectionRouter,
  pinTrade: pinTradeRouter,
  // Living Layer (M3) — public read + discovery-pin loop. Inert for the UI
  // until the PostHog `living-layer` flag is on (no existing page calls it).
  living: livingRouter,
  // Living Layer (M0) — dev/armchair-mode only; every procedure is gated by
  // LIVING_DEV and is inert in production. Adds no live surface.
  livingDev: livingDevRouter,
});
export type TRPCRouter = typeof trpcRouter;
