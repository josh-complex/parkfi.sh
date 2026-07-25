import { config } from "../parks/config.ts";
import { UniversalMenuPageSchema, type UniversalMenuPage } from "../parks/schemas.ts";
import { UpstreamError } from "../parks/sources/themeparks.ts";
import type { DiningMenuItemRow } from "./disney-dining-detail.ts";

/**
 * UOR menu ingestion (plan item 2.1) — the Universal counterpart of the WDW
 * dinemenu fetch, feeding the same `dining_menu_item` pipeline with
 * `source = UNIVERSAL_DIRECT` facility ids.
 *
 * There is no menu API on `api.universalparks.com`; menus live on the website
 * as Tridion pages. The `/web/…/dining/{slug}/menu.html` HTML route is Akamai
 * Bot-Manager gated, but swapping the prefix to `/contentdata/…` returns the
 * raw page model as JSON to a plain cookieless GET (edge-cached, ~2200s TTL,
 * verified from a datacenter fetch with an overt bot UA — no Browserless, no
 * session harvest). Sub-menus (Kids'/Dessert/Wine/Beer…) are enumerated by the
 * page's "K2 Local Navigation" component, each fetchable as its own JSON GET.
 *
 * Mapping onto `DiningMenuItemRow`:
 *   • mealPeriod ← the nav tab title ("Everyday Menu", "Wine Menu") so the
 *     tab split survives as the UI's period tabs;
 *   • itemType ← the section name (Subheading, falling back to the component
 *     title's last segment) — the venue-menu UI renders each distinct
 *     (groupName, itemType) as its own labeled section, so sections land as
 *     headers without any UI change; groupName stays null (no finer level);
 *   • dietary keyword keys (V/VG/GS) append to the description as "(Vegan)"
 *     etc. — the row shape has no dedicated column;
 *   • Price is a bare string ("52", "5.00") and absent on some rows (wine
 *     bottles price inside the description text) — parsed leniently, null
 *     tolerated.
 *
 * A wrong/absent slug 301-redirects to `/web/en/us/oops-sorry`; redirects are
 * therefore "no menu page", never retried.
 */

const CONTENTDATA_BASE = config.universalContentBase;

// The "K2 Restaurant Menu" component schema — the stable id is the primary
// match (per plan: parse by schema id + field names, never positionally); the
// schema title is a fallback in case the tcm id is ever republished.
const MENU_SCHEMA_ID = "tcm:58-19609-8";
const MENU_SCHEMA_TITLE = "K2 Restaurant Menu";
const NAV_SCHEMA_TITLE = "K2 Local Navigation";
const SECTION_TITLE_SCHEMA = "K2 Section Title";

// The GDS template (Epic Universe + refreshed hotel venues) — the menu nests
// under a Tabs Container instead of K2 Restaurant Menu components.
const GDS_TABS_SCHEMA_ID = "tcm:58-170370-8";
const GDS_TABS_SCHEMA_TITLE = "GDS - Tabs Container";
const GDS_TEXT_MENU_SCHEMA_ID = "tcm:58-178762-8";
const GDS_TEXT_MENU_SCHEMA_TITLE = "GDS - Text Block Menu";

const RETRY_STATUS = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

const DIETARY_LABELS: Record<string, string> = {
  V: "Vegetarian",
  VG: "Vegan",
  GS: "Gluten Sensitive",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalize a menu-page reference to the `/uor/en/us/…` path the contentdata
 * host serves: strip any origin, rewrite the website's `/web/` prefix to
 * `/uor/` (the contentdata equivalent — nav `ResolvedUrl`s already use it).
 * Null when the value can't be a UOR content path.
 */
function normalizeMenuPath(raw: string): string | null {
  let path: string;
  try {
    path = new URL(raw, "https://www.universalorlando.com").pathname;
  } catch {
    return null;
  }
  if (path.startsWith("/web/")) path = `/uor/${path.slice("/web/".length)}`;
  return path.startsWith("/uor/") ? path : null;
}

/**
 * The venue's menu path from its places-feed `urls[]`: the `DINING_MENU` entry
 * when present (authoritative — its slug can differ from the detail page's),
 * else the detail page + `/menu.html`. Null when the place carries neither.
 */
export function universalMenuPath(
  urls?: Array<{ url?: string; url_type?: string }> | null,
): string | null {
  let menu: string | null = null;
  let detail: string | null = null;
  for (const u of urls ?? []) {
    // The feed carries stray whitespace on some urls ("…/dining/atlantic ") —
    // untrimmed it percent-encodes into the path and 301s.
    const url = u.url?.trim();
    if (!url) continue;
    if ((u.url_type ?? "") === "DINING_MENU" && !menu) menu = url;
    else if ((u.url_type ?? "") === "PLACE_POI_DETAILS" && !detail) detail = url;
  }
  const raw = menu ?? (detail ? `${detail.replace(/\/+$/, "")}/menu.html` : null);
  return raw ? normalizeMenuPath(raw) : null;
}

/**
 * GET one contentdata page. Returns null on a redirect (the oops-sorry "no
 * such page" signal) or 404; retries soft blocks with jittered backoff.
 */
async function getPage(url: string, attempts = 3): Promise<UniversalMenuPage | null> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(config.fetchTimeoutMs),
        headers: { accept: "application/json" },
      });
      if (res.status >= 300 && res.status < 400) return null; // → oops-sorry
      if (res.status === 404) return null;
      if (res.ok) return UniversalMenuPageSchema.parse(await res.json());
      const err = new UpstreamError(`GET ${url} -> ${res.status}`, res.status);
      if (!RETRY_STATUS.has(res.status)) throw err;
      lastErr = err;
    } catch (err) {
      if (err instanceof UpstreamError && err.status != null && !RETRY_STATUS.has(err.status)) {
        throw err;
      }
      lastErr = err;
    }
    if (attempt < attempts) {
      const base = 300 * 2 ** (attempt - 1);
      await sleep(base + Math.random() * base);
    }
  }
  throw lastErr;
}

/** First non-empty string value of a Tridion field. */
function val(field?: { Values?: Array<string> }): string | null {
  return field?.Values?.find((v) => v.trim())?.trim() ?? null;
}

/**
 * XHTML fragment → plain text. Block/line-break boundaries become " · " so
 * adjacent fragments don't fuse ("…California</p><p>Bottle 53</p>" →
 * "…California · Bottle 53"); inline tags strip; the common entities decode.
 */
export function xhtmlToText(raw: string): string | null {
  const text = raw
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])\s*>/gi, " · ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;|&#38;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .replace(/(?: ?· ?)+/g, " · ")
    .replace(/^ ?· ?| ?· ?$/g, "")
    .trim();
  return text || null;
}

/** "1.00"-style price string → number; lenient about stray text; null safe. */
function parsePrice(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number.parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

type PageComponent = NonNullable<
  NonNullable<UniversalMenuPage["ComponentPresentations"][number]>["Component"]
>;

function componentsOf(page: UniversalMenuPage): Array<PageComponent> {
  return page.ComponentPresentations.map((cp) => cp.Component).filter(
    (c): c is PageComponent => c != null,
  );
}

/** The page's menu heading ("Everyday Menu") — the no-nav fallback tab name. */
function sectionHeading(page: UniversalMenuPage): string | null {
  for (const c of componentsOf(page)) {
    if (c.Schema?.Title === SECTION_TITLE_SCHEMA) {
      const heading = val(c.Fields?.Heading);
      if (heading) return heading;
    }
  }
  return null;
}

/** Sub-menu tabs from the "K2 Local Navigation" component, de-duped by path. */
function navTabs(page: UniversalMenuPage): Array<{ title: string | null; path: string }> {
  const out: Array<{ title: string | null; path: string }> = [];
  const seen = new Set<string>();
  for (const c of componentsOf(page)) {
    if (c.Schema?.Title !== NAV_SCHEMA_TITLE) continue;
    for (const link of c.Fields?.Link?.EmbeddedValues ?? []) {
      const resolved = link.Component?.LinkedComponentValues?.find(
        (l) => l.ResolvedUrl,
      )?.ResolvedUrl;
      const path = resolved ? normalizeMenuPath(resolved) : null;
      if (!path || seen.has(path)) continue;
      seen.add(path);
      out.push({ title: val(link.Title), path });
    }
  }
  return out;
}

/**
 * One tab's "K2 Restaurant Menu" components → menu rows. The section name
 * prefers the `Subheading` (sometimes present-but-empty); fallback is the
 * component title's last " - " segment ("The Cowfish - Everyday Menu -
 * Burgers" → "Burgers").
 */
export function universalMenuTabRows(
  facilityId: string,
  mealPeriod: string,
  page: UniversalMenuPage,
): Array<DiningMenuItemRow> {
  const rows: Array<DiningMenuItemRow> = [];
  for (const c of componentsOf(page)) {
    const isMenu = c.Schema?.Id === MENU_SCHEMA_ID || c.Schema?.Title === MENU_SCHEMA_TITLE;
    if (!isMenu) continue;
    const titleFallback = c.Title?.split(" - ").at(-1)?.trim() || null;
    for (const section of c.Fields?.MenuDetails?.EmbeddedValues ?? []) {
      const sectionName = val(section.Subheading) ?? titleFallback;
      for (const dish of section.DishDetails?.EmbeddedValues ?? []) {
        const title = val(dish.Title);
        if (!title) continue;
        let description = dish.Description?.Values?.length
          ? xhtmlToText(dish.Description.Values.join(" · "))
          : null;
        const dietary = (dish.HealthAttribute?.Values ?? [])
          .map((k) => DIETARY_LABELS[k] ?? k)
          .filter(Boolean);
        if (dietary.length > 0) {
          const tag = `(${dietary.join(", ")})`;
          description = description ? `${description} ${tag}` : tag;
        }
        const price = parsePrice(val(dish.Price));
        rows.push({
          facilityId,
          mealPeriod,
          groupName: null,
          itemType: sectionName,
          title,
          description,
          price,
          priceType: null,
          currency: price != null ? "USD" : null,
          prices: price != null ? [{ amount: price, type: null, currency: "USD" }] : null,
        });
      }
    }
  }
  rows.push(...gdsMenuRows(facilityId, page));
  return rows;
}

/**
 * GDS-template extraction (Epic Universe + refreshed hotel venues): the page
 * carries a "GDS - Tabs Container" whose tab items nest "GDS - Text Block
 * Menu" components. These pages have no local nav and no K2 components, and
 * their items carry NO prices (verified across probed venues) — rows land
 * unpriced, like the K2 wine tabs.
 *
 * Mapping: everything under ONE "Menu" period (the GDS tabs are category
 * tabs — Entrées/Beer/Wine — not meal periods, and ten UI period-tabs would
 * be noise); `itemType` ← tab heading (the UI's labeled sections);
 * `groupName` ← the text-block section heading when it differs from the tab
 * heading (Wine → Sparkling/Whites/Reds). Headings and item text are XHTML.
 * The `featureList` allergen flags are intentionally dropped — eight
 * "…Sensitive" tags per dish would drown the description.
 */
function gdsMenuRows(facilityId: string, page: UniversalMenuPage): Array<DiningMenuItemRow> {
  const rows: Array<DiningMenuItemRow> = [];
  for (const c of componentsOf(page)) {
    const isTabs = c.Schema?.Id === GDS_TABS_SCHEMA_ID || c.Schema?.Title === GDS_TABS_SCHEMA_TITLE;
    if (!isTabs) continue;
    for (const tab of c.Fields?.tabContents?.LinkedComponentValues ?? []) {
      const tabHeading = val(tab.Fields?.heading);
      const tabName = tabHeading ? xhtmlToText(tabHeading) : null;
      for (const el of tab.Fields?.elements?.EmbeddedValues ?? []) {
        for (const inner of el.component?.LinkedComponentValues ?? []) {
          const isTextMenu =
            inner.Schema?.Id === GDS_TEXT_MENU_SCHEMA_ID ||
            inner.Schema?.Title === GDS_TEXT_MENU_SCHEMA_TITLE;
          if (!isTextMenu) continue;
          for (const section of inner.Fields?.sections?.EmbeddedValues ?? []) {
            const rawHeading = val(section.heading);
            const sectionName = rawHeading ? xhtmlToText(rawHeading) : null;
            for (const item of section.items?.EmbeddedValues ?? []) {
              const rawTitle = val(item.heading);
              const title = rawTitle ? xhtmlToText(rawTitle) : null;
              if (!title) continue;
              const rawDesc = item.description?.Values?.length
                ? xhtmlToText(item.description.Values.join(" · "))
                : null;
              const price = parsePrice(val(item.price));
              rows.push({
                facilityId,
                mealPeriod: "Menu",
                groupName: sectionName !== tabName ? sectionName : null,
                itemType: tabName ?? sectionName,
                title,
                description: rawDesc,
                price,
                priceType: null,
                currency: price != null ? "USD" : null,
                prices: price != null ? [{ amount: price, type: null, currency: "USD" }] : null,
              });
            }
          }
        }
      }
    }
  }
  return rows;
}

/**
 * Fetch a venue's full menu — the root page plus every local-nav sub-menu.
 * Returns null when the venue has no menu page (redirect), the row list
 * otherwise. All-or-nothing: a hard failure on any tab throws, so a partial
 * capture can never be persisted as a generation (which would emit phantom
 * "removed" events for the missing tabs). A tab whose link itself redirects
 * (stale nav after a menu retire) is skipped as genuinely gone.
 */
export async function fetchUniversalMenu(
  facilityId: string,
  menuPath: string,
  tabDelayMs = 150,
): Promise<Array<DiningMenuItemRow> | null> {
  const root = await getPage(`${CONTENTDATA_BASE}${menuPath}`);
  if (!root) return null;

  const tabs = navTabs(root);
  if (!tabs.some((t) => t.path === menuPath)) {
    // No nav (single-menu venue) or a nav that omits the page we're on:
    // parse the root under its own heading, then any listed sub-menus.
    tabs.unshift({ title: sectionHeading(root) ?? "Menu", path: menuPath });
  }

  const rows: Array<DiningMenuItemRow> = [];
  for (const tab of tabs) {
    const page = tab.path === menuPath ? root : await getPage(`${CONTENTDATA_BASE}${tab.path}`);
    if (page == null) continue; // stale nav link — tab is gone
    rows.push(
      ...universalMenuTabRows(facilityId, tab.title ?? sectionHeading(page) ?? "Menu", page),
    );
    if (tab.path !== menuPath && tabDelayMs > 0) await sleep(tabDelayMs);
  }
  return rows;
}
