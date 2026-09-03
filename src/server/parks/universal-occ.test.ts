import { describe, expect, it } from "vite-plus/test";

import {
  cleanOccName,
  universalOccDecode,
  universalOccPriceRows,
  universalOccSkus,
} from "./universal-occ.ts";

import type { UniversalOccCalendar, UniversalOccProduct } from "./schemas.ts";

describe("universalOccDecode", () => {
  it("decodes date-priced day tickets", () => {
    expect(universalOccDecode("DAY_01D_BSE_EPIC_ICE", "ADULT")).toEqual({
      family: "TICKET",
      durationDays: 1,
      parkScope: ["EPIC"],
      parkToPark: false,
      ageGroup: "ADULT",
      residency: "STD",
      passTier: null,
    });
    expect(universalOccDecode("DAY_03D_PTP_USF_IOA_EPIC_UVB_FL_SAP", "CHILD")).toMatchObject({
      family: "TICKET",
      durationDays: 3,
      parkScope: ["USF", "UIOA", "EPIC", "UVB"],
      parkToPark: true,
      ageGroup: "CHILD",
      residency: "FL",
    });
    // The store says IOA; our park code is UIOA. Pool codes expand.
    expect(universalOccDecode("DAY_02D_BSE_2P_SAP", "ADULT").parkScope).toEqual(["USF", "UIOA"]);
    // "1 day per park" promos are not park-to-park; unlimited-days has no duration.
    expect(universalOccDecode("DAY_03D_1DPP_USF_IOA_EPIC_PM_SAP", "ADULT")).toMatchObject({
      durationDays: 3,
      parkToPark: false,
    });
    expect(universalOccDecode("DAY_UNL_PTP_USF_IOA_FL_PM_ICE", "ADULT")).toMatchObject({
      family: "TICKET",
      durationDays: null,
      parkToPark: true,
      residency: "FL",
    });
  });

  it("decodes annual passes with their tier", () => {
    expect(universalOccDecode("PASS_12M_PRM_3P_FL", "ADULT")).toEqual({
      family: "ANNUAL",
      durationDays: null,
      parkScope: ["USF", "UIOA", "EPIC"],
      parkToPark: false,
      ageGroup: "ADULT",
      residency: "FL",
      passTier: "PREMIER",
    });
    expect(universalOccDecode("PASS_12M_SEA_2P", "CHILD").passTier).toBe("SEASONAL");
    expect(universalOccDecode("PASS_12M_PWR_2P", "ADULT").passTier).toBe("POWER");
    expect(universalOccDecode("PASS_12M_PRF_2P", "ADULT").passTier).toBe("PREFERRED");
  });

  it("decodes Express, including the new multi-day passes", () => {
    expect(universalOccDecode("AO_UEP_01D_UU_USF_IOA_ICE", "ALL")).toEqual({
      family: "EXPRESS",
      durationDays: 1,
      parkScope: ["USF", "UIOA"],
      parkToPark: false,
      ageGroup: null,
      residency: "STD",
      passTier: null,
    });
    expect(universalOccDecode("AO_UEP_05D_01U_USF_IOA_EPIC_SAP", "ALL")).toMatchObject({
      family: "EXPRESS",
      durationDays: 5,
      parkScope: ["USF", "UIOA", "EPIC"],
    });
    expect(universalOccDecode("AO_UEP_01D_01U_UVB_STANDARD_ICE", "ALL").parkScope).toEqual(["UVB"]);
  });

  it("keeps events and extras out of the admission/Express shelves", () => {
    // HHN products (including HHN's own Express) are events at the Studios.
    expect(universalOccDecode("HHN_UEP_01U_ICE", "ALL")).toMatchObject({
      family: "EVENT",
      durationDays: null,
      parkScope: ["USF"],
    });
    expect(universalOccDecode("170190110008", null)).toMatchObject({
      family: "EVENT",
      parkScope: ["EPIC"],
    });
    expect(universalOccDecode("AO_VIP_01D_NONEXCL_ICE", "ALL")).toMatchObject({
      family: "EXTRA",
      durationDays: null,
      parkScope: [],
    });
    expect(universalOccDecode("AO_PKG_REGULAR_ICE", "ALL").family).toBe("EXTRA");
  });
});

describe("cleanOccName", () => {
  it("strips the store's inline markup", () => {
    expect(cleanOccName("Halloween Horror Nights <br   />Rush of Fear Pass")).toBe(
      "Halloween Horror Nights Rush of Fear Pass",
    );
    expect(cleanOccName("Coca-Cola Freestyle<sup  >®</sup> Souvenir Cup")).toBe(
      "Coca-Cola Freestyle® Souvenir Cup",
    );
    expect(cleanOccName("  ")).toBeNull();
  });
});

function product(over: Partial<UniversalOccProduct>): UniversalOccProduct {
  return { purchasable: true, dateSelectionRequired: true, ...over };
}

describe("universalOccSkus", () => {
  it("explodes a product into one SKU per variant, named by the variant", () => {
    const skus = universalOccSkus("tickets", [
      product({
        code: "DAY_01D_BSE_EPIC_ICE",
        name: "1-Day Ticket",
        price: { value: 139.99 },
        variantOptions: [
          {
            code: "180110115028",
            ageCategory: "CHILD",
            name: "1-Day Universal Epic Universe Child",
            startingPrice: { value: 134.99 },
          },
          {
            code: "180110111028",
            ageCategory: "ADULT",
            name: "1-Day Universal Epic Universe Adult",
            startingPrice: { value: 139.99 },
          },
        ],
      }),
    ]);
    expect(
      skus.map((s) => [s.sku, s.name, s.dims.ageGroup, s.listPriceCents, s.datePriced]),
    ).toEqual([
      ["180110115028", "1-Day Universal Epic Universe Child", "CHILD", 13499, true],
      ["180110111028", "1-Day Universal Epic Universe Adult", "ADULT", 13999, true],
    ]);
    expect(skus[0]!.productCode).toBe("DAY_01D_BSE_EPIC_ICE");
    expect(skus[0]!.category).toBe("tickets");
  });

  it("uses the product's name for a single 'ALL' variant, whose own name is shorthand", () => {
    const [sku] = universalOccSkus("express", [
      product({
        code: "AO_UEP_01D_UU_USF_IOA_ICE",
        name: "1-Day Universal Express Unlimited Pass: 2 Parks",
        price: { value: 154.99 },
        variantOptions: [
          { code: "110117006301", ageCategory: "ALL", name: "2PK Express Unlimited" },
        ],
      }),
    ]);
    expect(sku).toMatchObject({
      sku: "110117006301",
      name: "1-Day Universal Express Unlimited Pass: 2 Parks",
      listPriceCents: 15499, // falls back to the product from-price
      dims: { family: "EXPRESS", ageGroup: null },
    });
  });

  it("treats a variant-less product as its own SKU and skips codeless ones", () => {
    const skus = universalOccSkus("tickets", [
      product({
        code: "170190110008",
        name: "Universal Nights at Universal Epic Universe",
        price: { value: 179.99 },
        variantOptions: [],
      }),
      product({ name: "no code", variantOptions: [] }),
      product({
        code: "PASS_12M_PRM_2P",
        name: "Premier Annual Pass",
        dateSelectionRequired: false,
        variantOptions: [{ code: "110133651520", ageCategory: "ADULT", name: "Premier Adult" }],
      }),
    ]);
    expect(skus.map((s) => [s.sku, s.dims.family, s.datePriced])).toEqual([
      ["170190110008", "EVENT", true],
      ["110133651520", "ANNUAL", false],
    ]);
  });
});

describe("universalOccPriceRows", () => {
  const calendar: UniversalOccCalendar = {
    eventAvailability: [
      {
        partNumber: "185150321019",
        calendarDates: [
          {
            date: "2026-09-02", // before the window
            canBeVisited: true,
            pricing: [{ amount: 160, fullVariantPrice: 479.99 }],
            inventoryEvents: [{ isAvailable: true }],
          },
          {
            date: "2026-09-03",
            canBeVisited: true,
            forceSoldOut: false,
            pricing: [{ amount: 169, fullVariantPrice: 505.99, currency: "USD" }],
            inventoryEvents: [{ isAvailable: true }],
          },
          {
            date: "2026-09-04",
            canBeVisited: false,
            pricing: [{ amount: 177, fullVariantPrice: 528.99 }],
            inventoryEvents: [{ isAvailable: true }],
          },
          {
            date: "2026-09-05",
            canBeVisited: true,
            pricing: [{ amount: 172 }], // no exact total published
            inventoryEvents: [{ isAvailable: false }],
          },
          { date: "2026-09-06", canBeVisited: true, pricing: [], inventoryEvents: [] },
        ],
      },
      { partNumber: "110133651520", calendarDates: [] }, // annual pass: no calendar
    ],
  };

  it("records the exact ticket total per date, inside the window, with sell-outs", () => {
    expect(universalOccPriceRows(calendar, "2026-09-03", "2026-12-31")).toEqual([
      {
        sku: "185150321019",
        serviceDate: "2026-09-03",
        priceCents: 50599,
        currency: "USD",
        available: true,
      },
      {
        sku: "185150321019",
        serviceDate: "2026-09-04",
        priceCents: 52899,
        currency: "USD",
        available: false,
      },
      {
        sku: "185150321019",
        serviceDate: "2026-09-05",
        priceCents: 17200,
        currency: "USD",
        available: false,
      },
    ]);
  });
});
