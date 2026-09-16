/**
 * What the venue page's mint panel shows before you open the menu: which four
 * dishes stand for the whole card, and whether one of them has a photograph.
 *
 * Both answers used to be "whatever comes first" — the teaser took the opening
 * three items of a meal period (on most Disney menus, the appetizers) and drew
 * a lucide glyph next to each. A fruit bowl and a yogurt parfait are a poor
 * argument for a restaurant, and the glyph was a guess dressed as information.
 *
 * So: rank the card for what a visitor would call the *signature* dishes
 * (`rankTeaserDishes`), and look for a real photograph of one of them in media
 * we already hold (`findDishCover`). No new fetch and no new column — the WDW
 * `hero_media` gallery we ingest for the hero carries Disney's own alt text,
 * which names the dish often enough to be worth matching against.
 */

import { decodeEntities } from "#/lib/text.ts";

import type { MenuItemData } from "./menu-content.tsx";

/** A menu item plus the group context the ranking needs. */
export interface TeaserCandidate {
  item: MenuItemData;
  /** The menu group it was listed under ("Entrées", "Kids' Selections"). */
  groupName: string | null;
  /** The feed's own classification — "Entree", "Featured", "Kids", … */
  itemType: string | null;
  /** Position within the meal period, for a stable reading order. */
  index: number;
}

/** A gallery still the cover can be drawn from (`restaurant_dim.hero_media`). */
export interface DishPhotoSlide {
  url: string;
  alt: string | null;
}

// ── Text ──────────────────────────────────────────────────────────────────────

/**
 * Words that carry no evidence either way. Deliberately short: this list
 * decides what a *dish name* is made of, and over-pruning ("fresh", "house")
 * throws away the words that distinguish two items on the same menu.
 */
const STOP = new Set([
  "and",
  "the",
  "with",
  "our",
  "your",
  "for",
  "from",
  "served",
  "topped",
  "side",
  "sides",
  "choice",
  "style",
  "shape",
  "shaped",
  "made",
  "fresh",
  "plate",
  "plated",
  "bowl",
  "dish",
  "order",
  "each",
  "per",
  "small",
  "large",
  "add",
  "one",
  "two",
  "piece",
  "pieces",
]);

/**
 * Lowercase, strip accents and punctuation, and break the runs a DAM filename
 * packs together — `FrenchOnionSoup2` has to come apart into words, digits
 * included, or the last word of every such name comes out as "soup2".
 */
function normalize(text: string): string {
  return decodeEntities(text)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Crude singular form — enough to tie "waffles" to "waffle", "cups" to "cup". */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && (word.endsWith("es") || word.endsWith("s"))) {
    return word.replace(/e?s$/, "");
  }
  return word;
}

/** Significant, stemmed words — the units both sides of a match are made of. */
function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w))
    .map(stem);
}

// ── Ranking ───────────────────────────────────────────────────────────────────

/**
 * Scores below are relative to each other only; the absolute numbers mean
 * nothing. The shape of the rule set: the feed's own classification is the
 * strongest signal we have (Disney literally flags "Featured" items), a dish
 * the venue named after itself is almost always the one to show, and the two
 * large duplicate blocks every Disney menu carries — the kids' menu and the
 * allergy-friendly restatement of the whole card — must never lead.
 */
const SCORE = {
  featured: 2,
  entree: 3,
  signature: 2,
  eponymous: 2,
  described: 1,
  priced: 1,
  drinkAmongFood: -2,
  allergy: -4,
  kids: -5,
} as const;

/**
 * The feed's own "this is worth looking at" flag. Matched against the item type
 * only — a *group* called "Signature Non-Alcoholic Drinks" is a bar section
 * naming itself, not Disney flagging a dish.
 */
const FEATURED_RE = /featured|chef/;
/**
 * A row that states a price rather than naming a dish — Via Napoli's "Specialty
 * Toppings (5 | 7 | 8.5 each)", or Garden Grill's "$49 per adult, plus tax and
 * gratuity", which a prix-fixe venue files under its own "Pricing" group with
 * the `price` column left empty. Only unpriced rows are tested, so a real item
 * that happens to be parenthetical ("Rum Flight (3/4-oz pour of each)") is
 * safe: it carries a price of its own.
 */
const NOTE_RE = /\(\s*\$?\d|\||^\s*\$\s?\d/;
const PRICING_GROUP_RE = /\bpricing\b/;
const ENTREE_RE = /entree|main|sandwich|burger|plate|pizza|pasta|bowl/;
const DRINK_RE = /beverage|beer|wine|cocktail|drink|coffee|tea|soda|spirit|margarita|bar\b/;
const KIDS_RE = /\bkid|child/;
const ALLERGY_RE = /allergy|allergen/;
const SIGNATURE_RE = /signature|specialty|famous|award|house-made|world-famous/;

/** Words too generic to make a dish "named after the house". */
const VENUE_GENERIC = ["cafe", "restaurant", "grill", "kitchen", "bar", "lounge", "disney"];

/** Every word of the venue's name — what a caption may match for free. */
function venueWords(venueName: string | null): Set<string> {
  return new Set(venueName ? tokens(venueName) : []);
}

/** The distinctive part of it, which a dish can be named after. */
function houseWords(venueName: string | null): Set<string> {
  return new Set([...venueWords(venueName)].filter((w) => !VENUE_GENERIC.includes(w)));
}

function scoreCandidate(c: TeaserCandidate, house: Set<string>, menuHasFood: boolean): number {
  const type = normalize(c.itemType ?? "");
  const group = normalize(c.groupName ?? "");
  const both = `${type} ${group}`;
  const title = normalize(c.item.title);
  let score = 0;

  if (KIDS_RE.test(both)) score += SCORE.kids;
  if (ALLERGY_RE.test(both)) score += SCORE.allergy;
  if (FEATURED_RE.test(type)) score += SCORE.featured;
  if (ENTREE_RE.test(both)) score += SCORE.entree;
  if (SIGNATURE_RE.test(`${title} ${both}`)) score += SCORE.signature;
  if (menuHasFood && DRINK_RE.test(both)) score += SCORE.drinkAmongFood;
  // A dish carrying the venue's own name ("Grand Floridian Café Signature
  // Burger", "Toothsome Chocolate X5") is the house's own pick of itself.
  if (house.size > 0 && tokens(c.item.title).some((w) => house.has(w))) {
    score += SCORE.eponymous;
  }
  if (c.item.description) score += SCORE.described;
  if (c.item.price != null) score += SCORE.priced;
  return score;
}

/** True when the card is more than a drinks list. */
function hasFood(candidates: TeaserCandidate[]): boolean {
  return candidates.some(
    (c) => !DRINK_RE.test(normalize(`${c.itemType ?? ""} ${c.groupName ?? ""}`)),
  );
}

/**
 * The card's candidates, best first and de-duplicated by title (a venue often
 * lists one item under several groups). Ties break toward the pricier dish and
 * then toward menu order, so the ranking is stable for a given menu.
 */
export function rankTeaserDishes(
  candidates: TeaserCandidate[],
  venueName: string | null,
): TeaserCandidate[] {
  const house = houseWords(venueName);
  const menuHasFood = hasFood(candidates);
  const seen = new Set<string>();
  const unique: Array<{ c: TeaserCandidate; score: number }> = [];
  for (const c of candidates) {
    const key = normalize(c.item.title);
    if (!key || seen.has(key)) continue;
    if (
      c.item.price == null &&
      (NOTE_RE.test(c.item.title) || PRICING_GROUP_RE.test(normalize(c.groupName ?? "")))
    ) {
      continue;
    }
    seen.add(key);
    unique.push({ c, score: scoreCandidate(c, house, menuHasFood) });
  }
  return unique
    .sort(
      (a, b) =>
        b.score - a.score || (b.c.item.price ?? 0) - (a.c.item.price ?? 0) || a.c.index - b.c.index,
    )
    .map((entry) => entry.c);
}

// ── Photo matching ────────────────────────────────────────────────────────────

/** Significant words of a dish name that must be found in a caption. */
const MIN_TOKENS = 2;
/**
 * A description is prose, not a name, so it needs more of it to count: two
 * words of "served with french fries" are true of half the photos Disney owns.
 */
const MIN_DESCRIPTION_TOKENS = 3;
/**
 * Share of them that must land before we'll call it the same dish. Measured
 * against the live gallery: 0.6 lets a caption keep the noun and lose the
 * adjective, which is how "Chocolate Soft-serve Cup" ends up illustrated by a
 * photo of the orange one. Three quarters keeps the matches worth having.
 */
const MIN_RATIO = 0.75;
/**
 * How far into a caption the dish may be named. Disney's alt text leads with
 * its subject ("A spoon dipping into a bowl of French onion soup"), so a dish
 * mentioned late is a dish that happens to be *in* the frame — the mac and
 * cheese beside the fried chicken — not the dish the photo is of.
 */
const LEAD_WINDOW = 6;
/** A filename has no sentence to lead, so it has to match nearly whole. */
const FILENAME_RATIO = 0.75;

/** Basename of a CDN URL, minus the cache-busting query and extension. */
function filenameOf(url: string): string {
  const path = url.split("?")[0] ?? "";
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.[a-z0-9]+$/i, "");
}

/** Boilerplate every WDW DAM filename carries; matching on it means nothing. */
const FILENAME_NOISE = new Set([
  "wdw",
  "dlr",
  "gallery",
  "full",
  "hero",
  "crop",
  "stylized",
  "resize",
  "mwimage",
  "dam",
  "jpg",
  "jpeg",
  "png",
]);

/**
 * How well `needle` (a dish name) is named by `haystack` (a caption), as the
 * share of the dish's significant words that appear in it. `lead` additionally
 * requires every hit to fall inside the caption's opening words.
 */
function nameMatch(
  needle: string,
  haystack: string[],
  lead: boolean,
  house: Set<string>,
  minTokens: number,
): PhotoMatch | null {
  // The venue's own name is free to match — half of Disney's captions end in
  // "…from Maya Grill" — so it can't be evidence. Strip it from the dish name,
  // which also means a dish whose name is *only* the venue plus one word
  // ("Turf Club Burger") no longer clears the two-word floor on its own.
  const want = tokens(needle).filter((w) => !house.has(w));
  if (want.length < minTokens) return null;
  let hits = 0;
  let first = Infinity;
  for (const word of want) {
    const at = haystack.indexOf(word);
    if (at < 0) continue;
    if (lead && at >= LEAD_WINDOW) return null;
    hits += 1;
    first = Math.min(first, at);
  }
  if (hits < minTokens) return null;
  return { hits, score: hits / want.length, lead: first };
}

/**
 * The best photograph of `item` among `slides`, or null when none of them is
 * demonstrably of that dish. Both the caption and the DAM filename are tried —
 * they're independent, and a caption as vague as "A plated entrée" can still
 * sit on `…_FrenchOnionSoup2_FULL_DH-16x9.jpg`.
 *
 * Deliberately conservative: showing the wrong photo beside a dish name is
 * worse than showing none, and the panel reads perfectly well without one.
 */
/**
 * How strongly one slide claims one dish: the share of the dish's words the
 * caption carries, and how early it carries the first of them. Position is the
 * tie-breaker that lets a family-style platter belong to the dish it leads with
 * — "A skillet holding Mickey waffles, scrambled eggs and bacon" names the
 * waffles and the eggs equally well, and is a photograph of the waffles.
 */
interface PhotoMatch {
  /** How many of the dish's words the caption carries. */
  hits: number;
  /** What share of them that is. */
  score: number;
  /** Index of the first matched word in the caption; `Infinity` off a filename. */
  lead: number;
}

/**
 * Which of two claims on the same photo is the better one, in order: the dish
 * the caption says *more* about, then the dish it says it most completely of,
 * then the dish it names first. Count has to lead, because the share alone
 * rewards the shorter name — against "a waffle in the shape of Mickey's head
 * and 2 pieces of fried chicken breast", a plain "Mickey-shaped Waffle" scores
 * a perfect two-for-two while "Buttermilk-fried Chicken and Waffle", which is
 * what the photograph actually shows, scores three out of four.
 */
function better(a: PhotoMatch, b: PhotoMatch): boolean {
  if (a.hits !== b.hits) return a.hits > b.hits;
  if (a.score !== b.score) return a.score > b.score;
  return a.lead < b.lead;
}

function scoreSlide(
  item: MenuItemData,
  slide: DishPhotoSlide,
  house: Set<string>,
): PhotoMatch | null {
  const caption = slide.alt ? tokens(slide.alt) : [];
  const filename = tokens(filenameOf(slide.url)).filter((w) => !FILENAME_NOISE.has(w));
  // The description is tried too: Disney names half its soups one way on the
  // menu ("Caramelized Onion Soup Gratin") and the other in the copy beneath
  // it ("Traditional French Onion Soup"), and the photo follows the copy.
  const names: Array<[string, number]> = [[item.title, MIN_TOKENS]];
  if (item.description) names.push([item.description, MIN_DESCRIPTION_TOKENS]);
  let best: PhotoMatch | null = null;
  const keep = (m: PhotoMatch | null) => {
    if (!m || m.score < MIN_RATIO) return;
    if (!best || better(m, best)) best = m;
  };
  for (const [name, minTokens] of names) {
    keep(nameMatch(name, caption, true, house, minTokens));
    const byFile = nameMatch(name, filename, false, house, minTokens);
    if (byFile && byFile.score >= FILENAME_RATIO) keep({ ...byFile, lead: Infinity });
  }
  return best;
}

export function matchDishPhoto(
  item: MenuItemData,
  slides: DishPhotoSlide[],
  venueName: string | null,
): DishPhotoSlide | null {
  const house = venueWords(venueName);
  let best: DishPhotoSlide | null = null;
  let bestMatch: PhotoMatch | null = null;
  for (const slide of slides) {
    const match = scoreSlide(item, slide, house);
    if (!match) continue;
    if (!bestMatch || better(match, bestMatch)) {
      bestMatch = match;
      best = slide;
    }
  }
  return best;
}

/**
 * Words that mean a photograph is of the restaurant rather than of its food —
 * the room, the sign, the furniture, the people at the table. Tested first, so
 * "plate-glass … sign" is a sign and "a row of cocktail tables" is furniture,
 * whatever food words they happen to contain.
 */
const NOT_FOOD_RE =
  /\b(views?|exteriors?|interiors?|dining rooms?|rooms?|decor|signs?|entrances?|lobby|seating|guests?|famil(y|ies)|couples?|boys?|girls?|child(ren)?|m[ae]n|wom[ae]n|people|person|cast members?|standing|dressed|hugging|posing|laugh\w*|smil\w*|attire|doors?|tables?|chairs?|stools?|shel(f|ves)|counter|booths?|patio|umbrella\w*|row of)\b/;

/** Words that mean it is of the food. */
const FOOD_RE =
  /\b(platter|plate|bowl|buffet|spread|skillet|tray|basket|cup|waffles?|pancakes?|sandwich|burger|pizza|pasta|noodles?|salad|soup|stew|chicken|beef|steak|pork|ham|bacon|sausage|fish|salmon|shrimp|seafood|taco|burrito|arepa|curry|rice|vegetables?|potatoes|fries|fruit|berries|cheese|eggs?|bread|pastr(y|ies)|cake|cookies?|brownie|croissant|muffin|cupcake|tart|mousse|doughnut|donut|churro|pretzel|sundae|ice cream|dessert|cocktails?|margarita|martini|mojito|beer|wine|smoothie|shake|coffee|cappuccino|lemonade|dish(es)?|meal|entree|appetizer|gelato|sorbet)\b/;

/**
 * Whether a gallery slide is a photograph of food. Used for the fallback cover:
 * a buffet lists its menu as section headings ("Favorites", "Pastries"), so
 * there is no dish name for `matchDishPhoto` to prove anything against — but
 * Tusker House still has fifteen photographs of what is on the buffet, and a
 * panel called "What's cookin'" should be able to show one.
 *
 * The venue's own name comes out of the caption first, because half of them end
 * "…at Spice Road Table" and the restaurant is not furniture.
 */
export function isFoodPhoto(slide: DishPhotoSlide, venueName: string | null): boolean {
  if (!slide.alt) return false;
  const house = venueWords(venueName);
  const alt = normalize(slide.alt)
    .split(" ")
    .filter((w) => !house.has(stem(w)))
    .join(" ");
  if (NOT_FOOD_RE.test(alt)) return false;
  return FOOD_RE.test(alt);
}

/**
 * The best photograph of this venue's food that we cannot tie to one dish.
 * Gallery order is Disney's own ranking, so the first food slide is the one
 * they lead with. Runs without a dish name — we are showing the kitchen's
 * work, not captioning a plate we can't identify.
 */
export function findFoodPhoto(
  slides: DishPhotoSlide[],
  venueName: string | null,
): DishPhotoSlide | null {
  return slides.find((s) => isFoodPhoto(s, venueName)) ?? null;
}

/**
 * The panel's cover: the highest-ranked dish that has a photograph, searched
 * only over the dishes good enough to have been shown anyway. A venue whose
 * gallery is all dining rooms and signage — most of them — simply gets no
 * cover, and the panel falls back to its four typeset rows.
 */
export function findDishCover(
  ranked: TeaserCandidate[],
  slides: DishPhotoSlide[],
  venueName: string | null,
  limit: number,
): { candidate: TeaserCandidate; slide: DishPhotoSlide } | null {
  if (slides.length === 0) return null;
  const house = venueWords(venueName);
  for (const candidate of ranked.slice(0, limit)) {
    const slide = matchDishPhoto(candidate.item, slides, venueName);
    if (!slide) continue;
    const mine = scoreSlide(candidate.item, slide, house);
    if (!mine) continue;
    // The photo belongs to whichever dish on the card it names best, and — on a
    // tie — earliest. A stand of soft-serve cups answers to the chocolate one
    // and the citrus one equally well, so it runs for neither; a skillet of
    // "Mickey waffles, scrambled eggs and bacon" leads with the waffles, and
    // runs for them.
    const key = normalize(candidate.item.title);
    const beaten = ranked.some((other) => {
      if (normalize(other.item.title) === key) return false;
      const theirs = scoreSlide(other.item, slide, house);
      if (!theirs) return false;
      // Not strictly better than the rival — a rival that wins, or one this
      // caption fits exactly as well — means the photo isn't ours to run.
      return !better(mine, theirs);
    });
    if (!beaten) return { candidate, slide };
  }
  return null;
}
