/**
 * parkfi.sh ingestion worker (Railway service, replica = 1).
 *
 * Self-scheduling poller: every POLL_INTERVAL_MS it fetches `/live` for every
 * active park (bounded concurrency), normalizes, and persists. No Redis/BullMQ
 * yet — that's the documented scale path once this runs on >1 replica.
 *
 * Run:  bun run worker   (or: tsx services/worker/main.ts)
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

// Imported after loadEnv so the module-level PostHog client sees POSTHOG_KEY.
import { flushTelemetry, reportServiceError } from "../shared/telemetry.ts";

import { createServer } from "node:http";

import { config } from "#/server/parks/config.ts";
import { LIVING_ENABLED } from "#/server/living/config.ts";
import { evaluateAlerts } from "#/server/notifications/alerts.ts";
import { activeParkIds, ingestPark } from "#/server/parks/ingest.ts";

let shuttingDown = false;
let inFlight = false;
let lastTickOk = 0;

async function pool<T>(
  items: Array<T>,
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function tick(): Promise<void> {
  if (shuttingDown) return;
  inFlight = true;
  const started = Date.now();
  try {
    const parkIds = await activeParkIds();
    let entities = 0;
    let statusChanges = 0;
    let queueRows = 0;
    let virtualLineRows = 0;
    let degraded = 0;
    let errors = 0;

    await pool(parkIds, config.pollConcurrency, async (parkId) => {
      try {
        const r = await ingestPark(parkId);
        entities += r.entities;
        statusChanges += r.statusChanges;
        queueRows += r.queueRows;
        virtualLineRows += r.virtualLineRows;
        if (r.degraded) degraded++;
        if (r.error) {
          errors++;
          console.error(`[ingest] park ${parkId}: ${r.error}`);
        }
      } catch (err) {
        errors++;
        reportServiceError("worker", `ingest:${parkId}`, err);
      }
    });

    // Alerts read the rows we just wrote; isolate so a failure here never
    // breaks ingestion.
    let alertsFired = 0;
    try {
      alertsFired = await evaluateAlerts();
    } catch (err) {
      reportServiceError("worker", "alerts", err);
    }

    // Living Layer (M2) — reconcile the Darkness game layer to the live park
    // state we just ingested. OFF by default (LIVING_ENABLED), level-triggered
    // (reads current state, writes only `mark`), and isolated so it can never
    // affect ingestion or alerts. No-op unless explicitly enabled.
    let darkness = "";
    if (LIVING_ENABLED) {
      try {
        const { reconcileDarkness } = await import("#/server/living/darkness.ts");
        const r = await reconcileDarkness();
        darkness = ` darkness(+${r.spawned}/-${r.expired})`;
      } catch (err) {
        reportServiceError("worker", "living-darkness", err);
      }
    }

    lastTickOk = Date.now();
    const ms = lastTickOk - started;
    console.log(
      `[tick] parks=${parkIds.length} entities=${entities} statusΔ=${statusChanges} queueRows=${queueRows} vline=${virtualLineRows} alerts=${alertsFired} degraded=${degraded} errors=${errors}${darkness} ${ms}ms`,
    );
  } catch (err) {
    reportServiceError("worker", "tick", err);
  } finally {
    inFlight = false;
  }
}

async function loop(): Promise<void> {
  while (!shuttingDown) {
    const started = Date.now();
    await tick();
    const elapsed = Date.now() - started;
    const wait = Math.max(config.pollIntervalMs - elapsed, 0);
    if (shuttingDown) break;
    await new Promise((r) => setTimeout(r, wait));
  }
}

// Minimal health endpoint for Railway healthchecks.
const port = Number(process.env.PORT ?? 8080);
createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    // healthy if a tick succeeded within ~3 poll intervals
    const fresh = Date.now() - lastTickOk < config.pollIntervalMs * 3;
    const ok = lastTickOk === 0 || fresh;
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok, lastTickOk, inFlight }));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(port, () => console.log(`[worker] health on :${port}`));

function shutdown(sig: string) {
  console.log(`[worker] ${sig} received, draining…`);
  shuttingDown = true;
  // Flush queued PostHog events, then exit — awaited so tick failures captured
  // on the final loop aren't dropped by the process teardown.
  const exit = () => void flushTelemetry().finally(() => process.exit(0));
  const t = setInterval(() => {
    if (!inFlight) {
      clearInterval(t);
      console.log("[worker] drained, exiting");
      exit();
    }
  }, 200);
  // hard cap so Railway's SIGKILL grace window isn't exceeded
  setTimeout(exit, 8_000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log(
  `[worker] starting — interval=${config.pollIntervalMs}ms concurrency=${config.pollConcurrency}`,
);
void loop();
