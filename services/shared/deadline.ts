/**
 * Bound a promise that must not be allowed to hang a one-shot cron.
 *
 * The motivating case is BullMQ: it forces ioredis `maxRetriesPerRequest: null`
 * on its connections, so when Redis is unreachable `queue.add()` never rejects —
 * the command sits in the offline queue and the caller waits forever. A
 * `try/catch` around it cannot help, because nothing is ever thrown. A cron that
 * awaits such a call never reaches `process.exit`, so the container stays alive
 * until the platform replaces it on the next schedule — which is how the WDW
 * dining sweep silently stopped producing data for six weeks (2026-06-16 →
 * 2026-09-08).
 *
 * Losing the raced work is fine here: every caller treats the bounded step as
 * best-effort and has already flushed its primary output.
 */
export function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms deadline`)), ms);
    // Don't let the pending timer itself hold the event loop open.
    timer.unref?.();
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}
