import { config } from "./config.ts";

/**
 * In-process token bucket. The worker is a single process, so an in-memory
 * bucket is sufficient to honor ThemeParks.wiki's 300 req/min ceiling.
 *
 * SCALE PATH: if the worker is ever scaled to >1 replica, swap this for a
 * Redis `INCR`+`PEXPIRE` Lua bucket keyed `ratelimit:themeparks` so the
 * ceiling holds across replicas (see the original Railway design).
 */
class TokenBucket {
  private count = 0;
  private windowStart = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  /** Resolves once a token is available, sleeping until the window resets. */
  async take(): Promise<void> {
    // Loop because multiple callers may wake on the same window boundary.
    for (;;) {
      const t = this.now();
      if (t - this.windowStart >= this.windowMs) {
        this.windowStart = t;
        this.count = 0;
      }
      if (this.count < this.max) {
        this.count++;
        return;
      }
      const waitMs = this.windowMs - (t - this.windowStart);
      await new Promise((r) => setTimeout(r, Math.max(waitMs, 5)));
    }
  }
}

export const themeparksBucket = new TokenBucket(config.themeparksMaxPerMin, 60_000, () =>
  Date.now(),
);
