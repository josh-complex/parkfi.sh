/**
 * Idempotent seed: reference tables + first-wave parks (Walt Disney World &
 * Universal Orlando) with external-ID mappings to ThemeParks.wiki UUIDs and
 * Disney numeric park IDs. Attractions self-populate on first ingest.
 *
 *   bun run db:seed
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import {
  externalIds,
  operators,
  parkProducts,
  parks,
  refAttractionStatus,
  refProduct,
  refQueueState,
  refQueueType,
  refSource,
  resorts,
} from "./schema.ts";
import { db } from "./index.ts";
import { Product, QueueType, Source } from "#/server/parks/codes.ts";

const TZ = "America/New_York";

async function seedReference() {
  await db
    .insert(refQueueType)
    .values([
      { id: QueueType.STANDBY, code: "STANDBY" },
      { id: QueueType.SINGLE_RIDER, code: "SINGLE_RIDER" },
      { id: QueueType.RETURN_TIME, code: "RETURN_TIME" },
      { id: QueueType.PAID_RETURN_TIME, code: "PAID_RETURN_TIME" },
      { id: QueueType.PAID_STANDBY, code: "PAID_STANDBY" },
      { id: QueueType.BOARDING_GROUP, code: "BOARDING_GROUP" },
    ])
    .onConflictDoNothing();

  await db
    .insert(refProduct)
    .values([
      { id: Product.LIGHTNING_LANE_MULTI, code: "LIGHTNING_LANE_MULTI", pricingGrain: "park_date" },
      {
        id: Product.LIGHTNING_LANE_SINGLE,
        code: "LIGHTNING_LANE_SINGLE",
        pricingGrain: "attraction",
      },
      { id: Product.DISNEY_VIRTUAL_QUEUE, code: "DISNEY_VIRTUAL_QUEUE", pricingGrain: "free" },
      { id: Product.UNIVERSAL_EXPRESS, code: "UNIVERSAL_EXPRESS", pricingGrain: "park_date" },
      { id: Product.UNIVERSAL_VIRTUAL_LINE, code: "UNIVERSAL_VIRTUAL_LINE", pricingGrain: "free" },
      { id: Product.SIXFLAGS_FLASH_PASS, code: "SIXFLAGS_FLASH_PASS", pricingGrain: "park_date" },
      { id: Product.CEDAR_FAIR_FAST_LANE, code: "CEDAR_FAIR_FAST_LANE", pricingGrain: "park_date" },
      { id: Product.SEAWORLD_QUICK_QUEUE, code: "SEAWORLD_QUICK_QUEUE", pricingGrain: "park_date" },
      { id: Product.DISNEY_TICKET, code: "DISNEY_TICKET", pricingGrain: "park_date" },
      { id: Product.UNIVERSAL_TICKET, code: "UNIVERSAL_TICKET", pricingGrain: "park_date" },
    ])
    .onConflictDoNothing();

  await db
    .insert(refAttractionStatus)
    .values([
      { id: 0, code: "UNKNOWN" },
      { id: 1, code: "OPERATING" },
      { id: 2, code: "DOWN" },
      { id: 3, code: "CLOSED" },
      { id: 4, code: "REFURBISHMENT" },
    ])
    .onConflictDoNothing();

  await db
    .insert(refQueueState)
    .values([
      { id: 1, code: "AVAILABLE" },
      { id: 2, code: "LIMITED" },
      { id: 3, code: "SOLD_OUT" },
      { id: 4, code: "NOT_OFFERED" },
      { id: 5, code: "PAUSED" },
    ])
    .onConflictDoNothing();

  await db
    .insert(refSource)
    .values([
      { id: Source.THEMEPARKS_WIKI, code: "themeparks_wiki" },
      { id: Source.QUEUE_TIMES, code: "queue_times" },
      { id: Source.DISNEY_DIRECT, code: "disney_direct" },
      { id: Source.UNIVERSAL_DIRECT, code: "universal_direct" },
      { id: Source.OPENWEATHER, code: "openweather" },
      { id: Source.MANUAL_SEED, code: "manual_seed" },
      { id: Source.OSM, code: "osm" },
    ])
    .onConflictDoNothing();
}

async function upsertOperator(name: string, slug: string): Promise<number> {
  const [row] = await db
    .insert(operators)
    .values({ name, slug })
    .onConflictDoUpdate({ target: operators.slug, set: { name } })
    .returning({ id: operators.id });
  return row.id;
}

async function upsertResort(operatorId: number, name: string, slug: string): Promise<number> {
  const [row] = await db
    .insert(resorts)
    .values({ operatorId, name, slug })
    .onConflictDoUpdate({ target: resorts.slug, set: { name, operatorId } })
    .returning({ id: resorts.id });
  return row.id;
}

interface ParkSeed {
  name: string;
  slug: string;
  themeparksUuid: string;
  disneyId?: string;
  products: Array<{ productId: number; displayName: string }>;
}

async function upsertPark(operatorId: number, resortId: number, p: ParkSeed): Promise<void> {
  const [row] = await db
    .insert(parks)
    .values({ operatorId, resortId, name: p.name, slug: p.slug, timezone: TZ })
    .onConflictDoUpdate({
      target: parks.slug,
      set: { name: p.name, operatorId, resortId, timezone: TZ },
    })
    .returning({ id: parks.id });
  const parkId = row.id;

  await db
    .insert(externalIds)
    .values({
      entityKind: "park",
      entityId: parkId,
      source: Source.THEMEPARKS_WIKI,
      externalId: p.themeparksUuid,
    })
    .onConflictDoNothing();

  if (p.disneyId) {
    await db
      .insert(externalIds)
      .values({
        entityKind: "park",
        entityId: parkId,
        source: Source.DISNEY_DIRECT,
        externalId: p.disneyId,
      })
      .onConflictDoNothing();
  }

  if (p.products.length > 0) {
    await db
      .insert(parkProducts)
      .values(p.products.map((pr) => ({ parkId, ...pr })))
      .onConflictDoNothing();
  }
}

const DISNEY_PRODUCTS = [
  { productId: Product.LIGHTNING_LANE_MULTI, displayName: "Lightning Lane Multi Pass" },
  { productId: Product.LIGHTNING_LANE_SINGLE, displayName: "Lightning Lane Single Pass" },
  { productId: Product.DISNEY_VIRTUAL_QUEUE, displayName: "Virtual Queue" },
  { productId: Product.DISNEY_TICKET, displayName: "Date-Based Theme Park Ticket" },
];
const UNIVERSAL_PRODUCTS = [
  { productId: Product.UNIVERSAL_EXPRESS, displayName: "Universal Express Pass" },
  { productId: Product.UNIVERSAL_VIRTUAL_LINE, displayName: "Virtual Line" },
  { productId: Product.UNIVERSAL_TICKET, displayName: "Theme Park Ticket" },
];
// Volcano Bay (water park) has no Express Pass — its line-skip is the TapuTapu
// Virtual Line — so it omits the Express product the dry parks carry.
const VOLCANO_BAY_PRODUCTS = [
  { productId: Product.UNIVERSAL_VIRTUAL_LINE, displayName: "Virtual Line" },
  { productId: Product.UNIVERSAL_TICKET, displayName: "Water Park Ticket" },
];

async function main() {
  await seedReference();

  const disney = await upsertOperator("The Walt Disney Company", "disney");
  const wdw = await upsertResort(disney, "Walt Disney World® Resort", "walt-disney-world");
  const wdwParks: Array<ParkSeed> = [
    {
      name: "Magic Kingdom Park",
      slug: "magic-kingdom",
      themeparksUuid: "75ea578a-adc8-4116-a54d-dccb60765ef9",
      disneyId: "80007944",
      products: DISNEY_PRODUCTS,
    },
    {
      name: "EPCOT",
      slug: "epcot",
      themeparksUuid: "47f90d2c-e191-4239-a466-5892ef59a88b",
      disneyId: "80007838",
      products: DISNEY_PRODUCTS,
    },
    {
      name: "Disney's Animal Kingdom Theme Park",
      slug: "animal-kingdom",
      themeparksUuid: "1c84a229-8862-4648-9c71-378ddd2c7693",
      disneyId: "80007823",
      products: DISNEY_PRODUCTS,
    },
    {
      name: "Disney's Hollywood Studios",
      slug: "hollywood-studios",
      themeparksUuid: "288747d1-8b4f-4a64-867e-ea7c9b27bad8",
      disneyId: "80007998",
      products: DISNEY_PRODUCTS,
    },
    // Water parks: live status + ride list only. No Lightning Lane / Virtual
    // Queue and no date-based theme-park ticket product, so `products` is empty —
    // which also keeps them out of the ticket-pricing surfaces (those iterate the
    // static `WDW_PARKS` list in `src/lib/parks.ts`, where water parks are absent).
    {
      name: "Disney's Typhoon Lagoon Water Park",
      slug: "typhoon-lagoon",
      themeparksUuid: "b070cbc5-feaa-4b87-a8c1-f94cca037a18",
      disneyId: "80007981",
      products: [],
    },
    {
      name: "Disney's Blizzard Beach Water Park",
      slug: "blizzard-beach",
      themeparksUuid: "ead53ea5-22e5-4095-9a83-8c29300d7c63",
      disneyId: "80007834",
      products: [],
    },
  ];
  for (const p of wdwParks) await upsertPark(disney, wdw, p);

  const universal = await upsertOperator("Universal Destinations & Experiences", "universal");
  const uor = await upsertResort(universal, "Universal Orlando Resort", "universal-orlando");
  const uorParks: Array<ParkSeed> = [
    {
      name: "Universal Studios Florida",
      slug: "universal-studios-florida",
      themeparksUuid: "eb3f4560-2383-4a36-9152-6b3e5ed6bc57",
      products: UNIVERSAL_PRODUCTS,
    },
    {
      name: "Universal Islands of Adventure",
      slug: "islands-of-adventure",
      themeparksUuid: "267615cc-8943-4c2a-ae2c-5da728ca591f",
      products: UNIVERSAL_PRODUCTS,
    },
    {
      name: "Universal Epic Universe",
      slug: "epic-universe",
      themeparksUuid: "12dbb85b-265f-44e6-bccf-f1faa17211fc",
      products: UNIVERSAL_PRODUCTS,
    },
    // Water park: live status + ride list (TapuTapu Virtual Line), no Express.
    {
      name: "Universal Volcano Bay",
      slug: "volcano-bay",
      themeparksUuid: "fe78a026-b91b-470c-b906-9d2266b692da",
      products: VOLCANO_BAY_PRODUCTS,
    },
  ];
  for (const p of uorParks) await upsertPark(universal, uor, p);

  console.log(`Seeded reference data + ${wdwParks.length + uorParks.length} parks.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
