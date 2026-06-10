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
  // Three-group array-of-arrays of human-readable labels: experience tags,
  // cuisines/price, and a trailing `[park, land]` location group. Ordering is
  // heuristic (see parseDisneyFacets) so we stay tolerant of shape drift; null
  // slots appear in the wild, so each group filters them out to a clean string[].
  facets: z
    .array(z.array(z.string().nullable()).transform((g) => g.filter((x): x is string => x != null)))
    .optional(),
  card: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      // `desktop` is the ~90px thumbnail (resizable to hero via its
      // mwImage/1/{w}/{h}/ segment); `url` is the relative attraction-page path.
      media: z
        .object({ desktop: z.string().optional(), alt: z.string().optional() })
        .partial()
        .nullable()
        .optional(),
      url: z.string().optional(),
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

// ---------------------------------------------------------------------------
// Disney "finder" dining catalog — the PUBLIC, cookieless catalog source (same
// explorer-service host as the geo finder, no OneID session, no Akamai gate):
//   list-ancestor-entities/wdw/{destinationId}/{date}/dining -> results[]
// One entry per dining facility (restaurants, dinner-shows, dining-events) with
// the bare `facilityId`, location, cuisine/price/booking facets, and media. This
// is the `restaurant_dim` catalog feed for WDW. Tolerant: every field optional.
// ---------------------------------------------------------------------------
const DisneyFinderMedia = z
  .object({
    url: z.string().optional(),
    alt: z.string().optional(),
    transcodeTemplate: z.string().optional(),
  })
  .partial();

const DisneyDiningEntitySchema = z
  .object({
    facilityId: z.string(),
    id: z.string().optional(),
    // 'restaurant' | 'Dinner-Show' | 'Dining-Event' | 'Event'
    entityType: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    urlFriendlyId: z.string().optional(),
    url: z.string().optional(),
    locationName: z.string().nullable().optional(),
    parkIds: z.array(z.string()).default([]),
    facets: z
      .object({
        cuisine: z.array(z.string()).optional(),
        priceRangeDining: z.array(z.string()).optional(),
        checkAvailability: z.array(z.string()).optional(),
        tableService: z.array(z.string()).optional(),
        reservationOfferings: z.array(z.string()).optional(),
      })
      .partial()
      .passthrough()
      .nullable()
      .optional(),
    facetsLabel: z.string().nullable().optional(),
    facetGroupType: z.string().nullable().optional(),
    quickServiceAvailable: z.boolean().optional(),
    media: z
      .object({
        finderStandardThumb: DisneyFinderMedia.optional(),
        mapBubbleThumbLarge: DisneyFinderMedia.optional(),
      })
      .partial()
      .passthrough()
      .nullable()
      .optional(),
    webLinks: z
      .object({ wdwDetail: z.object({ href: z.string().optional() }).partial().optional() })
      .partial()
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
export type DisneyDiningEntity = z.infer<typeof DisneyDiningEntitySchema>;

export const DisneyDiningListSchema = z.object({
  results: z.array(DisneyDiningEntitySchema).default([]),
});
export type DisneyDiningList = z.infer<typeof DisneyDiningListSchema>;

/**
 * ThemeParks.wiki `/entity/{uuid}/schedule` — the forward 30-day park calendar.
 * Two payloads we care about live here:
 *  - `schedule[]`: per-date operating hours + ticketed-event windows (Early
 *    Entry, Extended Evening, Special Ticketed Event) -> `park_schedule`.
 *  - `schedule[].purchases[]`: demand-priced park-date bundles. The Lightning
 *    Lane Multi Pass / Premier Pass daily price (and `available` sell-out flag)
 *    -> `product_price_obs`. NB: `price.amount` here is ALREADY IN CENTS
 *    (1200 == $12.00), unlike the Disney/Universal direct feeds (dollars).
 * Tolerant by design: unknown fields drop, missing arrays default empty.
 */
const SchedulePurchase = z.object({
  id: z.string(),
  name: z.string().optional(),
  // ADMISSION | PACKAGE | ATTRACTION
  type: z.string().nullable().optional(),
  price: Price.optional(),
  available: z.boolean().optional(),
});
const ScheduleEntry = z.object({
  date: z.string(),
  // OPERATING | TICKETED_EVENT | PRIVATE_EVENT | EXTRA_HOURS | INFO
  type: z.string(),
  openingTime: z.string().nullable().optional(),
  closingTime: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  purchases: z.array(SchedulePurchase).default([]),
});
export const ScheduleSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  timezone: z.string().optional(),
  schedule: z.array(ScheduleEntry).default([]),
});
export type SchedulePayload = z.infer<typeof ScheduleSchema>;
export type ScheduleEntryData = z.infer<typeof ScheduleEntry>;

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

// ---------------------------------------------------------------------------
// Universal Orlando "places" feed — the UOR geo *enrichment* layer (analog of
// the Disney finder explorer). `GET api.universalparks.com/resort-areas/uor/places`
// returns every resort POI (park rides/shows/dining + hotels + CityWalk), each
// keyed by `place_id` in the SAME namespace as the ThemeParks.wiki Universal
// child `externalId` (`uor.<venue>.<type>.<leaf>`, e.g.
// `uor.usf.rides.revenge_of_the_mummy`) — that's the join back to our attractions.
// Bearer/guest-session gated like the ticket feeds, so harvested via Browserless.
// Tolerant by design: every enriched field is optional and degrades to null.
// ---------------------------------------------------------------------------
const UniversalPlaceImage = z
  .object({
    desktop: z.string().optional(),
    mobile: z.string().optional(),
    tablet: z.string().optional(),
    // Comma-joined kinds, e.g. "heroImage", "filterListImage,iconImage,tileImage".
    image_kind: z.string().nullable().optional(),
  })
  .partial();

const UniversalPlaceLatLng = z
  .object({
    lat: z.union([z.number(), z.string()]).nullable().optional(),
    lng: z.union([z.number(), z.string()]).nullable().optional(),
  })
  .partial();

const UniversalPlace = z
  .object({
    place_id: z.string(),
    name: z.string().nullable().optional(),
    short_description: z.string().nullable().optional(),
    long_description: z.string().nullable().optional(),
    // `uor.usf` / `uor.ioa` / `uor.ueu` for park items; hotel/CityWalk venues we
    // ignore (they never join to a park attraction).
    venue_id: z.string().nullable().optional(),
    // `uor.<venue>.<land>`, e.g. `uor.ioa.wizarding_world_of_harry_potter_hogsmeade`.
    land_id: z.string().nullable().optional(),
    geometry: z
      .object({
        locations: z
          .array(z.object({ lat_lng: UniversalPlaceLatLng.nullable().optional() }).partial())
          .default([]),
      })
      .partial()
      .nullable()
      .optional(),
    images: z.array(UniversalPlaceImage).default([]),
    place_type: z
      .object({
        // "Dining" | "Amenity" | "Attraction" | "Show" | "Shopping" | …
        type: z.string().nullable().optional(),
        categories: z.array(z.string()).default([]),
      })
      .partial()
      .nullable()
      .optional(),
    urls: z
      .array(
        z
          .object({
            url: z.string().optional(),
            // PLACE_POI_DETAILS is the official detail page; DINING_MENU etc. exist too.
            url_type: z.string().optional(),
            description: z.string().optional(),
          })
          .partial(),
      )
      .default([]),
    tags: z.array(z.string()).default([]),
  })
  .passthrough();
export type UniversalPlace = z.infer<typeof UniversalPlace>;

export const UniversalPlacesSchema = z.object({
  results: z
    .array(z.object({ place: UniversalPlace, open_now: z.boolean().optional() }))
    .default([]),
});
export type UniversalPlaces = z.infer<typeof UniversalPlacesSchema>;

// ---------------------------------------------------------------------------
// Universal dining reservation availability —
// `POST resort-areas/UOR/places/{place_id}/reservation-availability` with
// {place_id, start_date, end_date, party_size}. One POST covers the whole date
// range. Each date carries time slots with an AVAILABLE/NOT_AVAILABLE status
// (and a per-party-size breakdown). Same guest-session auth as the places feed.
// Tolerant: unknown fields drop, missing arrays default empty.
// ---------------------------------------------------------------------------
const UniversalReservationSlot = z.object({
  time: z.string(),
  availability_status: z.string().optional(),
  party_sizes: z
    .array(
      z
        .object({
          size: z.union([z.string(), z.number()]).optional(),
          availability_status: z.string().optional(),
        })
        .partial(),
    )
    .default([]),
});

const UniversalReservationDate = z.object({
  date: z.string(),
  availability_status: z.string().optional(),
  slots: z.array(UniversalReservationSlot).default([]),
});

export const UniversalReservationAvailabilitySchema = z.object({
  place_id: z.string().optional(),
  min_party_size: z.number().optional(),
  max_party_size: z.number().optional(),
  min_advanced_minutes: z.number().optional(),
  max_advanced_days: z.number().optional(),
  dates: z.array(UniversalReservationDate).default([]),
});
export type UniversalReservationAvailability = z.infer<
  typeof UniversalReservationAvailabilitySchema
>;
