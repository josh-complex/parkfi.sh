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
export const SITE_NAME = "ParkFi";

/** Absolute URL to the default share image. OG requires an absolute href. */
const DEFAULT_IMAGE = `${SITE_URL}/og-image.png`;
/** Dimensions of {@link DEFAULT_IMAGE}; lets crawlers render the card sooner. */
const DEFAULT_IMAGE_WIDTH = "1731";
const DEFAULT_IMAGE_HEIGHT = "909";

export interface SeoOptions {
  /** Full <title>. Include the brand suffix yourself, e.g. "Dining — ParkFi". */
  title: string;
  description?: string;
  keywords?: string;
  /** Absolute or root-relative share image. Defaults to the app logo. */
  image?: string;
  /** Pixel dimensions of {@link image}; lets crawlers render the card sooner. */
  imageWidth?: string | number;
  imageHeight?: string | number;
  /** Root-relative path of this page (e.g. "/dining"). Drives canonical + og:url. */
  path?: string;
  /** Keep this page out of search indexes (auth/settings pages). */
  noindex?: boolean;
}

export function seo(opts: SeoOptions) {
  const { title, description, keywords, image = DEFAULT_IMAGE, path, noindex } = opts;
  const url = path ? `${SITE_URL}${path}` : SITE_URL;
  const absImage = image.startsWith("http") ? image : `${SITE_URL}${image}`;
  const imageWidth = opts.imageWidth ?? (image === DEFAULT_IMAGE ? DEFAULT_IMAGE_WIDTH : undefined);
  const imageHeight =
    opts.imageHeight ?? (image === DEFAULT_IMAGE ? DEFAULT_IMAGE_HEIGHT : undefined);

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
  if (imageWidth != null && imageHeight != null) {
    meta.push(
      { property: "og:image:width", content: String(imageWidth) },
      { property: "og:image:height", content: String(imageHeight) },
    );
  }
  if (keywords) meta.push({ name: "keywords", content: keywords });
  if (noindex) meta.push({ name: "robots", content: "noindex, nofollow" });

  const links = path ? [{ rel: "canonical", href: url }] : [];

  return { meta, links };
}

/**
 * Word-boundary truncation for meta-description fragments — official venue/
 * attraction copy (plan item 2.3) can run long, and the appended blurb should
 * not balloon the tag past what SERPs render.
 */
export function truncateMeta(s: string, max = 180): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 0)).trimEnd()}…`;
}

/**
 * Sitewide WebSite + Organization graph. Rendered once in the root document so
 * every page carries brand identity and enables the SERP sitelinks search box.
 */
export function websiteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#org`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: DEFAULT_IMAGE,
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: SITE_URL,
        publisher: { "@id": `${SITE_URL}/#org` },
      },
    ],
  };
}

/** Breadcrumb trail (Home › … › current) for breadcrumb rich snippets. */
export function breadcrumbJsonLd(
  trail: Array<{ name: string; path: string }>,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: `${SITE_URL}${c.path}`,
    })),
  };
}

/** AmusementPark entity for a park page, with geo + canonical URL. */
export function amusementParkJsonLd(opts: {
  name: string;
  slug: string;
  description?: string;
  latitude?: number | null;
  longitude?: number | null;
}): Record<string, unknown> {
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "AmusementPark",
    name: opts.name,
    url: `${SITE_URL}/park/${opts.slug}`,
  };
  if (opts.description) node.description = opts.description;
  if (opts.latitude != null && opts.longitude != null) {
    node.geo = {
      "@type": "GeoCoordinates",
      latitude: opts.latitude,
      longitude: opts.longitude,
    };
  }
  return node;
}

/** Restaurant entity for a dining venue detail page. */
export function restaurantJsonLd(opts: {
  facilityId: string;
  name: string;
  description?: string;
  cuisine?: string | null;
  priceRange?: string | null;
  image?: string | null;
}): Record<string, unknown> {
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: opts.name,
    url: `${SITE_URL}/dining/${opts.facilityId}`,
  };
  if (opts.description) node.description = opts.description;
  if (opts.cuisine) node.servesCuisine = opts.cuisine;
  if (opts.priceRange) node.priceRange = opts.priceRange;
  if (opts.image)
    node.image = opts.image.startsWith("http") ? opts.image : `${SITE_URL}${opts.image}`;
  return node;
}

/** TouristAttraction entity for a ride/attraction detail page. */
export function attractionJsonLd(opts: {
  parkSlug: string;
  rideSlug: string;
  name: string;
  description?: string;
  parkName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  image?: string | null;
}): Record<string, unknown> {
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "TouristAttraction",
    name: opts.name,
    url: `${SITE_URL}/park/${opts.parkSlug}/ride/${opts.rideSlug}`,
  };
  if (opts.description) node.description = opts.description;
  if (opts.parkName) node.containedInPlace = { "@type": "AmusementPark", name: opts.parkName };
  if (opts.latitude != null && opts.longitude != null) {
    node.geo = { "@type": "GeoCoordinates", latitude: opts.latitude, longitude: opts.longitude };
  }
  if (opts.image)
    node.image = opts.image.startsWith("http") ? opts.image : `${SITE_URL}${opts.image}`;
  return node;
}

/** Resort (LodgingBusiness) entity for a resort hotel detail page. */
export function resortJsonLd(opts: {
  slug: string;
  name: string;
  description?: string;
  image?: string | null;
}): Record<string, unknown> {
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Resort",
    name: opts.name,
    url: `${SITE_URL}/resort/${opts.slug}`,
  };
  if (opts.description) node.description = opts.description;
  if (opts.image)
    node.image = opts.image.startsWith("http") ? opts.image : `${SITE_URL}${opts.image}`;
  return node;
}

/** Blog (CollectionPage) entity for the /blog index. */
export function blogJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${SITE_URL}/blog#blog`,
    name: `${SITE_NAME} — Orlando Theme Park News & Analysis`,
    url: `${SITE_URL}/blog`,
    publisher: { "@id": `${SITE_URL}/#org` },
  };
}

/** Article entity for a single blog post. */
export function articleJsonLd(opts: {
  slug: string;
  title: string;
  description: string;
  publishedAt?: string | null;
  image?: string;
}): Record<string, unknown> {
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: opts.title,
    description: opts.description,
    url: `${SITE_URL}/blog/${opts.slug}`,
    mainEntityOfPage: `${SITE_URL}/blog/${opts.slug}`,
    author: { "@id": `${SITE_URL}/#org` },
    publisher: { "@id": `${SITE_URL}/#org` },
  };
  if (opts.publishedAt) node.datePublished = opts.publishedAt;
  if (opts.image)
    node.image = opts.image.startsWith("http") ? opts.image : `${SITE_URL}${opts.image}`;
  return node;
}
