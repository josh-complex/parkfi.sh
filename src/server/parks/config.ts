/**
 * Ingestion config. Reads env with sensible defaults so the worker runs with
 * zero config in dev. All knobs are overridable per Railway service.
 */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  themeparksBase: process.env.THEMEPARKS_BASE ?? "https://api.themeparks.wiki/v1",
  queueTimesBase: process.env.QUEUE_TIMES_BASE ?? "https://queue-times.com",
  disneyAvailabilityBase:
    process.env.DISNEY_AVAILABILITY_BASE ??
    "https://disneyworld.disney.go.com/availability-calendar/api",

  /** How often the worker polls every active park, in ms. */
  pollIntervalMs: num("POLL_INTERVAL_MS", 60_000),
  /** Max parks fetched concurrently within one tick. */
  pollConcurrency: num("POLL_CONCURRENCY", 4),
  /** Per-request fetch timeout, in ms. */
  fetchTimeoutMs: num("FETCH_TIMEOUT_MS", 9_000),

  /**
   * ThemeParks.wiki allows 300 req/min. Hold below that across the process to
   * leave headroom for /schedule and retries.
   */
  themeparksMaxPerMin: num("THEMEPARKS_MAX_PER_MIN", 280),

  /**
   * User-Agent sent to upstreams. Disney's availability-calendar rejects empty
   * UAs; be a polite, identifiable client.
   */
  userAgent:
    process.env.INGEST_USER_AGENT ?? "parkfi.sh/1.0 (+https://parkfi.sh; theme-park data platform)",
} as const;
