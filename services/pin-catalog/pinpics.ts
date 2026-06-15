/**
 * PinPics crawler for the pin-catalog seed. PinPics is the broadest clean Disney
 * pin catalog (isolated, front-facing reference images + structured metadata) and
 * sourcing from it is established practice across the pin-trading tooling
 * ecosystem (see docs/plans/pin-traders.md § Legal & ToS). We crawl POLITELY:
 * a browser-identifying UA, a configurable per-request delay, and provenance
 * (`source='pinpics'`, `source_ref=<pid>`) on every row so it can be purged
 * wholesale if their stance ever changes.
 *
 * PinPics references pins by a numeric PID (e.g. "Pin 22739"). The detail-page
 * URL template + the crawl range are env-configurable because the site
 * bot-blocks discovery and its DOM shifts — point the selectors at the live page
 * via env without a code change:
 *
 *   PINPICS_PIN_URL_TEMPLATE   default https://www.pinpics.com/pins/view/{id}
 *   PINPICS_START_ID / END_ID  inclusive PID range to walk
 *   PINPICS_RATE_MS            delay between requests (default 1500 — be kind)
 *   PINPICS_MAX                hard ceiling on pins fetched in one run
 *   PINPICS_UA                 override the identifying User-Agent
 *
 * Extraction is best-effort: OpenGraph/Twitter meta first (most stable), then
 * JSON-LD, then a <title>/<h1> fallback. A page that yields no name/image is
 * skipped (likely a gap in the PID range or a soft-404).
 */

/** A normalized-source listing the catalog pipeline can ingest (shared shape). */
export interface RawListing {
  source: string;
  sourceRef: string;
  title: string;
  imageUrl: string | null;
  priceCents: number | null;
}

const URL_TEMPLATE =
  process.env.PINPICS_PIN_URL_TEMPLATE ?? "https://www.pinpics.com/pins/view/{id}";
const RATE_MS = Number(process.env.PINPICS_RATE_MS ?? 1500);
const MAX = Number(process.env.PINPICS_MAX ?? 500);
const UA =
  process.env.PINPICS_UA ?? "Mozilla/5.0 (compatible; ParkFiPinBot/1.0; +https://parkfi.sh/pins)";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Pull a `<meta property|name="key" content="...">` value (either attr order). */
function metaContent(html: string, ...keys: string[]): string | null {
  for (const key of keys) {
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

/** Try a JSON-LD Product block for name + image (PinPics emits these on some pages). */
function jsonLd(html: string): { name?: string; image?: string } {
  const blocks = [
    ...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi),
  ];
  for (const m of blocks) {
    try {
      const data = JSON.parse(m[1].trim());
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        if (node?.name || node?.image) {
          const image = Array.isArray(node.image) ? node.image[0] : node.image;
          return { name: typeof node.name === "string" ? node.name : undefined, image };
        }
      }
    } catch {
      /* malformed block — try the next */
    }
  }
  return {};
}

function titleTag(html: string): string | null {
  const t = /<title>([^<]+)<\/title>/i.exec(html)?.[1]?.trim();
  if (!t) return null;
  // Strip a trailing " - PinPics" / " | PinPics" site-name suffix.
  return t.replace(/\s*[-|]\s*PinPics\s*$/i, "").trim() || null;
}

function h1Tag(html: string): string | null {
  return (
    /<h1[^>]*>([\s\S]*?)<\/h1>/i
      .exec(html)?.[1]
      ?.replace(/<[^>]+>/g, "")
      .trim() || null
  );
}

/** Fetch + parse one PinPics pin page into a RawListing, or null if it's empty. */
async function fetchPin(pid: number): Promise<RawListing | null> {
  const url = URL_TEMPLATE.replace("{id}", String(pid));
  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (!res.ok) {
      if (res.status !== 404) console.error(`[pinpics] pid=${pid} ${res.status}`);
      return null;
    }
    html = (await res.text()).slice(0, 300_000);
  } catch (err) {
    console.error(`[pinpics] pid=${pid} fetch failed:`, (err as Error)?.message ?? err);
    return null;
  }

  const ld = jsonLd(html);
  const title =
    metaContent(html, "og:title", "twitter:title") ?? ld.name ?? titleTag(html) ?? h1Tag(html);
  const rawImage =
    metaContent(html, "og:image:secure_url", "og:image", "twitter:image") ?? ld.image ?? null;
  const imageUrl = rawImage ? new URL(rawImage, url).toString() : null;

  if (!title) return null; // soft-404 / gap in the PID range
  return { source: "pinpics", sourceRef: String(pid), title, imageUrl, priceCents: null };
}

/**
 * Walk the configured PID range, yielding one RawListing per real pin. Streams
 * (an async generator) so the caller can ingest in batches without holding the
 * whole crawl in memory, and so a long run can be interrupted cleanly.
 */
export async function* crawlPinPics(): AsyncGenerator<RawListing> {
  const start = Number(process.env.PINPICS_START_ID ?? 1);
  const end = Number(process.env.PINPICS_END_ID ?? start + MAX - 1);
  let fetched = 0;

  for (let pid = start; pid <= end && fetched < MAX; pid++) {
    const listing = await fetchPin(pid);
    if (listing) {
      fetched++;
      yield listing;
    }
    await sleep(RATE_MS); // be kind regardless of hit/miss
  }
  console.log(`[pinpics] crawl done — ${fetched} pin(s) from PID ${start}..${end}`);
}
