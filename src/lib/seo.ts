/**
 * Centralized SEO metadata for route `head()` configs.
 *
 * Returns `{ meta, links }` ready to spread into a TanStack Start route head.
 * Covers the standard description/keywords tags plus Open Graph and Twitter
 * cards so links shared to Slack/iMessage/social render a rich preview, and a
 * per-page canonical link to keep duplicate URLs from splitting rank.
 */

/** Production origin. Used for canonical + absolute OG/Twitter URLs. */
export const SITE_URL = "https://parkfi.sh";
export const SITE_NAME = "ParkFish";

/** Absolute URL to the default share image. OG requires an absolute href. */
const DEFAULT_IMAGE = `${SITE_URL}/og-image.png`;
/** Dimensions of {@link DEFAULT_IMAGE}; lets crawlers render the card sooner. */
const DEFAULT_IMAGE_WIDTH = "1731";
const DEFAULT_IMAGE_HEIGHT = "909";

export interface SeoOptions {
  /** Full <title>. Include the brand suffix yourself, e.g. "Dining — ParkFish". */
  title: string;
  description?: string;
  keywords?: string;
  /** Absolute or root-relative share image. Defaults to the app logo. */
  image?: string;
  /** Root-relative path of this page (e.g. "/dining"). Drives canonical + og:url. */
  path?: string;
  /** Keep this page out of search indexes (auth/settings pages). */
  noindex?: boolean;
}

export function seo(opts: SeoOptions) {
  const { title, description, keywords, image = DEFAULT_IMAGE, path, noindex } = opts;
  const url = path ? `${SITE_URL}${path}` : SITE_URL;
  const absImage = image.startsWith("http") ? image : `${SITE_URL}${image}`;

  const meta: Array<Record<string, string>> = [
    { title },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: title },
    { property: "og:image", content: absImage },
    { property: "og:url", content: url },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:image", content: absImage },
  ];

  if (description) {
    meta.push(
      { name: "description", content: description },
      { property: "og:description", content: description },
      { name: "twitter:description", content: description },
    );
  }
  if (image === DEFAULT_IMAGE) {
    meta.push(
      { property: "og:image:width", content: DEFAULT_IMAGE_WIDTH },
      { property: "og:image:height", content: DEFAULT_IMAGE_HEIGHT },
    );
  }
  if (keywords) meta.push({ name: "keywords", content: keywords });
  if (noindex) meta.push({ name: "robots", content: "noindex, nofollow" });

  const links = path ? [{ rel: "canonical", href: url }] : [];

  return { meta, links };
}
