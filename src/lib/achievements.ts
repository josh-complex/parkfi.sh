/**
 * Levels & achievements — shared catalog.
 *
 * Pure data + math, no server/db imports. Client and server both import this
 * module so unlock names/descriptions/thresholds live in code, not the DB —
 * the DB only stores which tier ids a user has unlocked (see
 * `src/db/schema.ts` — `userAchievement`). Deliberately independent of the
 * Living Layer: nothing here imports from `src/server/living/**` or
 * `src/components/living/**`.
 */

/** Every trackable quantity. Geo-derived keys are aggregated from user_park_day;
 *  event keys are counters in user_stat. */
export type StatKey =
  // geo-derived
  | "park_days" // distinct (park, local-day) visits
  | "parks_unique" // distinct parks ever visited
  | "distance_m" // lifetime in-park meters walked
  | "queue_seconds" // lifetime seconds spent in detected queue dwells
  | "rides" // completed queue dwells (≈ attractions ridden)
  | "rope_drops" // days flagged: in park before 09:30 local
  | "night_owls" // days flagged: in park at/after 22:00 local
  | "rain_days" // days flagged: pinged while it was raining
  | "park_hop_days" // local days with ≥2 distinct parks
  | "streak_best" // longest consecutive-day visit streak
  | "best_day_distance_m" // most meters walked in one park-day
  | "best_day_queue_seconds" // most queue time in one park-day
  | "park_seconds" // lifetime seconds inside parks (Σ last_seen-first_seen)
  // event counters (client-reported via achievements.track)
  | "pin_scans"
  | "alerts_created"
  | "menus_viewed"
  | "forecast_views"
  | "searches";

/** Allowlisted client-reportable events → the stat they bump. */
export const TRACK_EVENTS = {
  pin_scan: "pin_scans",
  alert_created: "alerts_created",
  menu_view: "menus_viewed",
  forecast_view: "forecast_views",
  search: "searches",
} as const satisfies Record<string, StatKey>;
export type TrackEvent = keyof typeof TRACK_EVENTS;

export type StatUnit = "count" | "meters" | "seconds";

export interface AchievementTier {
  /** `${family.key}.${n}` where n is 1-based tier number — this is what's stored in DB. */
  id: string;
  name: string;
  description: string;
  threshold: number; // in the family's unit
  xp: number;
}

export interface AchievementFamily {
  key: string;
  /** Family display title, shown as the group header on the achievements page. */
  title: string;
  stat: StatKey;
  unit: StatUnit;
  /** Emoji — used in toasts and page headers; no icon-library coupling. */
  icon: string;
  tiers: AchievementTier[]; // ascending thresholds
}

function fam(
  key: string,
  title: string,
  stat: StatKey,
  unit: StatUnit,
  icon: string,
  tiers: Array<[threshold: number, xp: number, name: string, description: string]>,
): AchievementFamily {
  return {
    key,
    title,
    stat,
    unit,
    icon,
    tiers: tiers.map(([threshold, xp, name, description], i) => ({
      id: `${key}.${i + 1}`,
      threshold,
      xp,
      name,
      description,
    })),
  };
}

/** 18 families, 63 tiers. Order is the display order on the achievements page. */
export const ACHIEVEMENTS: AchievementFamily[] = [
  fam("gate", "Through the Turnstiles", "park_days", "count", "🎟️", [
    [
      1,
      50,
      "First Contact",
      "You walked into a park with ParkFi in your pocket. It only escalates from here.",
    ],
    [5, 100, "Weekend Warrior", "Five park days. The couch misses you."],
    [15, 200, "The Regular", "Fifteen visits. The turnstile recognizes your gait."],
    [40, 400, "Annual Pass Energy", "Forty park days. You radiate laminated confidence."],
    [100, 800, "Basically Furniture", "One hundred visits. Cast members dust around you."],
  ]),
  fam("passport", "Park Passport", "parks_unique", "count", "🛂", [
    [2, 75, "Two-Timer", "Seeing another park. It's not cheating, it's hopping."],
    [4, 150, "Kingdom Collector", "Four distinct parks stamped."],
    [6, 300, "Have Ears, Will Travel", "Six parks. Your suitcase is mostly ponchos now."],
    [10, 600, "World Tour", "Ten parks. Passport bureau is impressed and concerned."],
  ]),
  fam("walker", "Sole Survivor", "distance_m", "meters", "👟", [
    [5_000, 50, "Stroller Pace", "Your first 5 km of park pavement."],
    [25_000, 100, "Step Goal? Crushed", "25 km walked. Your watch thinks you're training."],
    [100_000, 200, "Blister Pack", "100 km. Moleskin is a food group now."],
    [250_000, 400, "Marathon, Eventually", "250 km, a few hundred meters at a time."],
    [1_000_000, 800, "Walk Around the World", "1,000 km on park pavement. Your shoes fear you."],
  ]),
  fam("queue", "The Waiting Game", "queue_seconds", "seconds", "⏳", [
    [3_600, 50, "Line Cook", "One hour in queues. Everyone starts somewhere."],
    [28_800, 100, "Queue-rious", "Eight hours waiting. A full workday of standing."],
    [86_400, 200, "Standby Citizen", "24 lifetime hours in line. You've seen things."],
    [259_200, 400, "Waiting Room VIP", "72 hours queued. The switchbacks feel like home."],
    [604_800, 800, "A Week, Gone", "168 hours in line. That's between you and the churro cart."],
  ]),
  fam("rider", "Certified Ride Enjoyer", "rides", "count", "🎢", [
    [1, 50, "First Drop", "One queue conquered, one ride ridden."],
    [10, 100, "Frequent Flyer", "Ten rides logged."],
    [50, 200, "Adrenaline Adjacent", "Fifty rides. Your lanyard jingles when you walk."],
    [200, 400, "Lap Bar Legend", "Two hundred rides. You brace before the photo automatically."],
    [500, 800, "Human Rollercoaster", "Five hundred rides. You ARE the attraction."],
  ]),
  fam("ropedrop", "Dawn Patrol", "rope_drops", "count", "🌅", [
    [1, 75, "Rope Dropper", "In the park before 9:30 AM. The headliners never saw you coming."],
    [5, 150, "Dawn Patrol", "Five early mornings. Coffee is a personality now."],
    [20, 300, "The Early Bird Gets the Headliner", "Twenty rope drops. Sunrise is your FastPass."],
  ]),
  fam("nightowl", "Closing Time", "night_owls", "count", "🦉", [
    [1, 75, "Closing Credits", "Still in the park after 10 PM."],
    [5, 150, "Kiss Goodnight", "Five late nights. You stay for the goodnight, every time."],
    [20, 300, "Security Knows You by Name", "Twenty closes. They wave now."],
  ]),
  fam("rain", "Weatherproof", "rain_days", "count", "🌧️", [
    [1, 75, "Singin' in the Rain", "Park day in the rain. Shortest lines of your life."],
    [3, 150, "Poncho Season", "Three rainy visits. You own it in three colors."],
    [10, 300, "Florida Weather Veteran", "Ten rain days. You can smell the 2 PM storm coming."],
  ]),
  fam("hopper", "Hop to It", "park_hop_days", "count", "🐇", [
    [1, 75, "Hop, Skip", "Two parks, one day."],
    [5, 150, "Multi-Park Menace", "Five hop days. The monorail is basically your commute."],
    [15, 300, "Teleportation Suspect", "Fifteen hop days. Physics has questions."],
  ]),
  fam("streak", "Can't Stay Away", "streak_best", "count", "🔥", [
    [2, 75, "Back for More", "Two days in a row."],
    [4, 150, "The Long Weekend", "Four consecutive park days."],
    [7, 300, "The Full Week", "Seven straight days. A truly deranged itinerary. Respect."],
    [
      14,
      600,
      "Do You Even Go Home?",
      "Fourteen consecutive days. Asking for your mail to be forwarded.",
    ],
  ]),
  fam("bigday", "Leg Day", "best_day_distance_m", "meters", "🦵", [
    [10_000, 100, "Step Goal: Obliterated", "10 km in a single park day."],
    [
      21_097,
      200,
      "Accidental Half-Marathon",
      "21.1 km in one day. You didn't even get a medal. Here's this instead.",
    ],
    [30_000, 400, "Cast Members Are Getting Worried", "30 km in one day. Please hydrate."],
  ]),
  fam("queueday", "Committed to the Line", "best_day_queue_seconds", "seconds", "🧍", [
    [7_200, 100, "Time Well Spent?", "Two hours queued in one day."],
    [
      14_400,
      200,
      "Queue Sweet Queue",
      "Four hours in line in one day. You've adopted a switchback.",
    ],
    [
      28_800,
      400,
      "I Live Here Now",
      "Eight hours queued in a single day. The line is your home; the ride, a vacation.",
    ],
  ]),
  fam("hours", "Clocked In", "park_seconds", "seconds", "🕰️", [
    [43_200, 50, "Guest Appearance", "12 lifetime hours inside parks."],
    [180_000, 100, "Part-Timer", "50 hours in the parks."],
    [720_000, 200, "Full-Timer", "200 hours. That's a job. This is better."],
    [1_800_000, 400, "Just Get a Nametag", "500 hours inside the berm. HR would like a word."],
  ]),
  fam("pins", "Pin Pals", "pin_scans", "count", "📌", [
    [1, 50, "Pin Curious", "First pin scanned."],
    [10, 100, "Lanyard Loaded", "Ten pins scanned."],
    [50, 200, "Sharp Collector", "Fifty pins scanned. Airport security hates your lanyard."],
  ]),
  fam("alerts", "On High Alert", "alerts_created", "count", "🚨", [
    [1, 50, "First Watch", "First wait-time alert armed."],
    [5, 100, "Notification Nation", "Five alerts. Your phone buzzes with purpose."],
    [25, 200, "Mission Control", "Twenty-five alerts. You run this park from your pocket."],
  ]),
  fam("menus", "Menu Scholar", "menus_viewed", "count", "🍽️", [
    [5, 50, "Window Shopper", "Five menus browsed."],
    [25, 100, "Menu Connoisseur", "Twenty-five menus studied."],
    [100, 200, "Snackademic", "One hundred menus. Cite your sauces."],
  ]),
  fam("forecast", "Crystal Ball", "forecast_views", "count", "🔮", [
    [5, 50, "Crystal Ball Curious", "Checked the wait forecast five times."],
    [
      25,
      100,
      "Wait-Time Weather Person",
      "Twenty-five forecasts. You predict the crowds before the crowds exist.",
    ],
  ]),
  fam("search", "Ask Around", "searches", "count", "🔎", [
    [10, 50, "Just Asking Questions", "Ten omnisearches."],
    [50, 100, "Omnisearch, Omniscient", "Fifty searches. You find things before they're lost."],
  ]),
];

export interface TierRef {
  family: AchievementFamily;
  tier: AchievementTier;
  tierIndex: number;
}

/** id → ref, built once at module load. */
export const TIER_BY_ID: ReadonlyMap<string, TierRef> = (() => {
  const map = new Map<string, TierRef>();
  for (const family of ACHIEVEMENTS) {
    family.tiers.forEach((tier, tierIndex) => {
      map.set(tier.id, { family, tier, tierIndex });
    });
  }
  return map;
})();

export type Stats = Partial<Record<StatKey, number>>;

/** Every tier id whose threshold the stats satisfy (the full closed set, not a delta). */
export function satisfiedTierIds(stats: Stats): string[] {
  const ids: string[] = [];
  for (const family of ACHIEVEMENTS) {
    const value = stats[family.stat] ?? 0;
    for (const tier of family.tiers) {
      if (value >= tier.threshold) ids.push(tier.id);
    }
  }
  return ids;
}

/** Sum XP for a set of unlocked tier ids (unknown ids — deleted from catalog — count 0). */
export function xpForTierIds(ids: Iterable<string>): number {
  let xp = 0;
  for (const id of ids) {
    const ref = TIER_BY_ID.get(id);
    if (ref) xp += ref.tier.xp;
  }
  return xp;
}

/** Highest level the catalog awards titles for. */
export const MAX_LEVEL = 20;

const LEVEL_TITLES: readonly string[] = [
  "Turnstile Tourist",
  "Map Unfolder",
  "Churro Apprentice",
  "Queue Cadet",
  "Snack Strategist",
  "Rope Drop Recruit",
  "Standby Scholar",
  "Lightning Lane Lieutenant",
  "Poncho Professional",
  "Park Commando",
  "Wait-Time Whisperer",
  "Itinerary Architect",
  "Turnstile Royalty",
  "Kiss-Goodnight Keeper",
  "Monorail Monarch",
  "Berm Legend",
  "E-Ticket Emeritus",
  "Imagineer-in-Spirit",
  "Park Deity (Regional)",
  "The Mouse Knows Your Name",
];

/** Total XP needed to *reach* level n (level 1 = 0). Curve: 100·(n−1)^1.7, capped at MAX_LEVEL 20. */
export function xpForLevel(n: number): number {
  const level = Math.min(n, MAX_LEVEL);
  if (level <= 1) return 0;
  return Math.round(100 * Math.pow(level - 1, 1.7));
}

export interface LevelInfo {
  level: number;
  title: string;
  xp: number; // total
  intoLevel: number; // xp - xpForLevel(level)
  forNext: number | null; // xpForLevel(level+1) - xpForLevel(level), null at cap
}

export function levelForXp(xp: number): LevelInfo {
  let level = 1;
  for (let n = 2; n <= MAX_LEVEL; n++) {
    if (xp >= xpForLevel(n)) level = n;
    else break;
  }
  return {
    level,
    title: LEVEL_TITLES[level - 1],
    xp,
    intoLevel: xp - xpForLevel(level),
    forNext: level < MAX_LEVEL ? xpForLevel(level + 1) - xpForLevel(level) : null,
  };
}

/** "12.4 km", "4h 20m", "17" — for progress bars & admin table. */
export function formatStatValue(unit: StatUnit, value: number): string {
  switch (unit) {
    case "count":
      return Math.round(value).toLocaleString("en-US");
    case "meters":
      if (value < 1_000) return `${Math.round(value)} m`;
      return `${(value / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 })} km`;
    case "seconds": {
      const totalMinutes = Math.round(value / 60);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    }
  }
}
