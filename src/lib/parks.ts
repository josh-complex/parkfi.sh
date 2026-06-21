export const WDW_PARKS: Array<{ code: string; label: string; slug: string | null }> = [
  { code: "MK", label: "Magic Kingdom", slug: "magic-kingdom" },
  { code: "EP", label: "EPCOT", slug: "epcot" },
  { code: "HS", label: "Hollywood Studios", slug: "hollywood-studios" },
  { code: "AK", label: "Animal Kingdom", slug: "animal-kingdom" },
];

export const UOR_PARKS: Array<{ code: string; label: string; slug: string | null }> = [
  { code: "USF", label: "Studios", slug: "universal-studios-florida" },
  { code: "UIOA", label: "Islands of Adventure", slug: "islands-of-adventure" },
  { code: "EPIC", label: "Epic Universe", slug: "epic-universe" },
  { code: "UVB", label: "Volcano Bay", slug: null },
];

export type Resort = "WDW" | "UOR";

export interface ParkEntry {
  code: string;
  label: string;
  slug: string | null;
  resort: Resort;
}

/** Every park across both resorts, resort-tagged — for the combined park picker. */
export const ALL_PARKS: Array<ParkEntry> = [
  ...WDW_PARKS.map((p) => ({ ...p, resort: "WDW" as const })),
  ...UOR_PARKS.map((p) => ({ ...p, resort: "UOR" as const })),
];

/** Default park slug to use for resort-level crowd/weather when no park is selected. */
export const RESORT_DEFAULT_SLUG: Record<string, string> = {
  WDW: "magic-kingdom",
  UOR: "universal-studios-florida",
};
