/**
 * Curated headliner attractions — the per-attraction "Repeat Rider" badge
 * families ("Everest ×10") and the /activity lifetime chips.
 *
 * Client-safe, pure data: no server imports, and no import from
 * `./achievements.ts` (achievements.ts imports THIS module to derive stat keys
 * and generate the families).
 *
 * Identity is (park slug, attraction slug), the same convention as
 * `MOUNTAIN_SET` in `src/server/achievements/disney.ts`. Every pair below was
 * verified against the production catalog on 2026-07-19. Slugs come from
 * `slugify(name)` at ingest, so a marketing rename can drift one (see
 * `rock-n-roller-coaster-starring-the-muppets`) — the stat fold in
 * `computeStats` fails soft: an unmatched slug just counts 0 until the entry
 * here is re-verified.
 */

export interface Headliner {
  /** StatKey AND achievement-family key (tier ids are `${key}.${n}`). */
  key: string;
  /** Family title on the Badges page — the attraction's display name. */
  name: string;
  /** Compact label for the /activity lifetime chips ("Everest", "VelociCstr"). */
  shortName: string;
  emoji: string;
  parkSlug: string;
  attractionSlug: string;
  /** Bespoke first-ride (×1 tier) description; later tiers are templated. */
  firstRide: string;
}

export const HEADLINERS = [
  // --- Magic Kingdom ---------------------------------------------------------
  {
    key: "hl_space_mountain",
    name: "Space Mountain",
    shortName: "Space Mtn",
    emoji: "🚀",
    parkSlug: "magic-kingdom",
    attractionSlug: "space-mountain",
    firstRide: "Launched into the dark since 1975. Your eyes never adjusted.",
  },
  {
    key: "hl_big_thunder",
    name: "Big Thunder Mountain Railroad",
    shortName: "Big Thunder",
    emoji: "🚂",
    parkSlug: "magic-kingdom",
    attractionSlug: "big-thunder-mountain-railroad",
    firstRide: "The wildest ride in the wilderness, survived once.",
  },
  {
    key: "hl_seven_dwarfs",
    name: "Seven Dwarfs Mine Train",
    shortName: "Mine Train",
    emoji: "⛏️",
    parkSlug: "magic-kingdom",
    attractionSlug: "seven-dwarfs-mine-train",
    firstRide: "Heigh-ho. The standby line was the real mine shaft.",
  },
  {
    key: "hl_tron",
    name: "TRON Lightcycle / Run",
    shortName: "TRON",
    emoji: "🏍️",
    parkSlug: "magic-kingdom",
    attractionSlug: "tron-lightcycle-run",
    firstRide: "First launch on the Grid. Your glasses stayed on. Barely.",
  },
  // --- EPCOT -----------------------------------------------------------------
  {
    key: "hl_guardians",
    name: "Guardians of the Galaxy: Cosmic Rewind",
    shortName: "Cosmic Rwnd",
    emoji: "🌌",
    parkSlug: "epcot",
    attractionSlug: "guardians-of-the-galaxy-cosmic-rewind",
    firstRide: "One reverse launch and a personal soundtrack. Groot approves.",
  },
  {
    key: "hl_test_track",
    name: "Test Track",
    shortName: "Test Track",
    emoji: "🏎️",
    parkSlug: "epcot",
    attractionSlug: "test-track",
    firstRide: "0 to 65 on the outside loop. Your hair has opinions now.",
  },
  // --- Hollywood Studios -----------------------------------------------------
  {
    key: "hl_rise",
    name: "Star Wars: Rise of the Resistance",
    shortName: "Rise Resist.",
    emoji: "⚔️",
    parkSlug: "hollywood-studios",
    attractionSlug: "star-wars-rise-of-the-resistance",
    firstRide: "Captured by the First Order, escaped on the first try.",
  },
  {
    key: "hl_slinky",
    name: "Slinky Dog Dash",
    shortName: "Slinky Dash",
    emoji: "🐕",
    parkSlug: "hollywood-studios",
    attractionSlug: "slinky-dog-dash",
    firstRide: "One lap around Andy's backyard, tail wagging the whole way.",
  },
  {
    key: "hl_tower",
    name: "The Twilight Zone Tower of Terror",
    shortName: "Tower",
    emoji: "🛗",
    parkSlug: "hollywood-studios",
    attractionSlug: "the-twilight-zone-tower-of-terror",
    firstRide: "You checked into the Hollywood Tower Hotel. The elevator checked out.",
  },
  {
    key: "hl_rnrc",
    name: "Rock 'n' Roller Coaster",
    shortName: "Rock'n'RC",
    emoji: "🎸",
    parkSlug: "hollywood-studios",
    attractionSlug: "rock-n-roller-coaster-starring-the-muppets",
    firstRide: "0–57 in 2.8 seconds in a super-stretch limo. Encore pending.",
  },
  // --- Animal Kingdom --------------------------------------------------------
  {
    key: "hl_everest",
    name: "Expedition Everest",
    shortName: "Everest",
    emoji: "🏔️",
    parkSlug: "animal-kingdom",
    attractionSlug: "expedition-everest-legend-of-the-forbidden-mountain",
    firstRide: "Met the Yeti, rode backwards, lived to log it.",
  },
  {
    key: "hl_passage",
    name: "Avatar Flight of Passage",
    shortName: "Flt Passage",
    emoji: "🪂",
    parkSlug: "animal-kingdom",
    attractionSlug: "avatar-flight-of-passage",
    firstRide: "Linked with a banshee and flew over Pandora. The link persists.",
  },
  {
    key: "hl_kilimanjaro",
    name: "Kilimanjaro Safaris",
    shortName: "Safaris",
    emoji: "🦁",
    parkSlug: "animal-kingdom",
    attractionSlug: "kilimanjaro-safaris",
    firstRide: "Two weeks in the Harambe Wildlife Reserve, in about twenty minutes.",
  },
  // --- Universal: Islands of Adventure ---------------------------------------
  {
    key: "hl_veloci",
    name: "Jurassic World VelociCoaster",
    shortName: "VelociCstr",
    emoji: "🦖",
    parkSlug: "islands-of-adventure",
    attractionSlug: "jurassic-world-velocicoaster",
    firstRide: "You joined the raptor pack at 70 mph. The top hat noticed you.",
  },
  {
    key: "hl_hagrid",
    name: "Hagrid's Magical Creatures Motorbike Adventure",
    shortName: "Hagrid's",
    emoji: "🐉",
    parkSlug: "islands-of-adventure",
    attractionSlug: "hagrid-s-magical-creatures-motorbike-adventure",
    firstRide: "Seven launches, one Blast-Ended Skrewt, zero regrets.",
  },
  {
    key: "hl_forbidden",
    name: "Harry Potter and the Forbidden Journey",
    shortName: "Forbidden J.",
    emoji: "🧙",
    parkSlug: "islands-of-adventure",
    attractionSlug: "harry-potter-and-the-forbidden-journey",
    firstRide: "Flew over Hogwarts on an enchanted bench. The bench remembers.",
  },
] as const satisfies readonly Headliner[];

/** The headliner stat keys, for the StatKey union in achievements.ts. */
export type HeadlinerKey = (typeof HEADLINERS)[number]["key"];
