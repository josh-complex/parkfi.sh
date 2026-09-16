import { describe, expect, it } from "vite-plus/test";

import {
  findDishCover,
  isFoodPhoto,
  matchDishPhoto,
  rankTeaserDishes,
  type DishPhotoSlide,
  type TeaserCandidate,
} from "./menu-teaser.ts";

/** Every fixture below is a real row from `dining_menu_item` / `hero_media`. */
function candidate(
  title: string,
  opts: Partial<{
    description: string | null;
    price: number | null;
    groupName: string | null;
    itemType: string | null;
  }> = {},
): TeaserCandidate {
  return {
    item: {
      title,
      description: opts.description ?? null,
      price: opts.price ?? null,
      priceType: null,
      currency: "USD",
    },
    groupName: opts.groupName ?? null,
    itemType: opts.itemType ?? null,
    index: 0,
  };
}

function withIndexes(list: TeaserCandidate[]): TeaserCandidate[] {
  return list.map((c, index) => ({ ...c, index }));
}

const titles = (list: TeaserCandidate[]) => list.map((c) => c.item.title);

describe("rankTeaserDishes", () => {
  it("leads with entrées rather than the opening appetizers", () => {
    const ranked = rankTeaserDishes(
      withIndexes([
        candidate("Fresh Fruit Bowl", {
          price: 15,
          itemType: "Appetizer",
          groupName: "Appetizers",
        }),
        candidate("Yogurt Parfait", { price: 12, itemType: "Appetizer", groupName: "Appetizers" }),
        candidate("Buttermilk-fried Chicken and Waffle", {
          description: "Hand-breaded Chicken Breast and Malted Waffle",
          price: 27,
          itemType: "Entree",
          groupName: "Entrées",
        }),
      ]),
      "Grand Floridian Cafe",
    );
    expect(titles(ranked)[0]).toBe("Buttermilk-fried Chicken and Waffle");
  });

  it("prefers a dish the venue named after itself", () => {
    const ranked = rankTeaserDishes(
      withIndexes([
        candidate("Steak and Eggs*", { price: 27, itemType: "Entree", groupName: "Entrées" }),
        candidate("Grand Floridian Café Signature Burger*", {
          price: 26,
          itemType: "Entree",
          groupName: "Entrées",
        }),
      ]),
      "Grand Floridian Cafe",
    );
    expect(titles(ranked)[0]).toBe("Grand Floridian Café Signature Burger*");
  });

  it("sinks the kids' menu and the allergy-friendly restatement", () => {
    const ranked = rankTeaserDishes(
      withIndexes([
        candidate("Chopped Romaine Salad", {
          price: 5.25,
          itemType: "Kids",
          groupName: "Kids' Appetizers (à la carte)",
        }),
        candidate("Charred Eggplant", {
          itemType: "Allergy Friendly",
          groupName: "Allergy-Friendly Entrées",
        }),
        candidate("Charred Eggplant Entrée", { itemType: "Entree", groupName: "Entrées" }),
      ]),
      "Be Our Guest Restaurant",
    );
    expect(titles(ranked)[0]).toBe("Charred Eggplant Entrée");
    expect(titles(ranked).at(-1)).toBe("Chopped Romaine Salad");
  });

  it("holds drinks back on a menu that also serves food", () => {
    const food = [
      candidate("Short Rib Beef Bourguignon", { itemType: "Entree", groupName: "Entrées" }),
      candidate("Château Shimmer", {
        price: 7.75,
        itemType: "Beverage",
        // A bar section naming itself "Signature" must not read as Disney's own
        // Featured flag — the bug this case was written for.
        groupName: "Signature Non-Alcoholic Drinks",
      }),
    ];
    expect(titles(rankTeaserDishes(withIndexes(food), "Be Our Guest Restaurant"))[0]).toBe(
      "Short Rib Beef Bourguignon",
    );
  });

  it("lets drinks lead at a bar, where they are the menu", () => {
    const bar = withIndexes([
      candidate("Uh-Oa!", { price: 28.5, itemType: "Alcoholic Beverage", groupName: "Cocktails" }),
      candidate("Rum Flight (3/4-oz pour of each)", {
        price: 22,
        itemType: "Alcoholic Beverage",
        groupName: "Cocktails",
      }),
    ]);
    expect(titles(rankTeaserDishes(bar, "Trader Sam's Grog Grotto"))).toHaveLength(2);
    expect(titles(rankTeaserDishes(bar, "Trader Sam's Grog Grotto"))[0]).toBe("Uh-Oa!");
  });

  it("drops an unpriced row that only prices something else", () => {
    const ranked = rankTeaserDishes(
      withIndexes([
        candidate("Specialty Toppings (5 | 7 | 8.5 each)", {
          itemType: "Entree",
          groupName: "Pizze - Build Your Own",
        }),
        candidate("Fettucine via Napoli", { price: 29, itemType: "Entree", groupName: "Paste" }),
      ]),
      "Via Napoli Ristorante e Pizzeria",
    );
    expect(titles(ranked)).toEqual(["Fettucine via Napoli"]);
  });

  it("drops a prix-fixe venue's price rows, which carry no price of their own", () => {
    const ranked = rankTeaserDishes(
      withIndexes([
        candidate("$49 per adult, plus tax and gratuity", {
          itemType: "Entree",
          groupName: "Chip ‘n’ Dale Harvest Feast Pricing",
        }),
        candidate("$33 per child (Ages 3-9), plus tax and gratuity", {
          itemType: "Entree",
          groupName: "Chip ‘n’ Dale Harvest Feast Pricing",
        }),
        candidate("Mickey-shaped Waffles", {
          description: "with Maple Syrup",
          itemType: "Entree",
          groupName: "Chip ‘n’ Dale Harvest Feast",
        }),
      ]),
      "Garden Grill Restaurant",
    );
    expect(titles(ranked)).toEqual(["Mickey-shaped Waffles"]);
  });

  it("de-duplicates a dish listed under several groups", () => {
    const ranked = rankTeaserDishes(
      withIndexes([
        candidate("Caesar Salad", { price: 10, groupName: "Appetizers" }),
        candidate("Caesar Salad", { price: 10, groupName: "Sides" }),
      ]),
      null,
    );
    expect(ranked).toHaveLength(1);
  });
});

// Both slides are the real assets on Grand Floridian Cafe's `hero_media`.
const CHICKEN_WAFFLE: DishPhotoSlide = {
  url: "https://cdn1.parksmedia.wdprapps.disney.com/resize/mwImage/1/1600/900/75/vision-dam/digital/parks-platform/parks-global-assets/disney-world/dining/grand-floridian-cafe/WDW_GrandFloridian_GrandCafe_ChickenAndWaffles1_FULL_DH-16x9.jpg?2022-05-13T20:27:57+00:00",
  alt: "A waffle in the shape of Mickey’s head and 2 pieces of fried chicken breast, with Sriracha Honey drizzle",
};
const ONION_SOUP: DishPhotoSlide = {
  url: "https://cdn1.parksmedia.wdprapps.disney.com/resize/mwImage/1/1600/900/75/vision-dam/digital/parks-platform/parks-global-assets/disney-world/dining/grand-floridian-cafe/WDW_GrandFloridian_GrandCafe_FrenchOnionSoup2_FULL_DH-16x9.jpg?2022-05-13T20:28:03+00:00",
  alt: "A spoon dipping into a bowl of French onion soup",
};
const DINING_ROOM: DishPhotoSlide = {
  url: "https://cdn1.parksmedia.wdprapps.disney.com/resize/mwImage/1/1600/900/75/dam/wdpro-assets/gallery/dining/grand-floridian-cafe/grand-floridian-cafe-gallery01.jpg",
  alt: "Panoramic view of the dining room from an alternate angle",
};
const GALLERY = [DINING_ROOM, CHICKEN_WAFFLE, ONION_SOUP];

describe("matchDishPhoto", () => {
  const venue = "Grand Floridian Cafe";

  it("matches a dish its caption names", () => {
    const item = candidate("Buttermilk-fried Chicken and Waffle", {
      description: "Hand-breaded Chicken Breast and Malted Waffle with Sriracha-Honey Drizzle",
    }).item;
    expect(matchDishPhoto(item, GALLERY, venue)).toBe(CHICKEN_WAFFLE);
  });

  it("matches through the description when the menu name differs", () => {
    const item = candidate("Caramelized Onion Soup Gratin", {
      description: "Traditional French Onion Soup",
    }).item;
    expect(matchDishPhoto(item, GALLERY, venue)).toBe(ONION_SOUP);
  });

  it("does not match a dish to a room", () => {
    const item = candidate("Avocado Toast", {
      description: "Avocado, Fire-roasted Tomatoes, and Micro Greens on Multigrain Toast",
    }).item;
    expect(matchDishPhoto(item, GALLERY, venue)).toBeNull();
  });

  it("ignores the venue's own name inside a caption", () => {
    // "Maya Grill Parrillada" once matched a photo of the building, on the
    // strength of "maya" and "grill" alone.
    const item = candidate("Maya Grill Parrillada").item;
    const exterior: DishPhotoSlide = {
      url: "https://cdn1.parksmedia.wdprapps.disney.com/maya-grill-gallery02.jpg",
      alt: "The exterior of Maya Grill features tiles and arched columns",
    };
    expect(matchDishPhoto(item, [exterior], "Maya Grill")).toBeNull();
  });

  it("will not take a dish named only late in a caption", () => {
    const item = candidate("Macaroni & Cheese").item;
    const platter: DishPhotoSlide = {
      url: "https://cdn1.parksmedia.wdprapps.disney.com/trails-end-gallery03.jpg",
      alt: "Eight piece fried chicken meal with mashed potatoes, macaroni & cheese and cornbread",
    };
    expect(matchDishPhoto(item, [platter], "Trail's End Restaurant")).toBeNull();
  });

  it("falls back to the DAM filename when the caption is vague", () => {
    const item = candidate("French Onion Soup").item;
    const vague: DishPhotoSlide = { url: ONION_SOUP.url, alt: "A plated starter" };
    expect(matchDishPhoto(item, [vague], "Grand Floridian Cafe")).toBe(vague);
  });

  it("sees through a dish name's filler adjectives", () => {
    // "Mickey-shaped Waffles" against "A skillet holding Mickey waffles,
    // scrambled eggs and bacon": "shaped" is not a word about the food.
    const item = candidate("Mickey-shaped Waffles", { description: "with Maple Syrup" }).item;
    const skillet: DishPhotoSlide = {
      url: "https://cdn1.parksmedia.wdprapps.disney.com/WDW_EPCOT_GardenGrill_ChipNDaleHarvestBreakfastSTYLIZED-16x9.jpg",
      alt: "A skillet holding Mickey waffles, scrambled eggs and bacon",
    };
    expect(matchDishPhoto(item, [skillet], "Garden Grill Restaurant")).toBe(skillet);
  });

  it("needs two words of evidence", () => {
    const item = candidate("Waffle").item;
    expect(matchDishPhoto(item, GALLERY, venue)).toBeNull();
  });
});

describe("isFoodPhoto", () => {
  const food = (alt: string, venue: string | null = null) =>
    isFoodPhoto({ url: "https://cdn1.parksmedia.wdprapps.disney.com/x.jpg", alt }, venue);

  it("takes a photo of the food", () => {
    expect(
      food("A breakfast buffet spread with Mickey shaped waffles, sausages, ham and pastries"),
    ).toBe(true);
    expect(food("Sliced roasted pork with tomatoes and onions in a serving pot")).toBe(true);
  });

  it("leaves the room, the sign and the people", () => {
    expect(food("Panoramic view of the dining room from an alternate angle")).toBe(false);
    expect(
      food("Brass-framed, plate-glass Grand Floridian Cafe sign between 2 white columns"),
    ).toBe(false);
    expect(food("Two couples share a pizza and laughs at Via Napoli")).toBe(false);
    expect(food("A row of cocktail tables with Art Deco chairs and umbrellas")).toBe(false);
    expect(food("Goofy and Donald Duck dressed in safari gear")).toBe(false);
  });

  it("does not mistake the venue's own name for furniture", () => {
    const alt = "Spiced Lamb Kefta topped with feta cheese and tomato sauce at Spice Road Table";
    expect(food(alt, "Spice Road Table")).toBe(true);
    expect(food(alt, null)).toBe(false);
  });

  it("wants a caption to go on", () => {
    expect(food("")).toBe(false);
    expect(food("Tusker House Restaurant", "Tusker House Restaurant")).toBe(false);
  });
});

describe("findDishCover", () => {
  const venue = "Grand Floridian Cafe";

  it("covers with the highest-ranked dish that has a photo", () => {
    const ranked = rankTeaserDishes(
      withIndexes([
        candidate("Miso-glazed Salmon*", { price: 31, itemType: "Entree", groupName: "Entrées" }),
        candidate("Buttermilk-fried Chicken and Waffle", {
          description: "Hand-breaded Chicken Breast and Malted Waffle with Sriracha-Honey Drizzle",
          price: 27,
          itemType: "Entree",
          groupName: "Entrées",
        }),
      ]),
      venue,
    );
    const cover = findDishCover(ranked, GALLERY, venue, 12);
    expect(cover?.candidate.item.title).toBe("Buttermilk-fried Chicken and Waffle");
    expect(cover?.slide).toBe(CHICKEN_WAFFLE);
  });

  // Both cases below are one real venue: Sunshine Tree Terrace lists a soft-serve
  // cup per flavour, and its gallery once put the citrus photo on the chocolate one.
  const flavours = () =>
    rankTeaserDishes(
      withIndexes([
        candidate("Chocolate Soft-serve Cup", { price: 6 }),
        candidate("Vanilla Soft-serve Cup", { price: 6 }),
      ]),
      "Sunshine Tree Terrace",
    );

  it("gives a flavour's photo to that flavour, not to its neighbour", () => {
    const vanilla: DishPhotoSlide = {
      url: "https://cdn1.parksmedia.wdprapps.disney.com/sunshine-tree-gallery01.jpg",
      alt: "Cups of soft-serve, made with soft-serve vanilla ice cream",
    };
    const cover = findDishCover(flavours(), [vanilla], "Sunshine Tree Terrace", 12);
    expect(cover?.candidate.item.title).toBe("Vanilla Soft-serve Cup");
  });

  it("gives a photo to the dish it says most about, not the shortest name that fits", () => {
    // Grand Floridian Cafe lists a plain "Mickey-shaped Waffle" alongside the
    // chicken and waffle. Both fit the caption; only one is the photograph.
    const ranked = rankTeaserDishes(
      withIndexes([
        candidate("Buttermilk-fried Chicken and Waffle", {
          description: "Hand-breaded Chicken Breast and Malted Waffle with Sriracha-Honey Drizzle",
          price: 27,
          itemType: "Entree",
          groupName: "Entrées",
        }),
        candidate("Mickey-shaped Waffle", {
          description: "Malted Waffle served with Bacon or Sausage",
          price: 16,
          itemType: "Entree",
          groupName: "Entrées",
        }),
      ]),
      venue,
    );
    const cover = findDishCover(ranked, GALLERY, venue, 12);
    expect(cover?.candidate.item.title).toBe("Buttermilk-fried Chicken and Waffle");
  });

  it("refuses a photo of the category, which fits every flavour equally", () => {
    const anonymous: DishPhotoSlide = {
      url: "https://cdn1.parksmedia.wdprapps.disney.com/sunshine-tree-gallery02.jpg",
      alt: "Three cups of soft-serve ice cream",
    };
    expect(findDishCover(flavours(), [anonymous], "Sunshine Tree Terrace", 12)).toBeNull();
  });

  it("returns null for a gallery of rooms, and for no gallery at all", () => {
    const ranked = rankTeaserDishes(
      withIndexes([candidate("Avocado Toast", { price: 13 })]),
      venue,
    );
    expect(findDishCover(ranked, [DINING_ROOM], venue, 12)).toBeNull();
    expect(findDishCover(ranked, [], venue, 12)).toBeNull();
  });
});
