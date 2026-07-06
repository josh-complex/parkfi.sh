/**
 * parkfi.sh pin-identify worker (Railway service, replica = 1).
 *
 * Long-running process hosting TWO BullMQ workers on one Redis connection:
 *  - `pin-scan`  — runs the identification cascade for a queued scan and writes
 *                  candidates back to `pin_scan` (the client polls the result).
 *  - `pin-embed` — embeds a reference image (calls the self-hosted CLIP service)
 *                  and upserts the vector into `pin_embedding`.
 *
 * Both call `services/pin-embed` over the private network (PIN_EMBED_URL).
 *
 * Run:  bun run pins:identify
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

// Imported after loadEnv so the module-level PostHog client sees POSTHOG_KEY.
import { flushTelemetry, reportServiceError } from "../shared/telemetry.ts";

import { createServer } from "node:http";

import { Worker } from "bullmq";
import { eq, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { pinEmbedding, pinScan } from "#/db/schema.ts";
import {
  PIN_EMBED_QUEUE,
  PIN_SCAN_QUEUE,
  type PinEmbedJob,
  type PinScanJob,
} from "#/server/notifications/queue.ts";
import { runCascade } from "#/server/pins/cascade.ts";
import { EMBED_MODEL, embedUrls, toVectorLiteral } from "#/server/pins/embed.ts";
import { pinPublicUrl } from "#/server/pins/storage.ts";

let ready = false;

/** Fetch image bytes from R2's public URL for a stored key. */
async function fetchBytes(r2Key: string): Promise<Buffer> {
  const res = await fetch(pinPublicUrl(r2Key), { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`fetch ${r2Key} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Worker 1: the identification cascade.
const scanWorker = new Worker<PinScanJob>(
  PIN_SCAN_QUEUE,
  async (job) => {
    const { scanId } = job.data;
    const scan = await db
      .select()
      .from(pinScan)
      .where(eq(pinScan.id, scanId))
      .limit(1)
      .then((r) => r[0]);
    if (!scan) {
      console.warn(`[pin-scan] job=${job.id} scan=${scanId} not found — skipping`);
      return;
    }

    await db.update(pinScan).set({ status: "processing" }).where(eq(pinScan.id, scanId));
    try {
      const photo = await fetchBytes(scan.photoR2Key);
      const result = await runCascade(photo);
      await db
        .update(pinScan)
        .set({
          status: "ready",
          candidates: result.candidates,
          topConfidence: result.topConfidence,
          stageResolved: result.stageResolved,
          resolvedAt: new Date(),
        })
        .where(eq(pinScan.id, scanId));
      console.log(
        `[pin-scan] job=${job.id} scan=${scanId} ready — ${result.candidates.length} candidate(s), top=${result.topConfidence.toFixed(2)}, stage=${result.stageResolved}`,
      );
    } catch (err) {
      await db
        .update(pinScan)
        .set({ status: "failed", error: (err as Error)?.message ?? String(err) })
        .where(eq(pinScan.id, scanId));
      throw err; // let BullMQ record the failure / retry
    }
  },
  { connection: { url: process.env.REDIS_URL }, concurrency: 4 },
);

// Worker 2: reference-image embedding.
const embedWorker = new Worker<PinEmbedJob>(
  PIN_EMBED_QUEUE,
  async (job) => {
    const { pinImageId } = job.data;
    const { rows } = await db.execute<{ pin_id: string; r2_key: string }>(sql`
      SELECT pin_id, r2_key FROM pin_image WHERE id = ${pinImageId}::uuid
    `);
    const img = rows[0];
    if (!img) {
      console.warn(`[pin-embed] job=${job.id} image=${pinImageId} not found — skipping`);
      return;
    }

    const { embeddings } = await embedUrls([pinPublicUrl(img.r2_key)]);
    const vec = embeddings[0];
    if (!vec) throw new Error(`no embedding returned for ${pinImageId}`);

    // Upsert (PK on pin_image_id) so a re-embed overwrites cleanly.
    await db
      .insert(pinEmbedding)
      .values({ pinImageId, pinId: img.pin_id, embedding: vec, model: EMBED_MODEL })
      .onConflictDoUpdate({
        target: pinEmbedding.pinImageId,
        set: { embedding: sql`${toVectorLiteral(vec)}::vector`, model: EMBED_MODEL },
      });
    console.log(`[pin-embed] job=${job.id} image=${pinImageId} embedded (${EMBED_MODEL})`);
  },
  { connection: { url: process.env.REDIS_URL }, concurrency: 4 },
);

scanWorker.on("ready", () => {
  ready = true;
  console.log("[pin-identify] workers ready");
});
// Capture only the terminal failure so BullMQ retries don't flood Error Tracking.
scanWorker.on("failed", (job, err) => {
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    reportServiceError("pin-identify", "pin-scan", err ?? new Error("pin-scan job failed"));
  } else {
    console.error(`[pin-scan] job=${job?.id} failed (attempt ${job?.attemptsMade}):`, err);
  }
});
embedWorker.on("failed", (job, err) => {
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    reportServiceError("pin-identify", "pin-embed", err ?? new Error("pin-embed job failed"));
  } else {
    console.error(`[pin-embed] job=${job?.id} failed (attempt ${job?.attemptsMade}):`, err);
  }
});

const port = Number(process.env.PORT ?? 8080);
createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: ready }));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(port, () => console.log(`[pin-identify] health on :${port}`));

async function shutdown(sig: string) {
  console.log(`[pin-identify] ${sig} received, closing workers…`);
  await Promise.all([scanWorker.close(), embedWorker.close()]);
  await flushTelemetry();
  console.log("[pin-identify] drained, exiting");
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
