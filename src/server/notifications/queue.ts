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
