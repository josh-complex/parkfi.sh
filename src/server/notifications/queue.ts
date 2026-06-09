import { Queue } from "bullmq";

export interface PushJob {
  userId: string;
  title: string;
  body: string;
  url?: string;
}

export const pushQueue = new Queue<PushJob>("push-notifications", {
  connection: { url: process.env.REDIS_URL },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 500,
    removeOnFail: 200,
  },
});
