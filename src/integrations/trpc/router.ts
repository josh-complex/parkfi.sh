import { createTRPCRouter } from "./init";
import { blogRouter } from "./routers/blog.ts";
import { diningRouter } from "./routers/dining.ts";
import { diningAlertsRouter } from "./routers/diningAlerts.ts";
import { forecastRouter } from "./routers/forecast.ts";
import { notificationsRouter } from "./routers/notifications.ts";
import { parksRouter } from "./routers/parks.ts";
import { pinCatalogRouter } from "./routers/pinCatalog.ts";
import { pinCollectionRouter } from "./routers/pinCollection.ts";
import { pinIdentifyRouter } from "./routers/pinIdentify.ts";
import { pinTradeRouter } from "./routers/pinTrade.ts";
import { rideAlertsRouter } from "./routers/rideAlerts.ts";
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
  stayAlerts: stayAlertsRouter,
  diningAlerts: diningAlertsRouter,
  uploads: uploadsRouter,
  blog: blogRouter,
  search: searchRouter,
  pinCatalog: pinCatalogRouter,
  pinIdentify: pinIdentifyRouter,
  pinCollection: pinCollectionRouter,
  pinTrade: pinTradeRouter,
});
export type TRPCRouter = typeof trpcRouter;
