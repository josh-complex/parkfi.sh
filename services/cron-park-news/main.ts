/**
 * Park-news → LLM draft pipeline (Railway cron, e.g. hourly or "0 *&#47;2 * * *").
 *
 * Pulls Orlando theme-park RSS feeds, dedupes against `news_item`, and asks a
 * cheap model (Haiku) to write ORIGINAL analysis for genuinely new items — not a
 * rewrite of the source. Each post is inserted as a `blog_post` DRAFT; a human
 * approves it in /admin/blog before it ever publishes. That review gate is
 * deliberate: Google penalizes unedited bulk AI content, so nothing reaches the
 * index without a person in the loop.
 *
 * Natural cadence by design: the model is shown what we've already covered (via
 * each post's `aiSummary`) and SKIPS items that are redundant — so a quiet news
 * day produces zero drafts rather than filler. Only recent items are considered.
 *
 * Guardrails: browser User-Agent (these sites 403 default agents), recency
 * window, per-run cap, records every seen item, no-ops without ANTHROPIC_API_KEY.
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

const SYSTEM = `You are the editorial writer for ParkFi, a live Orlando theme-park wait-times and trip-planning site. You turn ONE incoming news item into a short, original analysis post.

How to work:
- Add value the source didn't. Do LIGHT extra research with Google Search to add verifiable context the feed snippet lacked — official confirmations, dates, prior history, related projects, pricing.
- TRUTH ONLY. Every claim must be verifiable from a real source. If you cannot verify something, leave it out. Never invent quotes, dates, numbers, or attendance figures.
- Original wording — never copy or closely paraphrase the source.
- Tie it to what ParkFi readers care about: crowds, wait times, Lightning Lane, dining, trip timing — only where it's honestly relevant.
- Cite EVERY source you actually used (the original item plus anything you found via search) in "extraSources".
- Tight: 250–450 words, Markdown body, no H1, no images.`;

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
  { source: "WDWMagic", url: "https://www.wdwmagic.com/feed" }, // best-effort path
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

interface FeedItem {
  source: string;
  title: string;
  url: string;
  summary: string;
  publishedAt: Date | null;
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

interface DraftJson {
  skip?: boolean;
  title: string;
  dek: string;
  bodyMd: string;
  aiSummary: string;
  tags: string[];
  parkSlugs: string[];
  extraSources: Source[];
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

Otherwise research it lightly (per your instructions) and write the post. When
it adds value, link to a closely related prior post inline using its /blog/<slug>
path. Reference a park by its ParkFi slug only from this list (we link it
internally): ${slugList || "(none)"}.

Respond with ONLY a JSON object (no code fence), shape:
{
  "skip": false,
  "title": "compelling, specific, <70 chars",
  "dek": "one-sentence reader summary / meta description, <160 chars",
  "bodyMd": "the post in Markdown (## subheads ok, no H1, no images)",
  "aiSummary": "dense 1-2 sentence FACTUAL summary for our internal dedup index",
  "tags": ["2-4 short lowercase tags"],
  "parkSlugs": ["relevant slugs from the list, or empty"],
  "extraSources": [{"title": "...", "url": "https://..."}]  // every source you used beyond the original
}`;
}

function parseDraft(text: string): DraftJson | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Partial<DraftJson>;
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
          maxOutputTokens: 2500,
          // Background cron — latency-insensitive, so use the cheaper Flex tier.
          serviceTier: ServiceTier.FLEX,
        },
      });
      const draft = parseDraft(res.text ?? "");
      if (!draft) {
        console.error(`[park-news] unparseable draft for: ${item.title}`);
        await recordSeen(item); // don't reconsider a persistently unparseable item
        continue;
      }
      if (draft.skip) {
        skipped++;
        await recordSeen(item);
        continue;
      }

      const parkSlugs = draft.parkSlugs.filter((s) => validSlugs.has(s));
      const slug = `${slugify(draft.title)}-${sha256(item.url).slice(0, 6)}`;
      // The original feed item leads; researched sources follow (deduped by url).
      const seenUrls = new Set([item.url]);
      const sourceUrls: Source[] = [
        { title: `${item.source}: ${item.title}`, url: item.url },
        ...draft.extraSources.filter((s) => !seenUrls.has(s.url) && seenUrls.add(s.url)),
      ];

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
