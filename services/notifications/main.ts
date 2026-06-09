/**
 * parkfi.sh push notification worker (Railway service, replica = 1).
 *
 * Long-running BullMQ worker that dequeues push-notification jobs and fans
 * them out to all registered devices for the target user.
 *
 * Run:  bun run notifications
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { createServer } from "node:http";
import { Worker } from "bullmq";

import { sendPush } from "#/server/notifications/push.ts";
import { getSubsForUser, removeStale } from "#/server/notifications/subscriptions.ts";
import type { PushJob } from "#/server/notifications/queue.ts";

let ready = false;

const worker = new Worker<PushJob>(
  "push-notifications",
  async (job) => {
    const { userId, title, body, url } = job.data;
    const subs = await getSubsForUser(userId);
    await Promise.all(
      subs.map(async (sub) => {
        const ok = await sendPush(sub, { title, body, url });
        if (!ok) await removeStale(userId, sub.endpoint);
      }),
    );
    if (subs.length === 0) {
      console.warn(
        `[notifications] job=${job.id} user=${userId} has NO registered devices — push dropped`,
      );
    } else {
      console.log(`[notifications] job=${job.id} user=${userId} subs=${subs.length}`);
    }
  },
  {
    connection: { url: process.env.REDIS_URL },
    concurrency: 10,
  },
);

worker.on("ready", () => {
  ready = true;
  console.log("[notifications] worker ready");
});
worker.on("failed", (job, err) => {
  console.error(`[notifications] job=${job?.id} failed:`, err);
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
}).listen(port, () => console.log(`[notifications] health on :${port}`));

async function shutdown(sig: string) {
  console.log(`[notifications] ${sig} received, closing worker…`);
  await worker.close();
  console.log("[notifications] drained, exiting");
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
