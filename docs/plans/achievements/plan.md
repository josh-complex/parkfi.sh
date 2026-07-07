# ParkFi Levels & Achievements — Implementation Plan

> Handoff plan. All research is done; every file path, convention, and pattern below was
> verified against the repo on 2026-07-06 (HEAD = `b3d1f1b`). Follow it top-to-bottom;
> each section is ordered so the code compiles at every step.

## 0. Non-negotiable repo conventions (read first)

- **`node` is NOT on PATH.** Run every bin through bun: `bun vp check`, `bun vp test run`,
  `bun tsc` etc. Never `npx`/`node`.
- **Never commit or stage anything.** The user handles all git operations.
- **Never start dev servers or preview tools.** Validate with `bun vp check` + `bun vp test` only.
- **Migrations are hand-written.** Create `drizzle/<YYYYMMDDHHMMSS-ish>_<slug>/migration.sql`
  (folder + single `migration.sql`). Do NOT run `drizzle-kit generate`, do NOT touch any
  `_journal.json` (there isn't one). Latest existing folder is
  `drizzle/20260706140000_removal_requests`; use `20260706150000_achievements`.
  Every migration in this repo starts with a boxed comment explaining what it does and a
  SAFETY note, and uses `IF NOT EXISTS` everywhere. Match that.
- **Coordinates are `[lng, lat]`** everywhere (GeoJSON/MapLibre order). Do not flip.
- **Imports use the `#/*` alias** (`./src/*`) and include the `.ts`/`.tsx` extension,
  e.g. `import { db } from "#/db/index.ts"`.
- **This feature must be 100% agnostic of the Living Layer.** Do not import anything from
  `src/server/living/**`, `src/components/living/**`, or touch `world`/`mark`/`encounter_log`
  tables — even the pure geofence helpers in `src/server/living/geofence.ts`. Write our own
  tiny copies (see §4.1). If living layer is ever deleted, achievements must not notice.

## 1. Architecture at a glance

```
┌─ client ────────────────────────────────────────────────────────────┐
│ AchievementTracker (mounted in _dash.tsx, logged-in users only)     │
│  ├─ useGeolocation({watch:true, rememberActive:true})               │
│  ├─ every ~30s while granted → trpc.achievements.ping               │
│  ├─ on mount → trpc.achievements.pendingUnlocks → replay toasts     │
│  └─ location-nudge: must-dismiss stacked toasts when not granted    │
│ useAchievementTrack() → trpc.achievements.track (app events)        │
│ showUnlockToasts() → sonner toast.success + navigator.vibrate       │
└──────────────────────────────────────────────────────────────────────┘
┌─ server ────────────────────────────────────────────────────────────┐
│ engine.ts: park geofence → user_park_day upsert → stats aggregate   │
│            → evaluateUnlocks(catalog) → insert user_achievement     │
│ routers/achievements.ts: ping / track / progress / ackUnlocks       │
│                          + admin: searchUsers / userDetail /        │
│                            revoke / resetStats                      │
└──────────────────────────────────────────────────────────────────────┘
┌─ shared ────────────────────────────────────────────────────────────┐
│ src/lib/achievements.ts — catalog (18 families / 63 tiers), stat    │
│ keys, XP math, level curve + titles. No server imports. Client and  │
│ server both import it, so unlock names/descriptions live in code,   │
│ not the DB. DB stores only (user, tier-id, timestamps).             │
└──────────────────────────────────────────────────────────────────────┘
```

Key design decisions (already made, don't relitigate):

- **Catalog in code, unlocks in DB.** `user_achievement` stores tier ids like `"walker.3"`.
  Renaming an achievement is a code change; revoking is a row delete. Admin revoke + next
  ping re-unlocking it is _desired_ (that's the testing loop the user asked for).
- **Stats are derived, not stored** (except event counters). Geo activity lands in
  `user_park_day` (one row per user × park × local day, with accumulators + flags); totals,
  bests, streaks, distinct counts are aggregated at evaluation time by pulling the user's
  day rows (a superfan has a few hundred — trivial). Event counters (pin scans, alert
  creations, …) live in `user_stat` because they have no day/park dimension.
- **XP = sum of unlocked tier XP; level = pure function of XP.** No level table.
- **Unlock delivery is at-least-once.** Engine inserts unlock rows with `notified_at NULL`;
  ping/track responses carry newly-inserted unlocks; the client toasts then calls
  `ackUnlocks`. A `pendingUnlocks` query on mount replays anything un-acked (app closed
  mid-toast, etc.).

---

## 2. Shared catalog — `src/lib/achievements.ts` (new file)

Pure TypeScript module, no imports from server/db. This is both the data and the naming —
write it exactly as specced here.

### 2.1 Types

```ts
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
```

### 2.2 The catalog (18 families, 63 tiers — write ALL of these verbatim)

Build with a small helper so tier ids are consistent:

```ts
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
```

| family key | title                  | stat                     | unit    | icon | tiers (threshold → name — description)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ---------------------- | ------------------------ | ------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gate`     | Through the Turnstiles | `park_days`              | count   | 🎟️   | 1 → **First Contact** — "You walked into a park with ParkFi in your pocket. It only escalates from here." (50xp) · 5 → **Weekend Warrior** — "Five park days. The couch misses you." (100) · 15 → **The Regular** — "Fifteen visits. The turnstile recognizes your gait." (200) · 40 → **Annual Pass Energy** — "Forty park days. You radiate laminated confidence." (400) · 100 → **Basically Furniture** — "One hundred visits. Cast members dust around you." (800) |
| `passport` | Park Passport          | `parks_unique`           | count   | 🛂   | 2 → **Two-Timer** — "Seeing another park. It's not cheating, it's hopping." (75) · 4 → **Kingdom Collector** — "Four distinct parks stamped." (150) · 6 → **Have Ears, Will Travel** — "Six parks. Your suitcase is mostly ponchos now." (300) · 10 → **World Tour** — "Ten parks. Passport bureau is impressed and concerned." (600)                                                                                                                                  |
| `walker`   | Sole Survivor          | `distance_m`             | meters  | 👟   | 5,000 → **Stroller Pace** — "Your first 5 km of park pavement." (50) · 25,000 → **Step Goal? Crushed** — "25 km walked. Your watch thinks you're training." (100) · 100,000 → **Blister Pack** — "100 km. Moleskin is a food group now." (200) · 250,000 → **Marathon, Eventually** — "250 km, a few hundred meters at a time." (400) · 1,000,000 → **Walk Around the World** — "1,000 km on park pavement. Your shoes fear you." (800)                                |
| `queue`    | The Waiting Game       | `queue_seconds`          | seconds | ⏳   | 3,600 → **Line Cook** — "One hour in queues. Everyone starts somewhere." (50) · 28,800 → **Queue-rious** — "Eight hours waiting. A full workday of standing." (100) · 86,400 → **Standby Citizen** — "24 lifetime hours in line. You've seen things." (200) · 259,200 → **Waiting Room VIP** — "72 hours queued. The switchbacks feel like home." (400) · 604,800 → **A Week, Gone** — "168 hours in line. That's between you and the churro cart." (800)              |
| `rider`    | Certified Ride Enjoyer | `rides`                  | count   | 🎢   | 1 → **First Drop** — "One queue conquered, one ride ridden." (50) · 10 → **Frequent Flyer** — "Ten rides logged." (100) · 50 → **Adrenaline Adjacent** — "Fifty rides. Your lanyard jingles when you walk." (200) · 200 → **Lap Bar Legend** — "Two hundred rides. You brace before the photo automatically." (400) · 500 → **Human Rollercoaster** — "Five hundred rides. You ARE the attraction." (800)                                                              |
| `ropedrop` | Dawn Patrol            | `rope_drops`             | count   | 🌅   | 1 → **Rope Dropper** — "In the park before 9:30 AM. The headliners never saw you coming." (75) · 5 → **Dawn Patrol** — "Five early mornings. Coffee is a personality now." (150) · 20 → **The Early Bird Gets the Headliner** — "Twenty rope drops. Sunrise is your FastPass." (300)                                                                                                                                                                                   |
| `nightowl` | Closing Time           | `night_owls`             | count   | 🦉   | 1 → **Closing Credits** — "Still in the park after 10 PM." (75) · 5 → **Kiss Goodnight** — "Five late nights. You stay for the goodnight, every time." (150) · 20 → **Security Knows You by Name** — "Twenty closes. They wave now." (300)                                                                                                                                                                                                                             |
| `rain`     | Weatherproof           | `rain_days`              | count   | 🌧️   | 1 → **Singin' in the Rain** — "Park day in the rain. Shortest lines of your life." (75) · 3 → **Poncho Season** — "Three rainy visits. You own it in three colors." (150) · 10 → **Florida Weather Veteran** — "Ten rain days. You can smell the 2 PM storm coming." (300)                                                                                                                                                                                             |
| `hopper`   | Hop to It              | `park_hop_days`          | count   | 🐇   | 1 → **Hop, Skip** — "Two parks, one day." (75) · 5 → **Multi-Park Menace** — "Five hop days. The monorail is basically your commute." (150) · 15 → **Teleportation Suspect** — "Fifteen hop days. Physics has questions." (300)                                                                                                                                                                                                                                        |
| `streak`   | Can't Stay Away        | `streak_best`            | count   | 🔥   | 2 → **Back for More** — "Two days in a row." (75) · 4 → **The Long Weekend** — "Four consecutive park days." (150) · 7 → **The Full Week** — "Seven straight days. A truly deranged itinerary. Respect." (300) · 14 → **Do You Even Go Home?** — "Fourteen consecutive days. Asking for your mail to be forwarded." (600)                                                                                                                                              |
| `bigday`   | Leg Day                | `best_day_distance_m`    | meters  | 🦵   | 10,000 → **Step Goal: Obliterated** — "10 km in a single park day." (100) · 21,097 → **Accidental Half-Marathon** — "21.1 km in one day. You didn't even get a medal. Here's this instead." (200) · 30,000 → **Cast Members Are Getting Worried** — "30 km in one day. Please hydrate." (400)                                                                                                                                                                          |
| `queueday` | Committed to the Line  | `best_day_queue_seconds` | seconds | 🧍   | 7,200 → **Time Well Spent?** — "Two hours queued in one day." (100) · 14,400 → **Queue Sweet Queue** — "Four hours in line in one day. You've adopted a switchback." (200) · 28,800 → **I Live Here Now** — "Eight hours queued in a single day. The line is your home; the ride, a vacation." (400)                                                                                                                                                                   |
| `hours`    | Clocked In             | `park_seconds`           | seconds | 🕰️   | 43,200 → **Guest Appearance** — "12 lifetime hours inside parks." (50) · 180,000 → **Part-Timer** — "50 hours in the parks." (100) · 720,000 → **Full-Timer** — "200 hours. That's a job. This is better." (200) · 1,800,000 → **Just Get a Nametag** — "500 hours inside the berm. HR would like a word." (400)                                                                                                                                                       |
| `pins`     | Pin Pals               | `pin_scans`              | count   | 📌   | 1 → **Pin Curious** — "First pin scanned." (50) · 10 → **Lanyard Loaded** — "Ten pins scanned." (100) · 50 → **Sharp Collector** — "Fifty pins scanned. Airport security hates your lanyard." (200)                                                                                                                                                                                                                                                                    |
| `alerts`   | On High Alert          | `alerts_created`         | count   | 🚨   | 1 → **First Watch** — "First wait-time alert armed." (50) · 5 → **Notification Nation** — "Five alerts. Your phone buzzes with purpose." (100) · 25 → **Mission Control** — "Twenty-five alerts. You run this park from your pocket." (200)                                                                                                                                                                                                                            |
| `menus`    | Menu Scholar           | `menus_viewed`           | count   | 🍽️   | 5 → **Window Shopper** — "Five menus browsed." (50) · 25 → **Menu Connoisseur** — "Twenty-five menus studied." (100) · 100 → **Snackademic** — "One hundred menus. Cite your sauces." (200)                                                                                                                                                                                                                                                                            |
| `forecast` | Crystal Ball           | `forecast_views`         | count   | 🔮   | 5 → **Crystal Ball Curious** — "Checked the wait forecast five times." (50) · 25 → **Wait-Time Weather Person** — "Twenty-five forecasts. You predict the crowds before the crowds exist." (100)                                                                                                                                                                                                                                                                       |
| `search`   | Ask Around             | `searches`               | count   | 🔎   | 10 → **Just Asking Questions** — "Ten omnisearches." (50) · 50 → **Omnisearch, Omniscient** — "Fifty searches. You find things before they're lost." (100)                                                                                                                                                                                                                                                                                                             |

Export `ACHIEVEMENTS: AchievementFamily[]` in the table order above.

### 2.3 Derived structures & helpers (same file)

```ts
export interface TierRef { family: AchievementFamily; tier: AchievementTier; tierIndex: number; }

/** id → ref, built once at module load. */
export const TIER_BY_ID: ReadonlyMap<string, TierRef> = ...;

export type Stats = Partial<Record<StatKey, number>>;

/** Every tier id whose threshold the stats satisfy (the full closed set, not a delta). */
export function satisfiedTierIds(stats: Stats): string[];

/** Sum XP for a set of unlocked tier ids (unknown ids — deleted from catalog — count 0). */
export function xpForTierIds(ids: Iterable<string>): number;

/** Total XP needed to *reach* level n (level 1 = 0). Curve: 100·(n−1)^1.7, capped at MAX_LEVEL 20. */
export function xpForLevel(n: number): number; // Math.round(100 * Math.pow(n - 1, 1.7))

export interface LevelInfo {
  level: number; title: string;
  xp: number;              // total
  intoLevel: number;       // xp - xpForLevel(level)
  forNext: number | null;  // xpForLevel(level+1) - xpForLevel(level), null at cap
}
export function levelForXp(xp: number): LevelInfo;

/** "12.4 km", "4h 20m", "17" — for progress bars & admin table. */
export function formatStatValue(unit: StatUnit, value: number): string;
```

**Level titles** (index = level, cap 20):

1 Turnstile Tourist · 2 Map Unfolder · 3 Churro Apprentice · 4 Queue Cadet ·
5 Snack Strategist · 6 Rope Drop Recruit · 7 Standby Scholar · 8 Lightning Lane Lieutenant ·
9 Poncho Professional · 10 Park Commando · 11 Wait-Time Whisperer · 12 Itinerary Architect ·
13 Turnstile Royalty · 14 Kiss-Goodnight Keeper · 15 Monorail Monarch · 16 Berm Legend ·
17 E-Ticket Emeritus · 18 Imagineer-in-Spirit · 19 Park Deity (Regional) ·
20 The Mouse Knows Your Name

**Unit test** (see §9): catalog invariants — unique ids, ascending thresholds per family,
`satisfiedTierIds` / `levelForXp` correctness. Total tier count must be ≥ 36 (it's 63).

---

## 3. Database — schema + migration

### 3.1 Drizzle additions — append a new section at the bottom of `src/db/schema.ts`

`user` is already imported at the top (`import { user } from "./auth-schema.ts"` — schema.ts:53).
Follow the FK style of `rideAlert` (schema.ts:929): `text("user_id").notNull().references(() => user.id, { onDelete: "cascade" })`.

```ts
// ============================================================================
// Levels & achievements — engagement telemetry and unlocks.
// Catalog (names, thresholds, XP) lives in code: src/lib/achievements.ts.
// The DB stores only per-user activity rollups and unlocked tier ids.
// Deliberately independent of the Living Layer tables/modules.
// ============================================================================

/** One row per user × park × park-local day; all geo achievement stats derive from these. */
export const userParkDay = pgTable(
  "user_park_day",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parkId: bigint("park_id", { mode: "number" })
      .notNull()
      .references(() => parks.id),
    day: date("day").notNull(), // park-local calendar day (per parks.timezone)
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    pings: integer("pings").notNull().default(0),
    distanceM: doublePrecision("distance_m").notNull().default(0),
    queueSeconds: integer("queue_seconds").notNull().default(0),
    rides: integer("rides").notNull().default(0),
    ropeDrop: boolean("rope_drop").notNull().default(false),
    nightOwl: boolean("night_owl").notNull().default(false),
    rainy: boolean("rainy").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.parkId, t.day] }),
    index("user_park_day_user_idx").on(t.userId),
  ],
);

/** Last-ping cursor per user: powers distance deltas and queue-dwell detection. */
export const userGeoState = pgTable("user_geo_state", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  parkId: bigint("park_id", { mode: "number" }),
  lng: doublePrecision("lng"),
  lat: doublePrecision("lat"),
  at: timestamp("at", { withTimezone: true }),
  anchorAttractionId: bigint("anchor_attraction_id", { mode: "number" }),
  anchorSince: timestamp("anchor_since", { withTimezone: true }),
  anchorSeconds: integer("anchor_seconds").notNull().default(0),
});

/** Event counters with no day/park dimension (pin scans, alert creations, …). */
export const userStat = pgTable(
  "user_stat",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    stat: text("stat").notNull(), // StatKey (event keys only)
    value: doublePrecision("value").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.stat] })],
);

/** Unlocked achievement tiers. achievement_id = catalog tier id, e.g. "walker.3". */
export const userAchievement = pgTable(
  "user_achievement",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    achievementId: text("achievement_id").notNull(),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }).notNull().defaultNow(),
    /** Null until the client has shown the unlock toast (at-least-once delivery). */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.achievementId] }),
    index("user_achievement_user_idx").on(t.userId),
  ],
);
```

(Everything used — `date`, `doublePrecision`, etc. — is already imported at the top of schema.ts.
Verify; add to the import list if one is missing.)

### 3.2 Migration — `drizzle/20260706150000_achievements/migration.sql` (new)

Boxed header comment + SAFETY note ("purely additive: four new tables, no existing object
touched"), then `CREATE TABLE IF NOT EXISTS` for the four tables exactly matching §3.1
(snake_case, FKs with `ON DELETE CASCADE` on user, PKs as above), plus the two indexes with
`CREATE INDEX IF NOT EXISTS`. Reference an existing folder (e.g.
`drizzle/20260706120000_park_poi/migration.sql`) for tone/format.

---

## 4. Server engine

### 4.1 `src/server/achievements/geo.ts` (new) — pure geometry, no I/O

Deliberately small local copies so we don't depend on Living Layer helpers:

```ts
import type { GeoPolygon } from "#/db/schema.ts";
export type LngLat = [number, number];
export function pointInRing(p: LngLat, ring: ReadonlyArray<LngLat>): boolean; // ray-cast
export function pointInPolygon(p: LngLat, geo: GeoPolygon | null | undefined): boolean; // outer rings only
export function distanceMeters(a: LngLat, b: LngLat): number; // equirectangular approx
```

(Same math as `src/server/living/geofence.ts:19-54` — reimplement, don't import.)

### 4.2 `src/server/achievements/engine.ts` (new) — the whole brain

Constants:

```ts
const PING_MAX_ACCURACY_M = 150; // drop noisy fixes
const PING_MAX_GAP_S = 300; // deltas older than this don't accrue distance/queue
const WALK_SPEED_CAP_MS = 2.5; // m/s — clamps GPS jumps & vehicle travel
const QUEUE_ENTER_RADIUS_M = 40; // anchor to an attraction within this
const QUEUE_EXIT_RADIUS_M = 60; // hysteresis: keep anchor until beyond this
const QUEUE_MIN_DWELL_S = 480; // ≥8 min anchored ⇒ it was a queue ⇒ +1 ride
const ROPE_DROP_BEFORE = { h: 9, m: 30 }; // local
const NIGHT_OWL_AFTER_H = 22; // local
const CACHE_TTL_MS = 10 * 60 * 1000;
```

**In-module caches** (plain `Map` + timestamp, TTL above):

- `parksCache`: all active parks with any geo (`id, timezone, latMin/Max, lngMin/Max, boundary`).
- `attractionsCache` per parkId: `id, latitude, longitude` for `entityType = 'ATTRACTION'`,
  `active = true`, coords not null.

**`function parkForPoint(p: LngLat, parks): { id, timezone } | null`** — bounds prefilter
(latMin/latMax/lngMin/lngMax, skip parks with null bounds), then `pointInPolygon` when
`boundary` present; bounds hit alone is enough when boundary is null.

**`function localParts(now: Date, timeZone: string): { day: string; hour: number; minute: number }`**
— via `Intl.DateTimeFormat("en-CA", { timeZone, ... })` (en-CA gives `YYYY-MM-DD`).

**`async function ingestPing(userId, lng, lat, accuracyM): Promise<IngestResult>`** — the core:

1. `accuracyM > PING_MAX_ACCURACY_M` → return `{ inPark: false, newlyUnlocked: [] }` (do not
   update state; a bad fix shouldn't break a queue dwell).
2. `now = new Date()` (server time; never trust client timestamps).
3. Resolve `park = parkForPoint([lng, lat])`. Load `userGeoState` row (may be absent).
4. **Left-park / cross-park anchor settlement:** if state has an anchor and (no park now, or
   `park.id !== state.parkId`): settle the anchor (step 7's settle logic) against the _old_
   park's current local day before switching.
5. If `park == null`: upsert state (coords, at, parkId null, anchor cleared) and return
   `{ inPark: false }`.
6. **Day row upsert (single statement):** compute `{ day, hour, minute }` in park tz;
   `elapsed = state?.at ? (now - state.at)/1000 : null`;
   `moved = state?.parkId === park.id && elapsed != null && elapsed <= PING_MAX_GAP_S && state.lng != null`
   ? `min(distanceMeters(prev, cur), WALK_SPEED_CAP_MS * elapsed)` : `0`;
   `ropeDrop = hour < 9 || (hour === 9 && minute < 30)`; `nightOwl = hour >= 22`;
   `rainy` = does the latest `weather_obs` row for this park within the last 2h
   (`kind` either, `observed_at desc limit 1`) have `precipMm > 0` OR `condition` in
   ('Rain','Drizzle','Thunderstorm')? (One indexed PK-scan query; run every ping, it's cheap.)
   Then:

   ```ts
   await db.insert(userParkDay).values({... pings: 1, distanceM: moved, ropeDrop, nightOwl, rainy})
     .onConflictDoUpdate({ target: [userId, parkId, day], set: {
       lastSeenAt: now, pings: sql`user_park_day.pings + 1`,
       distanceM: sql`user_park_day.distance_m + ${moved}`,
       ropeDrop: sql`user_park_day.rope_drop OR ${ropeDrop}`,
       nightOwl: sql`user_park_day.night_owl OR ${nightOwl}`,
       rainy: sql`user_park_day.rainy OR ${rainy}`,
     }});
   ```

7. **Queue dwell state machine** (against cached attractions for this park):
   - `nearest` = closest attraction; `d` its distance.
   - _Continue_: if `state.anchorAttractionId` and that same attraction is within
     `QUEUE_EXIT_RADIUS_M` → `anchorSeconds += min(elapsed ?? 0, PING_MAX_GAP_S)`.
   - _Settle_: else if there was an anchor → if `anchorSeconds >= QUEUE_MIN_DWELL_S`,
     bump today's row: `queueSeconds += anchorSeconds`, `rides += 1` (an `update ... set
queue_seconds = queue_seconds + …` on the (user, park, day) PK). Then clear anchor.
   - _Enter_: if no anchor (or just settled) and `nearest` within `QUEUE_ENTER_RADIUS_M` →
     set `anchorAttractionId = nearest.id`, `anchorSince = now`, `anchorSeconds = 0`.
   - Note: dwell only credits on settle, so a 3-hour lunch parked next to a coaster
     entrance counts once, as one (generous) "ride" — acceptable v1 noise. Restaurants/shops
     are excluded because we only load `entityType='ATTRACTION'`.
8. Upsert `userGeoState` (coords, `at = now`, parkId, anchor fields).
9. `newlyUnlocked = await evaluateAndUnlock(userId)` (below).
10. Return `{ inPark: true, parkId, newlyUnlocked, xp, level }` (xp/level from the
    evaluation's stats — see below; also return `today: { distanceM, queueSeconds, rides }`
    for potential UI use).

**`async function computeStats(userId): Promise<Stats>`** — two queries:

- all `user_park_day` rows for the user (select the needed columns), aggregate in JS:
  `park_days` = rows.length; `parks_unique` = distinct parkId; `distance_m` = Σ distanceM;
  `queue_seconds` = Σ queueSeconds; `rides` = Σ rides; `rope_drops`/`night_owls`/`rain_days`
  = counts of flags; `best_day_distance_m` / `best_day_queue_seconds` = maxes;
  `park_seconds` = Σ (lastSeenAt − firstSeenAt)/1000;
  `park_hop_days` = # of `day` values appearing with ≥2 distinct parkIds;
  `streak_best` = longest run of consecutive dates over the distinct sorted `day` set
  (string→Date at UTC noon to dodge DST; a day counts toward a streak regardless of park).
- all `user_stat` rows → spread into the stats object.

**`async function evaluateAndUnlock(userId): Promise<{ newlyUnlocked: UnlockDTO[]; xp: number; level: LevelInfo }>`**

- `stats = await computeStats(userId)`; `deserved = satisfiedTierIds(stats)`.
- Insert all deserved ids with `.onConflictDoNothing().returning()` — the returned rows are
  the _newly_ unlocked ones (race-safe & idempotent; PK is (user, achievement)).
- Fetch the user's full unlock set (or union existing+new), `xp = xpForTierIds(...)`,
  `level = levelForXp(xp)`.
- `UnlockDTO = { id, unlockedAt }` — the client resolves names from the shared catalog.
- **Never delete rows here**: unlocks are sticky even if stats later imply otherwise (admin
  revoke is the only removal path).

**`async function bumpEventStat(userId, event: TrackEvent, by = 1)`** — upsert into
`user_stat` (`value = user_stat.value + by`, `updated_at = now()`), then
`evaluateAndUnlock`. Same return shape as `ingestPing`.

### 4.3 Weather note

`weatherObs` (schema.ts:1166) PK is `(park_id, kind, observed_at)`; columns `precipMm`,
`condition` ('Rain' | 'Clear' | …). Query:
`select precip_mm, condition from weather_obs where park_id = $1 and observed_at > now() - interval '2 hours' order by observed_at desc limit 1`.
Missing row ⇒ not rainy. Don't join on `kind` — accept either FORECAST or ACTUAL, latest wins.

---

## 5. tRPC — `src/integrations/trpc/routers/achievements.ts` (new) + registration

Follow the file style of `routers/removal.ts` (plain object typed `TRPCRouterRecord`,
zod inputs, `protectedProcedure`/`adminProcedure` from `../init.ts`).

```ts
export const achievementsRouter = {
  /** Location ping from the tracker. ~1 per 30s per active user. */
  ping: protectedProcedure
    .input(z.object({
      lng: z.number().gte(-180).lte(180),
      lat: z.number().gte(-90).lte(90),
      accuracy: z.number().nonnegative().max(100_000),
    }))
    .mutation(({ ctx, input }) => ingestPing(ctx.userId, input.lng, input.lat, input.accuracy)),

  /** Allowlisted client event (pin scan, alert created, …). */
  track: protectedProcedure
    .input(z.object({ event: z.enum(Object.keys(TRACK_EVENTS) as [TrackEvent, ...TrackEvent[]]) }))
    .mutation(({ ctx, input }) => bumpEventStat(ctx.userId, input.event)),

  /** Full progress for the achievements page: stats + unlocked ids + xp/level. */
  progress: protectedProcedure.query(async ({ ctx }) => {
    const stats = await computeStats(ctx.userId);
    const unlocked = await db.select(...).from(userAchievement).where(eq(userId, ctx.userId));
    const xp = xpForTierIds(unlocked.map(u => u.achievementId));
    return { stats, unlocked /* [{id, unlockedAt}] */, xp, level: levelForXp(xp) };
  }),

  /** Unlocks whose toast may never have shown (notified_at null). */
  pendingUnlocks: protectedProcedure.query(...),

  /** Mark unlock toasts as delivered. */
  ackUnlocks: protectedProcedure
    .input(z.object({ ids: z.array(z.string().max(64)).min(1).max(100) }))
    .mutation(...), // update ... set notified_at = now() where user_id = ctx.userId and achievement_id in ids

  // ---- admin (testing tools) ----
  adminSearchUsers: adminProcedure
    .input(z.object({ q: z.string().trim().min(1).max(200) }))
    .query(...),
    // ilike on email OR name, limit 20 → { id, email, name, unlockCount } (left join count of user_achievement)

  adminUserDetail: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input }) => ({
      user: { id, email, name },
      stats: await computeStats(input.userId),
      unlocked: [...{ id, unlockedAt, notifiedAt }],
      xp, level,
    })),

  adminRevoke: adminProcedure
    .input(z.object({ userId: z.string(), achievementIds: z.array(z.string()).min(1).max(200) }))
    .mutation(...), // delete from user_achievement where user_id and achievement_id in (...); return { removed: n }

  adminResetStats: adminProcedure
    .input(z.object({ userId: z.string(), alsoAchievements: z.boolean().default(false) }))
    .mutation(...), // delete user_park_day + user_stat + user_geo_state (+ user_achievement when flagged)
} satisfies TRPCRouterRecord;
```

Register in `src/integrations/trpc/router.ts`: import + `achievements: achievementsRouter,`
(alphabetical-ish placement near the top with the other feature routers).

**Cache caution:** `lib/cache.ts` holds an allowlist of edge-cacheable GET queries — do NOT
add any achievements procedure to it; everything here is per-user.

---

## 6. Client

### 6.1 `src/lib/vibrate.ts` (new)

```ts
/** Best-effort Vibration API — no-ops on iOS Safari / non-secure contexts. */
export function vibrate(pattern: number | number[]): void; // try/catch navigator.vibrate?.()

/** Tier-scaled celebration: a "ta-da" that grows with tier (1-based).
 *  tier 1: [35, 60, 35, 60, 90]; each extra tier prepends another [35, 60] pulse
 *  and adds +40ms to the finale (capped at 250ms). */
export function vibrateUnlock(tierIndex: number): void;

/** Level-up drumroll: six 15ms taps at 30ms gaps, then a 250ms boom. */
export function vibrateLevelUp(): void;
```

### 6.2 `src/components/achievements/unlock-toasts.tsx` (new)

The single funnel through which every unlock is celebrated (tracker pings, track events,
pending replays all call this):

```ts
export function showUnlockToasts(
  unlockIds: string[],
  opts: { xp: number; level: LevelInfo; onShown?: (ids: string[]) => void },
): void;
```

- Resolve each id via `TIER_BY_ID` (skip unknown ids defensively).
- For each, `toast.success(name, { id: `achv:${id}`, description, duration: 6000, icon })` —
  **success toasts per the requirement**, sonner handles stacking. `id:` dedupes replays.
  Description: `"${family.icon} ${tier.description} (+${tier.xp} XP)"`. Stagger multiple
  unlocks ~250ms apart (setTimeout) so the stack animates in rather than slamming.
- `vibrateUnlock(tierIndex + 1)` per toast (fires with the stagger).
- **Level-up detection:** persist last-celebrated level in
  `localStorage["parkfi:achv:level"]`. If `opts.level.level` exceeds it, fire an extra
  `toast.success(`Level ${level} — ${title}`, { id: "achv:levelup", duration: 8000, ... })`
  - `vibrateLevelUp()`, then store the new level. (Store max, never regress on revoke.)
- Call `opts.onShown?.(ids)` after scheduling — the caller wires this to `ackUnlocks`.

### 6.3 `src/hooks/use-achievement-track.ts` (new)

```ts
/** Fire-and-forget achievement event. Silently no-ops for anonymous users. */
export function useAchievementTrack(): (event: TrackEvent) => void;
```

- `authClient.useSession()`; if no user, return a no-op.
- Wrap `useMutation(trpc.achievements.track.mutationOptions({ onSuccess: (r) =>
showUnlockToasts(r.newlyUnlocked.map(u => u.id), { xp: r.xp, level: r.level, onShown: ack })
, onError: () => {} /* never toast errors for telemetry */ }))`.
  Set `meta: { errorToast: false }` so the global mutation-error sink stays quiet
  (see `root-provider.tsx` — mutations with meta.errorToast=false are suppressed; verify the
  exact meta contract there and use whatever it expects).

### 6.4 `src/components/achievements/achievement-tracker.tsx` (new) — mounted globally

One headless component, mounted in `_dash.tsx`'s `DashLayout` (inside providers, next to
`<Outlet/>`; it renders `null`). Responsibilities:

1. **Session gate:** `authClient.useSession()` — do nothing while anonymous.
2. **Geolocation:** `useGeolocation({ watch: true, rememberActive: true })` (the existing
   hook already auto-resumes across sessions via the Permissions API — that's why the
   tracker works silently after the first grant).
3. **Ping loop:** while `state.status === "granted"`, every 30s (setInterval + latest coords
   in a ref) call `trpc.achievements.ping` with `{ lng, lat, accuracy }`. Skip a tick if the
   previous mutation is still in flight or the tab is hidden (`document.visibilityState`).
   On success: `showUnlockToasts(...)` + ack (same funnel as §6.3).
4. **Pending replay:** on mount (once per session, when logged in),
   `useQuery(trpc.achievements.pendingUnlocks...)` → if non-empty, `showUnlockToasts` + ack.
5. **Location nudge — the must-dismiss stacked toast situation** (§6.5).

### 6.5 Location-services nudge (inside the tracker)

Trigger conditions (all must hold, evaluated once ~8s after mount):

- logged in; geolocation state is NOT `granted`/`prompting` (also check
  `navigator.permissions.query({name:"geolocation"})` ≠ granted where available);
- no snooze: `localStorage["parkfi:achv:locnudge"]` timestamp older than 14 days or absent.

Fire **three stacked, must-dismiss toasts** (sonner stacks them automatically; every one has
`duration: Infinity` so none auto-dismisses — the user must interact):

```ts
toast.info("ParkFi is better in the park", {
  id: "locnudge:1",
  duration: Infinity,
  description: "Turn on location and the app starts noticing things…",
});
toast.info("Earn achievements as you go", {
  id: "locnudge:2",
  duration: Infinity,
  description: "Miles walked, queues survived, rope drops conquered — all counted automatically.",
});
toast("Enable location services?", {
  id: "locnudge:3",
  duration: Infinity,
  description: "Only used while the app is open. Never shared.",
  action: {
    label: "Turn on",
    onClick: () => {
      locate();
      dismissAll();
    },
  },
  cancel: {
    label: "Not now",
    onClick: () => {
      snooze();
      dismissAll();
    },
  },
});
```

- Fire them ~300ms apart (in the order above, so the actionable one lands on top of the stack).
- `dismissAll()` = `["locnudge:1","locnudge:2","locnudge:3"].forEach(toast.dismiss)`.
- `snooze()` writes `Date.now()` to the localStorage key.
- If the user dismisses via sonner's close affordances instead, treat as snooze: pass
  `onDismiss: snooze` on each toast.
- If `locate()` later lands on `denied`, snooze too (don't nag someone who said no at the
  browser level).

### 6.6 Mount point — edit `src/routes/_dash.tsx`

In `DashLayout`, alongside `<Outlet/>` (inside `MapStageProvider` is fine, placement just
needs the query/session providers which wrap the whole tree):

```tsx
<AchievementTracker />
```

Import from `#/components/achievements/achievement-tracker.tsx`.

---

## 7. Pages

### 7.1 User-facing — `src/routes/_dash/achievements.tsx` (new)

Route `createFileRoute("/_dash/achievements")`, `head: () => seo({ title: "Achievements — ParkFi", noindex: true })`.
Gate like `_dash/account.tsx` does (client-side `authClient.useSession()`; render a sign-in
prompt when anonymous — copy that page's pattern, ~line 19/42).

Content (use existing `Card`, `Progress`, `Badge`, `Skeleton` from `#/components/ui/*`;
match the admin pages' container: `mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 lg:px-6`):

1. **Level header card** — big level number + title (`levelForXp`), XP progress bar
   (`intoLevel / forNext`), total XP, count `unlocked / 63`.
2. **Family grid** (`grid gap-4 sm:grid-cols-2`): one card per family —
   icon + title; current stat value formatted via `formatStatValue`; tier chips (one `Badge`
   per tier: solid when unlocked, outline when locked, tooltip = description); progress bar
   toward the next locked threshold with "12.4 km / 25 km" caption; when all tiers unlocked,
   show "Maxed" state.
3. Data: single `useQuery(trpc.achievements.progress.queryOptions())`.
4. A muted footnote when location has never been granted: "Most of these unlock from being
   in the parks — turn on location to start counting." (Text only; the toast nudge is the
   active surface.)

**Sidebar nav** — edit `src/components/app-sidebar.tsx` NAV array (line 32), append:
`{ title: "Badges", to: "/achievements", icon: <TrophyIcon /> }` (lucide `TrophyIcon`,
import alongside the existing icon imports).

### 7.2 Admin — `src/routes/_dash/admin.achievements.tsx` (new)

Auto-gated by the existing `/_dash/admin` layout guard (`admin.tsx` — nothing to do).
Model the file on `admin.removal-requests.tsx` (queries/mutations/toasts shown there).

UI:

1. **User picker** — `Input` bound to local state, 300ms debounce →
   `adminSearchUsers { q }`; results table (email, name, unlock count) with a "select" button.
2. **Selected user panel** (`adminUserDetail`):
   - Stat strip: level/xp + each StatKey with `formatStatValue` (small `Badge` grid).
   - **Unlocks table** grouped by family: rows = unlocked tiers (name, tier n/of, unlockedAt,
     notified yes/no) with a per-row **Revoke** button (`adminRevoke` with that one id) and a
     per-family **Revoke stack** button (all unlocked ids in the family).
   - Danger zone `Card`: "Revoke all achievements" (`adminRevoke` with every unlocked id) and
     "Reset stats" with an `alsoAchievements` checkbox (`adminResetStats`). Both behind a
     confirm (`window.confirm` is fine for an internal tool, or the existing `AlertDialog`).
   - Every mutation: `onSuccess` → invalidate the detail query + `toast.success(...)`,
     `onError` → `toast.error(err.message)` — exactly the removal-requests pattern.
3. Note under the header: "Revoking is the test loop — the user's next location ping or
   tracked event re-evaluates their stats and re-unlocks (with toast + buzz) anything they
   still qualify for."

**Admin index card** — edit `src/routes/_dash/admin.index.tsx` TOOLS array (line 19), add:
`{ title: "Achievements", description: "Inspect user stats and revoke achievement unlocks for testing.", to: "/admin/achievements", icon: Trophy }`
(lucide `Trophy` import).

---

## 8. Event wiring (small edits, one line-ish each)

Use `useAchievementTrack()` (§6.3). Call sites (verified paths):

| Event           | File                                                                                        | Where                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pin_scan`      | `src/components/pins/pin-scanner.tsx`                                                       | in the existing scan-success `onSuccess` (near the `toast.success("Pin confirmed"...)` at ~line 54) |
| `alert_created` | `src/components/notifications/ride-alert-button.tsx`                                        | create-success branch (~line 77, "Tracking …")                                                      |
| `alert_created` | `src/components/dining/dining-alert-button.tsx`                                             | create-success (~line 75)                                                                           |
| `alert_created` | `src/components/stays/stay-alert-button.tsx`                                                | create-success (~line 89)                                                                           |
| `menu_view`     | `src/routes/dining_.$facilityId.tsx`                                                        | `useEffect` on mount keyed by facilityId                                                            |
| `forecast_view` | `src/routes/predictions.tsx`                                                                | `useEffect` on mount                                                                                |
| `search`        | omnisearch component — find via `grep -rn "omnisearch\|cmdk\|CommandDialog" src/components` | on result selection                                                                                 |

Rules: hooks must be called unconditionally at component top level; the returned `track` is
already a safe no-op when anonymous. For the two route-mount events, guard with a
`useRef` so re-renders don't double-fire; firing once per mount is the intent (it's a
"viewed" counter, not analytics).

If any of these files has moved, adapt — the event list itself is the contract.

---

## 9. Tests (vitest — `vp test`)

New file `src/lib/achievements.test.ts` (colocate; repo already runs vitest via `vp test`):

- Catalog invariants: ≥36 tiers total; ids unique; every family's thresholds strictly
  ascending; every tier id round-trips through `TIER_BY_ID`.
- `satisfiedTierIds({ distance_m: 100_000 })` returns exactly `walker.1..3` for that stat.
- `xpForTierIds` ignores unknown ids.
- `levelForXp(0)` = level 1 title "Turnstile Tourist"; monotonic; caps at 20.
- `formatStatValue` for the three units.

New file `src/server/achievements/geo.test.ts`:

- `pointInPolygon` inside/outside a square Polygon and a MultiPolygon.
- `distanceMeters` sanity (~111m per 0.001° lat).

(Engine DB logic is exercised manually via the admin loop; don't build a DB test harness
for this PR.)

---

## 10. Validation & handoff checklist (in order)

1. `bun vp install` (if deps look stale — no new deps are required by this plan).
2. `bun vp check` — format/lint/typecheck. Fix everything it flags.
3. `bun vp test run` — catalog + geo tests green.
4. **Do not** run dev servers; **do not** commit. Migration is applied by the user
   (they run their own drizzle flow) — just make sure `migration.sql` matches the Drizzle
   schema exactly.
5. Sanity-read: no import from `src/server/living/**` or `src/components/living/**`
   anywhere in the new code (`grep -rn "living" src/server/achievements src/components/achievements src/lib/achievements.ts src/integrations/trpc/routers/achievements.ts` → zero hits).

## 11. Explicit non-goals (v1)

- No push notifications for unlocks (toasts only, while app is open).
- No public profile/leaderboard; achievements are private to the user + admin.
- No offline queueing of pings; a closed app simply doesn't count steps (the geofenced
  dwell math needs continuity anyway).
- No ride-accuracy guarantees: "rides" = completed ≥8-min dwells near an attraction —
  labeled honestly in the catalog copy ("queues conquered").
- No dedicated settings toggle: the existing locate affordance + `rememberActive`
  localStorage flag is the opt-in/out surface; `deactivate()` on the map's locate control
  already turns tracking off globally.

## 12. File manifest (create ✚ / edit ✎)

```
✚ src/lib/achievements.ts                                  catalog + math (§2)
✚ src/lib/achievements.test.ts                             (§9)
✚ src/lib/vibrate.ts                                       (§6.1)
✚ src/db/schema.ts                                         ✎ append 4 tables (§3.1)
✚ drizzle/20260706150000_achievements/migration.sql        (§3.2)
✚ src/server/achievements/geo.ts                           (§4.1)
✚ src/server/achievements/geo.test.ts                      (§9)
✚ src/server/achievements/engine.ts                        (§4.2)
✚ src/integrations/trpc/routers/achievements.ts            (§5)
✎ src/integrations/trpc/router.ts                          register router (§5)
✚ src/components/achievements/unlock-toasts.tsx            (§6.2)
✚ src/hooks/use-achievement-track.ts                       (§6.3)
✚ src/components/achievements/achievement-tracker.tsx      (§6.4–6.5)
✎ src/routes/_dash.tsx                                     mount tracker (§6.6)
✚ src/routes/_dash/achievements.tsx                        user page (§7.1)
✎ src/components/app-sidebar.tsx                           nav entry (§7.1)
✚ src/routes/_dash/admin.achievements.tsx                  admin tool (§7.2)
✎ src/routes/_dash/admin.index.tsx                         tool card (§7.2)
✎ src/components/pins/pin-scanner.tsx                      track pin_scan (§8)
✎ src/components/notifications/ride-alert-button.tsx       track alert_created (§8)
✎ src/components/dining/dining-alert-button.tsx            track alert_created (§8)
✎ src/components/stays/stay-alert-button.tsx               track alert_created (§8)
✎ src/routes/dining_.$facilityId.tsx                       track menu_view (§8)
✎ src/routes/predictions.tsx                               track forecast_view (§8)
✎ <omnisearch component>                                   track search (§8)
```
