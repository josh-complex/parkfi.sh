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

// SHOW entities carry a `showtimes[]` of the day's performances
// (`Performance Time` type covers parades/fireworks/meet-and-greets too). Times
// are ISO strings with a park-local offset. Tolerant: fields optional, unknown
// keys pass through.
const LiveShowtime = z
  .object({
    type: z.string().nullable().optional(),
    startTime: z.string().nullable().optional(),
    endTime: z.string().nullable().optional(),
  })
  .partial()
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
  showtimes: z.array(LiveShowtime).optional(),
  // Per-entity operating hours for today (plan item 1.4) — typed windows incl.
  // per-ride `Early Entry`. Same {type, startTime, endTime} shape as showtimes.
  operatingHours: z.array(LiveShowtime).optional(),
  // Live walk-up waitlist on restaurant entities (plan item 1.2) — one entry
  // per party size, sparse (signature TS venues only).
  diningAvailability: z
    .array(
      z
        .object({
          partySize: z.number().nullable().optional(),
          waitTime: z.number().nullable().optional(),
        })
        .partial()
        .passthrough(),
    )
    .optional(),
  // Disney's own hourly wait forecast (plan item 1.3) — parsed so the batch
  // rides one schema change; capture/storage is a later phase-3 item and the
  // worker currently ignores it.
  forecast: z
    .array(
      z
        .object({
          time: z.string().nullable().optional(),
          waitTime: z.number().nullable().optional(),
          percentage: z.number().nullable().optional(),
        })
        .partial()
        .passthrough(),
    )
    .optional(),
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
  // Marker `type` ('attractions' | 'dining' | 'shops' | 'guest-services' |
  // 'entertainment' | 'events-tours') + the marker's own `point-of-interest` id
  // and location-specific display name. Used to land the non-facility markers
  // (guest-services / entertainment / events-tours) into `park_poi`; the
  // attraction enrichment path keys off `card.id` and ignores these.
  type: z.string().nullable().optional(),
  id: z.string().optional(),
  name: z.string().nullable().optional(),
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
      // Finder slug ("first-aid") — keys the operator detail page for POIs.
      urlFriendlyId: z.string().optional(),
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

// One hero slide. Videos carry a `poster` still + mp4 rendition `source[]`;
// image slides carry a `desktop`/`tablet`/`mobile` URL. Both are park-level
// marketing imagery and share the `/resize/mwImage/1/{w}/{h}/…` CDN segment
// (resizable). `partial` + `passthrough` so unknown slide shapes don't fail
// the parse.
const DisneyHeroSlide = z
  .object({
    type: z.string().optional(),
    poster: z.string().optional(),
    desktop: z.string().optional(),
    tablet: z.string().optional(),
    mobile: z.string().optional(),
    alt: z.string().optional(),
    source: z.array(z.string()).optional(),
  })
  .partial()
  .passthrough();

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
  // Park-level hero. The four theme parks carry a `mediaEngine.data` slide
  // carousel; the water parks instead carry a single responsive image under
  // `media` (same CDN/resize segment). The geo cron reads slides first, then
  // falls back to `media` so both shapes yield a park photo.
  heroData: z
    .object({
      mediaEngine: z
        .object({ data: z.array(DisneyHeroSlide).default([]) })
        .partial()
        .optional(),
      media: DisneyHeroSlide.optional(),
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
    // Granular in-park land entity id ("80007973;entityType=land"), finer than
    // the marker `land` label and the `parkResort`.
    landId: z.string().nullable().optional(),
    // Cap on the booking party size (string in the feed, e.g. "50"); mostly set
    // on dining-events. Parsed to int.
    maximumPartySize: z.coerce.string().nullable().optional(),
    // Internal `dine-product-svc` product links (menu/product data per venue).
    productUrls: z.array(z.string()).default([]),
    facets: z
      .object({
        cuisine: z.array(z.string()).optional(),
        priceRangeDining: z.array(z.string()).optional(),
        checkAvailability: z.array(z.string()).optional(),
        tableService: z.array(z.string()).optional(),
        reservationOfferings: z.array(z.string()).optional(),
        // Catalog attribute facets (see disney-finder-catalog `toRow`):
        // `dining` carries the "walkupWaitList" tag; `features` carries
        // "mobile-orders"; `tableService` also carries "character-dining" /
        // "fine-signature-dining". The rec/discount facets below feed the
        // picks shelves and discount filters.
        dining: z.array(z.string()).optional(),
        features: z.array(z.string()).optional(),
        annualPass: z.array(z.string()).optional(),
        discounts: z.array(z.string()).optional(),
        diningPlan: z.array(z.string()).optional(),
        disneyFavorites: z.array(z.string()).optional(),
        diningInterests: z.array(z.string()).optional(),
        entertainmentType: z.array(z.string()).optional(),
        "eec-category": z.array(z.string()).optional(),
        restaurantAttributes: z.array(z.string()).optional(),
      })
      .partial()
      .passthrough()
      .nullable()
      .optional(),
    facetsLabel: z.string().nullable().optional(),
    facetGroupType: z.string().nullable().optional(),
    quickServiceAvailable: z.boolean().optional(),
    // Inline TODAY schedule (populated on ~372/409 venues): typed hours for the
    // requested date. A single list call keeps `dining_schedule`'s today rows
    // fresh between the weekly per-venue detail fetches (plan item 2.3).
    schedule: z
      .object({
        schedules: z
          .array(
            z
              .object({
                type: z.string().nullable().optional(),
                startTime: z.string().nullable().optional(),
                endTime: z.string().nullable().optional(),
                date: z.string().nullable().optional(),
                isClosed: z.boolean().nullable().optional(),
              })
              .partial()
              .passthrough(),
          )
          .default([]),
      })
      .partial()
      .passthrough()
      .nullable()
      .optional(),
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
    // Map marker the finder carries: geo coords + pin/icon category + the
    // granular "land" (an in-park area, finer than `locationName`).
    marker: z
      .object({
        lat: z.number().nullable().optional(),
        lng: z.number().nullable().optional(),
        pin: z.string().nullable().optional(),
        card: z
          .object({ land: z.string().nullable().optional() })
          .partial()
          .passthrough()
          .nullable()
          .optional(),
      })
      .partial()
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
export type DisneyDiningEntity = z.infer<typeof DisneyDiningEntitySchema>;

// Ancestor locations the finder lists dining under: 4 theme parks, 2 water
// parks, Disney Springs/ESPN/BoardWalk, + the resorts. A near-static reference
// table (`dining_location`) and a proper FK target for `parkResortId`.
const DisneyDiningLocationSchema = z
  .object({
    id: z.string(),
    title: z.string().nullable().optional(),
    urlFriendlyId: z.string().nullable().optional(),
    locationType: z.string().nullable().optional(),
  })
  .passthrough();
export type DisneyDiningLocation = z.infer<typeof DisneyDiningLocationSchema>;

export const DisneyDiningListSchema = z.object({
  results: z.array(DisneyDiningEntitySchema).default([]),
  locations: z.array(DisneyDiningLocationSchema).default([]),
});
export type DisneyDiningList = z.infer<typeof DisneyDiningListSchema>;

// ---------------------------------------------------------------------------
// Merchandise (shops) catalog — the retail counterpart to the dining list
// (`list-ancestor-entities/wdw/{destination}/{date}/shops`). Same envelope
// (`results` entities + ancestor `locations`); each entity is a
// `MerchandiseFacility` carrying a map `marker`, the `merchandise` category
// facets, a hero image, and a detail link. Shares `DisneyFinderMedia`.
// ---------------------------------------------------------------------------
const DisneyMerchandiseEntitySchema = z
  .object({
    facilityId: z.string(),
    id: z.string().optional(),
    entityType: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    urlFriendlyId: z.string().optional(),
    url: z.string().optional(),
    locationName: z.string().nullable().optional(),
    parkIds: z.array(z.string()).default([]),
    landId: z.string().nullable().optional(),
    // "true"/"false" string — Disney-operated vs third-party lessee.
    disneyOwned: z.string().nullable().optional(),
    facets: z
      .object({ merchandise: z.array(z.string()).optional() })
      .partial()
      .passthrough()
      .nullable()
      .optional(),
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
    marker: z
      .object({
        lat: z.number().nullable().optional(),
        lng: z.number().nullable().optional(),
        pin: z.string().nullable().optional(),
        card: z
          .object({ land: z.string().nullable().optional() })
          .partial()
          .passthrough()
          .nullable()
          .optional(),
      })
      .partial()
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
export type DisneyMerchandiseEntity = z.infer<typeof DisneyMerchandiseEntitySchema>;

// ---------------------------------------------------------------------------
// Disney attractions + entertainment catalog — the SAME public
// `list-ancestor-entities` endpoint the dining/shops/resort catalogs use, with
// `attractions` as the type (research/disney-content-parity.md §2). One
// destination-wide GET returns every WDW attraction and entertainment entity
// with Disney's own typed facet slugs, a map marker, alt text and today's
// performance times — the WDW analog of Universal's `filtersdata` + mobile POI
// feeds. Tolerant: every field optional, facets read by group name.
//
// Deliberately NOT read from here: Lightning Lane (`eA`) and single rider
// (`interests`). Both are already modelled from live queue capability, which
// agrees with these facets on every joinable ride and additionally carries
// state and price — see §3.1.
// ---------------------------------------------------------------------------

/** One `{urlFriendlyId, value, group}` entry of the feed's label dictionary. */
const DisneyFacetDefSchema = z
  .object({
    urlFriendlyId: z.string(),
    value: z.string().nullable().optional(),
    group: z.string().nullable().optional(),
    /** Only on `heightFilter.facets`: the height as a label (`44"`). */
    height: z.string().nullable().optional(),
  })
  .passthrough();
export type DisneyFacetDef = z.infer<typeof DisneyFacetDefSchema>;

/** One performance/operating window from a result's `schedule.schedules[]`. */
const DisneyEntityScheduleSchema = z
  .object({
    type: z.string().nullable().optional(),
    date: z.string().nullable().optional(),
    startTime: z.string().nullable().optional(),
    endTime: z.string().nullable().optional(),
    isClosed: z.boolean().nullable().optional(),
  })
  .passthrough();

const DisneyAttractionEntitySchema = z
  .object({
    facilityId: z.string(),
    id: z.string().optional(),
    /** 'Attraction' | 'Entertainment'. */
    entityType: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    urlFriendlyId: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    locationName: z.string().nullable().optional(),
    parkIds: z.array(z.string()).default([]),
    landId: z.string().nullable().optional(),
    // Facet groups are marketing taxonomy and DO churn, so this stays an open
    // record keyed by group name — unknown groups fall through to tags rather
    // than failing the row.
    facets: z.record(z.string(), z.array(z.string())).nullable().optional(),
    media: z
      .object({
        finderStandardThumb: DisneyFinderMedia.optional(),
        mapBubbleThumbLarge: DisneyFinderMedia.optional(),
        mapBubbleThumbSmall: DisneyFinderMedia.optional(),
      })
      .partial()
      .passthrough()
      .nullable()
      .optional(),
    schedule: z
      .object({
        timeZone: z.string().nullable().optional(),
        schedules: z.array(DisneyEntityScheduleSchema).default([]),
      })
      .partial()
      .passthrough()
      .nullable()
      .optional(),
    marker: z
      .object({
        lat: z.number().nullable().optional(),
        lng: z.number().nullable().optional(),
        /** The physical `point-of-interest` id — `park_poi.poi_id`'s key. */
        id: z.string().nullable().optional(),
        pin: z.string().nullable().optional(),
        card: z
          .object({ land: z.string().nullable().optional() })
          .partial()
          .passthrough()
          .nullable()
          .optional(),
      })
      .partial()
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
export type DisneyAttractionEntity = z.infer<typeof DisneyAttractionEntitySchema>;

export const DisneyAttractionListSchema = z.object({
  results: z.array(DisneyAttractionEntitySchema).default([]),
  locations: z.array(DisneyDiningLocationSchema).default([]),
  filters: z
    .object({
      // 60 slug -> label pairs across the 9 groups we read; the authoritative
      // humanization for accessibility and thrill chips.
      flatFacets: z.array(DisneyFacetDefSchema).default([]),
      heightFilter: z
        .object({ facets: z.array(DisneyFacetDefSchema).default([]) })
        .partial()
        .passthrough()
        .nullable()
        .optional(),
    })
    .partial()
    .passthrough()
    .nullable()
    .optional(),
});
export type DisneyAttractionList = z.infer<typeof DisneyAttractionListSchema>;

export const DisneyMerchandiseListSchema = z.object({
  results: z.array(DisneyMerchandiseEntitySchema).default([]),
  locations: z.array(DisneyDiningLocationSchema).default([]),
});
export type DisneyMerchandiseList = z.infer<typeof DisneyMerchandiseListSchema>;

// ---------------------------------------------------------------------------
// Dining detail enrichment — two per-venue endpoints the weekly catalog cron
// fetches for schedules + menus (the list feed above carries neither):
//   • details-entity-simple/wdw/{urlFriendlyId}/{date}/ -> schedule
//   • dining/dinemenu/api/menu?searchTerm={facilityId}  -> menu
// ---------------------------------------------------------------------------

// `structuredData.openingHoursSpecification[]` — schema.org OpeningHours: a
// forward ~7-day week, one entry per weekday with opens/closes (HH:MM) and a
// [validFrom, validThrough] date range. `description` is the schedule type
// ("Operating", "Extended Evening", …). Cleaner than the nested
// `aagData.schedule.schedules` shape, so we parse from here.
const DisneyOpeningHours = z
  .object({
    dayOfWeek: z.union([z.string(), z.array(z.string())]).optional(),
    opens: z.string().optional(),
    closes: z.string().optional(),
    description: z.string().nullable().optional(),
    validFrom: z.string().nullable().optional(),
    validThrough: z.string().nullable().optional(),
  })
  .partial()
  .passthrough();

export const DisneyDiningDetailSchema = z
  .object({
    structuredData: z
      .object({
        // Clean one-liner ("Experience an endless variety of sips…") — the
        // description fallback when `aagData.description` is absent.
        description: z.string().nullable().optional(),
        openingHoursSpecification: z.array(DisneyOpeningHours).default([]),
      })
      .partial()
      .passthrough()
      .nullable()
      .optional(),
    // Venue enrichment (plan item 2.3): richer marketing copy (may carry inline
    // HTML like <em> — stripped at parse) and the per-venue discounts modal,
    // whose `sections` map is keyed by discount type ('annualPass' | 'dvc' |
    // 'diningPlan' | 'disneyVisa') with a "10%"-style `percentage` (nullable —
    // some sections publish no figure).
    aagData: z
      .object({
        description: z.string().nullable().optional(),
        discountsModal: z
          .object({
            sections: z
              .record(
                z.string(),
                z.object({ percentage: z.string().nullable().optional() }).partial().passthrough(),
              )
              .optional(),
          })
          .partial()
          .passthrough()
          .nullable()
          .optional(),
      })
      .partial()
      .passthrough()
      .nullable()
      .optional(),
    // Entity-level media collection (plan item 1.9, ride-level): gallery
    // stills (`source` is a single 1600x900 URL) plus `video` / `cinemagraph`
    // slides (`source` is a rendition array, webm+mp4; `thumbnail` is a 43px
    // square on the resizable mwImage segment). Present on attraction AND
    // dining detail payloads — currently consumed for attractions.
    mediaEngine: z
      .object({
        data: z
          .array(
            z
              .object({
                type: z.string().nullable().optional(),
                thumbnail: z.string().nullable().optional(),
                mobile: z.string().nullable().optional(),
                source: z
                  .union([z.string(), z.array(z.string())])
                  .nullable()
                  .optional(),
                title: z.string().nullable().optional(),
                alt: z.string().nullable().optional(),
              })
              .partial()
              .passthrough(),
          )
          .default([]),
      })
      .partial()
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
export type DisneyDiningDetail = z.infer<typeof DisneyDiningDetailSchema>;

// dinemenu API: meal periods -> groups -> items. Prices are an array (an item
// can be priced per-serving/per-glass/etc.); some items carry an empty array
// (section descriptions). `withoutTax` is a number in dollars (may be decimal).
const DisneyMenuPrice = z
  .object({
    withoutTax: z.number().nullable().optional(),
    type: z.string().nullable().optional(),
    currency: z.string().nullable().optional(),
  })
  .partial()
  .passthrough();

const DisneyMenuItem = z
  .object({
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    prices: z.array(DisneyMenuPrice).default([]),
  })
  .partial()
  .passthrough();

const DisneyMenuGroup = z
  .object({
    name: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    items: z.array(DisneyMenuItem).default([]),
  })
  .partial()
  .passthrough();

const DisneyMenuMealPeriod = z
  .object({
    name: z.string().nullable().optional(),
    label: z.string().nullable().optional(),
    groups: z.array(DisneyMenuGroup).default([]),
  })
  .partial()
  .passthrough();

export const DisneyDineMenuSchema = z
  .object({
    name: z.string().nullable().optional(),
    mealPeriods: z.array(DisneyMenuMealPeriod).default([]),
  })
  .passthrough();
export type DisneyDineMenu = z.infer<typeof DisneyDineMenuSchema>;

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
    // Weekly recurring hours (Google-Places shape; day 0 = Sunday, 12-hour
    // strings, literal "Closed" on dark days) — on ~163/191 dining venues.
    place_hours: z
      .object({
        periods: z
          .array(
            z
              .object({
                open: z
                  .object({
                    day: z.number().nullable().optional(),
                    time: z.string().nullable().optional(),
                  })
                  .partial()
                  .nullable()
                  .optional(),
                close: z
                  .object({
                    day: z.number().nullable().optional(),
                    time: z.string().nullable().optional(),
                  })
                  .partial()
                  .nullable()
                  .optional(),
              })
              .partial()
              .nullable(),
          )
          .default([]),
      })
      .partial()
      .nullable()
      .optional(),
    // Universal publishes venue phone numbers (unlike Disney) — ~173/191.
    phone_number: z.string().nullable().optional(),
    address: z
      .object({
        address_line1: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        state: z.string().nullable().optional(),
        postal_code: z.string().nullable().optional(),
        country_code: z.string().nullable().optional(),
      })
      .partial()
      .nullable()
      .optional(),
    // Small slug vocabulary: accessible-in-wheelchair / accessible-in-ecv /
    // stationary-seating.
    accessibility_options: z.array(z.string()).nullable().optional(),
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

// ---------------------------------------------------------------------------
// Universal menu page model (plan item 2.1) — the raw Tridion/DD4T JSON behind
// `/contentdata/uor/en/us/things-to-do/dining/{slug}/*.html` (the object the
// Angular app hydrates from; a plain cookieless edge-cached GET — no session).
// The payload is deeply nested, so this schema keeps only the layers the menu
// parser walks and lets everything else drop. Components are identified by
// `Schema.Id`/`Schema.Title`, never by list position.
// ---------------------------------------------------------------------------

/** A Tridion field's plain string values (`{Name, Values, FieldType, …}`). */
const TridionValues = z.object({ Values: z.array(z.string()).default([]) }).partial();

const UniversalMenuDish = z
  .object({
    Title: TridionValues.optional(),
    // XHTML fragment ("<div>herbed butter, peach jam</div>"); wine/beer tabs
    // carry the bottle price inside this text instead of a Price field.
    Description: TridionValues.optional(),
    // String with inconsistent format ("52" vs "5.00"); absent on some rows.
    Price: TridionValues.optional(),
    // Dietary keyword keys: V / VG / GS.
    HealthAttribute: TridionValues.optional(),
  })
  .partial();

const UniversalMenuSection = z
  .object({
    // Sometimes present-but-empty — callers fall back to the component Title.
    Subheading: TridionValues.optional(),
    DishDetails: z
      .object({ EmbeddedValues: z.array(UniversalMenuDish).default([]) })
      .partial()
      .optional(),
  })
  .partial();

const UniversalMenuNavLink = z
  .object({
    Title: TridionValues.optional(),
    Component: z
      .object({
        LinkedComponentValues: z
          .array(z.object({ ResolvedUrl: z.string().nullable().optional() }).partial())
          .default([]),
      })
      .partial()
      .optional(),
  })
  .partial();

// --- The GDS template (Epic Universe + refreshed hotel venues): the menu
// lives in a "GDS - Tabs Container" whose linked "GDS - Tab Items" nest
// "GDS - Text Block Menu" components (sections → items). Headings and item
// text are XHTML fragments; items carry NO prices (verified: 0 priced across
// probed GDS venues — Universal doesn't publish them on this template).

const GdsMenuItem = z
  .object({
    heading: TridionValues.optional(),
    description: TridionValues.optional(),
    // Not observed on any probed GDS venue, but modeled in case it appears.
    price: TridionValues.optional(),
    // Allergen/dietary flags ("Gluten Sensitive", "Egg Sensitive", …).
    featureList: TridionValues.optional(),
  })
  .partial();

const GdsMenuSection = z
  .object({
    heading: TridionValues.optional(),
    items: z
      .object({ EmbeddedValues: z.array(GdsMenuItem).default([]) })
      .partial()
      .optional(),
  })
  .partial();

const GdsTabElement = z
  .object({
    Schema: z
      .object({
        Id: z.string().nullable().optional(),
        Title: z.string().nullable().optional(),
      })
      .partial()
      .nullable()
      .optional(),
    Fields: z
      .object({
        sections: z
          .object({ EmbeddedValues: z.array(GdsMenuSection).default([]) })
          .partial()
          .optional(),
      })
      .partial()
      .default({}),
  })
  .partial();

const GdsTabItem = z
  .object({
    Fields: z
      .object({
        heading: TridionValues.optional(),
        elements: z
          .object({
            EmbeddedValues: z
              .array(
                z
                  .object({
                    component: z
                      .object({
                        LinkedComponentValues: z.array(GdsTabElement).default([]),
                      })
                      .partial()
                      .optional(),
                  })
                  .partial(),
              )
              .default([]),
          })
          .partial()
          .optional(),
      })
      .partial()
      .default({}),
  })
  .partial();

const UniversalMenuComponent = z
  .object({
    Title: z.string().nullable().optional(),
    Schema: z
      .object({
        Id: z.string().nullable().optional(),
        Title: z.string().nullable().optional(),
      })
      .partial()
      .nullable()
      .optional(),
    Fields: z
      .object({
        // "K2 Restaurant Menu" components (one per menu section).
        MenuDetails: z
          .object({ EmbeddedValues: z.array(UniversalMenuSection).default([]) })
          .partial()
          .optional(),
        // "K2 Local Navigation" — the sub-menu tab list (Everyday/Kids'/Wine…).
        Link: z
          .object({ EmbeddedValues: z.array(UniversalMenuNavLink).default([]) })
          .partial()
          .optional(),
        // "K2 Section Title" — the page's menu heading ("Everyday Menu").
        Heading: TridionValues.optional(),
        // "GDS - Tabs Container" — the GDS-template tab list.
        tabContents: z
          .object({ LinkedComponentValues: z.array(GdsTabItem).default([]) })
          .partial()
          .optional(),
      })
      .partial()
      .default({}),
  })
  .partial();

export const UniversalMenuPageSchema = z.object({
  Title: z.string().nullable().optional(),
  ComponentPresentations: z
    .array(z.object({ Component: UniversalMenuComponent.nullable().optional() }).partial())
    .default([]),
});
export type UniversalMenuPage = z.infer<typeof UniversalMenuPageSchema>;

// ---------------------------------------------------------------------------
/**
 * Universal's services host sends `null` where it means "empty list" on most
 * repeating fields (a tile with no taxonomy, a venue with no boundary), so
 * every array in the feeds below normalizes null/undefined to `[]` rather than
 * failing the parse.
 */
const listOf = <T extends z.ZodType>(item: T) =>
  z
    .array(item)
    .nullish()
    .transform((v) => v ?? []);

// Universal mobile-app services (`services.universalorlando.com/api`) — the
// typed POI + venue catalog behind Universal's own app, reachable with the
// static `X-UNIWebService-ApiKey`/`-Token` pair the website publishes in its JS
// bundle (see config.universalServicesBase). Documented in
// research/universal-content-parity.md §2.3.
//
// Every record shares a base shape (name, coords, land/venue ids, images,
// `ExternalIds.PlaceId` in the same `uor.<venue>.<type>.<slug>` namespace the
// places feed uses); each bucket adds its own typed attributes. Loose objects
// throughout: Universal adds buckets and fields without notice, and an unknown
// key must never fail the run.
// ---------------------------------------------------------------------------
const UniversalPoiBase = z
  .object({
    Id: z.number().optional(),
    Category: z.string().nullable().optional(),
    MblDisplayName: z.string().nullable().optional(),
    MblShortDescription: z.string().nullable().optional(),
    MblLongDescription: z.string().nullable().optional(),
    Latitude: z.number().nullable().optional(),
    Longitude: z.number().nullable().optional(),
    // Numeric venue (park/CityWalk/hotel) + land ids — see `UniversalVenue`.
    VenueId: z.number().nullable().optional(),
    LandId: z.number().nullable().optional(),
    ListImage: z.string().nullable().optional(),
    ThumbnailImage: z.string().nullable().optional(),
    DetailImages: listOf(z.string()),
    QueueImage: z.string().nullable().optional(),
    SiteUrl: z.string().nullable().optional(),
    Tags: listOf(z.string()),
    ExternalIds: z
      .object({
        PlaceId: z.string().nullable().optional(),
        ContentId: z.string().nullable().optional(),
        Tridion13: z.string().nullable().optional(),
      })
      .partial()
      .nullable()
      .optional(),
  })
  .passthrough();

const UniversalPoiRide = UniversalPoiBase.extend({
  // The operator's own numeric height fields — the reason this feed exists for
  // us. Absent on rides with no requirement AND on every Epic Universe record
  // (a content gap upstream, filled from the ride's contentdata page instead).
  MinHeightInInches: z.number().nullable().optional(),
  MaxHeightInInches: z.number().nullable().optional(),
  ExpressPassAccepted: z.boolean().nullable().optional(),
  HasSingleRiderLine: z.boolean().nullable().optional(),
  HasChildSwap: z.boolean().nullable().optional(),
  HasNominalFee: z.boolean().nullable().optional(),
  VirtualLine: z.boolean().nullable().optional(),
  RideTypes: listOf(z.string()),
  AccessibilityOptions: listOf(z.string()),
  FunFact: z.string().nullable().optional(),
  Tier: z.string().nullable().optional(),
});

const UniversalPoiShow = UniversalPoiBase.extend({
  ShowTypes: listOf(z.string()),
  AccessibilityOptions: listOf(z.string()),
  ExpressPassAccepted: z.boolean().nullable().optional(),
  ContinuousUntilParkClose: z.boolean().nullable().optional(),
  // "HH:MM:SS" wall-clock strings for today plus their dated forms.
  StartTimes: listOf(z.string()),
  StartDateTimes: listOf(z.string()),
});

const UniversalPoiEvent = UniversalPoiBase.extend({
  Dates: z
    .array(z.object({ StartDate: z.string().nullable().optional() }).partial().passthrough())
    .default([]),
  RequiresSeparateTicket: z.boolean().nullable().optional(),
  RequiresAnnualPass: z.boolean().nullable().optional(),
  TicketedEventDetails: z.string().nullable().optional(),
  Location: z.string().nullable().optional(),
  DisplayInEventList: z.boolean().nullable().optional(),
});

/**
 * The whole `/api/PointsOfInterest?city=Orlando&pageSize=All` payload — one
 * array per POI bucket. Every bucket defaults to `[]` so a bucket Universal
 * stops publishing (or starts publishing) is a no-op for us.
 */
export const UniversalPoiFeedSchema = z
  .object({
    Rides: listOf(UniversalPoiRide),
    Shows: listOf(UniversalPoiShow),
    Parades: listOf(UniversalPoiShow),
    Events: listOf(UniversalPoiEvent),
    DiningLocations: listOf(UniversalPoiBase),
    Shops: listOf(UniversalPoiBase),
    Hotels: listOf(UniversalPoiBase),
    Restrooms: listOf(UniversalPoiBase),
    Lockers: listOf(UniversalPoiBase),
    Atms: listOf(UniversalPoiBase),
    FirstAidStations: listOf(UniversalPoiBase),
    LostAndFoundStations: listOf(UniversalPoiBase),
    GuestServices: listOf(UniversalPoiBase),
    ServiceAnimalRestAreas: listOf(UniversalPoiBase),
    SmokingAreas: listOf(UniversalPoiBase),
    NightlifeLocations: listOf(UniversalPoiBase),
    FamilyServices: listOf(UniversalPoiBase),
    ChargingStations: listOf(UniversalPoiBase),
    GeneralLocations: listOf(UniversalPoiBase),
    Rentals: listOf(UniversalPoiBase),
    Games: listOf(UniversalPoiBase),
  })
  .passthrough();
export type UniversalPoiFeed = z.infer<typeof UniversalPoiFeedSchema>;
export type UniversalPoi = z.infer<typeof UniversalPoiBase>;
export type UniversalPoiRide = z.infer<typeof UniversalPoiRide>;
export type UniversalPoiShow = z.infer<typeof UniversalPoiShow>;

/** One `ContainedLands[]` entry — centroid + the brand color set per land. */
const UniversalLand = z
  .object({
    Id: z.number().optional(),
    MblDisplayName: z.string().nullable().optional(),
    ContainingVenueId: z.number().nullable().optional(),
    Latitude: z.number().nullable().optional(),
    Longitude: z.number().nullable().optional(),
    Color: z.string().nullable().optional(),
  })
  .passthrough();

export const UniversalVenuesSchema = z.object({
  Results: z
    .array(
      z
        .object({
          Id: z.number().optional(),
          MblDisplayName: z.string().nullable().optional(),
          // 'Theme-Park' | 'Entertainment-District' | 'Hotel'.
          VenueType: z.string().nullable().optional(),
          Latitude: z.number().nullable().optional(),
          Longitude: z.number().nullable().optional(),
          // The operator's own outline — an ordered lat/lng ring. Absent on a
          // couple of venues, which then keep their OSM/centroid geometry.
          GpsBoundary: z
            .array(z.object({ Latitude: z.number(), Longitude: z.number() }))
            .nullable()
            .optional(),
          GpsBoundaryCircle: z
            .object({
              RadiusInMeters: z.number().nullable().optional(),
              Latitude: z.number().nullable().optional(),
              Longitude: z.number().nullable().optional(),
            })
            .partial()
            .nullable()
            .optional(),
          ContainedLands: listOf(UniversalLand),
          ExternalIds: z
            .object({ PlaceId: z.string().nullable().optional() })
            .partial()
            .nullable()
            .optional(),
        })
        .passthrough(),
    )
    .default([]),
});
export type UniversalVenues = z.infer<typeof UniversalVenuesSchema>;
export type UniversalVenue = UniversalVenues["Results"][number];

// ---------------------------------------------------------------------------
// `/api/Queues` — the Virtual Line queue registry on the same mobile-services
// host and the same static credential pair (~13 KB, 45 queues). This is the ONLY
// unauthenticated surface that carries per-ride Virtual Line state: the public
// CDN wait-time feed exposes STANDBY/EXPRESS/SINGLE and no virtual queue at all,
// and ThemeParks.wiki's UOR `RETURN_TIME.state` is a stuck `TEMP_FULL` constant
// (verified 2026-07-28: 11,601 samples across 28 rides, 100% one value, null
// return windows). Booking — actual return times — still needs the app's OIDC
// session, so this gives operational state, not appointments.
//
// `PlaceId` is the `uor.<venue>.rides.<slug>` namespace we join Universal
// content on. Loose object: unknown keys must never fail a tick.
// ---------------------------------------------------------------------------
export const UniversalQueuesSchema = z.object({
  Results: z
    .array(
      z
        .object({
          Id: z.number().optional(),
          PlaceId: z.string().nullable().optional(),
          Name: z.string().nullable().optional(),
          /** Virtual Line is switched on for this ride. */
          IsEnabled: z.boolean().nullable().optional(),
          /** Switched on but not currently taking guests. */
          IsUnavailable: z.boolean().nullable().optional(),
          MaxAppointmentSize: z.number().nullable().optional(),
          /** "00:30:00" on all but Jimmy Fallon ("01:00:00"). */
          AppointmentDuration: z.string().nullable().optional(),
          GracePeriodInMin: z.number().nullable().optional(),
          QueueEntityId: z.number().nullable().optional(),
          QueueEntityType: z.string().nullable().optional(),
        })
        .passthrough(),
    )
    .default([]),
});
export type UniversalQueues = z.infer<typeof UniversalQueuesSchema>;
export type UniversalQueue = UniversalQueues["Results"][number];

// ---------------------------------------------------------------------------
// `contentdata/uor/en/us/api/filtersdata/index.html` — the tile database behind
// universalorlando.com's own filter UI (§2.1). One cookieless GET, ~1.4 MB,
// 339 tiles. Each tile carries card copy WITH alt text and a `Meta` block of
// pre-typed taxonomy facets. We take the copy/alt/interests; heights come from
// the per-ride pages instead (the `HeightRequirements` buckets are tagged
// inconsistently — see `sources/universal-content.ts`).
// ---------------------------------------------------------------------------
const TridionKeyword = z
  .object({
    Key: z.string().nullable().optional(),
    Value: z.string().nullable().optional(),
    Description: z.string().nullable().optional(),
  })
  .passthrough();

const FiltersImage = z
  .object({
    HightResolutionImage: z.string().nullable().optional(),
    DesktopTabletImage: z.string().nullable().optional(),
    MobileImage: z.string().nullable().optional(),
    AltText: z.string().nullable().optional(),
  })
  .partial()
  .passthrough();

export const UniversalFiltersDataSchema = z.object({
  PublishedOn: z.string().nullable().optional(),
  Tiles: z
    .array(
      z
        .object({
          PageUrl: z.string().nullable().optional(),
          Content: z
            .object({
              Heading: z.string().nullable().optional(),
              ShortDescription: z.string().nullable().optional(),
              MediumDescription: z.string().nullable().optional(),
              LongDescription: z.string().nullable().optional(),
              TileImage: FiltersImage.nullable().optional(),
              HeroImage: FiltersImage.nullable().optional(),
              CategoryLabel: z.string().nullable().optional(),
            })
            .partial()
            .nullable()
            .optional(),
          Meta: z
            .object({
              AttractionExperiences: listOf(TridionKeyword),
              AttractionLocations: listOf(TridionKeyword),
              AttractionInterests: listOf(TridionKeyword),
              AreasToExplore: listOf(TridionKeyword),
              AttractionType: listOf(TridionKeyword),
              Age: listOf(TridionKeyword),
              MapLatitude: z.string().nullable().optional(),
              MapLongitude: z.string().nullable().optional(),
            })
            .partial()
            .nullable()
            .optional(),
        })
        .passthrough(),
    )
    .default([]),
});
export type UniversalFiltersData = z.infer<typeof UniversalFiltersDataSchema>;
export type UniversalTile = UniversalFiltersData["Tiles"][number];

// ---------------------------------------------------------------------------
// A `/contentdata/…/things-to-do/rides-attractions/{slug}/index.html` page —
// the per-ride Tridion document (§2.2). We only model the "GDS - Utility
// Section" component: its `featureList` is the guest-facing attribute strip
// (Height Requirement · Ride Type · Express Pass · Child Swap · Accessibility ·
// Loose Articles · Rider Safety), which is the ONLY source covering Epic
// Universe and the most accurate height source resort-wide.
// ---------------------------------------------------------------------------
const TridionTextField = z
  .object({ Values: listOf(z.string()), KeywordValues: listOf(TridionKeyword) })
  .partial()
  .passthrough();

const UniversalUtilityFeature = z
  .object({
    Fields: z
      .object({
        icon: TridionTextField.optional(),
        heading: TridionTextField.optional(),
        description: TridionTextField.optional(),
      })
      .partial()
      .optional(),
  })
  .partial()
  .passthrough();

export const UniversalRidePageSchema = z.object({
  ComponentPresentations: z
    .array(
      z
        .object({
          Component: z
            .object({
              Schema: z
                .object({ Id: z.string().optional(), Title: z.string().optional() })
                .partial()
                .optional(),
              Fields: z
                .object({
                  heading: TridionTextField.optional(),
                  categoryLabel: TridionTextField.optional(),
                  featureList: z
                    .object({
                      LinkedComponentValues: z
                        .array(
                          z
                            .object({
                              Fields: z
                                .object({
                                  feature: z
                                    .object({
                                      LinkedComponentValues: z
                                        .array(UniversalUtilityFeature)
                                        .default([]),
                                    })
                                    .partial()
                                    .optional(),
                                })
                                .partial()
                                .optional(),
                            })
                            .passthrough(),
                        )
                        .default([]),
                    })
                    .partial()
                    .optional(),
                })
                .partial()
                .optional(),
            })
            .partial()
            .passthrough()
            .nullable()
            .optional(),
        })
        .partial(),
    )
    .default([]),
});
export type UniversalRidePage = z.infer<typeof UniversalRidePageSchema>;
