import { config as loadEnv } from "dotenv";
import { Queue } from "bullmq";

// See db/index.ts — vite dev doesn't populate process.env from .env files.
if (!process.env.REDIS_URL) loadEnv({ path: [".env.local", ".env"] });

export interface PushJob {
  userId: string;
  title: string;
  body: string;
  url?: string;
}

let _queue: Queue<PushJob> | null = null;

export function getPushQueue(): Queue<PushJob> {
  if (!_queue) {
    _queue = new Queue<PushJob>("push-notifications", {
      connection: { url: process.env.REDIS_URL },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 500,
        removeOnFail: 200,
      },
    });
  }
  return _queue;
}

/**
 * A fired stay alert. Carries only the `notification` row id — the worker loads
 * the full payload + recipient from the DB so the durable log is the source of
 * truth (and the job stays tiny). More retries/backoff than push: a missed
 * money-saving email is unacceptable, so we lean on the queue's durability.
 */
export interface StayAlertJob {
  notificationId: number;
}

export const STAY_ALERT_QUEUE = "stay-alerts";

let _stayQueue: Queue<StayAlertJob> | null = null;

export function getStayAlertQueue(): Queue<StayAlertJob> {
  if (!_stayQueue) {
    _stayQueue = new Queue<StayAlertJob>(STAY_ALERT_QUEUE, {
      connection: { url: process.env.REDIS_URL },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 15_000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    });
  }
  return _stayQueue;
}

/**
 * A fired dining alert — same durable-delivery posture as stay alerts (carries
 * only the `dining_notification` row id; the worker loads payload + recipient).
 */
export interface DiningAlertJob {
  notificationId: number;
}

export const DINING_ALERT_QUEUE = "dining-alerts";

let _diningQueue: Queue<DiningAlertJob> | null = null;

export function getDiningAlertQueue(): Queue<DiningAlertJob> {
  if (!_diningQueue) {
    _diningQueue = new Queue<DiningAlertJob>(DINING_ALERT_QUEUE, {
      connection: { url: process.env.REDIS_URL },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 15_000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    });
  }
  return _diningQueue;
}

/**
 * A pin-identification scan. Carries only the `pin_scan` row id — the identify
 * worker loads the photo key + runs the cascade, writing candidates back to the
 * row (the client polls `pinIdentify.result`). Few attempts: a failed scan is
 * surfaced to the user, not silently retried forever.
 */
export interface PinScanJob {
  scanId: string;
}

export const PIN_SCAN_QUEUE = "pin-scan";

let _pinScanQueue: Queue<PinScanJob> | null = null;

export function getPinScanQueue(): Queue<PinScanJob> {
  if (!_pinScanQueue) {
    _pinScanQueue = new Queue<PinScanJob>(PIN_SCAN_QUEUE, {
      connection: { url: process.env.REDIS_URL },
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 3_000 },
        removeOnComplete: 500,
        removeOnFail: 500,
      },
    });
  }
  return _pinScanQueue;
}

/**
 * Embed a reference image into `pin_embedding`. Enqueued by the catalog cron
 * after it upserts a `pin_image`; the worker calls the self-hosted CLIP service
 * and writes the vector. Durable (the catalog seed is a one-shot batch) and
 * idempotent (PK on pin_image_id → upsert).
 */
export interface PinEmbedJob {
  pinImageId: string;
}

export const PIN_EMBED_QUEUE = "pin-embed";

let _pinEmbedQueue: Queue<PinEmbedJob> | null = null;

export function getPinEmbedQueue(): Queue<PinEmbedJob> {
  if (!_pinEmbedQueue) {
    _pinEmbedQueue = new Queue<PinEmbedJob>(PIN_EMBED_QUEUE, {
      connection: { url: process.env.REDIS_URL },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: 2000,
        removeOnFail: 2000,
      },
    });
  }
  return _pinEmbedQueue;
}
