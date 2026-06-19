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
export type SocialPlatform = "tiktok" | "youtube" | "instagram" | "twitter" | "reddit";

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
// A Reddit post (or comment) permalink — id is the base-36 submission id; the
// embed iframe is built from the full URL path, not the id alone.
const REDDIT = /^https?:\/\/(?:www\.|old\.|np\.)?reddit\.com\/r\/[\w]+\/comments\/([\w]+)/i;

/** Parse a URL into an embeddable social post, or null if it isn't one. */
export function parseSocialUrl(raw: string): SocialEmbed | null {
  const url = raw.trim();
  let m: RegExpExecArray | null;
  if ((m = YOUTUBE.exec(url)) || (m = YOUTUBE_SHORTS.exec(url)))
    return { platform: "youtube", id: m[1], url };
  if ((m = TIKTOK.exec(url))) return { platform: "tiktok", id: m[1], url };
  if ((m = INSTAGRAM.exec(url))) return { platform: "instagram", id: m[1], url };
  if ((m = TWITTER.exec(url))) return { platform: "twitter", id: m[1], url };
  if ((m = REDDIT.exec(url))) return { platform: "reddit", id: m[1], url };
  return null;
}

/**
 * Confirm the post actually exists. TikTok + YouTube expose public oEmbed
 * endpoints that 404 on dead/private posts; Instagram + X oEmbed now need an
 * app token, so we fall back to a liveness GET on the post URL. Best-effort:
 * any network error counts as "not verifiable" → we drop the embed.
 */
export async function socialExists(e: SocialEmbed, ua: string): Promise<boolean> {
  // Reddit returns 200 (and the embed even renders) for posts that have been
  // DELETED or REMOVED — a plain liveness GET can't tell, so we'd ship an embed
  // that just says "This post has been deleted." Check the post JSON instead.
  if (e.platform === "reddit") return redditExists(e, ua);

  const oembed: Partial<Record<SocialPlatform, string>> = {
    youtube: `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(e.url)}`,
    tiktok: `https://www.tiktok.com/oembed?url=${encodeURIComponent(e.url)}`,
  };
  try {
    const probe = oembed[e.platform];
    // YouTube/TikTok expose oEmbed that cleanly 404s on dead/private posts.
    if (probe) {
      const res = await fetch(probe, {
        headers: { "User-Agent": ua, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
        redirect: "follow",
      });
      return res.ok;
    }
    // Instagram / X have no usable public oEmbed and bot-block our UA
    // (403/429), so a strict res.ok would drop real posts. Mirror isDeadLink:
    // only an unambiguous 404/410 means "doesn't exist"; keep anything else.
    const res = await fetch(e.url, {
      headers: { "User-Agent": ua, Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    return res.status !== 404 && res.status !== 410;
  } catch {
    return false;
  }
}

const REDDIT_DEAD = new Set(["[deleted]", "[removed]"]);

/**
 * A Reddit post counts as "exists" only if it's not deleted/removed. Reddit's
 * page + embed both 200 on a scrubbed post, so we read the post JSON and check
 * the deletion markers (`removed_by_category`, scrubbed author/selftext). If
 * Reddit rate-limits/blocks us (403/429) we can't disprove existence, so we keep
 * the embed rather than drop a real one; only a clear 404/410 or an explicit
 * deletion marker drops it.
 */
async function redditExists(e: SocialEmbed, ua: string): Promise<boolean> {
  try {
    const jsonUrl = `${e.url.replace(/\/+$/, "")}/.json?raw_json=1`;
    const res = await fetch(jsonUrl, {
      headers: { "User-Agent": ua, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (res.status === 404 || res.status === 410) return false;
    if (!res.ok) return true; // blocked/rate-limited — can't disprove, keep it
    const data = (await res.json()) as {
      data?: { children?: { data?: Record<string, unknown> }[] };
    }[];
    const post = data?.[0]?.data?.children?.[0]?.data;
    if (!post) return true; // unexpected shape — don't drop on a parse quirk
    if (typeof post.removed_by_category === "string" && post.removed_by_category) return false;
    if (REDDIT_DEAD.has(post.author as string)) return false;
    if (REDDIT_DEAD.has(post.selftext as string)) return false;
    return true;
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
  // No `referrerpolicy="no-referrer"` here: YouTube validates the embedding
  // domain via the referrer and throws "Error 153 / Video player configuration
  // error" when it's stripped. The browser default sends the origin, which the
  // providers all accept.
  const frame = (
    src: string,
    style: string,
    title: string,
    iframeStyle = "height:100%",
    attrs = "",
  ) =>
    `<div class="social-embed" style="margin:1.5rem auto;${style}">` +
    `<iframe src="${src}" title="${title}" loading="lazy" frameborder="0"${attrs ? ` ${attrs}` : ""} ` +
    `style="width:100%;${iframeStyle};border:0;border-radius:12px" ` +
    `allow="encrypted-media;fullscreen" allowfullscreen></iframe></div>`;
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
      // No fixed wrapper height: the iframe carries an initial height plus a
      // `data-social-embed` hook so the client resize listener (see the blog
      // post route) can grow it to the post's real height — tall posts with
      // media or long threads were getting clipped at the old 600px cap.
      return frame(
        `https://platform.twitter.com/embed/Tweet.html?id=${id}&dnt=true`,
        "max-width:550px",
        "Post on X",
        "height:600px",
        'data-social-embed="twitter"',
      );
    case "reddit": {
      // Reddit's iframe embed is served from redditmedia.com off the post's own
      // path (the `id` alone isn't enough — it needs r/sub/comments/id/slug).
      const path = new URL(e.url).pathname.replace(/\/+$/, "");
      return frame(
        `https://www.redditmedia.com${path}/?ref_source=embed&ref=share&embed=true&theme=dark`,
        "max-width:640px;height:520px",
        "Reddit post",
      );
    }
  }
}
