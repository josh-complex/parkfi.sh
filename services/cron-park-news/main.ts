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

import { GoogleGenAI, ServiceTier, ThinkingLevel } from "@google/genai";
import { inArray, sql } from "drizzle-orm";
import Parser from "rss-parser";

import { db } from "#/db/index.ts";
import { blogPost, newsItem } from "#/db/schema.ts";
import { parseSocialUrl, socialExists, type SocialEmbed } from "#/server/blog/embeds.ts";

const MODEL = process.env.NEWS_MODEL ?? "gemini-3.1-flash-lite";
/** Safety cap on drafts per run — a ceiling, not a target (skips yield fewer). */
const MAX_DRAFTS_PER_RUN = Number(process.env.NEWS_MAX_DRAFTS ?? 2);
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
 * Output ceiling + thinking level. Gemini 3 is a thinking model and thought
 * tokens count toward maxOutputTokens — so deep thinking on a long, complex
 * prompt can burn the whole budget on thoughts and return an EMPTY answer (the
 * numeric `thinkingBudget` knob is a no-op on Gemini 3; it uses `thinkingLevel`).
 * LOW keeps thinking light so the answer always has room; raise via env if a
 * future model needs more. Set NEWS_THINKING_LEVEL=minimal|low|medium|high.
 */
const MAX_OUTPUT_TOKENS = Number(process.env.NEWS_MAX_OUTPUT_TOKENS ?? 16_000);
/**
 * Floor on in-body media (inline images) every post should carry beyond the
 * hero. The writer is handed a palette of REAL, pre-verified images/embeds
 * harvested from the source article; if the finished body still falls short we
 * top it up from that palette, and anything still under the floor is surfaced as
 * "media-thin" in the review queue. Set NEWS_MIN_INLINE_IMAGES.
 */
const MIN_INLINE_IMAGES = Number(process.env.NEWS_MIN_INLINE_IMAGES ?? 2);
/**
 * Floor on embedded social posts (TikTok/YouTube/Instagram/X/Reddit) every post
 * should carry — a real embed is the single biggest credibility/richness signal.
 * Topped up from the verified palette if the writer left the post short, and
 * flagged "media-thin" in the review queue if it still can't be met. Set NEWS_MIN_EMBEDS.
 */
const MIN_EMBEDS = Number(process.env.NEWS_MIN_EMBEDS ?? 1);
const THINKING_LEVELS: Record<string, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};
const THINKING_LEVEL =
  THINKING_LEVELS[(process.env.NEWS_THINKING_LEVEL ?? "low").toLowerCase()] ?? ThinkingLevel.LOW;
/** Grounded research is slow; give the request real headroom but a hard ceiling. */
const REQUEST_TIMEOUT_MS = Number(process.env.NEWS_REQUEST_TIMEOUT_MS ?? 180_000);

const SYSTEM = `You are a staff writer for ParkFi, a live Orlando theme-park wait-times and trip-planning site. You turn ONE incoming news item into an original, genuinely useful analysis post. Write like a sharp human who actually goes to these parks — not a press release, not a content farm.

VOICE — this is the part that matters most:
- Have a point of view, and lead with what's genuinely interesting or what readers should DO about it — not a throat-clearing "Just in time for…" intro. Cut corporate filler ("exciting", "magical experience", "perfect for the whole family", "be sure to").
- TONE: warm and upbeat, but grounded — like a friend who loves these parks and is genuinely glad to share what's new. These are vacations; default to the reader's excitement. Be honest about real downsides (a closure, a price, a catch) when they exist, but DON'T manufacture a problem, a "gotcha", or a cynical angle just to sound sharp. Most news is good or neutral news — write it that way. Skip snark, doom, and clickbait-negative framing ("dying", "ghost town", "the catch", "the sad reality"); a headline shouldn't reach for a downside the story doesn't actually have.
- HEADLINES: make the title genuinely inviting — lead with the exciting thing (the new ride, the return, the perk, the cool detail fans will love), not a hedge, a question, or a warning. Optimistic and specific beats neutral-and-safe; our instinct is to undersell and over-qualify, so deliberately lean into the real enthusiasm the news earns. Still no clickbait, no fake stakes, no manufactured drama — the excitement has to be backed by the actual story.
- Be concrete and specific over generic. Real wait-time numbers, real dates, real prices — enthusiasm earns its keep when it's backed by specifics, not vague hype.
- Don't break the magic. When it fits naturally, treat the characters as themselves — real personalities who live in the parks — rather than as "IP", "the franchise", or "the Mickey Mouse character". And when an ending turns speculative or forward-looking, let it carry a small note of wonder, the quiet sense that something delightful might be waiting. Keep this a light touch — a seasoning, never a costume — and never at the expense of the real, specific information above.
- Vary sentence length. A short punchy line is fine. Contractions are fine. A light, friendly touch beats both brochure-speak and forced cynicism.

SUBSTANCE:
- Add value the source didn't. Use Google Search to add verifiable context the feed snippet lacked — official confirmations, dates, prior history, related projects, pricing — and to find a primary source.
- QUOTES: if Search surfaces a REAL, verifiable direct quote (a Disney/Universal exec, an Imagineer, an official press release), include ONE as a Markdown blockquote with attribution: "> ...quote...\\n>\\n> — Name, title". Never invent or paraphrase a quote into quotation marks. No real quote found = no quote. Don't force it.
- BACKLINKS: weave 1–2 contextual links INLINE in the prose (not just a list at the end) — to a closely related prior ParkFi post via its /blog/<slug> path when one fits, and to an authoritative external page (official park site, the primary source) where it helps the reader. Every external link AND every source you cite is fetched before publish: a confirmed-dead one (404) is unwrapped to plain text or dropped from the source list, so a guessed or half-remembered URL just disappears. Link only to a page whose exact URL you actually saw in a search result — never reconstruct a likely-looking article path.
- Tie it to what ParkFi readers care about: crowds, wait times, Lightning Lane, dining, trip timing — only where it's honestly relevant. Skip the tie-in if it's a stretch.

IMAGES (inline, in the body) — a rich post is a media-rich post:
- A post MUST carry AT LEAST 2 relevant images INSIDE the body (3–4 is better for a meatier story), using Markdown: ![descriptive alt](https://image-url), spread through the post (next to the section each one illustrates), not stacked at the top. Right after each image add an italic credit line: *Photo: Source Name* (link the source name to its URL).
- You will be given a "VERIFIED MEDIA" palette: real image URLs we already pulled from the source article and confirmed load. PREFER these — they are guaranteed to work and are already correctly attributed. Use as many as fit the story.
- You may ALSO add images via Google Search, but ONLY a URL you actually found in a search result — NEVER guess, pattern-match, or fabricate an image path. Every image URL is fetched before publish and silently dropped if it 404s, so a guessed link just vanishes and can leave the post under the 2-image floor.
- Don't decorate for the sake of it: an image must show the actual thing the post is about.

EMBEDS (social posts / video) — REQUIRED: every post MUST carry AT LEAST ONE embed:
- A real embedded post (TikTok, YouTube, Instagram, X, or a Reddit thread) is one of the biggest things that makes a post feel rich and credible — include at least one in EVERY post (more is fine, spread through the body). The VERIFIED MEDIA palette often includes embeds we pulled straight from the source article — if one is listed, INCLUDE it (put its bare URL on its OWN line, nothing else) unless it's truly irrelevant. We turn it into a clean embedded player.
- When the palette has none, search for the real post: the OFFICIAL account (the park, Universal, Disney, the resort) or relevant creators for an announcement/video, and — especially on heavier or divisive stories (a price hike, a closure, a policy or perk change, a cut, a real controversy) — a relevant Reddit thread (e.g. r/WaltDisneyWorld, r/UniversalOrlando, r/DisneyWorld, r/wdw) where real guests are reacting. A Reddit thread surfaces the critical, on-the-ground opinion the official line and upbeat fan blogs won't, and a weightier post is more honest for it. Prefer the official announcement on routine news; reach for Reddit when the story has a genuine downside or debate — never to manufacture one onto good news.
- Truth gate still applies: embed ONLY a post from the palette or one you actually found in a search result — never invent or guess a URL. Every embed is verified to exist before publish and dropped if it doesn't, so a guessed link just vanishes and leaves the post under the 1-embed floor.

TRUTH ONLY. Every claim, quote, date, number, image, and embed must trace to a real source. If you can't verify it, leave it out. Never invent attendance figures, prices, or quotes.

FORMAT: original wording (never copy/closely paraphrase the source), Markdown body, ## subheads ok, NO H1. 900–1300 words — real depth and development, with a couple of ## subheads to structure it, not padded filler. Cite EVERY source you used (original + anything from Search) in "extraSources".`;

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

/**
 * Is this NON-image link confirmed dead? Source citations and inline prose links
 * are the other thing the model fabricates — a plausible-looking article URL that
 * 404s, or an invented host. This is the gate that keeps a broken "Sources" link
 * (or a dead inline backlink) out of a published post.
 *
 * We only report DEAD on an unambiguous signal — an HTTP 404/410, or a DNS/
 * connection failure (a host that doesn't resolve = fabricated). A 403/429/5xx,
 * or a timeout, is treated as alive-but-unverifiable and KEPT: many of these
 * sites bot-block or rate-limit even our browser UA, and dropping a real source
 * on a false positive is worse than keeping an occasional slow link. HEAD first
 * (cheap), then a GET recheck for hosts that reject HEAD (often a 405) before we
 * pass final judgment.
 */
async function isDeadLink(url: string): Promise<boolean> {
  const probe = async (method: "HEAD" | "GET"): Promise<"live" | "dead" | "unknown"> => {
    try {
      const res = await fetch(url, {
        method,
        headers: { "User-Agent": UA, Accept: "text/html,*/*" },
        signal: AbortSignal.timeout(10_000),
        redirect: "follow",
      });
      if (res.ok) return "live";
      if (res.status === 404 || res.status === 410) return "dead";
      return "unknown"; // 403/429/5xx → likely bot-blocked, not fabricated
    } catch (err) {
      // A real-but-slow site aborts with TimeoutError — give it the benefit of
      // the doubt. Anything else (DNS/connection failure) is a dead host.
      return (err as Error)?.name === "TimeoutError" ? "unknown" : "dead";
    }
  };
  const head = await probe("HEAD");
  if (head !== "unknown") return head === "dead";
  // HEAD inconclusive — recheck with a real GET before judging it dead.
  return (await probe("GET")) === "dead";
}

/** Drop any researched source whose URL is confirmed dead (404/410/bad host). */
async function liveSources(sources: Source[]): Promise<Source[]> {
  const dead = await Promise.all(sources.map((s) => isDeadLink(s.url)));
  const kept = sources.filter((_, i) => !dead[i]);
  const dropped = sources.length - kept.length;
  if (dropped) console.log(`[park-news]   dropped ${dropped} dead source link(s)`);
  return kept;
}

/** Matches a Markdown image and an optional italic credit line right after it. */
const BODY_IMG_RE = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)[^)]*\)([^\S\n]*\n[^\S\n]*\*[^\n]*\*)?/g;
/** Matches an inline Markdown link `[text](http…)` — NOT an image (no leading `!`). */
const BODY_LINK_RE = /(?<!!)\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

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

  // 3) Inline prose links — unwrap any confirmed-dead external link to plain
  // text (keep the words, lose the broken href) so the sentence still reads.
  const linkUrls = [...new Set([...out.matchAll(BODY_LINK_RE)].map((m) => m[2]))];
  const deadLink = new Map(
    await Promise.all(linkUrls.map(async (u) => [u, await isDeadLink(u)] as const)),
  );
  const deadLinks = linkUrls.filter((u) => deadLink.get(u)).length;
  out = out.replace(BODY_LINK_RE, (full, text: string, url: string) =>
    deadLink.get(url) ? text : full,
  );

  if (deadImgs) console.log(`[park-news]   dropped ${deadImgs} dead inline image(s)`);
  if (deadEmbeds) console.log(`[park-news]   dropped ${deadEmbeds} unverified embed(s)`);
  if (deadLinks) console.log(`[park-news]   unwrapped ${deadLinks} dead inline link(s)`);
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

/** Real, pre-verified assets harvested from a source article for the writer. */
interface HarvestedMedia {
  images: OgImage[];
  embeds: SocialEmbed[];
}

const HTML_IMG_RE = /<img\b[^>]*>/gi;
const SRC_RE = /\ssrc\s*=\s*["']([^"']+)["']/i;
const DATASRC_RE = /\sdata-src\s*=\s*["']([^"']+)["']/i;
const ALT_RE = /\salt\s*=\s*["']([^"']*)["']/i;
/** URL fragments that mark non-content images we never want inline. */
const IMG_SKIP =
  /(sprite|logo|favicon|\bicon\b|avatar|gravatar|emoji|pixel|spacer|1x1|blank|placeholder|badge|button|loading|share|social|tracking|beacon|wp-content\/plugins)/i;
/** Bare social-post URLs embedded in article HTML (one pattern per platform). */
const EMBED_SCAN: RegExp[] = [
  /https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]{6,}/gi,
  /https?:\/\/(?:www\.)?youtu\.be\/[\w-]{6,}/gi,
  /https?:\/\/(?:www\.)?youtube\.com\/shorts\/[\w-]{6,}/gi,
  /https?:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/\d+/gi,
  /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[\w-]+/gi,
  /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/\w+\/status\/\d+/gi,
  /https?:\/\/(?:www\.|old\.)?reddit\.com\/r\/\w+\/comments\/\w+(?:\/[\w-]+)?/gi,
];
/** YouTube embed iframes (youtube.com/embed/ID) — normalized to a watch URL. */
const YT_EMBED_RE = /https?:\/\/(?:www\.)?(?:youtube(?:-nocookie)?\.com)\/embed\/([\w-]{6,})/gi;

function looksLikeContentImage(url: string): boolean {
  return /^https?:\/\//i.test(url) && !/\.svg(\?|$)/i.test(url) && !IMG_SKIP.test(url);
}

/**
 * Pull real media OUT of the source article — the same trick that makes the hero
 * reliable, applied to the rest of the post. News articles already embed press
 * photos, galleries, and the official YouTube/social post; lifting those (rather
 * than asking the model to find live URLs, which it guesses and 404s) is what
 * lets a post clear the in-body media floor. Best-effort: a fetch failure just
 * returns nothing and the writer falls back to Search. Caller verifies liveness.
 */
async function harvestSourceMedia(pageUrl: string, excludeUrl?: string): Promise<HarvestedMedia> {
  let html: string;
  try {
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok) return { images: [], embeds: [] };
    html = (await res.text()).slice(0, 600_000);
  } catch {
    return { images: [], embeds: [] };
  }

  const images: OgImage[] = [];
  const seenImg = new Set<string>(excludeUrl ? [excludeUrl] : []);
  for (const tag of html.match(HTML_IMG_RE) ?? []) {
    const raw = SRC_RE.exec(tag)?.[1] ?? DATASRC_RE.exec(tag)?.[1];
    if (!raw) continue;
    let abs: string;
    try {
      abs = new URL(raw, pageUrl).toString();
    } catch {
      continue;
    }
    if (seenImg.has(abs) || !looksLikeContentImage(abs)) continue;
    seenImg.add(abs);
    images.push({ url: abs, alt: ALT_RE.exec(tag)?.[1]?.trim() || null });
    if (images.length >= 10) break;
  }

  const embeds: HarvestedMedia["embeds"] = [];
  const seenEmb = new Set<string>();
  const pushEmbed = (url: string) => {
    const e = parseSocialUrl(url);
    if (e && !seenEmb.has(e.url)) {
      seenEmb.add(e.url);
      embeds.push(e);
    }
  };
  for (const re of EMBED_SCAN) for (const m of html.match(re) ?? []) pushEmbed(m);
  for (const m of html.matchAll(YT_EMBED_RE)) pushEmbed(`https://www.youtube.com/watch?v=${m[1]}`);

  return { images, embeds };
}

/** Keep only harvested media that actually loads/exists, capped to a sane palette. */
async function verifyHarvest(m: HarvestedMedia): Promise<HarvestedMedia> {
  const [imgOk, embOk] = await Promise.all([
    Promise.all(m.images.map((i) => isLiveImage(i.url))),
    Promise.all(m.embeds.map((e) => socialExists(e, UA))),
  ]);
  return {
    images: m.images.filter((_, i) => imgOk[i]).slice(0, 6),
    embeds: m.embeds.filter((_, i) => embOk[i]).slice(0, 2),
  };
}

/** Count in-body media (inline images + social embeds) — the review-queue floor. */
function countBodyMedia(md: string): { images: number; embeds: number } {
  const images = [...md.matchAll(BODY_IMG_RE)].length;
  const embeds = md.split("\n").filter((l) => parseSocialUrl(l.trim())).length;
  return { images, embeds };
}

/**
 * Top up a finished body that fell short of the image floor (or carries no
 * embed) from the pre-verified palette, so a thin-but-real post still ships with
 * media rather than a lone hero. The writer normally places these inline; this
 * is the safety net, so the extras land at the end with a proper credit line.
 */
function ensureBodyMedia(
  md: string,
  media: HarvestedMedia,
  source: string,
  sourceUrl: string,
): string {
  const have = countBodyMedia(md);
  const usedImg = new Set([...md.matchAll(BODY_IMG_RE)].map((m) => m[1]));
  const usedEmb = new Set(
    md
      .split("\n")
      .map((l) => parseSocialUrl(l.trim())?.url)
      .filter((u): u is string => !!u),
  );
  const credit = `*Photo: [${source}](${sourceUrl})*`;
  let out = md;
  let added = 0;
  let need = MIN_INLINE_IMAGES - have.images;
  for (const img of media.images) {
    if (need <= 0) break;
    if (usedImg.has(img.url)) continue;
    out += `\n\n![${img.alt || source}](${img.url})\n${credit}`;
    usedImg.add(img.url);
    need--;
    added++;
  }
  let needEmb = MIN_EMBEDS - have.embeds;
  for (const e of media.embeds) {
    if (needEmb <= 0) break;
    if (usedEmb.has(e.url)) continue;
    out += `\n\n${e.url}`;
    usedEmb.add(e.url);
    needEmb--;
    added++;
  }
  if (added) console.log(`[park-news]   topped up body with ${added} palette media item(s)`);
  return out.trim();
}

/** Matches an internal blog backlink `[text](/blog/some-slug)` (not an image). */
const BODY_INTERNAL_LINK_RE = /(?<!!)\[([^\]]+)\]\((\/blog\/[a-z0-9-]+)\/?\)/g;

/** Unwrap any internal /blog/<slug> link whose slug doesn't exist (keep the text). */
function validateInternalLinks(md: string, validSlugs: Set<string>): string {
  let dropped = 0;
  const out = md.replace(BODY_INTERNAL_LINK_RE, (full, text: string, path: string) => {
    const slug = path.replace(/^\/blog\//, "").replace(/\/$/, "");
    if (validSlugs.has(slug)) return full;
    dropped++;
    return text;
  });
  if (dropped) console.log(`[park-news]   unwrapped ${dropped} bad internal /blog link(s)`);
  return out;
}

/** Every existing blog slug — so a hallucinated internal backlink gets unwrapped. */
async function allBlogSlugs(): Promise<Set<string>> {
  const { rows } = await db.execute<{ slug: string }>(sql`SELECT slug FROM blog_post`);
  return new Set(rows.map((r) => r.slug));
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
  media: HarvestedMedia,
): string {
  const slugList = parks.map((p) => `${p.slug} (${p.name})`).join(", ");
  const coveredList =
    covered.length === 0
      ? "(nothing yet)"
      : covered.map((c) => `- "${c.title}" (/blog/${c.slug}): ${c.aiSummary ?? "—"}`).join("\n");

  const imgPalette =
    media.images.length === 0
      ? "(none found — use Google Search to find real, relevant image URLs)"
      : media.images.map((i) => `- ${i.url}${i.alt ? `  (alt: ${i.alt})` : ""}`).join("\n");
  const embedPalette =
    media.embeds.length === 0
      ? "(none found in the source — you MUST find one: an official/creator post, or a Reddit thread for heavier topics)"
      : media.embeds.map((e) => `- ${e.url}`).join("\n");
  const mediaBlock = `VERIFIED MEDIA from the source article — real, already confirmed to load. Prefer these (credit them as "*Photo: [${item.source}](${item.url})*"):
Images (use at least ${MIN_INLINE_IMAGES}, spread through the body):
${imgPalette}
Embeds (REQUIRED — at least ${MIN_EMBEDS} per post; put a bare URL on its own line; include any listed, else search for a real one — a Reddit thread is great for heavier topics):
${embedPalette}`;

  return `A theme-park news item just came in:

Source: ${item.source}
Headline: ${item.title}
Summary: ${item.summary}
URL: ${item.url}

${mediaBlock}

We've ALREADY published/drafted these recent posts (do not repeat their angle):
${coveredList}

If this item is already substantially covered above, or isn't genuinely
newsworthy on its own, respond with exactly {"skip": true} and nothing else.

Otherwise research it (per your instructions) and write the post (900–1300 words):
real voice, an optimistic headline that leads with the exciting thing, inline
backlinks (only to URLs you actually found — dead ones get dropped), a verifiable
quote if one exists, AT LEAST ${MIN_INLINE_IMAGES} relevant inline images spread
through the body (Markdown, with an italic credit line under each — prefer the
VERIFIED MEDIA above), and AT LEAST ${MIN_EMBEDS} embedded social post on its own
line (prefer the verified embed above; for a heavier/divisive story a relevant
Reddit thread works great). When a recent post above is
genuinely related, link it inline using its EXACT /blog/<slug> path from that list
(a wrong slug is dropped). Reference a park by its ParkFi slug only from this list
(we link it internally): ${slugList || "(none)"}.

Respond with ONLY a JSON object (no code fence), shape:
{
  "skip": false,
  "title": "compelling, specific, OPTIMISTIC, <70 chars — lead with the exciting thing, not a hedge, question, or warning",
  "dek": "one-sentence reader summary / meta description, <160 chars",
  "bodyMd": "the post in Markdown (900–1300 words) — ## subheads ok, NO H1, AT LEAST 2 inline ![alt](url) images spread through the body each followed by an italic *Photo: ...* credit, a > blockquote for any real quote, and AT LEAST ${MIN_EMBEDS} embedded social post (TikTok/YouTube/Instagram/X/Reddit) as a bare URL on its own line",
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
  const blogSlugs = await allBlogSlugs();

  // Google Search grounding lets the model verify + add context before writing.
  const tools = WEB_SEARCH ? [{ googleSearch: {} }] : undefined;

  let drafted = 0;
  let skipped = 0;
  for (const item of items) {
    try {
      // Pull the hero (source og:image) AND a palette of real, verified media
      // straight out of the source article BEFORE writing — so the writer places
      // guaranteed-live images/embeds instead of guessing URLs that 404.
      const og = await fetchOgImage(item.url);
      const media = await verifyHarvest(await harvestSourceMedia(item.url, og?.url));

      const res = await ai.models.generateContent({
        model: MODEL,
        contents: buildPrompt(item, parks, covered, media),
        config: {
          systemInstruction: SYSTEM,
          tools,
          // Keep thinking light so it can't eat the whole budget (→ empty answer),
          // and leave the answer comfortable headroom on top.
          thinkingConfig: { thinkingLevel: THINKING_LEVEL },
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          // Don't let a single grounded call hang the whole run.
          httpOptions: { timeout: REQUEST_TIMEOUT_MS },
          // Background cron — latency-insensitive, so prefer the cheap Flex tier
          // (paid-tier only; configurable via NEWS_SERVICE_TIER).
          serviceTier: SERVICE_TIER,
        },
      });
      const draft = parseDraft(res.text ?? "");
      if (!draft) {
        // Surface WHY: an empty body with finish=MAX_TOKENS means thinking ate the
        // budget (lower NEWS_THINKING_LEVEL / raise NEWS_MAX_OUTPUT_TOKENS); a
        // block= reason means the prompt/answer was filtered.
        const u = res.usageMetadata;
        const cand = res.candidates?.[0];
        console.error(
          `[park-news] unparseable draft for: ${item.title} — ` +
            `finish=${cand?.finishReason ?? "?"} ` +
            `block=${res.promptFeedback?.blockReason ?? "none"} ` +
            `parts=${cand?.content?.parts?.length ?? 0} ` +
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
      // any dead inline images / unverified embeds before it's ever stored. Then
      // unwrap hallucinated internal /blog links, and top up from the verified
      // palette if the writer left the post under the in-body media floor.
      draft.title = titleCase(draft.title);
      draft.bodyMd = await validateBodyMedia(draft.bodyMd);
      draft.bodyMd = validateInternalLinks(draft.bodyMd, blogSlugs);
      draft.bodyMd = ensureBodyMedia(draft.bodyMd, media, item.source, item.url);
      const finalMedia = countBodyMedia(draft.bodyMd);
      if (finalMedia.images < MIN_INLINE_IMAGES || finalMedia.embeds < MIN_EMBEDS) {
        console.log(
          `[park-news]   media-thin draft (${finalMedia.images} inline image(s), ${finalMedia.embeds} embed(s)): ${draft.title}`,
        );
      }

      const parkSlugs = draft.parkSlugs.filter((s) => validSlugs.has(s));
      const slug = `${slugify(draft.title)}-${sha256(item.url).slice(0, 6)}`;
      // The original feed item leads (it came from the feed — always real, never
      // checked); researched sources follow, deduped by url and liveness-checked
      // so a fabricated or 404'd citation never reaches the review queue.
      const seenUrls = new Set([item.url]);
      const liveExtra = await liveSources(
        draft.extraSources.filter((s) => !seenUrls.has(s.url) && seenUrls.add(s.url)),
      );
      const sourceUrls: Source[] = [
        { title: `${item.source}: ${item.title}`, url: item.url },
        ...liveExtra,
      ];

      // Hero image: prefer the source article's og:image (fetched up top —
      // deterministic, and we already credit + link that source), falling back to
      // the model's pick — and verify whichever we land on actually loads.
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
        // Let later items in this same run see this one, avoiding intra-run dupes
        // and letting them backlink to it (so its slug must count as valid).
        covered.unshift({ slug, title: draft.title, aiSummary: draft.aiSummary });
        blogSlugs.add(slug);
      }
    } catch (err) {
      // Leave the item unrecorded so a transient API/network failure (e.g. a
      // grounded-request TimeoutError) retries next run. Log name+message only —
      // the full DOMException/Error object is noise.
      const e = err as { name?: string; message?: string };
      console.error(
        `[park-news] failed on: ${item.title} — ${e?.name ?? "Error"}: ${e?.message ?? err}`,
      );
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
