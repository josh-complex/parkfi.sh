import { config } from "../parks/config.ts";
import {
  DisneyDineMenuSchema,
  DisneyDiningDetailSchema,
  type DisneyDiningDetail,
  type DisneyDineMenu,
} from "../parks/schemas.ts";
import { UpstreamError } from "../parks/sources/themeparks.ts";

/**
 * Per-venue dining enrichment the weekly catalog cron fetches on top of the
 * `list-ancestor-entities` feed (which carries neither hours nor menus):
 *
 *   • Schedules ← `details-entity-simple/wdw/{urlFriendlyId}/{date}/`, parsed
 *     from `structuredData.openingHoursSpecification[]` (a forward ~7-day week).
 *     Slug-keyed (the finder `urlFriendlyId`, e.g. "jaleo").
 *   • Menus ← `dining/dinemenu/api/menu?searchTerm={facilityId}`, the numeric
 *     facility id (NOT the slug). Flattened meal-period → group → item.
 *
 * Both are cookieless GETs over plain HTTPS, same trust level as the catalog
 * feed. The internal `dineprdsvc…eks…` product URLs in the catalog are NOT
 * usable (internal host); these public paths are the way in.
 */

const DINEMENU_BASE =
  process.env.DISNEY_DINEMENU_BASE ?? "https://disneyworld.disney.go.com/dining/dinemenu/api";

// These two feeds sit behind Akamai bot-manager + AWS API Gateway. A bot-shaped
// User-Agent (the generic `config.userAgent`) plus a high-concurrency burst from
// a datacenter IP gets rate-clamped to 403s — the dinemenu API rejects *every*
// such request. So speak browser: a real Chrome UA + the client hints / fetch
// metadata a browser sends, and retry the soft blocks (403/429/5xx) with
// jittered backoff. The catalog list feed (one call) is untouched.
const DISNEY_WEB_UA =
  process.env.DISNEY_WEB_UA ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const WEB_HEADERS: Record<string, string> = {
  "user-agent": DISNEY_WEB_UA,
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  referer: "https://disneyworld.disney.go.com/dining/",
  "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
};

// Soft blocks worth retrying (Akamai throttle / API Gateway hiccup); a 404 or
// other hard error is not retried.
const RETRY_STATUS = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DiningScheduleRow {
  facilityId: string;
  scheduleDate: string; // YYYY-MM-DD
  scheduleType: string; // "Operating", "Extended Evening", …
  startTime: string; // HH:MM:SS
  endTime: string; // HH:MM:SS
}

export interface DiningMenuItemRow {
  facilityId: string;
  mealPeriod: string;
  groupName: string | null;
  itemType: string | null;
  title: string;
  description: string | null;
  price: number | null;
  priceType: string | null;
  currency: string | null;
}

/**
 * Browser-shaped GET with bounded retry. Each attempt gets its own
 * `fetchTimeoutMs` budget; soft blocks back off with jitter, hard errors throw
 * straight through. `attempts` counts total tries (so 4 = 1 + 3 retries).
 */
async function getJson(url: string, attempts = 4): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(config.fetchTimeoutMs),
        headers: WEB_HEADERS,
      });
      if (res.ok) return await res.json();
      const err = new UpstreamError(`GET ${url} -> ${res.status}`, res.status);
      if (!RETRY_STATUS.has(res.status)) throw err; // hard error — don't retry
      lastErr = err;
    } catch (err) {
      // Non-retryable upstream status bubbles up; network/timeout errors retry.
      if (err instanceof UpstreamError && err.status != null && !RETRY_STATUS.has(err.status)) {
        throw err;
      }
      lastErr = err;
    }
    if (attempt < attempts) {
      const base = 400 * 2 ** (attempt - 1); // 400ms, 800ms, 1600ms …
      await sleep(base + Math.random() * base); // + up to 100% jitter
    }
  }
  throw lastErr;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** "11:30" / "11:30:00" -> "11:30:00"; null when unparseable. */
function normTime(t?: string): string | null {
  const m = (t ?? "").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`;
}

/** Inclusive UTC date walk between two YYYY-MM-DD strings, capped to avoid runaway. */
function datesBetween(from: string, through: string, max = 16): Array<string> {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${through}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return Number.isNaN(start.getTime()) ? [] : [from];
  }
  const out: Array<string> = [];
  for (const d = new Date(start); d <= end && out.length < max; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Expand `openingHoursSpecification[]` into concrete per-date rows. Each entry
 * names a weekday (or several) + opens/closes over a [validFrom, validThrough]
 * window; we emit one row per matching date in that window.
 */
function scheduleRows(
  facilityId: string,
  date: string,
  detail: DisneyDiningDetail,
): Array<DiningScheduleRow> {
  const specs = detail.structuredData?.openingHoursSpecification ?? [];
  const seen = new Set<string>();
  const rows: Array<DiningScheduleRow> = [];
  for (const spec of specs) {
    const start = normTime(spec.opens);
    const end = normTime(spec.closes);
    if (!start || !end) continue; // closed/no-times entries carry no opens/closes
    const days = new Set(
      (Array.isArray(spec.dayOfWeek) ? spec.dayOfWeek : spec.dayOfWeek ? [spec.dayOfWeek] : [])
        .map((d) => d.split("/").filter(Boolean).pop() ?? d) // tolerate schema.org URI form
        .map((d) => d.toLowerCase()),
    );
    const from = spec.validFrom ?? date;
    const through = spec.validThrough ?? spec.validFrom ?? date;
    const type = spec.description?.trim() || "Operating";
    for (const day of datesBetween(from, through)) {
      const weekday = WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()];
      if (days.size > 0 && !days.has(weekday)) continue;
      const key = `${day}|${type}|${start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        facilityId,
        scheduleDate: day,
        scheduleType: type,
        startTime: start,
        endTime: end,
      });
    }
  }
  return rows;
}

export async function fetchDiningSchedule(
  facilityId: string,
  slug: string,
  date: string,
): Promise<Array<DiningScheduleRow>> {
  const url = `${config.disneyFinderBase}/details-entity-simple/wdw/${slug}/${date}/`;
  const detail = DisneyDiningDetailSchema.parse(await getJson(url));
  return scheduleRows(facilityId, date, detail);
}

function menuRows(facilityId: string, menu: DisneyDineMenu): Array<DiningMenuItemRow> {
  const rows: Array<DiningMenuItemRow> = [];
  for (const period of menu.mealPeriods) {
    const mealPeriod = period.name ?? period.label;
    if (!mealPeriod) continue;
    for (const group of period.groups ?? []) {
      for (const item of group.items ?? []) {
        const title = item.title?.trim();
        if (!title) continue;
        // First priced entry (an item may list per-serving + per-glass etc.).
        const priced = (item.prices ?? []).find((p) => p.withoutTax != null);
        rows.push({
          facilityId,
          mealPeriod,
          groupName: group.name ?? null,
          itemType: group.type ?? null,
          title,
          description: item.description?.trim() || null,
          price: priced?.withoutTax ?? null,
          priceType: priced?.type ?? null,
          currency: priced?.currency ?? null,
        });
      }
    }
  }
  return rows;
}

export async function fetchDiningMenu(
  facilityId: string,
  attempts = 4,
): Promise<Array<DiningMenuItemRow>> {
  const url = `${DINEMENU_BASE}/menu?searchTerm=${encodeURIComponent(facilityId)}&language=en-us`;
  const menu = DisneyDineMenuSchema.parse(await getJson(url, attempts));
  return menuRows(facilityId, menu);
}
