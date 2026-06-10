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
