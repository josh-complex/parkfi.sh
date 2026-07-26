/**
 * Display vocabulary for `attraction_meta.tags`.
 *
 * Both operators publish their descriptors in typed groups — Disney's finder
 * splits them across `thrillFactor` / `interests` / `entertainmentType` / `age`
 * facets, Universal across ride types + tile interests — but ingest flattens
 * them into one untyped string array (`disneyFacetTags`, `universal-index`), so
 * the group is gone by the time the ride page reads them. That's why a ride
 * ends up wearing "Thrill Rides", "Disney Princesses", "Kids", "Adults",
 * "Teens" and "Tweens" as six equal-weight chips.
 *
 * This module reconstructs the grouping from the label vocabulary itself
 * (99 distinct tags live today) and does three things with it:
 *  - collapses the age tier labels into ONE age-range chip,
 *  - folds the cross-operator alias forms together ("Thrill" / "Thrill Rides" /
 *    "Universal Thrills"; "3-D" / "3D/4D" / "4-D Experience"),
 *  - splits the rest into perks (actionable: PhotoPass, single rider) vs
 *    descriptors (what the ride is like), which the page renders as two rows.
 *
 * Unknown labels are never dropped — they pass through as `other` descriptors,
 * so a new operator tag still shows up, just last.
 */

export type TagCategory = "perk" | "type" | "theme" | "other";

/**
 * Age tiers, mapped to the ages each operator scopes them to. Universal
 * publishes its bands in the label itself ("Tweens (7–12)"); Disney publishes
 * only the words, so its bounds are the conventional reading of its own age
 * filter (Preschoolers / Kids / Tweens / Teens / Adults) and are approximate.
 * They only ever feed a single summary chip, never a filter.
 */
const AGE_TIERS: Record<string, { min: number; max: number | null }> = {
  // Disney `age` facet.
  preschoolers: { min: 0, max: 4 },
  kids: { min: 5, max: 9 },
  tweens: { min: 10, max: 14 },
  teens: { min: 15, max: 17 },
  adults: { min: 18, max: null },
  "all ages": { min: 0, max: null },
  // Universal states its bands outright.
  "kids (under 7)": { min: 0, max: 6 },
  "tweens (7-12)": { min: 7, max: 12 },
  "teens (13-17)": { min: 13, max: 17 },
  "fun for little ones": { min: 0, max: 6 },
  "fun for grownups": { min: 18, max: null },
  // "Kid Friendly" says kids CAN enjoy it, not that grown-ups can't — no
  // upper bound, unlike "Fun For Little Ones".
  "kid friendly": { min: 0, max: null },
};

/** Alias table: normalized label -> the chip we actually render. */
const CANONICAL: Record<string, { label: string; category: TagCategory }> = {
  // --- perks (actionable — these change what a guest does) -----------------
  photopass: { label: "PhotoPass", category: "perk" },
  "single rider offered": { label: "Single rider", category: "perk" },
  "single rider line": { label: "Single rider", category: "perk" },
  "play disney parks": { label: "Play Disney Parks", category: "perk" },

  // --- ride / show format --------------------------------------------------
  thrill: { label: "Thrill Rides", category: "type" },
  "thrill rides": { label: "Thrill Rides", category: "type" },
  "universal thrills": { label: "Thrill Rides", category: "type" },
  "slow rides": { label: "Slow Rides", category: "type" },
  "small drops": { label: "Small Drops", category: "type" },
  "big drops": { label: "Big Drops", category: "type" },
  spinning: { label: "Spinning", category: "type" },
  dark: { label: "Dark", category: "type" },
  loud: { label: "Loud", category: "type" },
  scary: { label: "Scary", category: "type" },
  indoor: { label: "Indoor", category: "type" },
  interactive: { label: "Interactive", category: "type" },
  "motion simulation": { label: "Motion Simulation", category: "type" },
  rollercoaster: { label: "Roller Coaster", category: "type" },
  "roller coaster": { label: "Roller Coaster", category: "type" },
  water: { label: "Water Rides", category: "type" },
  "water ride": { label: "Water Rides", category: "type" },
  "water rides": { label: "Water Rides", category: "type" },
  // Volcano Bay grades its slides by intensity — that's real information, so
  // these stay distinct from the plain "Water Rides" bucket.
  "water thrill": { label: "Water Thrill", category: "type" },
  "water family": { label: "Water Family", category: "type" },
  "water kids": { label: "Water Kids", category: "type" },
  "water relax": { label: "Water Relax", category: "type" },
  "3-d": { label: "3D / 4D", category: "type" },
  "3d": { label: "3D / 4D", category: "type" },
  "3d/4d": { label: "3D / 4D", category: "type" },
  "3d 4d experience": { label: "3D / 4D", category: "type" },
  "4-d experience": { label: "3D / 4D", category: "type" },
  "play area": { label: "Play Area", category: "type" },
  "play areas": { label: "Play Area", category: "type" },
  relax: { label: "Relax", category: "type" },
  "live entertainment": { label: "Live Entertainment", category: "type" },
  "stage shows": { label: "Stage Shows", category: "type" },
  streetmosphere: { label: "Streetmosphere", category: "type" },
  "nighttime spectaculars": { label: "Nighttime Spectaculars", category: "type" },
  "nighttime entertainment": { label: "Nighttime Entertainment", category: "type" },
  "park atmosphere entertainment": { label: "Park Atmosphere", category: "type" },
  fireworks: { label: "Fireworks", category: "type" },
  parades: { label: "Parades", category: "type" },
  concerts: { label: "Concerts", category: "type" },
  comedy: { label: "Comedy", category: "type" },
  music: { label: "Music", category: "type" },

  // --- themes, characters, franchises --------------------------------------
  "disney princesses": { label: "Disney Princesses", category: "theme" },
  "pixar pals": { label: "Pixar Pals", category: "theme" },
  "mickey & friends": { label: "Mickey & Friends", category: "theme" },
  "classic characters": { label: "Classic Characters", category: "theme" },
  "character experiences": { label: "Character Experiences", category: "theme" },
  "character sightings": { label: "Character Sightings", category: "theme" },
  character: { label: "Character Sightings", category: "theme" },
  "star wars": { label: "Star Wars", category: "theme" },
  frozen: { label: "Frozen", category: "theme" },
  avatar: { label: "Avatar", category: "theme" },
  "animal encounters": { label: "Animal Encounters", category: "theme" },
  "action & adventure": { label: "Action & Adventure", category: "theme" },
  action: { label: "Action & Adventure", category: "theme" },
  classics: { label: "Classics", category: "theme" },
  "totally immersive experiences": { label: "Immersive", category: "theme" },
  "holiday entertainment": { label: "Holiday", category: "theme" },
};

/** Marketing filler that says nothing about the ride — never worth a chip. */
const DROPPED = new Set(["experience", "multi- person", "multi-person", "entertainment"]);

/**
 * Disney scopes the same interest to an entity type by suffixing the label
 * ("Frozen Entertainment", "Star Wars Entertainment"). Strip the qualifier when
 * the remainder is a theme we know, so the two forms share one chip.
 */
function canonicalize(normalized: string): { label: string; category: TagCategory } | null {
  const hit = CANONICAL[normalized];
  if (hit) return hit;
  const stripped = normalized.replace(/ (entertainment|attractions|events)$/, "");
  if (stripped !== normalized) {
    const alt = CANONICAL[stripped];
    if (alt?.category === "theme") return alt;
  }
  return null;
}

/** Lowercase, collapse whitespace, and flatten every dash variant to `-`. */
function normalize(label: string): string {
  // U+2010–U+2015: hyphen through horizontal bar. Universal writes its age
  // bands with an en dash ("Tweens (7–12)"), so the keys can't assume ASCII.
  return label
    .trim()
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ");
}

/** Render order for the descriptor row: what it is, then what it's about. */
const DESCRIPTOR_ORDER: Record<TagCategory, number> = { type: 0, theme: 1, other: 2, perk: 3 };

export interface RideTagGroups {
  /** Collapsed age-tier chip ("All ages", "Ages 5+", "Ages 6 & under"). */
  ageLabel: string | null;
  /** Actionable chips — these sit with the height requirement. */
  perks: Array<string>;
  /** Descriptive chips — ride format first, then themes, then unknowns. */
  descriptors: Array<string>;
}

/** Turn the operator's age-tier labels into one human range. */
function ageLabelFor(min: number | null, max: number | null): string | null {
  if (min == null) return null;
  if (min <= 0) return max == null ? "All ages" : `Ages ${max} & under`;
  if (max == null) return `Ages ${min}+`;
  return `Ages ${min}–${max}`;
}

/**
 * Bucket a ride's flat tag array into the chip rows the detail page renders.
 * Order within each row follows the source order, so an operator's own emphasis
 * survives.
 */
export function rideTagGroups(tags: ReadonlyArray<string>): RideTagGroups {
  let ageMin: number | null = null;
  let ageMax: number | null = null;
  let ageOpen = false;

  const perks: Array<string> = [];
  const descriptors: Array<{ label: string; rank: number }> = [];
  const seen = new Set<string>();

  for (const raw of tags) {
    const key = normalize(raw);
    if (!key || DROPPED.has(key)) continue;

    const tier = AGE_TIERS[key];
    if (tier) {
      ageMin = ageMin == null ? tier.min : Math.min(ageMin, tier.min);
      // A single open-ended tier ("Adults", "All Ages") lifts the ceiling for
      // the whole set — the ride tops out at nobody.
      if (tier.max == null) ageOpen = true;
      else ageMax = ageMax == null ? tier.max : Math.max(ageMax, tier.max);
      continue;
    }

    const canon = canonicalize(key);
    const label = canon?.label ?? raw.trim();
    if (seen.has(label)) continue;
    seen.add(label);

    if (canon?.category === "perk") perks.push(label);
    else descriptors.push({ label, rank: DESCRIPTOR_ORDER[canon?.category ?? "other"] });
  }

  return {
    ageLabel: ageLabelFor(ageMin, ageOpen ? null : ageMax),
    perks,
    descriptors: descriptors
      .map((d, i) => ({ ...d, i }))
      .sort((a, b) => a.rank - b.rank || a.i - b.i)
      .map((d) => d.label),
  };
}
