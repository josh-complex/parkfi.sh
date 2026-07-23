/**
 * Source-article media + text harvesting for park-news. Split out of `main.ts`
 * (which runs its cron body on import) so this half is importable/testable —
 * same reason `og-image.ts` lives apart.
 *
 * Defuddle (the Obsidian Web Clipper extractor) pulls the ARTICLE body out of
 * the fetched page. That matters twice:
 *   - Images are scanned only inside the article content. News pages surround
 *     the story with ad banners and related-article thumbnails whose URLs look
 *     exactly like content images (IMG_SKIP can't catch them) — on a WDWNT page
 *     7 of 9 full-page palette images were ads. Falls back to the full page when
 *     extraction comes up empty.
 *   - The article's full text (Markdown) rides along for the writer prompt, so
 *     the model grounds on the actual story instead of a 600-char RSS snippet.
 * Embeds still scan the FULL page: defuddle strips social-embed markup (an
 * in-article Instagram blockquote disappears from its content), and bare
 * post-shaped URLs (/status/, /reel/, /video/) don't occur in page chrome, so
 * the wider scan is safe where the image scan isn't.
 */
import { Defuddle } from "defuddle/node";

import { parseSocialUrl, type SocialEmbed } from "#/server/blog/embeds.ts";

import { type OgImage, UA } from "./og-image.ts";

/** Real, pre-verified assets harvested from a source article for the writer. */
export interface HarvestedMedia {
  images: OgImage[];
  embeds: SocialEmbed[];
  /** Full article text as Markdown (capped), or null when extraction failed. */
  articleMd: string | null;
}

/**
 * Page-read cap. Was 600 KB, which truncated Blog Mickey articles (~900 KB of
 * markup) mid-body — leaving BOTH the media harvest and content extraction
 * empty. 2 MB clears every current feed with headroom.
 */
const PAGE_BYTE_CAP = 2_000_000;
/** Cap on the article Markdown handed to the writer prompt (~4-5k tokens). */
const ARTICLE_MD_CAP = 18_000;

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
 * Extract the article from the raw page: HTML content (for the scoped image
 * scan) + Markdown text (for the writer). Best-effort — a defuddle failure or
 * an empty extraction returns nulls and the caller falls back to the full page.
 */
async function extractArticle(
  html: string,
  pageUrl: string,
): Promise<{ contentHtml: string | null; md: string | null }> {
  try {
    const article = await Defuddle(html, pageUrl);
    const contentHtml = article?.content && (article.wordCount ?? 0) > 0 ? article.content : null;
    const mdResult = await Defuddle(html, pageUrl, { markdown: true });
    const md =
      mdResult?.content
        // Lazy-load placeholders survive as giant data: URI images — pure token waste.
        ?.replace(/!\[[^\]]*\]\(data:[^)]*\)/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim() ?? "";
    return { contentHtml, md: md ? md.slice(0, ARTICLE_MD_CAP) : null };
  } catch {
    return { contentHtml: null, md: null };
  }
}

/**
 * Pull real media OUT of the source article — the same trick that makes the hero
 * reliable, applied to the rest of the post. News articles already embed press
 * photos, galleries, and the official YouTube/social post; lifting those (rather
 * than asking the model to find live URLs, which it guesses and 404s) is what
 * lets a post clear the in-body media floor. Best-effort: a fetch failure just
 * returns nothing and the writer falls back to Search. Caller verifies liveness.
 */
export async function harvestSourceMedia(
  pageUrl: string,
  excludeUrl?: string,
): Promise<HarvestedMedia> {
  let html: string;
  try {
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok) return { images: [], embeds: [], articleMd: null };
    html = (await res.text()).slice(0, PAGE_BYTE_CAP);
  } catch {
    return { images: [], embeds: [], articleMd: null };
  }

  const article = await extractArticle(html, pageUrl);
  // Image scan runs over the article body when we have one (ads/related-post
  // thumbnails live outside it); the raw page is the fallback, not a supplement.
  const imgScanHtml = article.contentHtml ?? html;

  const images: OgImage[] = [];
  const seenImg = new Set<string>(excludeUrl ? [excludeUrl] : []);
  for (const tag of imgScanHtml.match(HTML_IMG_RE) ?? []) {
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

  return { images, embeds, articleMd: article.md };
}
