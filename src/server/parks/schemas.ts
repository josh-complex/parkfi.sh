import { z } from "zod";

/**
 * Versioned zod schemas validating the *real* upstream shapes (verified live
 * against Magic Kingdom). Validation is the schema-drift guard: on a shape
 * change we archive + alert rather than crash ingestion.
 */

const Price = z.object({
  amount: z.number(),
  currency: z.string().optional(),
  formatted: z.string().optional(),
});

const Queue = z
  .object({
    STANDBY: z.object({ waitTime: z.number().nullable() }).optional(),
    SINGLE_RIDER: z.object({ waitTime: z.number().nullable() }).optional(),
    PAID_STANDBY: z.object({ waitTime: z.number().nullable() }).optional(),
    RETURN_TIME: z
      .object({
        state: z.string().optional(),
        returnStart: z.string().nullable().optional(),
        returnEnd: z.string().nullable().optional(),
      })
      .optional(),
    PAID_RETURN_TIME: z
      .object({
        state: z.string().optional(),
        price: Price.optional(),
        returnStart: z.string().nullable().optional(),
        returnEnd: z.string().nullable().optional(),
      })
      .optional(),
    BOARDING_GROUP: z
      .object({
        state: z.string().optional(),
        currentGroupStart: z.number().nullable().optional(),
        currentGroupEnd: z.number().nullable().optional(),
        allocationStatus: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

export const LiveEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  entityType: z.string(),
  parkId: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  lastUpdated: z.string().nullable().optional(),
  queue: Queue.optional(),
});
export type LiveEntity = z.infer<typeof LiveEntitySchema>;

export const LiveSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  liveData: z.array(LiveEntitySchema),
});
export type LivePayload = z.infer<typeof LiveSchema>;

/**
 * ThemeParks.wiki `/entity/{uuid}/children` — the geo backbone. Returns every
 * child entity (attractions, shows, restaurants) with a `location` block for
 * ~100% of children at both Disney and Universal, keyed by the same UUID our
 * `attractions` rows map to via `external_ids` (source THEMEPARKS_WIKI). The
 * `externalId` is the operator's own numeric id (Disney's `80010199`), the join
 * onward to the Disney explorer. Tolerant: location is optional/nullable.
 */
const EntityLocation = z
  .object({
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
  })
  .nullable()
  .optional();

export const EntityChildSchema = z.object({
  id: z.string(),
  name: z.string(),
  entityType: z.string(),
  slug: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  location: EntityLocation,
});
export type EntityChild = z.infer<typeof EntityChildSchema>;

export const EntityChildrenSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  entityType: z.string().optional(),
  timezone: z.string().optional(),
  location: EntityLocation,
  children: z.array(EntityChildSchema).default([]),
});
export type EntityChildrenPayload = z.infer<typeof EntityChildrenSchema>;

// ---------------------------------------------------------------------------
// Disney "finder" explorer (disneyworld.disney.go.com/finder/api/v1) — the WDW
// geo *enrichment* layer (pin categories). Cookieless GET, same trust level as
// the availability calendar:
//   details-entity-simple/wdw/{slug}/{date}/ -> mapData.location.markers[]
// NB: the map `defaults` (center/zoom/maxBounds) are resort-wide (identical for
// all four parks), so per-park center/bounds come from the ThemeParks.wiki child
// centroid, not here — this feed is used ONLY for the per-marker `pin` category.
// `card.id` is "80010199;entityType=Attraction"; the numeric prefix before ';'
// joins back to the ThemeParks.wiki child's `externalId` numeric prefix.
// ---------------------------------------------------------------------------

const DisneyParkMarker = z.object({
  lat: z.union([z.number(), z.string()]).optional(),
  lng: z.union([z.number(), z.string()]).optional(),
  pin: z.string().nullable().optional(),
  card: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      media: z.unknown().optional(),
    })
    .partial()
    .optional(),
});

export const DisneyParkDetailSchema = z.object({
  mapData: z
    .object({
      location: z
        .object({
          markers: z.array(DisneyParkMarker).default([]),
        })
        .partial()
        .optional(),
    })
    .partial()
    .optional(),
});
export type DisneyParkDetail = z.infer<typeof DisneyParkDetailSchema>;

// queue-times.com — wait times + open/closed only (degraded fallback)
export const QueueTimesSchema = z.object({
  lands: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        rides: z.array(
          z.object({
            id: z.number(),
            name: z.string(),
            is_open: z.boolean(),
            wait_time: z.number(),
            last_updated: z.string().nullable().optional(),
          }),
        ),
      }),
    )
    .default([]),
  // some parks expose top-level `rides` with no lands
  rides: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        is_open: z.boolean(),
        wait_time: z.number(),
        last_updated: z.string().nullable().optional(),
      }),
    )
    .optional(),
});
export type QueueTimesPayload = z.infer<typeof QueueTimesSchema>;

// Disney availability-calendar.
// Fields are optional because the endpoint returns placeholder entries (`[{}]`)
// for anonymous callers / segments with no data. The cron filters to usable
// entries rather than crashing on the empties.
export const AvailabilityCalendarSchema = z.array(
  z.object({
    date: z.string().optional(),
    availability: z.string().optional(),
    parks: z.array(z.string()).default([]),
  }),
);
export type AvailabilityCalendar = z.infer<typeof AvailabilityCalendarSchema>;

// Disney anonymous client token (D2 step 1).
export const DisneyClientTokenSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
});
export type DisneyClientToken = z.infer<typeof DisneyClientTokenSchema>;

// Disney date-based ticket pricing calendar (D2/E2), from
// lexicon-view-assembler-service. One bucket per `numDays` (1..10), each with a
// ~17-month `dates[]` series. Each `pricing[]` entry's `id` IS the
// productInstanceId (the join/SKU key — for 1-day it carries a `_mk/_ep/_hs/_ak`
// park suffix); `stopSale` is the per-product/date sold-out flag.
const DisneyPricingDate = z.object({
  date: z.string(),
  currency: z.string().optional(),
  pricing: z
    .array(
      z.object({
        id: z.string().optional(),
        ageGroup: z.string().optional(),
        pricePerDay: z.union([z.string(), z.number()]).optional(),
        subtotal: z.union([z.string(), z.number()]).optional(),
        tax: z.union([z.string(), z.number()]).optional(),
        stopSale: z.boolean().optional(),
      }),
    )
    .default([]),
});
export const DisneyPricingSchema = z.object({
  soldOut: z.boolean().optional(),
  blockoutDates: z.array(z.string()).default([]),
  pricingCalendar: z
    .object({
      pricingCalendar: z
        .array(z.object({ numDays: z.string(), dates: z.array(DisneyPricingDate).default([]) }))
        .default([]),
    })
    .optional(),
});
export type DisneyPricing = z.infer<typeof DisneyPricingSchema>;

// Disney E1 catalog / product-listing. Enumerates every purchasable product
// across the anonymous discount groups (STD_GST, FL_RESIDENT, CANADA_RESIDENT).
// Each `products` key IS the E2 slug; `isVariablePricing` distinguishes the
// demand-priced tickets (have an E2 calendar) from flat offers (e.g. the FL
// summer ticket) whose only price is the per-day-count `startingFromPrice` here.
// Tolerant by design: unknown fields are dropped, missing ones default empty.
const DisneyPriceBlock = z.object({
  currency: z.string().optional(),
  pricePerDay: z.union([z.string(), z.number()]).optional(),
  subtotal: z.union([z.string(), z.number()]).optional(),
  tax: z.union([z.string(), z.number()]).optional(),
  total: z.union([z.string(), z.number()]).optional(),
});
const DisneyTicketDay = z.object({
  numDays: z.union([z.string(), z.number()]).optional(),
  productInstanceId: z.string(),
  startingFromPrice: DisneyPriceBlock.optional(),
});
const DisneyListingProduct = z.object({
  isVariablePricing: z.boolean().optional(),
  names: z.object({ text: z.string().optional() }).partial().optional(),
  ticketDays: z
    .object({
      adult: z.array(DisneyTicketDay).default([]),
      child: z.array(DisneyTicketDay).default([]),
    })
    .partial()
    .optional(),
});
export const DisneyProductListingSchema = z.object({
  discountGroups: z
    .record(
      z.string(),
      z.object({ products: z.record(z.string(), DisneyListingProduct).default({}) }),
    )
    .default({}),
});
export type DisneyProductListing = z.infer<typeof DisneyProductListingSchema>;

// Universal `priceAndInventory/v2` per-date calendar, harvested by replaying the
// endpoint with the web-store's guest-session headers. Shape:
// eventAvailability[partNumber][date] = {...}.
const UniversalDateEntry = z.object({
  pricing: z
    .array(
      z.object({
        amount: z.number().optional(),
        quantity: z.number().optional(),
        currency: z.string().optional(),
      }),
    )
    .default([]),
  inventoryEvents: z
    .array(
      z.object({
        availableUnits: z.string().nullable().optional(),
        totalCapacity: z.string().nullable().optional(),
        available: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

// A SKU from the `gettickets` catalog crawl. `listPrice` is the from-price anchor;
// `variablePriced` marks demand-priced day tickets/Express vs flat annual passes.
const UniversalSku = z.object({
  partNumber: z.string(),
  name: z.string().nullable().optional(),
  listPrice: z.union([z.number(), z.string()]).nullable().optional(),
  currency: z.string().nullable().optional(),
  variablePriced: z.boolean().default(false),
});
export type UniversalSku = z.infer<typeof UniversalSku>;

// Full Universal capture: catalog (all SKUs) + per-date pricing for the
// variable-priced ones. See research/universal-ticket-deep-dive.md.
export const UniversalCaptureSchema = z.object({
  skus: z.array(UniversalSku).default([]),
  eventAvailability: z.record(z.string(), z.record(z.string(), UniversalDateEntry)).default({}),
});
export type UniversalCapture = z.infer<typeof UniversalCaptureSchema>;
