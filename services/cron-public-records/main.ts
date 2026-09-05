/**
 * Public-records intelligence cron (Railway cron, "0 9 * * *" = 04:00 ET,
 * after the City of Orlando's nightly Socrata refresh).
 * Plan: docs/plans/public-records-intelligence.md.
 *
 * Single-shot, keyless by default. One adapter per government source runs
 * through the shared ingest loop (`src/server/records/ingest.ts`): fetch
 * since cursor → normalize → attribute to an operator → link to our entity
 * graph → score → upsert with revisions. Each adapter is a `runStep` — a
 * broken portal logs and is skipped, never fails the run, and its cursor is
 * held so the next run re-drains.
 *
 * Adapters are feature-flagged by `RECORDS_SOURCES` (comma list); weekly
 * adapters skip when they ran within the last six days. `--dry-run` fetches
 * and normalizes without touching the ledger (prints what would be kept).
 *
 * Run:  bun run cron:public-records [--dry-run] [--source=orlando_soda]
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

// Imported after loadEnv so the module-level PostHog client sees POSTHOG_KEY.
import { flushTelemetry, reportServiceError } from "../shared/telemetry.ts";

import {
  lastRanAt,
  loadAliases,
  prepareRecord,
  runAdapter,
  type IngestStats,
} from "#/server/records/ingest.ts";
import { loadEntityCatalog } from "#/server/records/link.ts";
import { ADAPTERS } from "#/server/records/registry.ts";

import type { Adapter } from "#/server/records/types.ts";

const SERVICE = "cron-public-records";

const ENABLED = new Set(
  (process.env.RECORDS_SOURCES ?? "orlando_soda")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
/** Per-adapter wall-clock cap for the fetch phase (plan §8). */
const STEP_BUDGET_MS = Number(process.env.RECORDS_STEP_BUDGET_MS ?? 120_000);
/** First-run backfill start for sources that support it. */
const BACKFILL_FROM = process.env.RECORDS_BACKFILL_FROM ?? "2019-01-01";
const WEEKLY_MIN_GAP_MS = 6 * 24 * 60 * 60 * 1000;

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const ONLY = [...args].find((a) => a.startsWith("--source="))?.slice("--source=".length);

const log = (message: string) => console.log(`[${SERVICE}] ${message}`);

async function runStep(label: string, fn: () => Promise<IngestStats | null>): Promise<void> {
  const started = Date.now();
  try {
    const stats = await fn();
    if (!stats) return;
    log(
      `${label}: fetched=${stats.fetched} kept=${stats.kept} inserted=${stats.inserted} changed=${stats.changed} unchanged=${stats.unchanged} skipped=${stats.skipped} errors=${stats.errors} scoreP50=${stats.scoreP50 ?? "-"} scoreMax=${stats.scoreMax ?? "-"} in ${Math.round((Date.now() - started) / 1000)}s`,
    );
    if (stats.fetched === 0)
      log(`${label}: zero rows — check the portal if this persists for 3 runs`);
  } catch (err) {
    // A blocked/changed portal must not fail the whole run — log, report, move on.
    reportServiceError(SERVICE, label, err);
  }
}

/** Fetch + normalize + attribute only; print a sample of what would be kept. */
async function dryRun(adapter: Adapter): Promise<IngestStats> {
  const catalog = await loadEntityCatalog();
  const aliases = await loadAliases();
  const { records } = await adapter.fetchSince(null, {
    fetch,
    log: (m) => log(`[${adapter.source}] ${m}`),
    signal: AbortSignal.timeout(STEP_BUDGET_MS),
    parks: catalog.parks,
    aliases,
    backfillFrom: BACKFILL_FROM,
  });
  const stats: IngestStats = {
    fetched: records.length,
    kept: 0,
    inserted: 0,
    changed: 0,
    unchanged: 0,
    skipped: 0,
    errors: 0,
    scoreP50: null,
    scoreMax: null,
  };
  const kept: Array<{ score: number; line: string }> = [];
  for (const raw of records) {
    try {
      const input = adapter.normalize(raw);
      const p = input ? prepareRecord(adapter, input, catalog, aliases) : null;
      if (!p) {
        stats.skipped++;
        continue;
      }
      stats.kept++;
      kept.push({
        score: p.score,
        line: `${p.score.toFixed(1).padStart(6)}  ${input!.externalId.padEnd(16)} ${p.operator ?? "-"}/${p.resortSlug ?? "-"} park=${p.parkId ?? "-"} links=${p.links.map((l) => `${l.entityKind}:${l.entityId}@${l.method}`).join(",") || "-"}  ${input!.title.slice(0, 70)}`,
      });
    } catch (err) {
      stats.errors++;
      log(`normalize failed for ${raw.externalId}: ${err instanceof Error ? err.message : err}`);
    }
  }
  kept.sort((a, b) => b.score - a.score);
  for (const k of kept.slice(0, 40)) console.log(k.line);
  if (kept.length > 40) console.log(`… ${kept.length - 40} more`);
  const scores = kept.map((k) => k.score).sort((a, b) => a - b);
  stats.scoreP50 = scores[Math.floor(scores.length / 2)] ?? null;
  stats.scoreMax = scores.at(-1) ?? null;
  return stats;
}

async function main() {
  const catalog = DRY_RUN ? undefined : await loadEntityCatalog();
  const aliases = DRY_RUN ? undefined : await loadAliases();
  for (const adapter of ADAPTERS) {
    if (ONLY ? adapter.source !== ONLY : !ENABLED.has(adapter.source)) continue;
    await runStep(adapter.source, async () => {
      if (DRY_RUN) return dryRun(adapter);
      if (adapter.cadence === "weekly") {
        const ran = await lastRanAt(adapter.source);
        if (ran && Date.now() - ran.getTime() < WEEKLY_MIN_GAP_MS) {
          log(`${adapter.source}: weekly, ran ${ran.toISOString()} — not due`);
          return null;
        }
      }
      return runAdapter(adapter, {
        budgetMs: STEP_BUDGET_MS,
        backfillFrom: BACKFILL_FROM,
        log,
        catalog,
        aliases,
      });
    });
  }
}

main()
  .catch((err) => {
    reportServiceError(SERVICE, "main", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await flushTelemetry();
    process.exit();
  });
