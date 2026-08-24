/**
 * Data-driven park report pipeline (Railway cron, bidaily — e.g. "0 10,22 * * *").
 * Plan: docs/plans/blog-data-reports.md.
 *
 * The first-party counterpart to cron-park-news: instead of summarizing other
 * outlets' RSS, this narrates OUR telemetry. Each run:
 *
 *   1. DETECT — deterministic SQL over our own tables (downtime episodes from
 *      `attraction_status_obs`, per-venue menu churn from the dining change
 *      logs, price moves from the change-only price ledgers) writes newsworthy
 *      facts to the `report_event` ledger. Idempotent via the event identity
 *      key, so runs and lookbacks overlap freely. No LLM anywhere in this step.
 *   2. COMPOSE — when a resort's unconsumed events cross the score floor (or
 *      age out), the events are assembled into a JSON brief of precomputed
 *      numbers and ONE model call narrates it into a digest draft
 *      (`blog_post`, status 'draft'). The same human approval gate at
 *      /admin/blog reviews it before publish.
 *
 * The model is deliberately given NO web search and NO media palette: every
 * number in the post must come from the brief, so a data post can't hallucinate
 * a source — the opposite tradeoff from the news drafter. Detection still runs
 * without GEMINI_API_KEY (the ledger keeps accruing); only composing needs it.
 *
 * Run:  bun run cron:park-report
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

// Imported after loadEnv so the module-level PostHog client sees POSTHOG_KEY.
import { flushTelemetry, reportServiceError } from "../shared/telemetry.ts";

import { createHash } from "node:crypto";

import { GoogleGenAI, ServiceTier, ThinkingLevel } from "@google/genai";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { blogPost, reportEvent } from "#/db/schema.ts";
import {
  detectDowntimeEpisodes,
  detectMenuChangeRollups,
  detectPriceChanges,
  persistReportEvents,
  type ReportEventKind,
} from "#/server/report/detectors.ts";
import { fillMissingThumbhashes } from "#/server/parks/thumbhash.ts";

const MODEL = process.env.REPORT_MODEL ?? "gemini-3.5-flash";

// --- Detector thresholds -----------------------------------------------------
/** Downtime scan window. Bidaily cadence + margin so nothing falls between runs. */
const LOOKBACK_HOURS = Number(process.env.REPORT_LOOKBACK_HOURS ?? 78);
/** Shortest DOWN episode worth an event (park ops churn under this is noise). */
const DOWNTIME_MIN_MINUTES = Number(process.env.REPORT_DOWNTIME_MIN_MINUTES ?? 45);
const MENU_LOOKBACK_DAYS = Number(process.env.REPORT_MENU_LOOKBACK_DAYS ?? 4);
/** Menu events below this many changes/day/venue never leave SQL. */
const MENU_MIN_CHANGES = Number(process.env.REPORT_MENU_MIN_CHANGES ?? 3);
const PRICE_LOOKBACK_DAYS = Number(process.env.REPORT_PRICE_LOOKBACK_DAYS ?? 4);
/** Ignore sub-percent price jitter. */
const PRICE_MIN_PCT = Number(process.env.REPORT_PRICE_MIN_PCT ?? 1);

// --- Composer gates ----------------------------------------------------------
/**
 * A resort's unconsumed events must sum past this score to draft a digest…
 * Calibration (measured 2026-08-23): a typical August day accrues ~3k score per
 * resort (~30 qualifying downtime episodes/day across both resorts, avg score
 * ~100, plus menu rollups), so 3500 ≈ one digest per resort every 1–1.5 days.
 * Every run logs the backlog score, so tune from the logs, not from guesses.
 */
const SCORE_FLOOR = Number(process.env.REPORT_SCORE_FLOOR ?? 3500);
/** …or the oldest event ages past this (with at least MIN_EVENTS accrued). */
const MAX_AGE_DAYS = Number(process.env.REPORT_MAX_AGE_DAYS ?? 7);
const MIN_EVENTS = Number(process.env.REPORT_MIN_EVENTS ?? 3);
/** Brief size cap so a busy week doesn't blow the prompt. Highest score wins. */
const MAX_EVENTS_PER_KIND = Number(process.env.REPORT_MAX_EVENTS_PER_KIND ?? 12);

// Same Gemini plumbing as cron-park-news (see its comments for the rationale).
const SERVICE_TIER =
  (process.env.REPORT_SERVICE_TIER ?? "flex").toLowerCase() === "flex"
    ? ServiceTier.FLEX
    : undefined;
const THINKING_LEVELS: Record<string, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};
const THINKING_LEVEL =
  THINKING_LEVELS[(process.env.REPORT_THINKING_LEVEL ?? "low").toLowerCase()] ?? ThinkingLevel.LOW;
const MAX_OUTPUT_TOKENS = Number(process.env.REPORT_MAX_OUTPUT_TOKENS ?? 16_000);
const REQUEST_TIMEOUT_MS = Number(process.env.REPORT_REQUEST_TIMEOUT_MS ?? 180_000);

const SYSTEM = `You are a staff writer for ParkFi, a live Orlando theme-park wait-times and trip-planning site. You turn a structured brief of ParkFi's OWN measured park data into an original, genuinely useful report post. This is first-party reporting: ParkFi's trackers measured every number in the brief, and nobody else has this data — write with that quiet authority.

VOICE:
- Warm, sharp, and concrete — like a friend who loves these parks explaining what actually changed this week. Cut corporate filler. Vary sentence length; contractions are fine.
- Lead with the single most interesting fact in the brief, not a throat-clearing intro.
- Be honest but not cynical: a rough downtime day is worth reporting straight, without doom framing. Most of this is simply useful.
- Where it fits, end a section with what a reader should DO about it (ride it early, check the live board, book before the price date, try the new menu item).

TRUTH GATE — the hard rule of this format:
- EVERY number, name, date, duration, and price in your post must appear in the brief. Never invent, extrapolate, or "roughly" a figure. If the brief doesn't say it, you don't know it.
- Prices in the brief are integer CENTS — convert to dollars (e.g. 3500 -> $35).
- Times in the brief are UTC instants; describe them loosely ("Tuesday afternoon", "midday") rather than quoting exact clock times you'd have to convert.
- Never speculate about WHY something happened (weather, staffing, crowds) — report what we measured. "Went down for 3 hours" is the story; the cause is not yours to guess.
- NO external links, NO images, NO social embeds — this post cites our own measurements only. You may link a related prior ParkFi post inline via its EXACT /blog/<slug> path from the covered list when genuinely relevant.

FORMAT: original wording, Markdown body, ## subheads to group by theme (rides / dining / prices — only the themes the brief actually has), NO H1, no tables. 500–900 words: dense and scannable, not padded. A short bulleted list is fine where several small items cluster.`;

// --- Types -------------------------------------------------------------------

interface EventRow {
  id: number;
  kind: ReportEventKind;
  resortSlug: string;
  parkId: number | null;
  score: number;
  windowStart: string;
  windowEnd: string;
  detectedAt: string;
  payload: Record<string, unknown>;
}

interface ReportDraft {
  title: string;
  dek: string;
  bodyMd: string;
  aiSummary: string;
  tags: string[];
  parkSlugs: string[];
}

const RESORT_NAMES: Record<string, string> = {
  "walt-disney-world": "Walt Disney World",
  "universal-orlando": "Universal Orlando Resort",
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 70);
}

/** Extract the first balanced JSON object from a model response (news-cron twin). */
function extractJsonObject(text: string): string | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return cleaned.slice(start, i + 1);
  }
  return null;
}

function parseReportDraft(text: string): ReportDraft | null {
  const json = extractJsonObject(text);
  if (!json) return null;
  try {
    const obj = JSON.parse(json) as Partial<ReportDraft>;
    if (!obj.title || !obj.dek || !obj.bodyMd) return null;
    return {
      title: obj.title,
      dek: obj.dek,
      bodyMd: obj.bodyMd,
      aiSummary: obj.aiSummary ?? obj.dek,
      tags: Array.isArray(obj.tags) ? obj.tags.slice(0, 4) : [],
      parkSlugs: Array.isArray(obj.parkSlugs) ? obj.parkSlugs : [],
    };
  } catch {
    return null;
  }
}

/** Markdown image (with optional caption line) / inline link / bare-URL lexers. */
const BODY_IMG_RE = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)[^)]*\)([^\S\n]*\n[^\S\n]*\*[^\n]*\*)?/g;
const BODY_LINK_RE = /(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g;
const BARE_URL_LINE_RE = /^https?:\/\/\S+$/;
const INTERNAL_BLOG_RE = /^\/blog\/([a-z0-9-]+)\/?$/;

/**
 * Enforce the data post's truth gate mechanically: strip any image the model
 * smuggled in, drop bare-URL embed lines, and unwrap every link that isn't a
 * verified internal /blog/<slug> — a data post cites our measurements, not the
 * web. Keeps the anchor text so sentences still read.
 */
function sanitizeBody(md: string, validBlogSlugs: Set<string>): string {
  let out = md.replace(BODY_IMG_RE, "");
  out = out
    .split("\n")
    .filter((line) => !BARE_URL_LINE_RE.test(line.trim()))
    .join("\n");
  out = out.replace(BODY_LINK_RE, (full, text: string, href: string) => {
    const m = INTERNAL_BLOG_RE.exec(href);
    return m && validBlogSlugs.has(m[1]) ? full : text;
  });
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

// --- Composer ----------------------------------------------------------------

async function unconsumedEvents(): Promise<EventRow[]> {
  const { rows } = await db.execute<{
    id: string;
    kind: ReportEventKind;
    resort_slug: string;
    park_id: string | null;
    score: number;
    window_start: string;
    window_end: string;
    detected_at: string;
    payload: Record<string, unknown>;
  }>(sql`
    SELECT id, kind, resort_slug, park_id, score, window_start, window_end,
           detected_at, payload
    FROM report_event
    WHERE consumed_by IS NULL
    ORDER BY score DESC
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind,
    resortSlug: r.resort_slug,
    parkId: r.park_id == null ? null : Number(r.park_id),
    score: Number(r.score),
    windowStart: r.window_start,
    windowEnd: r.window_end,
    detectedAt: r.detected_at,
    payload: r.payload,
  }));
}

/** Should this resort's backlog become a post this run? */
function gateDigest(events: EventRow[]): { fire: boolean; reason: string } {
  const total = events.reduce((sum, e) => sum + e.score, 0);
  if (total >= SCORE_FLOOR) return { fire: true, reason: `score ${total} >= ${SCORE_FLOOR}` };
  const oldest = Math.min(...events.map((e) => new Date(e.detectedAt).getTime()));
  const ageDays = (Date.now() - oldest) / 86_400_000;
  if (events.length >= MIN_EVENTS && ageDays >= MAX_AGE_DAYS) {
    return {
      fire: true,
      reason: `weekly floor (${events.length} events, oldest ${ageDays.toFixed(1)}d)`,
    };
  }
  return { fire: false, reason: `score ${total} < ${SCORE_FLOOR}, oldest ${ageDays.toFixed(1)}d` };
}

/** The events the brief carries: per-kind, highest score first, capped. */
function briefEvents(events: EventRow[]): EventRow[] {
  const byKind = new Map<ReportEventKind, EventRow[]>();
  for (const e of events) {
    const list = byKind.get(e.kind) ?? [];
    if (list.length < MAX_EVENTS_PER_KIND) list.push(e);
    byKind.set(e.kind, list);
  }
  return [...byKind.values()].flat();
}

function buildPrompt(
  resortSlug: string,
  events: EventRow[],
  parks: Array<{ slug: string; name: string }>,
  covered: Array<{ slug: string; title: string; aiSummary: string | null }>,
): string {
  const resortName = RESORT_NAMES[resortSlug] ?? resortSlug;
  const windows = events.flatMap((e) => [
    new Date(e.windowStart).getTime(),
    new Date(e.windowEnd).getTime(),
  ]);
  const from = new Date(Math.min(...windows)).toISOString().slice(0, 10);
  const to = new Date(Math.max(...windows)).toISOString().slice(0, 10);

  const section = (kind: ReportEventKind, label: string) => {
    const list = events.filter((e) => e.kind === kind);
    if (list.length === 0) return "";
    const lines = list.map((e) => `- ${JSON.stringify(e.payload)}`).join("\n");
    return `\n${label} (${list.length}):\n${lines}\n`;
  };

  const coveredList =
    covered.length === 0
      ? "(nothing yet)"
      : covered.map((c) => `- "${c.title}" (/blog/${c.slug}): ${c.aiSummary ?? "—"}`).join("\n");
  const slugList = parks.map((p) => `${p.slug} (${p.name})`).join(", ");

  return `ParkFi's trackers measured the following changes at ${resortName} between ${from} and ${to}. Write the report post.

DATA BRIEF (every fact you may cite; prices are integer cents; timestamps are UTC):
${section("downtime_episode", "RIDE DOWNTIME EPISODES — unplanned outages our status tracker recorded (minutes = full outage length; endStatus CLOSED means it never reopened that day; avgWait14d = the ride's typical standby wait, for context on how big a deal the ride is)")}${section("menu_change_rollup", "RESTAURANT MENU CHANGES — items added/removed and price moves our daily menu diff caught, per venue per day")}${section("price_change", "PRICE MOVES — Lightning Lane / Express / ticket price changes our price ledger recorded (datesMoved = how many visit dates the price changed for; samples show oldCents -> newCents per date)")}
We've ALREADY published/drafted these recent posts (don't repeat their angle; link one inline via its exact /blog/<slug> path if genuinely related):
${coveredList}

Group the post by theme with ## subheads, lead with the most interesting single fact, and keep every number traceable to the brief above. Reference a park by its ParkFi slug only from this list: ${slugList || "(none)"}.

Respond with ONLY a JSON object (no code fence), shape:
{
  "title": "specific, data-forward, <70 chars — lead with the most interesting concrete fact",
  "dek": "one-sentence reader summary / meta description, <160 chars",
  "bodyMd": "the post in Markdown (500-900 words) — ## subheads, NO H1, no images, no embeds, no external links",
  "aiSummary": "dense 1-2 sentence FACTUAL summary for our internal dedup index",
  "tags": ["2-4 short lowercase tags"],
  "parkSlugs": ["relevant slugs from the list, or empty"]
}`;
}

/** Hero: the flagship image of the park with the most events (fallback: any). */
async function resortHero(
  resortSlug: string,
  events: EventRow[],
): Promise<{ url: string; alt: string | null } | null> {
  const counts = new Map<number, number>();
  for (const e of events)
    if (e.parkId != null) counts.set(e.parkId, (counts.get(e.parkId) ?? 0) + 1);
  const preferred = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const { rows } = await db.execute<{
    id: string;
    image_url: string | null;
    image_alt: string | null;
  }>(sql`
    SELECT p.id, p.image_url, p.image_alt
    FROM parks p JOIN resorts r ON r.id = p.resort_id
    WHERE r.slug = ${resortSlug} AND p.active = true AND p.image_url IS NOT NULL
  `);
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const pick = preferred.map((id) => byId.get(id)).find(Boolean) ?? rows[0];
  return pick?.image_url ? { url: pick.image_url, alt: pick.image_alt } : null;
}

async function composeDigest(
  ai: GoogleGenAI,
  resortSlug: string,
  events: EventRow[],
): Promise<number | null> {
  const parks = (
    await db.execute<{ slug: string; name: string }>(
      sql`SELECT slug, name FROM parks WHERE active = true ORDER BY name`,
    )
  ).rows;
  const validParkSlugs = new Set(parks.map((p) => p.slug));
  const covered = (
    await db.execute<{ slug: string; title: string; aiSummary: string | null }>(sql`
      SELECT slug, title, ai_summary AS "aiSummary"
      FROM blog_post
      WHERE status IN ('published', 'draft')
        AND created_at >= now() - INTERVAL '45 days'
      ORDER BY created_at DESC
      LIMIT 40
    `)
  ).rows;
  const blogSlugs = new Set(
    (await db.execute<{ slug: string }>(sql`SELECT slug FROM blog_post`)).rows.map((r) => r.slug),
  );

  const chosen = briefEvents(events);
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: buildPrompt(resortSlug, chosen, parks, covered),
    config: {
      systemInstruction: SYSTEM,
      // NO tools: the brief is the entire universe of citable facts.
      thinkingConfig: { thinkingLevel: THINKING_LEVEL },
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      httpOptions: { timeout: REQUEST_TIMEOUT_MS },
      serviceTier: SERVICE_TIER,
    },
  });
  const draft = parseReportDraft(res.text ?? "");
  if (!draft) {
    const u = res.usageMetadata;
    const cand = res.candidates?.[0];
    console.error(
      `[park-report] unparseable draft for ${resortSlug} — ` +
        `finish=${cand?.finishReason ?? "?"} block=${res.promptFeedback?.blockReason ?? "none"} ` +
        `tokens(thought=${u?.thoughtsTokenCount ?? "?"}, answer=${u?.candidatesTokenCount ?? "?"}) ` +
        `raw head: ${(res.text ?? "(empty)").slice(0, 200)}`,
    );
    return null; // events stay unconsumed; the next run retries
  }

  draft.bodyMd = sanitizeBody(draft.bodyMd, blogSlugs);
  const parkSlugs = draft.parkSlugs.filter((s) => validParkSlugs.has(s));
  // 'park-report' identifies the format everywhere (browse filter, ops queries).
  const tags = [...new Set(["park-report", ...draft.tags.map((t) => t.toLowerCase())])].slice(0, 5);
  const hero = await resortHero(resortSlug, events);
  const slug = `${slugify(draft.title)}-${sha256(events.map((e) => e.id).join(",")).slice(0, 6)}`;

  const [post] = await db
    .insert(blogPost)
    .values({
      slug,
      title: draft.title,
      dek: draft.dek,
      bodyMd: draft.bodyMd,
      aiSummary: draft.aiSummary,
      status: "draft",
      tags,
      parkSlugs,
      sourceUrls: [],
      heroImageUrl: hero?.url ?? null,
      heroImageAlt: hero?.alt ?? null,
      heroImageCredit: hero ? (RESORT_NAMES[resortSlug] ?? null) : null,
      model: MODEL,
    })
    .returning({ id: blogPost.id });
  if (!post) return null;

  // Consume the resort's ENTIRE backlog, not just the events the brief carried:
  // the digest represents "caught up through now", and letting the sub-cap tail
  // linger would eventually age-gate a post made of stale crumbs.
  await db
    .update(reportEvent)
    .set({ consumedBy: post.id })
    .where(and(eq(reportEvent.resortSlug, resortSlug), isNull(reportEvent.consumedBy)));

  console.log(
    `[park-report] drafted "${draft.title}" (${slug}) from ${chosen.length}/${events.length} event(s)`,
  );
  return post.id;
}

// --- Main --------------------------------------------------------------------

async function main() {
  // 1) Detect. Each detector is isolated — one failing never loses the others.
  const detectors: Array<
    [string, () => Promise<import("#/server/report/detectors.ts").ReportEventInput[]>]
  > = [
    [
      "downtime",
      () =>
        detectDowntimeEpisodes({ lookbackHours: LOOKBACK_HOURS, minMinutes: DOWNTIME_MIN_MINUTES }),
    ],
    [
      "menu",
      () =>
        detectMenuChangeRollups({ lookbackDays: MENU_LOOKBACK_DAYS, minChanges: MENU_MIN_CHANGES }),
    ],
    [
      "prices",
      () => detectPriceChanges({ lookbackDays: PRICE_LOOKBACK_DAYS, minPctMove: PRICE_MIN_PCT }),
    ],
  ];
  for (const [step, run] of detectors) {
    try {
      const found = await run();
      const inserted = await persistReportEvents(found);
      console.log(`[park-report] ${step}: ${found.length} detected, ${inserted} new`);
    } catch (err) {
      reportServiceError("cron-park-report", step, err);
    }
  }

  // 2) Compose.
  if (!process.env.GEMINI_API_KEY) {
    console.warn("[park-report] GEMINI_API_KEY unset — detectors ran, skipping compose");
    return;
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const backlog = await unconsumedEvents();
  const byResort = new Map<string, EventRow[]>();
  for (const e of backlog) {
    byResort.set(e.resortSlug, [...(byResort.get(e.resortSlug) ?? []), e]);
  }
  if (byResort.size === 0) {
    console.log("[park-report] no unconsumed events");
    return;
  }

  for (const [resortSlug, events] of byResort) {
    const gate = gateDigest(events);
    console.log(
      `[park-report] ${resortSlug}: ${events.length} unconsumed event(s) — ` +
        `${gate.fire ? "COMPOSING" : "holding"} (${gate.reason})`,
    );
    if (!gate.fire) continue;
    try {
      await composeDigest(ai, resortSlug, events);
    } catch (err) {
      reportServiceError("cron-park-report", `compose:${resortSlug}`, err);
    }
  }

  // ThumbHash placeholders for any hero written above (idempotent, best-effort).
  try {
    const { hashed, failed } = await fillMissingThumbhashes();
    if (hashed || failed)
      console.log(`[park-report] thumbhashes: ${hashed} computed, ${failed} failed`);
  } catch (err) {
    reportServiceError("cron-park-report", "thumbhashes", err);
  }
}

main()
  .catch((err) => {
    reportServiceError("cron-park-report", "main", err);
    process.exitCode = 1;
  })
  // Flush queued PostHog events BEFORE exiting — process.exit would drop them.
  .finally(async () => {
    await flushTelemetry();
    process.exit(process.exitCode ?? 0);
  });
