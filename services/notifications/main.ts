/**
 * parkfi.sh notification worker (Railway service, replica = 1).
 *
 * Long-running process hosting TWO BullMQ workers on one Redis connection:
 *  - `push-notifications` — fans web-push jobs out to a user's devices.
 *  - `stay-alerts` — renders + sends durable, retried stay-alert EMAIL (Resend).
 *
 * Run:  bun run notifications
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

// Imported after loadEnv so the module-level PostHog client sees POSTHOG_KEY.
import { flushTelemetry, reportServiceError } from "../shared/telemetry.ts";

import { createServer } from "node:http";
import { Worker } from "bullmq";

import { sendPush } from "#/server/notifications/push.ts";
import { sendNativePush } from "#/server/notifications/native-push.ts";
import {
  DINING_ALERT_QUEUE,
  STAY_ALERT_QUEUE,
  type DiningAlertJob,
  type StayAlertJob,
} from "#/server/notifications/queue.ts";
import {
  markStayNotificationFailed,
  sendStayNotification,
} from "#/server/notifications/stayMailer.tsx";
import {
  markDiningNotificationFailed,
  sendDiningNotification,
} from "#/server/notifications/diningMailer.tsx";
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
        const ok =
          sub.kind === "fcm"
            ? await sendNativePush(sub, { title, body, url })
            : await sendPush(sub, { title, body, url });
        if (!ok) await removeStale(userId, sub);
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
  // Only capture the terminal failure (retries exhausted) so BullMQ's per-attempt
  // retries don't flood Error Tracking; intermediate attempts just log.
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    reportServiceError("notifications", "push", err ?? new Error("push job failed"));
  } else {
    console.error(`[notifications] job=${job?.id} failed (attempt ${job?.attemptsMade}):`, err);
  }
});

// Second worker: durable stay-alert email. Low concurrency — a slow provider
// must not stall the queue, and email volume is modest vs. push.
const stayWorker = new Worker<StayAlertJob>(
  STAY_ALERT_QUEUE,
  async (job) => {
    await sendStayNotification(job.data.notificationId);
    console.log(`[stay-alerts] job=${job.id} notification=${job.data.notificationId} sent`);
  },
  {
    connection: { url: process.env.REDIS_URL },
    concurrency: 4,
  },
);

stayWorker.on("failed", (job, err) => {
  console.error(`[stay-alerts] job=${job?.id} failed:`, err);
  // On the final attempt, record the terminal failure on the notification row.
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    void markStayNotificationFailed(job.data.notificationId, err?.message ?? String(err));
    reportServiceError("notifications", "stay-alert", err ?? new Error("stay-alert job failed"));
  }
});

// Third worker: durable dining-alert email — same posture as stay alerts.
const diningWorker = new Worker<DiningAlertJob>(
  DINING_ALERT_QUEUE,
  async (job) => {
    await sendDiningNotification(job.data.notificationId);
    console.log(`[dining-alerts] job=${job.id} notification=${job.data.notificationId} sent`);
  },
  {
    connection: { url: process.env.REDIS_URL },
    concurrency: 4,
  },
);

diningWorker.on("failed", (job, err) => {
  console.error(`[dining-alerts] job=${job?.id} failed:`, err);
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    void markDiningNotificationFailed(job.data.notificationId, err?.message ?? String(err));
    reportServiceError(
      "notifications",
      "dining-alert",
      err ?? new Error("dining-alert job failed"),
    );
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
}).listen(port, () => console.log(`[notifications] health on :${port}`));

async function shutdown(sig: string) {
  console.log(`[notifications] ${sig} received, closing workers…`);
  await Promise.all([worker.close(), stayWorker.close(), diningWorker.close()]);
  await flushTelemetry();
  console.log("[notifications] drained, exiting");
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
