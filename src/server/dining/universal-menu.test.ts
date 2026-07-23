import { describe, expect, it } from "vite-plus/test";

import { UniversalMenuPageSchema } from "../parks/schemas.ts";
import { universalMenuPath, universalMenuTabRows, xhtmlToText } from "./universal-menu.ts";

/** A minimal Tridion page model — the shapes seen live on bigfire/the-cowfish. */
function page(components: Array<unknown>) {
  return UniversalMenuPageSchema.parse({
    ComponentPresentations: components.map((c) => ({ Component: c })),
  });
}

function menuComponent(
  title: string,
  sections: Array<{
    subheading?: string;
    dishes: Array<{ title?: string; description?: string; price?: string; health?: Array<string> }>;
  }>,
) {
  return {
    Title: title,
    Schema: { Id: "tcm:58-19609-8", Title: "K2 Restaurant Menu" },
    Fields: {
      MenuDetails: {
        EmbeddedValues: sections.map((s) => ({
          Subheading: { Values: s.subheading ? [s.subheading] : [] },
          DishDetails: {
            EmbeddedValues: s.dishes.map((d) => ({
              Title: { Values: d.title ? [d.title] : [] },
              Description: { Values: d.description ? [d.description] : [] },
              Price: { Values: d.price ? [d.price] : [] },
              HealthAttribute: { Values: d.health ?? [] },
            })),
          },
        })),
      },
    },
  };
}

describe("universalMenuPath", () => {
  it("prefers the DINING_MENU url and rewrites /web/ to /uor/", () => {
    expect(
      universalMenuPath([
        {
          url_type: "PLACE_POI_DETAILS",
          url: "https://www.universalorlando.com/web/en/us/things-to-do/dining/the-cowfish-sushi-burger-bar",
        },
        {
          url_type: "DINING_MENU",
          url: "https://www.universalorlando.com/web/en/us/things-to-do/dining/the-cowfish/menu.html",
        },
      ]),
    ).toBe("/uor/en/us/things-to-do/dining/the-cowfish/menu.html");
  });

  it("falls back to the detail page + /menu.html, tolerating relative urls", () => {
    expect(
      universalMenuPath([
        { url_type: "PLACE_POI_DETAILS", url: "/web/en/us/things-to-do/dining/bigfire" },
      ]),
    ).toBe("/uor/en/us/things-to-do/dining/bigfire/menu.html");
  });

  it("returns null when the place carries no usable url", () => {
    expect(universalMenuPath([])).toBeNull();
    expect(universalMenuPath([{ url_type: "OTHER", url: "https://example.com/x" }])).toBeNull();
    expect(universalMenuPath(null)).toBeNull();
  });
});

describe("xhtmlToText", () => {
  it("strips inline tags and decodes common entities", () => {
    expect(
      xhtmlToText('<div xmlns="http://www.w3.org/1999/xhtml">herbed butter, peach jam</div>'),
    ).toBe("herbed butter, peach jam");
    expect(xhtmlToText("Mac &amp; Cheese&nbsp;")).toBe("Mac & Cheese");
  });

  it("separates block boundaries so fragments do not fuse", () => {
    // The wine-menu shape: variety in one <p>, bottle price in the next.
    expect(
      xhtmlToText(
        '<p xmlns="http://www.w3.org/1999/xhtml">Chardonnay, <em>Fulton,</em> <em>California</em></p><p xmlns="http://www.w3.org/1999/xhtml">Bottle 53</p>',
      ),
    ).toBe("Chardonnay, Fulton, California · Bottle 53");
    expect(xhtmlToText("Cabernet, <em>Washington</em><br />\nBottle 60")).toBe(
      "Cabernet, Washington · Bottle 60",
    );
  });

  it("returns null for effectively empty fragments", () => {
    expect(xhtmlToText("<p> </p>")).toBeNull();
  });
});

describe("universalMenuTabRows", () => {
  it("maps sections and dishes onto menu rows", () => {
    const rows = universalMenuTabRows(
      "uor.cw.dining.bigfire",
      "Everyday Menu",
      page([
        menuComponent("Bigfire - Everyday Menu - Appetizers", [
          {
            subheading: "Starters",
            dishes: [
              {
                title: "Artisan Sourdough Bread",
                description: "<div>herbed butter, peach jam</div>",
                price: "9",
                health: ["V"],
              },
              { title: "Butternut Squash Soup", description: "crispy pork belly", price: "12.50" },
            ],
          },
        ]),
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      facilityId: "uor.cw.dining.bigfire",
      mealPeriod: "Everyday Menu",
      groupName: null,
      itemType: "Starters",
      title: "Artisan Sourdough Bread",
      description: "herbed butter, peach jam (Vegetarian)",
      price: 9,
      priceType: null,
      currency: "USD",
      prices: [{ amount: 9, type: null, currency: "USD" }],
    });
    expect(rows[1]).toMatchObject({ title: "Butternut Squash Soup", price: 12.5 });
  });

  it("falls back to the component title's last segment when Subheading is empty", () => {
    const rows = universalMenuTabRows(
      "fid",
      "Everyday Menu",
      page([
        menuComponent("The Cowfish - Everyday Menu - Salads & Bowls", [
          { dishes: [{ title: "Crab Rangoon Salad", price: "23" }] },
        ]),
      ]),
    );
    expect(rows[0]).toMatchObject({ itemType: "Salads & Bowls", title: "Crab Rangoon Salad" });
  });

  it("tolerates price-less dishes (wine tabs) and skips title-less rows", () => {
    const rows = universalMenuTabRows(
      "fid",
      "Wine Menu",
      page([
        menuComponent("Bigfire - Drink Menu - White Wine", [
          {
            dishes: [
              { title: "Chalk Hill®", description: "<p>Chardonnay</p><p>Bottle 58</p>" },
              { description: "orphan description, no title" },
            ],
          },
        ]),
      ]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "Chalk Hill®",
      description: "Chardonnay · Bottle 58",
      price: null,
      currency: null,
      prices: null,
    });
  });

  it("extracts GDS-template tabs (Epic Universe / hotel venues)", () => {
    const gdsItem = (heading: string, description?: string) => ({
      heading: { Values: [heading] },
      description: { Values: description ? [description] : [] },
    });
    const textMenu = (sections: Array<{ heading: string; items: Array<unknown> }>) => ({
      Schema: { Id: "tcm:58-178762-8", Title: "GDS - Text Block Menu" },
      Fields: {
        sections: {
          EmbeddedValues: sections.map((s) => ({
            heading: { Values: [s.heading] },
            items: { EmbeddedValues: s.items },
          })),
        },
      },
    });
    const tab = (heading: string, elements: Array<unknown>) => ({
      Fields: {
        heading: { Values: [heading] },
        elements: {
          EmbeddedValues: elements.map((e) => ({ component: { LinkedComponentValues: [e] } })),
        },
      },
    });
    const rows = universalMenuTabRows(
      "uor.eu.dining.das_stakehaus",
      "Menu",
      page([
        {
          Title: "GDS - Das Stakehaus Menu - Tabs Container",
          Schema: { Id: "tcm:58-170370-8", Title: "GDS - Tabs Container" },
          Fields: {
            tabContents: {
              LinkedComponentValues: [
                tab("Stakes", [
                  textMenu([
                    {
                      heading: "Stakes",
                      items: [gdsItem("Steak on a Stake", "tenderloin steak, red chimichurri")],
                    },
                  ]),
                  // Spacer components inside the tab are skipped.
                  { Schema: { Title: "GDS - Place Holder" }, Fields: {} },
                ]),
                tab("Wine", [
                  textMenu([
                    { heading: "Whites", items: [gdsItem("Aviary® Chardonnay")] },
                    { heading: "Reds", items: [gdsItem("Sean Minor® Cabernet")] },
                  ]),
                ]),
                tab("Soups &amp; Salads", [
                  textMenu([
                    {
                      heading: "Soup &amp; Salads",
                      items: [
                        gdsItem(
                          '<p xmlns="http://www.w3.org/1999/xhtml">House Salad*</p>',
                          "<div>greens, vinaigrette</div>",
                        ),
                      ],
                    },
                  ]),
                ]),
              ],
            },
          },
        },
      ]),
    );
    expect(rows).toHaveLength(4);
    // Tab heading == section heading → itemType only, no groupName.
    expect(rows[0]).toMatchObject({
      mealPeriod: "Menu",
      itemType: "Stakes",
      groupName: null,
      title: "Steak on a Stake",
      description: "tenderloin steak, red chimichurri",
      price: null,
      prices: null,
    });
    // Differing section headings become the finer groupName.
    expect(rows[1]).toMatchObject({ itemType: "Wine", groupName: "Whites" });
    expect(rows[2]).toMatchObject({ itemType: "Wine", groupName: "Reds" });
    // XHTML headings/titles are cleaned; entities decode.
    expect(rows[3]).toMatchObject({
      itemType: "Soups & Salads",
      groupName: "Soup & Salads",
      title: "House Salad*",
      description: "greens, vinaigrette",
    });
  });

  it("ignores non-menu components", () => {
    const rows = universalMenuTabRows(
      "fid",
      "Menu",
      page([
        {
          Title: "Legend",
          Schema: { Id: "tcm:58-99999-8", Title: "K2 Restaurant Menu Legend Attributes" },
          Fields: {},
        },
        { Title: "Nav", Schema: { Title: "K2 Local Navigation" }, Fields: {} },
      ]),
    );
    expect(rows).toHaveLength(0);
  });
});
