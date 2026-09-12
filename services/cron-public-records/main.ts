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
 * Adapters are feature-flagged by `RECORDS_SOURCES` (comma list) and skip
 * themselves when a key they need (`requiredEnv`, e.g. `USPTO_ODP_API_KEY`)
 * is unset; weekly adapters skip when they ran within the last six days. `--dry-run` fetches
 * and normalizes without touching the ledger (prints what would be kept).
 *
 * After the adapters, every record the sweep created or revised is matched
 * against the active filing watches (plan §6.3) and delivered as one grouped
 * email/push per watch. `--dry-run` and `--no-alerts` both skip that step.
 *
 * `--relink` re-runs entity linking + scoring over the ledger instead of
 * fetching (plan §4.3's back-link pass): new linking rules reach old rows,
 * and a trademark filed months ago links to an attraction named since.
 * Pair with `--source=` to limit it, `--since=YYYY-MM-DD` to bound it by
 * first-seen date, `--dry-run` to only count. Nothing about the records'
 * content, revisions or timestamps changes, and admin-linked rows are left
 * alone.
 *
 * Run:  bun run cron:public-records [--dry-run] [--no-alerts] [--source=orlando_soda]
 *       bun run cron:public-records --relink [--source=uspto_tm] [--since=2024-09-01] [--dry-run]
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

// Imported after loadEnv so the module-level PostHog client sees POSTHOG_KEY.
import { flushTelemetry, reportServiceError } from "../shared/telemetry.ts";

import {
  lastRanAt,
  loadAliases,
  prepareRecord,
  relinkRecords,
  runAdapter,
  type IngestStats,
} from "#/server/records/ingest.ts";
import { loadEntityCatalog } from "#/server/records/link.ts";
import { ADAPTERS } from "#/server/records/registry.ts";
import { evaluateFilingWatches } from "#/server/notifications/filingAlerts.ts";

import type { Adapter } from "#/server/records/types.ts";

const SERVICE = "cron-public-records";

const ENABLED = new Set(
  (
    process.env.RECORDS_SOURCES ??
    "orlando_soda,uspto_tm,uspto_patent,faa_oeaaa,sfwmd_erp,fdacs_incident"
  )
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
const NO_ALERTS = args.has("--no-alerts");
/**
 * How far back the watch evaluator looks for records the sweep touched. A
 * generous margin over the daily cadence costs nothing — the (watch, record)
 * fire ledger, not this window, is what makes delivery exactly-once.
 */
const ALERT_WINDOW_MS = Number(process.env.RECORDS_ALERT_WINDOW_HOURS ?? 36) * 3_600_000;
/** Newsworthiness floor for a record to reach a watch at all (0 = everything). */
const ALERT_MIN_SCORE = Number(process.env.RECORDS_ALERT_MIN_SCORE ?? 0);
const ONLY = [...args].find((a) => a.startsWith("--source="))?.slice("--source=".length);
const RELINK = args.has("--relink");
const SINCE = [...args].find((a) => a.startsWith("--since="))?.slice("--since=".length);

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

/** `--relink`: re-link + re-score the ledger, source by source; no fetching. */
async function relink(): Promise<void> {
  const since = SINCE ? new Date(`${SINCE}T00:00:00Z`) : null;
  if (since && Number.isNaN(since.getTime())) throw new Error(`bad --since: ${SINCE}`);
  const catalog = await loadEntityCatalog();
  const aliases = await loadAliases();
  log(
    `relink${DRY_RUN ? " (dry run)" : ""}: catalog = ${catalog.parks.length} parks, ${catalog.attractions.length} attractions, ${catalog.venues?.length ?? 0} venues${since ? `; rows first seen since ${SINCE}` : ""}`,
  );
  for (const adapter of ADAPTERS) {
    if (ONLY ? adapter.source !== ONLY : !ENABLED.has(adapter.source)) continue;
    const started = Date.now();
    try {
      const s = await relinkRecords(adapter, { since, log, catalog, aliases, dryRun: DRY_RUN });
      log(
        `${adapter.source}: relink scanned=${s.scanned} relinked=${s.relinked} adminPinned=${s.adminPinned} parkGained=${s.parkGained} parkLost=${s.parkLost} linksAdded=${s.linksAdded} linksRemoved=${s.linksRemoved} in ${Math.round((Date.now() - started) / 1000)}s`,
      );
    } catch (err) {
      reportServiceError(SERVICE, `relink:${adapter.source}`, err);
    }
  }
}

async function main() {
  if (RELINK) return relink();
  const runStartedAt = Date.now();
  const catalog = DRY_RUN ? undefined : await loadEntityCatalog();
  const aliases = DRY_RUN ? undefined : await loadAliases();
  for (const adapter of ADAPTERS) {
    if (ONLY ? adapter.source !== ONLY : !ENABLED.has(adapter.source)) continue;
    const missing = (adapter.requiredEnv ?? []).filter((k) => !process.env[k]?.trim());
    if (missing.length > 0) {
      log(`${adapter.source}: skipped — ${missing.join(", ")} not set`);
      continue;
    }
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

  if (DRY_RUN || NO_ALERTS) return;
  try {
    const alerts = await evaluateFilingWatches({
      since: new Date(runStartedAt - ALERT_WINDOW_MS),
      minScore: ALERT_MIN_SCORE,
    });
    log(
      `filing-watches: ${alerts.watches} active, ${alerts.candidates} candidate record(s), ` +
        `${alerts.newPairs} new match(es) → ${alerts.notifications} notification(s)`,
    );
  } catch (err) {
    reportServiceError(SERVICE, "filing-watches", err);
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
