/**
 * Shared OpenGraph-image fetcher for park-news: used by the live cron (hero +
 * shelf thumbnail on newly-seen items) and by the one-off backfill script
 * (`bun run backfill:news-images`) for the pre-existing backlog. Split out of
 * `main.ts` because that module runs its cron body on import.
 */

/** Browser-like UA — WDWMagic / Disney / Akamai 403 the default fetch agent. */
export const UA =
  process.env.NEWS_USER_AGENT ??
  "Mozilla/5.0 (compatible; ParkFiNewsBot/1.0; +https://parkfi.sh/blog)";

export interface OgImage {
  url: string;
  alt: string | null;
}

export function metaContent(html: string, ...keys: string[]): string | null {
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
 * defensible hero/thumbnail. Best-effort: a failure just leaves it image-less.
 */
export async function fetchOgImage(pageUrl: string): Promise<OgImage | null> {
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
