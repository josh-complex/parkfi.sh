/**
 * Coaster-stats seed cron (manual/occasional — RCDB has no API, so figures are
 * hand-curated in `seed.csv`). Single-shot, per-row isolated (`runStep`-style:
 * a row that fails to resolve/upsert logs and is skipped, never fails the run).
 * Upserts the sparse `coaster_stats` enrichment side table with the MANUAL_SEED
 * ref_source. Idempotent — safe to re-run after editing the CSV.
 *
 * Row resolution: (parks.slug, attractions.slug) join, filtered to active,
 * non-ghost attractions (`category IS NOT NULL`). Slugs are ThemeParks.wiki-name
 * derived (see `slugify` in src/server/parks/ingest.ts); an unresolved slug logs
 * a warning and is skipped, so a stale/renamed slug never blocks the rest.
 *
 * Facts are non-copyrightable figures curated from RCDB pages by hand — do NOT
 * scrape RCDB programmatically.
 *
 * Run:  bun run cron:coaster-stats
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

// Imported after loadEnv so the module-level PostHog client sees POSTHOG_KEY.
import { flushTelemetry, reportServiceError } from "../shared/telemetry.ts";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { attractions, coasterStats, parks } from "#/db/schema.ts";
import { Source } from "#/server/parks/codes.ts";

const CSV_PATH = fileURLToPath(new URL("./seed.csv", import.meta.url));

const COLUMNS = [
  "park_slug",
  "attraction_slug",
  "track_length_m",
  "top_speed_kmh",
  "drop_height_m",
  "max_height_m",
  "inversions",
  "coaster_type",
  "manufacturer",
  "opened_year",
] as const;

interface SeedRow {
  parkSlug: string;
  attractionSlug: string;
  trackLengthM: number | null;
  topSpeedKmh: number | null;
  dropHeightM: number | null;
  maxHeightM: number | null;
  inversions: number | null;
  coasterType: string | null;
  manufacturer: string | null;
  openedYear: number | null;
}

function num(v: string | undefined): number | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function str(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  return s ? s : null;
}

/**
 * Parse the curated CSV. Deliberately simple (comma split, no quoting): none of
 * the curated fields contain commas — keep it that way. Skips the header row,
 * blank lines, and `#` comments.
 */
function parseSeed(text: string): SeedRow[] {
  const rows: SeedRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const cells = trimmed.split(",");
    // Skip the header row (first column literally "park_slug").
    if (cells[0].trim() === COLUMNS[0]) continue;
    rows.push({
      parkSlug: cells[0].trim(),
      attractionSlug: cells[1]?.trim() ?? "",
      trackLengthM: num(cells[2]),
      topSpeedKmh: num(cells[3]),
      dropHeightM: num(cells[4]),
      maxHeightM: num(cells[5]),
      inversions: num(cells[6]),
      coasterType: str(cells[7]),
      manufacturer: str(cells[8]),
      openedYear: num(cells[9]),
    });
  }
  return rows;
}

/** (park slug, attraction slug) → internal attraction id, non-ghost + active. */
async function resolveAttractionId(
  parkSlug: string,
  attractionSlug: string,
): Promise<number | null> {
  const [row] = await db
    .select({ id: attractions.id })
    .from(attractions)
    .innerJoin(parks, eq(parks.id, attractions.parkId))
    .where(
      and(
        eq(parks.slug, parkSlug),
        eq(attractions.slug, attractionSlug),
        eq(attractions.active, true),
        isNotNull(attractions.category),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function upsertRow(attractionId: number, row: SeedRow): Promise<void> {
  await db
    .insert(coasterStats)
    .values({
      attractionId,
      trackLengthM: row.trackLengthM,
      topSpeedKmh: row.topSpeedKmh,
      dropHeightM: row.dropHeightM,
      maxHeightM: row.maxHeightM,
      inversions: row.inversions,
      coasterType: row.coasterType,
      manufacturer: row.manufacturer,
      openedYear: row.openedYear,
      source: Source.MANUAL_SEED,
    })
    .onConflictDoUpdate({
      target: coasterStats.attractionId,
      set: {
        trackLengthM: sql`excluded.track_length_m`,
        topSpeedKmh: sql`excluded.top_speed_kmh`,
        dropHeightM: sql`excluded.drop_height_m`,
        maxHeightM: sql`excluded.max_height_m`,
        inversions: sql`excluded.inversions`,
        coasterType: sql`excluded.coaster_type`,
        manufacturer: sql`excluded.manufacturer`,
        openedYear: sql`excluded.opened_year`,
        source: sql`excluded.source`,
        updatedAt: sql`now()`,
      },
    });
}

async function main() {
  const rows = parseSeed(readFileSync(CSV_PATH, "utf8"));
  if (rows.length === 0) {
    console.warn("[coaster-stats] seed.csv has no data rows");
    return;
  }

  let upserted = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      const attractionId = await resolveAttractionId(row.parkSlug, row.attractionSlug);
      if (attractionId == null) {
        console.warn(`[coaster-stats] unresolved: ${row.parkSlug}/${row.attractionSlug} — skipped`);
        skipped++;
        continue;
      }
      await upsertRow(attractionId, row);
      upserted++;
    } catch (err) {
      reportServiceError("coaster-stats", `${row.parkSlug}/${row.attractionSlug}`, err);
      skipped++;
    }
  }
  console.log(`[coaster-stats] done — ${upserted} upserted, ${skipped} skipped of ${rows.length}`);
}

main()
  .catch((err) => {
    reportServiceError("coaster-stats", "main", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await flushTelemetry();
    process.exit(process.exitCode ?? 0);
  });
