/**
 * Park-news → LLM draft pipeline (Railway cron, e.g. hourly or "0 *&#47;2 * * *").
 *
 * Pulls Orlando theme-park RSS feeds, dedupes against `news_item`, and asks a
 * cheap model (Gemini Flash) to write ORIGINAL analysis for genuinely new items —
 * not a rewrite of the source. Each post is inserted as a `blog_post` DRAFT; a human
 * approves it in /admin/blog before it ever publishes. That review gate is
 * deliberate: Google penalizes unedited bulk AI content, so nothing reaches the
 * index without a person in the loop.
 *
 * Natural cadence by design: the model is shown what we've already covered (via
 * each post's `aiSummary`) and SKIPS items that are redundant — so a quiet news
 * day produces zero drafts rather than filler. Only recent items are considered.
 *
 * Guardrails: browser User-Agent (these sites 403 default agents), recency
 * window, per-run cap, records every seen item, no-ops without GEMINI_API_KEY.
 *
 * Run:  bun run cron:park-news
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { createHash } from "node:crypto";

import { GoogleGenAI, ServiceTier } from "@google/genai";
import { inArray, sql } from "drizzle-orm";
import Parser from "rss-parser";

import { db } from "#/db/index.ts";
import { blogPost, newsItem } from "#/db/schema.ts";
import { parseSocialUrl, socialExists } from "#/server/blog/embeds.ts";

const MODEL = process.env.NEWS_MODEL ?? "gemini-3.5-flash";
/** Safety cap on drafts per run — a ceiling, not a target (skips yield fewer). */
const MAX_DRAFTS_PER_RUN = Number(process.env.NEWS_MAX_DRAFTS ?? 3);
/** Ignore items older than this so a quiet day / first run doesn't flood. */
const MAX_AGE_DAYS = Number(process.env.NEWS_MAX_AGE_DAYS ?? 4);
/** Browser-like UA — WDWMagic / Disney / Akamai 403 the default fetch agent. */
const UA =
  process.env.NEWS_USER_AGENT ??
  "Mozilla/5.0 (compatible; ParkFiNewsBot/1.0; +https://parkfi.sh/blog)";

/** Give the model Google Search grounding so it can verify + add context. */
const WEB_SEARCH = (process.env.NEWS_WEB_SEARCH ?? "1") !== "0";

/**
 * Service tier. Flex is the cheap tier for background work — but it's PAID-TIER
 * ONLY (free-tier keys 429 if you request it). Set NEWS_SERVICE_TIER=standard
 * (or anything but "flex") on a free-tier key. Default flex.
 */
const SERVICE_TIER =
  (process.env.NEWS_SERVICE_TIER ?? "flex").toLowerCase() === "flex" ? ServiceTier.FLEX : undefined;

/**
 * Output ceiling AND thinking budget. Gemini 3 is a thinking model and thought
 * tokens count toward maxOutputTokens — so with AUTOMATIC thinking (-1) a long,
 * complex prompt can burn the entire budget on thoughts and return an EMPTY
 * answer. We cap thinking and give the answer comfortable headroom on top.
 * Override either via env if a future model needs more/less room.
 */
const MAX_OUTPUT_TOKENS = Number(process.env.NEWS_MAX_OUTPUT_TOKENS ?? 12_000);
const THINKING_BUDGET = Number(process.env.NEWS_THINKING_BUDGET ?? 4096);

const SYSTEM = `You are a staff writer for ParkFi, a live Orlando theme-park wait-times and trip-planning site. You turn ONE incoming news item into an original, genuinely useful analysis post. Write like a sharp human who actually goes to these parks — not a press release, not a content farm.

VOICE — this is the part that matters most:
- Have a point of view. Lead with what's actually interesting or what readers should DO about it, not a throat-clearing "Just in time for…" intro. Cut corporate filler ("exciting", "magical experience", "perfect for the whole family", "be sure to").
- Be concrete and specific over generic. Real wait-time numbers, real dates, real prices, the actual catch — not vague enthusiasm.
- Vary sentence length. A short punchy line is fine. Contractions are fine. A little dry wit is fine. Sounding like a brochure is not.

SUBSTANCE:
- Add value the source didn't. Use Google Search to add verifiable context the feed snippet lacked — official confirmations, dates, prior history, related projects, pricing — and to find a primary source.
- QUOTES: if Search surfaces a REAL, verifiable direct quote (a Disney/Universal exec, an Imagineer, an official press release), include ONE as a Markdown blockquote with attribution: "> ...quote...\\n>\\n> — Name, title". Never invent or paraphrase a quote into quotation marks. No real quote found = no quote. Don't force it.
- BACKLINKS: weave 1–2 contextual links INLINE in the prose (not just a list at the end) — to a closely related prior ParkFi post via its /blog/<slug> path when one fits, and to an authoritative external page (official park site, the primary source) where it helps the reader.
- Tie it to what ParkFi readers care about: crowds, wait times, Lightning Lane, dining, trip timing — only where it's honestly relevant. Skip the tie-in if it's a stretch.

IMAGES (inline, in the body):
- Include 1–2 relevant images INSIDE the body using Markdown: ![descriptive alt](https://image-url). Right after each image add an italic credit line: *Photo: Source Name* (link the source name if you have its URL).
- Use Google Search to find real, directly relevant image URLs (a press photo, the ride, the food item, the resort). Prefer official/press sources. Use ONLY a URL you actually found in a search result — NEVER guess, pattern-match, or fabricate an image path. Every image URL is fetched before publish and silently dropped if it 404s, so a guessed link just vanishes — it doesn't help you.
- Don't decorate for the sake of it: an image must show the actual thing the post is about.

EMBEDS (social posts) — OPTIONAL:
- Only relevant when you reference a specific viral video or social post (TikTok, YouTube, Instagram, or X). If you do, find its REAL URL via Search and put it on its OWN line — just the bare URL, nothing else. We turn it into a clean embedded player.
- An embed is never required. If you can't find a real, relevant post, OMIT it entirely — most posts won't have one, and that's fine. Never force one in or invent a URL to satisfy this instruction.
- Same rule as images: only embed a post you actually found. Every embed is verified to exist before publish and dropped if it doesn't, so a fabricated link is wasted. One well-chosen embed beats a vague "it went viral on TikTok".

TRUTH ONLY. Every claim, quote, date, number, image, and embed must trace to a real source. If you can't verify it, leave it out. Never invent attendance figures, prices, or quotes.

FORMAT: original wording (never copy/closely paraphrase the source), Markdown body, ## subheads ok, NO H1. 550–800 words — room to actually develop the angle, not padded filler. Cite EVERY source you used (original + anything from Search) in "extraSources".`;

/**
 * RSS feeds to pull. Override with NEWS_FEEDS (comma-separated).
 * Disney Parks Blog + Orlando Informer feed URLs are confirmed; the WDWMagic
 * news-feed path is best-effort (its site bot-blocks discovery) — if it 403s/404s
 * on the first run, the per-feed error logs and you can swap it via NEWS_FEEDS.
 */
const DEFAULT_FEEDS: Array<{ source: string; url: string }> = [
  // Official
  { source: "Disney Parks Blog", url: "https://disneyparks.disney.go.com/blog/feed/" },
  // News (high-volume, Disney + Universal Orlando)
  { source: "WDW News Today", url: "https://wdwnt.com/feed/" },
  { source: "Blog Mickey", url: "https://blogmickey.com/feed/" },
  { source: "Inside the Magic", url: "https://insidethemagic.net/feed/" },
  { source: "Attractions Magazine", url: "https://attractionsmagazine.com/feed/" },
  { source: "AllEars", url: "https://allears.net/feed/" },
  // Universal Orlando focus
  { source: "Orlando Informer", url: "https://orlandoinformer.com/category/blog/feed/" },
  // Planning / food (trip-impact angles)
  { source: "Disney Tourist Blog", url: "https://www.disneytouristblog.com/feed/" },
  { source: "Disney Food Blog", url: "https://www.disneyfoodblog.com/feed/" },
];

function feeds(): Array<{ source: string; url: string }> {
  const env = process.env.NEWS_FEEDS;
  if (!env) return DEFAULT_FEEDS;
  return env
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean)
    .map((url) => ({ source: new URL(url).hostname, url }));
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 70);
}

/** Words kept lowercase in titles unless they're the first/last word (or open a clause). */
const TITLE_SMALL = new Set(
  "a an and as at but by for from if in into nor of off on onto or over per the to up via vs with yet".split(
    " ",
  ),
);

function titleCaseWord(w: string, force: boolean): string {
  if (!w) return w;
  // Preserve tokens that already carry meaningful inner caps — acronyms (EPCOT)
  // and brand casing (TikTok, McDuck, Disney's) shouldn't be flattened.
  if (/[A-Z]/.test(w.slice(1))) return w;
  const lower = w.toLowerCase();
  if (!force && TITLE_SMALL.has(lower)) return lower;
  return lower.replace(/[a-z]/, (c) => c.toUpperCase()); // first alpha char
}

/** Normalize a model title to consistent AP-ish title case. */
function titleCase(s: string): string {
  const words = s.trim().split(/\s+/);
  const last = words.length - 1;
  return words
    .map((w, i) =>
      // Force a capital on the first/last word and the first word after a colon
      // or sentence-ending punctuation.
      titleCaseWord(w, i === 0 || i === last || /[:?!.—–]$/.test(words[i - 1] ?? "")),
    )
    .join(" ");
}

/**
 * Does this URL resolve to a real image? The model sometimes invents
 * plausible-looking image paths that 404; this is the gate that keeps a broken
 * <img> out of a published post. HEAD first (cheap), then a ranged GET for
 * hosts that don't support HEAD. Any failure → treat as not-an-image.
 */
async function isLiveImage(url: string): Promise<boolean> {
  const isImage = (res: Response) =>
    (res.headers.get("content-type") ?? "").toLowerCase().startsWith("image/");
  try {
    const head = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (head.ok && isImage(head)) return true;
    // 2xx with no/odd content-type, or HEAD unsupported (403/405): confirm via GET.
  } catch {
    /* fall through to GET */
  }
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA, Range: "bytes=0-1023", Accept: "image/*" },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    return res.ok && isImage(res);
  } catch {
    return false;
  }
}

/** Matches a Markdown image and an optional italic credit line right after it. */
const BODY_IMG_RE = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)[^)]*\)([^\S\n]*\n[^\S\n]*\*[^\n]*\*)?/g;

/**
 * Scrub a draft body of media that won't actually load: dead inline images
 * (dropped with their credit line) and social embeds that don't verify. Returns
 * the cleaned Markdown. This runs before insert so a human never has to catch a
 * broken image or a fabricated TikTok link in review.
 */
async function validateBodyMedia(md: string): Promise<string> {
  // 1) Inline images.
  const imgUrls = [...new Set([...md.matchAll(BODY_IMG_RE)].map((m) => m[1]))];
  const live = new Map(
    await Promise.all(imgUrls.map(async (u) => [u, await isLiveImage(u)] as const)),
  );
  const deadImgs = imgUrls.filter((u) => !live.get(u)).length;
  let out = md.replace(BODY_IMG_RE, (full, url: string) => (live.get(url) ? full : ""));

  // 2) Social embeds (bare post URL on its own line) — verify each exists.
  const checked = await Promise.all(
    out.split("\n").map(async (line) => {
      const embed = parseSocialUrl(line.trim());
      if (!embed) return line;
      return (await socialExists(embed, UA)) ? line : null;
    }),
  );
  const deadEmbeds = checked.filter((l) => l === null).length;
  out = checked.filter((l) => l !== null).join("\n");

  if (deadImgs) console.log(`[park-news]   dropped ${deadImgs} dead inline image(s)`);
  if (deadEmbeds) console.log(`[park-news]   dropped ${deadEmbeds} unverified embed(s)`);
  // Collapse the blank gaps left behind.
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

interface FeedItem {
  source: string;
  title: string;
  url: string;
  summary: string;
  publishedAt: Date | null;
}

interface OgImage {
  url: string;
  alt: string | null;
}

function metaContent(html: string, ...keys: string[]): string | null {
  for (const key of keys) {
    // property="og:image" content="..."  OR  content="..." property="og:image"
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key.replace(/[:]/g, "\\$&")}["'][^>]*>`,
      "i",
    );
    const tag = re.exec(html)?.[0];
    const content = tag && /content=["']([^"']+)["']/i.exec(tag)?.[1];
    if (content) return content.trim();
  }
  return null;
}

/**
 * Pull the source article's OpenGraph image. News sites publish og:image
 * expecting it to be shown when their article is linked/shared — which is
 * exactly what we do (we credit + link them as a source), so it's the most
 * defensible hero. Best-effort: a failure just leaves the post image-less.
 */
async function fetchOgImage(pageUrl: string): Promise<OgImage | null> {
  try {
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    // Only need the <head>; cap the read so a huge page doesn't stall the run.
    const html = (await res.text()).slice(0, 200_000);
    const raw = metaContent(html, "og:image:secure_url", "og:image", "twitter:image");
    if (!raw) return null;
    const url = new URL(raw, pageUrl).toString(); // resolve protocol-relative / relative
    if (!/^https?:\/\//i.test(url)) return null;
    return { url, alt: metaContent(html, "og:image:alt", "twitter:image:alt") };
  } catch {
    return null;
  }
}

/** Record an item as considered so it isn't reprocessed (idempotent). */
async function recordSeen(item: FeedItem, clusteredInto?: number): Promise<void> {
  await db
    .insert(newsItem)
    .values({
      source: item.source,
      url: item.url,
      urlHash: sha256(item.url),
      title: item.title,
      summary: item.summary,
      publishedAt: item.publishedAt,
      clusteredInto: clusteredInto ?? null,
    })
    .onConflictDoNothing({ target: newsItem.urlHash });
}

async function pullCandidates(): Promise<FeedItem[]> {
  const parser = new Parser({ timeout: 15_000, headers: { "User-Agent": UA } });
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  const all: FeedItem[] = [];
  for (const feed of feeds()) {
    try {
      const parsed = await parser.parseURL(feed.url);
      for (const item of parsed.items) {
        if (!item.link || !item.title) continue;
        const publishedAt = item.isoDate ? new Date(item.isoDate) : null;
        // Recency gate: skip stale items (and undated ones, to be safe).
        if (!publishedAt || publishedAt.getTime() < cutoff) continue;
        all.push({
          source: feed.source,
          title: item.title.trim(),
          url: item.link.trim(),
          summary: (item.contentSnippet ?? item.content ?? "").slice(0, 600),
          publishedAt,
        });
      }
    } catch (err) {
      console.error(`[park-news] feed failed: ${feed.url}`, err);
    }
  }

  if (all.length === 0) return [];

  // Drop items we've already seen (WITHOUT recording new ones — we only mark an
  // item seen once we actually consider it, so a per-run cap doesn't silently
  // burn the backlog; unconsidered items resurface next run).
  const seenRows = await db
    .select({ h: newsItem.urlHash })
    .from(newsItem)
    .where(
      inArray(
        newsItem.urlHash,
        all.map((i) => sha256(i.url)),
      ),
    );
  const seen = new Set(seenRows.map((r) => r.h));
  const unseen = all.filter((i) => !seen.has(sha256(i.url)));

  unseen.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  return unseen.slice(0, MAX_DRAFTS_PER_RUN);
}

type RecentPost = {
  slug: string;
  title: string;
  aiSummary: string | null;
};

async function recentCoverage(): Promise<RecentPost[]> {
  const { rows } = await db.execute<RecentPost>(sql`
    SELECT slug, title, ai_summary AS "aiSummary"
    FROM blog_post
    WHERE status IN ('published', 'draft')
      AND created_at >= now() - INTERVAL '45 days'
    ORDER BY created_at DESC
    LIMIT 40
  `);
  return rows;
}

interface Source {
  title: string;
  url: string;
}

interface HeroImage {
  url: string;
  alt?: string;
  credit?: string;
  creditUrl?: string;
}

interface DraftJson {
  skip?: boolean;
  title: string;
  dek: string;
  bodyMd: string;
  aiSummary: string;
  tags: string[];
  parkSlugs: string[];
  extraSources: Source[];
  heroImage: HeroImage | null;
}

/** A model-suggested hero is only a fallback; the source og:image is preferred. */
function cleanHero(v: unknown): HeroImage | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.url !== "string" || !/^https?:\/\//.test(o.url)) return null;
  return {
    url: o.url,
    alt: typeof o.alt === "string" ? o.alt : undefined,
    credit: typeof o.credit === "string" ? o.credit : undefined,
    creditUrl:
      typeof o.creditUrl === "string" && /^https?:\/\//.test(o.creditUrl) ? o.creditUrl : undefined,
  };
}

/** Keep only well-formed {title,url} source objects (cap to avoid runaway). */
function cleanSources(v: unknown): Source[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (s): s is Source =>
        typeof s?.title === "string" && typeof s?.url === "string" && /^https?:\/\//.test(s.url),
    )
    .slice(0, 6);
}

function buildPrompt(
  item: FeedItem,
  parks: Array<{ slug: string; name: string }>,
  covered: RecentPost[],
): string {
  const slugList = parks.map((p) => `${p.slug} (${p.name})`).join(", ");
  const coveredList =
    covered.length === 0
      ? "(nothing yet)"
      : covered.map((c) => `- "${c.title}" (/blog/${c.slug}): ${c.aiSummary ?? "—"}`).join("\n");

  return `A theme-park news item just came in:

Source: ${item.source}
Headline: ${item.title}
Summary: ${item.summary}
URL: ${item.url}

We've ALREADY published/drafted these recent posts (do not repeat their angle):
${coveredList}

If this item is already substantially covered above, or isn't genuinely
newsworthy on its own, respond with exactly {"skip": true} and nothing else.

Otherwise research it (per your instructions) and write the post (550–800 words):
real voice, inline backlinks, a verifiable quote if one exists, 1–2 relevant
inline images (Markdown, with an italic credit line under each), and an embedded
social post on its own line if you reference a specific one. When it fits, link a
closely related prior post inline using its /blog/<slug> path. Reference a park
by its ParkFi slug only from this list (we link it internally): ${slugList || "(none)"}.

Respond with ONLY a JSON object (no code fence), shape:
{
  "skip": false,
  "title": "compelling, specific, <70 chars",
  "dek": "one-sentence reader summary / meta description, <160 chars",
  "bodyMd": "the post in Markdown (550–800 words) — ## subheads ok, NO H1, inline ![alt](url) images each followed by an italic *Photo: ...* credit, a > blockquote for any real quote, and a bare social-post URL on its own line to embed one",
  "aiSummary": "dense 1-2 sentence FACTUAL summary for our internal dedup index",
  "tags": ["2-4 short lowercase tags"],
  "parkSlugs": ["relevant slugs from the list, or empty"],
  "heroImage": {"url": "https://...", "alt": "...", "credit": "Source Name", "creditUrl": "https://..."},  // a strong lead image; null if none found
  "extraSources": [{"title": "...", "url": "https://..."}]  // every source you used beyond the original
}`;
}

/**
 * Extract the JSON object from a model response. Grounded Gemini sometimes wraps
 * it in a ```json fence or adds a stray trailing line, so we strip fences and
 * scan for the first BALANCED top-level object (a naive last-"}" breaks when the
 * body contains braces) — far more robust than indexOf/lastIndexOf.
 */
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
  return null; // unbalanced (e.g. truncated by maxOutputTokens)
}

function parseDraft(text: string): DraftJson | null {
  const json = extractJsonObject(text);
  if (!json) return null;
  try {
    const obj = JSON.parse(json) as Partial<DraftJson>;
    if (obj.skip === true) return { skip: true } as DraftJson;
    if (!obj.title || !obj.dek || !obj.bodyMd) return null;
    return {
      title: obj.title,
      dek: obj.dek,
      bodyMd: obj.bodyMd,
      aiSummary: obj.aiSummary ?? obj.dek,
      tags: Array.isArray(obj.tags) ? obj.tags.slice(0, 4) : [],
      parkSlugs: Array.isArray(obj.parkSlugs) ? obj.parkSlugs : [],
      extraSources: cleanSources(obj.extraSources),
      heroImage: cleanHero(obj.heroImage),
    };
  } catch {
    return null;
  }
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.warn("[park-news] GEMINI_API_KEY unset — skipping draft generation");
    return;
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const parks = (
    await db.execute<{ slug: string; name: string }>(
      sql`SELECT slug, name FROM parks WHERE active = true ORDER BY name`,
    )
  ).rows;
  const validSlugs = new Set(parks.map((p) => p.slug));

  const items = await pullCandidates();
  if (items.length === 0) {
    console.log("[park-news] no new items");
    return;
  }
  const covered = await recentCoverage();

  // Google Search grounding lets the model verify + add context before writing.
  const tools = WEB_SEARCH ? [{ googleSearch: {} }] : undefined;

  let drafted = 0;
  let skipped = 0;
  for (const item of items) {
    try {
      const res = await ai.models.generateContent({
        model: MODEL,
        contents: buildPrompt(item, parks, covered),
        config: {
          systemInstruction: SYSTEM,
          tools,
          // Bound thinking so it can't eat the whole budget (→ empty answer), and
          // leave the answer comfortable headroom on top.
          thinkingConfig: { thinkingBudget: THINKING_BUDGET },
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          // Background cron — latency-insensitive, so prefer the cheap Flex tier
          // (paid-tier only; configurable via NEWS_SERVICE_TIER).
          serviceTier: SERVICE_TIER,
        },
      });
      const draft = parseDraft(res.text ?? "");
      if (!draft) {
        // Surface WHY: an empty body with finishReason=MAX_TOKENS means thinking
        // ate the budget (raise NEWS_MAX_OUTPUT_TOKENS / lower NEWS_THINKING_BUDGET);
        // SAFETY/RECITATION means the prompt was blocked.
        const u = res.usageMetadata;
        console.error(
          `[park-news] unparseable draft for: ${item.title} — ` +
            `finish=${res.candidates?.[0]?.finishReason ?? "?"} ` +
            `tokens(thought=${u?.thoughtsTokenCount ?? "?"}, answer=${u?.candidatesTokenCount ?? "?"}, total=${u?.totalTokenCount ?? "?"}) ` +
            `raw head: ${(res.text ?? "(empty)").slice(0, 200)}`,
        );
        await recordSeen(item); // don't reconsider a persistently unparseable item
        continue;
      }
      if (draft.skip) {
        skipped++;
        await recordSeen(item);
        continue;
      }

      // Normalize the headline to consistent title case, and scrub the body of
      // any dead inline images / unverified embeds before it's ever stored.
      draft.title = titleCase(draft.title);
      draft.bodyMd = await validateBodyMedia(draft.bodyMd);

      const parkSlugs = draft.parkSlugs.filter((s) => validSlugs.has(s));
      const slug = `${slugify(draft.title)}-${sha256(item.url).slice(0, 6)}`;
      // The original feed item leads; researched sources follow (deduped by url).
      const seenUrls = new Set([item.url]);
      const sourceUrls: Source[] = [
        { title: `${item.source}: ${item.title}`, url: item.url },
        ...draft.extraSources.filter((s) => !seenUrls.has(s.url) && seenUrls.add(s.url)),
      ];

      // Hero image: prefer the source article's og:image (deterministic, and we
      // already credit + link that source), falling back to the model's pick —
      // and verify whichever we land on actually loads.
      const og = await fetchOgImage(item.url);
      const ogHero: HeroImage | null = og
        ? { url: og.url, alt: og.alt ?? draft.title, credit: item.source, creditUrl: item.url }
        : null;
      let hero: HeroImage | null = ogHero ?? draft.heroImage;
      if (hero && !(await isLiveImage(hero.url))) {
        hero = hero === ogHero ? draft.heroImage : null;
        if (hero && !(await isLiveImage(hero.url))) hero = null;
      }

      const [post] = await db
        .insert(blogPost)
        .values({
          slug,
          title: draft.title,
          dek: draft.dek,
          bodyMd: draft.bodyMd,
          aiSummary: draft.aiSummary,
          status: "draft",
          tags: draft.tags,
          parkSlugs,
          sourceUrls,
          heroImageUrl: hero?.url ?? null,
          heroImageAlt: hero?.alt ?? null,
          heroImageCredit: hero?.credit ?? null,
          heroImageCreditUrl: hero?.creditUrl ?? null,
          model: MODEL,
        })
        .returning({ id: blogPost.id });

      if (post) {
        await recordSeen(item, post.id);
        drafted++;
        // Let later items in this same run see this one, avoiding intra-run dupes.
        covered.unshift({ slug, title: draft.title, aiSummary: draft.aiSummary });
      }
    } catch (err) {
      // Leave the item unrecorded so a transient API/network failure retries next run.
      console.error(`[park-news] failed on: ${item.title}`, err);
      // Quota exhausted: no point hammering the rest of the batch — stop and let
      // the next scheduled run pick the items back up.
      if ((err as { status?: number })?.status === 429) {
        console.error(
          "[park-news] quota exhausted (429) — stopping. If using Flex, enable billing; " +
            "otherwise set NEWS_SERVICE_TIER=standard and/or lower NEWS_MAX_DRAFTS.",
        );
        break;
      }
    }
  }

  console.log(
    `[park-news] done — ${drafted} draft(s), ${skipped} skipped as covered, from ${items.length} new item(s)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
