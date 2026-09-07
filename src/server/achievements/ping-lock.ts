/**
 * Per-user serialization for the ping pipeline (park-tracking fixes 2,
 * Workstream B ordering guarantee).
 *
 * `ingestPing` is a read-modify-write over `user_geo_state` spread across
 * several statements with no transaction. That was fine with one producer per
 * user (the foreground loop, ≥ 30 s apart); the native presence beacon adds a
 * second producer whose batches replay 30 s-cadence fixes in a burst, and a
 * beacon batch interleaving with a foreground ping would corrupt the dwell
 * anchor state machine (both read the same cursor, both write it).
 *
 * This is an in-process keyed mutex rather than the advisory lock the plan
 * sketched: `ingestPing` doesn't run inside a transaction, so a
 * `pg_advisory_xact_lock` would need the whole body wrapped in one — holding a
 * pooled connection for the duration while the body's statements still ran on
 * other connections. The web tier is a single Nitro process (the same
 * assumption the beacon's in-memory rate limiter makes), so a promise chain per
 * user gives the same mutual exclusion with no DB round-trip. If the tier is
 * ever scaled to more than one replica, swap this for the advisory lock.
 */
const chains = new Map<string, Promise<unknown>>();

/** Run `fn` after every previously-scheduled `fn` for the same key has
 *  settled. Rejections propagate to the caller and never poison the chain. */
export async function withUserLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  // Chain on settle (not on success) so a failed ingest doesn't block the
  // user's next ping forever.
  const run = prev.then(fn, fn);
  // The chain entry never rejects — only the caller's `run` does.
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, settled);
  try {
    return await run;
  } finally {
    // Drop the entry once nothing newer has been chained on, so idle users
    // don't accumulate map entries.
    if (chains.get(key) === settled) chains.delete(key);
  }
}

/** Test/diagnostic: number of keys with an in-flight or pending chain. */
export function pendingLockKeys(): number {
  return chains.size;
}
