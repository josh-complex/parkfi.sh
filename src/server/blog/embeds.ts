/**
 * Social-media embeds for blog bodies. The writer drops a bare post URL on its
 * own line; the cron validates it really exists (oEmbed / liveness) before
 * saving, and the renderer turns it into a sandboxed iframe embed.
 *
 * Split this way on purpose: existence-checking does network I/O at draft time
 * (so dead links never ship), while {@link embedHtml} is a pure transform the
 * SSR render step can run on every request. Both share one URL parser so the
 * two halves can't drift on what counts as an embeddable URL.
 */
export type SocialPlatform = "tiktok" | "youtube" | "instagram" | "twitter";

export interface SocialEmbed {
  platform: SocialPlatform;
  /** Post/video id (or shortcode for Instagram). */
  id: string;
  /** The original, canonical post URL (used for oEmbed + the fallback link). */
  url: string;
}

const YOUTUBE = /^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/i;
const YOUTUBE_SHORTS = /^https?:\/\/(?:www\.)?youtube\.com\/shorts\/([\w-]{6,})/i;
const TIKTOK = /^https?:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/(\d+)/i;
const INSTAGRAM = /^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([\w-]+)/i;
const TWITTER = /^https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[\w]+\/status\/(\d+)/i;

/** Parse a URL into an embeddable social post, or null if it isn't one. */
export function parseSocialUrl(raw: string): SocialEmbed | null {
  const url = raw.trim();
  let m: RegExpExecArray | null;
  if ((m = YOUTUBE.exec(url)) || (m = YOUTUBE_SHORTS.exec(url)))
    return { platform: "youtube", id: m[1], url };
  if ((m = TIKTOK.exec(url))) return { platform: "tiktok", id: m[1], url };
  if ((m = INSTAGRAM.exec(url))) return { platform: "instagram", id: m[1], url };
  if ((m = TWITTER.exec(url))) return { platform: "twitter", id: m[1], url };
  return null;
}

/**
 * Confirm the post actually exists. TikTok + YouTube expose public oEmbed
 * endpoints that 404 on dead/private posts; Instagram + X oEmbed now need an
 * app token, so we fall back to a liveness GET on the post URL. Best-effort:
 * any network error counts as "not verifiable" → we drop the embed.
 */
export async function socialExists(e: SocialEmbed, ua: string): Promise<boolean> {
  const oembed: Partial<Record<SocialPlatform, string>> = {
    youtube: `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(e.url)}`,
    tiktok: `https://www.tiktok.com/oembed?url=${encodeURIComponent(e.url)}`,
  };
  try {
    const probe = oembed[e.platform] ?? e.url;
    const res = await fetch(probe, {
      headers: { "User-Agent": ua, Accept: "application/json,text/html" },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    return res.ok;
  } catch {
    return false;
  }
}

const escapeAttr = (s: string) => s.replace(/"/g, "%22").replace(/[<>]/g, "");

/**
 * Sandboxed iframe embed for a verified post. We render iframes ourselves (from
 * a parsed id, never raw model HTML) so the body sanitizer can keep blanket-
 * stripping `<iframe>` — these are injected AFTER sanitization via a token.
 */
export function embedHtml(e: SocialEmbed): string {
  const id = escapeAttr(e.id);
  const frame = (src: string, style: string, title: string) =>
    `<div class="social-embed" style="margin:1.5rem auto;${style}">` +
    `<iframe src="${src}" title="${title}" loading="lazy" frameborder="0" ` +
    `style="width:100%;height:100%;border:0;border-radius:12px" ` +
    `allow="encrypted-media;fullscreen" allowfullscreen referrerpolicy="no-referrer"></iframe></div>`;
  switch (e.platform) {
    case "youtube":
      return frame(
        `https://www.youtube-nocookie.com/embed/${id}`,
        "max-width:680px;aspect-ratio:16/9",
        "YouTube video",
      );
    case "tiktok":
      return frame(
        `https://www.tiktok.com/embed/v2/${id}`,
        "max-width:325px;height:740px",
        "TikTok video",
      );
    case "instagram":
      return frame(
        `https://www.instagram.com/p/${id}/embed`,
        "max-width:480px;height:680px",
        "Instagram post",
      );
    case "twitter":
      return frame(
        `https://platform.twitter.com/embed/Tweet.html?id=${id}`,
        "max-width:550px;height:600px",
        "Post on X",
      );
  }
}
