/**
 * Universal's own published page inventory (plan §5.18, C10) — the operator
 * publishing a page is the last private step before an announcement, and the
 * page exists in their CMS feed before anyone links to it.
 *
 * Two Tridion publications, both served as JSON by the same cookieless
 * `contentdata` host our menu and ride-page ingests already ride
 * (`src/server/parks/sources/universal-content.ts`):
 *
 *  1. `uor` — universalorlando.com, the guest-facing site (~740 pages). Its
 *     inventory is the public `sitemap.xml`.
 *  2. `uomeetingsandevents` — uomeetingsandevents.com, the B2B group-sales
 *     site (~50 pages), where private-event venues and corporate packages are
 *     sold months before any guest-facing marketing. Its pages are client
 *     rendered and its sitemap is an empty SPA shell, so the inventory comes
 *     from Universal's own Coveo index, whose access token the site publishes
 *     in `…/api/pageinfo.html`.
 *
 * What lands in the ledger is the DIFF: a path this source has never listed
 * before, with the page's own SEO title, description and CMS revision date.
 * The first run seeds the inventory and writes nothing — otherwise day one
 * would file 790 "new pages". A run that suddenly sees more than
 * `RESEED_THRESHOLD` new paths in one publication is treated as a URL-scheme
 * change (a locale move, a sitemap rebuild), not news: it re-seeds silently.
 *
 * Etiquette (plan §9): one sitemap GET, one search POST and at most
 * `MAX_NEW_PER_RUN` page GETs a day, all of public marketing copy the
 * operator publishes for search engines, under our honest user agent. The
 * Coveo token is read fresh from the site on every run — never hardcoded —
 * and the adapter degrades to the other publication when it rotates.
 */
import { config } from "#/server/parks/config.ts";

import { cleanText } from "../normalize.ts";

import type {
  Adapter,
  AdapterContext,
  FetchResult,
  PublicRecordInput,
  RawRecord,
} from "../types.ts";

export const UOR_WEB_SOURCE = "uor_web";

const MEETINGS_WEB_BASE =
  process.env.UNIVERSAL_MEETINGS_WEB_BASE ?? "https://www.uomeetingsandevents.com";
const COVEO_SEARCH_URL =
  process.env.UNIVERSAL_COVEO_SEARCH_URL ?? "https://platform.cloud.coveo.com/rest/search/v2";

/** Page bodies fetched per run — a cap on both our load and theirs. */
const MAX_NEW_PER_RUN = Number(process.env.RECORDS_UOR_WEB_MAX_NEW ?? 25);
/** More "new" paths than this in one publication = a scheme change, not news. */
const RESEED_THRESHOLD = Number(process.env.RECORDS_UOR_WEB_RESEED_OVER ?? 60);
/**
 * Consecutive runs a path must be absent from the listing before we file it as
 * removed. Two, so a single flaky sitemap or a mid-republish read costs a day,
 * not a feed full of phantom removals.
 */
const MISSING_RUNS = Number(process.env.RECORDS_UOR_WEB_MISSING_RUNS ?? 2);
/** Runs a dead link is trusted to stay dead before we re-check it. */
const DEAD_RECHECK_RUNS = Number(process.env.RECORDS_UOR_WEB_DEAD_RECHECK ?? 7);
/** Politeness gap between page-body GETs. */
const PAGE_GAP_MS = Number(process.env.RECORDS_UOR_WEB_GAP_MS ?? 150);

/**
 * The `/sales/` trade microsite lives in the `uor` publication but is ABSENT
 * from the sitemap (verified 2026-09-15) — Universal publishes it for travel
 * trade and group sales without listing it. It is therefore only reachable by
 * following its own links, seeded from these hubs.
 */
const SALES_SEEDS = (
  process.env.RECORDS_UOR_WEB_SALES_SEEDS ??
  "/sales/theme-parks/epic-universe,/sales/epic-universe/worlds/celestial-park,/sales"
)
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);
/** Documents read per run by the sales crawl — seeds first, then a rotating slice. */
const SALES_MAX_FETCH = Number(process.env.RECORDS_UOR_WEB_SALES_FETCH ?? 12);

/** The B2B site's mega-nav component — the fallback inventory (see `listMeetingsNavPages`). */
const MEETINGS_NAV_COMPONENT =
  process.env.RECORDS_UOR_WEB_NAV_COMPONENT ?? "gds-navigation-mega-nav-uo-meetings-and-events";

/** Sections whose pages are boilerplate — enumerated, never filed. */
const IGNORED_SECTIONS =
  /^\/(search-results|sitemap|legal|terms-of-service|privacy|privacy-info-center|faqs?|email-sign-up|oops-sorry)\b/i;

export interface PublicationSpec {
  /** Inventory id — the cursor key and half of the record identity. */
  id: string;
  /** contentdata publication segment (two inventories share the `uor` one). */
  publication: string;
  label: string;
  /** Guest-facing URL for one inventory path. */
  publicUrl: (path: string) => string;
  /**
   * Current page inventory, as site-relative paths ("/things-to-do/…").
   * `known` is the last good inventory — a crawler uses it as its frontier.
   */
  list: (ctx: AdapterContext, known: string[] | undefined) => Promise<Inventory>;
}

/**
 * One publication's current page list. `partial` marks a listing that is a
 * SUBSET of the site by construction — the B2B nav fallback carries only what
 * the menu links. A partial run may still find new pages, but it must never
 * conclude that anything was removed, and it must never shrink the inventory.
 */
export interface Inventory {
  paths: string[];
  partial: boolean;
}

/** The page body we keep off one contentdata document. */
export interface PageBody {
  publication: string;
  path: string;
  url: string;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  /** Tridion's own last-edit stamp for the page — our "filed" date. */
  revisionDate: string | null;
  /** Internal CMS page name ("100 GDS - UO Meetings and Events - Celestial Park"). */
  cmsTitle: string | null;
  /** Never set here — the discriminant that separates this from `RemovedBody`. */
  removed?: false;
}

/** The body of a removal record — the page is gone, so there is nothing to read. */
export interface RemovedBody {
  publication: string;
  path: string;
  url: string;
  removed: true;
  /** Consecutive runs the path was absent before we filed it. */
  missedRuns: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `/web/en/us/things-to-do/x` and `/uomeetingsandevents/en/us/x` → `/things-to-do/x`, `/x`. */
export function sitePath(rawUrl: string, prefixes: string[]): string | null {
  let pathname: string;
  try {
    pathname = new URL(rawUrl).pathname;
  } catch {
    pathname = rawUrl;
  }
  for (const prefix of prefixes) {
    if (pathname === prefix) return "/";
    if (pathname.startsWith(`${prefix}/`)) {
      const rest = pathname.slice(prefix.length).replace(/\/+$/, "");
      return rest.length > 0 ? rest : "/";
    }
  }
  return null;
}

/** Every `<loc>` in a sitemap document, normalized to a site path. */
export function parseSitemap(xml: string, prefixes: string[]): string[] {
  const out = new Set<string>();
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const path = sitePath(m[1]!, prefixes);
    if (path && !IGNORED_SECTIONS.test(path)) out.add(path);
  }
  return [...out].sort();
}

/**
 * Field lookup over a Tridion page document: the first `Values[0]` of a field
 * named `name`, at any depth. Keyed by field NAME, never by position, so a
 * republished or reordered component is a no-op (same rule as
 * `universal-content.ts`).
 */
export function tridionField(node: unknown, name: string): string | null {
  if (node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = tridionField(child, name);
      if (hit !== null) return hit;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  if (obj.Name === name && Array.isArray(obj.Values) && typeof obj.Values[0] === "string") {
    const v = cleanText(obj.Values[0]);
    if (v) return v;
  }
  for (const key of Object.keys(obj)) {
    const hit = tridionField(obj[key], name);
    if (hit !== null) return hit;
  }
  return null;
}

/** Tridion's `0001-01-01T00:00:00` null-date sentinel. */
function realDate(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw : null;
  if (!s || s.startsWith("0001-01-01")) return null;
  return Number.isNaN(Date.parse(s)) ? null : s;
}

/** One contentdata document → the body we file. Null when the page is gone. */
export function pageBody(
  publication: string,
  path: string,
  url: string,
  doc: unknown,
): PageBody | null {
  if (doc === null || typeof doc !== "object") return null;
  const top = doc as Record<string, unknown>;
  return {
    publication,
    path,
    url,
    seoTitle: tridionField(doc, "SEOTitle"),
    seoDescription: tridionField(doc, "SEODescription"),
    canonicalUrl: tridionField(doc, "SEOCanonicalURL"),
    revisionDate: realDate(top.RevisionDate),
    cmsTitle: cleanText(top.Title),
  };
}

async function contentdataDoc(
  publication: string,
  path: string,
  ctx: AdapterContext,
): Promise<unknown | null> {
  const suffix = path === "/" ? "" : path;
  const url = `${config.universalContentBase}/${publication}/en/us${suffix}/index.html`;
  const res = await ctx.fetch(url, {
    headers: { accept: "application/json" },
    redirect: "manual",
    signal: ctx.signal,
  });
  // A redirect is Universal's "no such page" signal (it 301s to `oops-sorry`).
  if (res.status >= 300 && res.status < 400) return null;
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return (await res.json()) as unknown;
}

/** The guest site's inventory: its public sitemap. */
async function listConsumerPages(ctx: AdapterContext): Promise<Inventory> {
  // The root sitemap index (from robots.txt) lists en/us, es/us and en/gb;
  // probed 2026-09-15, the other two are strict subsets of en/us bar four
  // stale leftovers, so en/us alone is the complete guest-site inventory.
  const url = `${config.universalWebBase}/web/en/us/sitemap.xml`;
  const res = await ctx.fetch(url, { headers: { accept: "application/xml" }, signal: ctx.signal });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return { paths: parseSitemap(await res.text(), ["/web/en/us"]), partial: false };
}

/**
 * The B2B site's inventory, from Universal's own Coveo index. The token is
 * published in the site's `pageinfo.html` — read it per run so a rotation
 * costs us one skipped publication, not a code change.
 */
export async function coveoCredentials(
  publication: string,
  ctx: AdapterContext,
): Promise<{ token: string; searchHub: string } | null> {
  const url = `${config.universalContentBase}/${publication}/en/us/api/pageinfo.html`;
  const res = await ctx.fetch(url, { headers: { accept: "application/json" }, signal: ctx.signal });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const body = (await res.json()) as { ResourceList?: Record<string, unknown> };
  const list = body.ResourceList ?? {};
  const token = cleanText(list.coveoAccessToken);
  const searchHub = cleanText(list.coveoSearchHub);
  return token && searchHub ? { token, searchHub } : null;
}

/**
 * Fallback inventory for the B2B site: the links inside its own mega-nav
 * component, fetched through the same contentdata host
 * (`…/api/getcontent/?contentIds=<component>`). Nav-only, so it is PARTIAL —
 * it finds a new venue page the moment the menu links it, but it can never be
 * read as "everything else was removed".
 */
export async function listMeetingsNavPages(ctx: AdapterContext): Promise<string[]> {
  const url = `${config.universalContentBase}/uomeetingsandevents/en/us/api/getcontent/?contentIds=${MEETINGS_NAV_COMPONENT}`;
  const res = await ctx.fetch(url, {
    headers: { accept: "application/json" },
    redirect: "manual",
    signal: ctx.signal,
  });
  if (res.status >= 300 && res.status < 400) return [];
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const text = await res.text();
  const paths = new Set<string>();
  for (const m of text.matchAll(/https:\/\/[a-z0-9.-]*uomeetingsandevents\.com([^"']*)/gi)) {
    const path = sitePath(`https://www.uomeetingsandevents.com${m[1] ?? ""}`, [
      "/uomeetingsandevents/en/us",
      "/en/us",
      "",
    ]);
    if (path && !IGNORED_SECTIONS.test(path)) paths.add(path);
  }
  return [...paths].sort();
}

async function listMeetingsPages(ctx: AdapterContext): Promise<Inventory> {
  const creds = await coveoCredentials("uomeetingsandevents", ctx);
  if (!creds) {
    // The token rotated or the resource list changed shape: fall back to the
    // nav so a new page still surfaces, and mark the run partial.
    const nav = await listMeetingsNavPages(ctx);
    ctx.log(
      `uomeetingsandevents: no Coveo token in pageinfo — nav fallback listed ${nav.length} page(s), additions only`,
    );
    return { paths: nav, partial: true };
  }
  const paths = new Set<string>();
  const pageSize = 100;
  for (let firstResult = 0; firstResult < 1000; firstResult += pageSize) {
    const res = await ctx.fetch(COVEO_SEARCH_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${creds.token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        q: "",
        searchHub: creds.searchHub,
        numberOfResults: pageSize,
        firstResult,
      }),
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`POST coveo (${creds.searchHub}) -> ${res.status}`);
    const body = (await res.json()) as { results?: Array<{ clickUri?: string }> };
    const results = body.results ?? [];
    for (const r of results) {
      if (!r.clickUri) continue;
      const path = sitePath(r.clickUri, ["/uomeetingsandevents/en/us", "/en/us"]);
      if (path && !IGNORED_SECTIONS.test(path)) paths.add(path);
    }
    if (results.length < pageSize) break;
  }
  return { paths: [...paths].sort(), partial: false };
}

/** `/web/en/us/sales/x/index` and `/sales/x/` → `/sales/x`. */
export function normalizeSalesPath(raw: string): string | null {
  const path = raw
    .replace(/^\/web\/en\/us/, "")
    .replace(/\/index$/, "")
    .replace(/\/+$/, "");
  return path.startsWith("/sales/") || path === "/sales" ? path : null;
}

/** Every `/sales/…` link inside one page document. */
export function salesLinks(docText: string): string[] {
  const out = new Set<string>();
  for (const m of docText.matchAll(/(?:\/web\/en\/us)?\/sales[a-z0-9/-]{0,120}/gi)) {
    const path = normalizeSalesPath(m[0]);
    if (path) out.add(path);
  }
  return [...out];
}

/**
 * Inventory for the unlisted trade microsite: a bounded link crawl. Seeds plus
 * a day-rotated slice of what we already know, so the frontier widens over
 * runs without ever costing more than `SALES_MAX_FETCH` documents. PARTIAL by
 * construction — a crawl proves a page exists, never that one is gone.
 */
async function listSalesPages(
  ctx: AdapterContext,
  known: string[] | undefined,
): Promise<Inventory> {
  const found = new Set<string>(known ?? []);
  const prior = known ?? [];
  // Rotate which known pages get re-read, so links added to any hub surface
  // within a few days rather than only the first N alphabetically.
  const offset = prior.length > 0 ? Math.floor(Date.now() / 86_400_000) % prior.length : 0;
  const rotated = [...prior.slice(offset), ...prior.slice(0, offset)];
  const queue = [...SALES_SEEDS, ...rotated];
  const read = new Set<string>();

  for (const path of queue) {
    if (read.size >= SALES_MAX_FETCH) break;
    if (read.has(path)) continue;
    read.add(path);
    let doc: unknown | null = null;
    try {
      doc = await contentdataDoc("uor", path, ctx);
    } catch (err) {
      ctx.log(`uor_sales${path}: crawl read failed (${err instanceof Error ? err.message : err})`);
      continue;
    }
    if (!doc) continue;
    found.add(path);
    for (const link of salesLinks(JSON.stringify(doc))) found.add(link);
    if (PAGE_GAP_MS > 0) await sleep(PAGE_GAP_MS);
  }
  return { paths: [...found].sort(), partial: true };
}

export const PUBLICATIONS: readonly PublicationSpec[] = [
  {
    id: "uor",
    publication: "uor",
    label: "universalorlando.com",
    publicUrl: (path) => `${config.universalWebBase}/web/en/us${path === "/" ? "" : path}`,
    list: listConsumerPages,
  },
  {
    id: "uomeetingsandevents",
    publication: "uomeetingsandevents",
    label: "uomeetingsandevents.com (group sales)",
    publicUrl: (path) => `${MEETINGS_WEB_BASE}/en/us${path === "/" ? "" : path}`,
    list: listMeetingsPages,
  },
  {
    id: "uor_sales",
    publication: "uor",
    label: "universalorlando.com/sales (trade microsite, unlisted)",
    publicUrl: (path) => `${config.universalWebBase}/web/en/us${path}`,
    list: listSalesPages,
  },
];

interface Cursor {
  /** Publication id → the sorted path inventory as of the last good run. */
  pages: Record<string, string[]>;
  /**
   * Publication id → path → how many consecutive runs it has been absent from
   * the listing. A page is only filed as removed once it has missed
   * `MISSING_RUNS` runs, so one flaky sitemap doesn't bury the feed.
   */
  missing: Record<string, Record<string, number>>;
  /**
   * Inventory id → path → runs since we learned the path resolves to nothing
   * (contentdata 301s). The trade crawl follows links, and some of them are
   * dead ends; filing those would be noise. They stay in the inventory so we
   * don't re-fetch them daily, and are re-checked every `DEAD_RECHECK_RUNS`
   * runs in case Universal later publishes the page for real.
   */
  dead: Record<string, Record<string, number>>;
}

export function parseCursor(raw: Record<string, unknown> | null): Cursor {
  const pages = (raw?.pages ?? {}) as Record<string, unknown>;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(pages)) {
    if (Array.isArray(v)) out[k] = v.filter((p): p is string => typeof p === "string");
  }
  const rawMissing = (raw?.missing ?? {}) as Record<string, unknown>;
  const missing: Record<string, Record<string, number>> = {};
  for (const [k, v] of Object.entries(rawMissing)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const counts: Record<string, number> = {};
    for (const [path, n] of Object.entries(v as Record<string, unknown>)) {
      if (typeof n === "number" && Number.isFinite(n)) counts[path] = n;
    }
    missing[k] = counts;
  }
  const rawDead = (raw?.dead ?? {}) as Record<string, unknown>;
  const dead: Record<string, Record<string, number>> = {};
  for (const [k, v] of Object.entries(rawDead)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const counts: Record<string, number> = {};
    for (const [path, n] of Object.entries(v as Record<string, unknown>)) {
      if (typeof n === "number" && Number.isFinite(n)) counts[path] = n;
    }
    dead[k] = counts;
  }
  return { pages: out, missing, dead };
}

/** Title-cased fallback name for a page whose body we couldn't read. */
export function pathTitle(path: string): string {
  const slug = path.split("/").filter(Boolean).pop() ?? "Home";
  return slug
    .split("-")
    .map((w) => (w.length > 2 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** The site section a path sits in ("things-to-do", "events", "hotels"). */
export function sectionOf(path: string): string {
  return path.split("/").filter(Boolean)[0] ?? "home";
}

/** "… | Universal Orlando Resort™" and friends — the site's title furniture. */
export function trimSiteSuffix(title: string): string {
  return title.replace(/\s*[|–-]\s*Universal[^|–-]*$/i, "").trim() || title;
}

export const uorWebAdapter: Adapter = {
  source: UOR_WEB_SOURCE,
  agency: "Universal Orlando",
  cadence: "daily",
  // Most days nothing new is published; that is the signal working, not a break.
  quietWhenEmpty: true,

  async fetchSince(cursor, ctx): Promise<FetchResult> {
    const prior = parseCursor(cursor);
    const next: Record<string, string[]> = { ...prior.pages };
    const nextMissing: Record<string, Record<string, number>> = { ...prior.missing };
    const nextDead: Record<string, Record<string, number>> = {};
    const records: RawRecord[] = [];
    let budget = MAX_NEW_PER_RUN;

    for (const pub of PUBLICATIONS) {
      let listing: Inventory;
      try {
        listing = await pub.list(ctx, prior.pages[pub.id]);
      } catch (err) {
        // A broken listing holds this publication's inventory so the next run
        // re-diffs against the last good one instead of re-filing the site.
        ctx.log(`${pub.id}: listing failed (${err instanceof Error ? err.message : err}) — held`);
        continue;
      }
      const { paths, partial } = listing;
      if (paths.length === 0) {
        ctx.log(`${pub.id}: empty listing — inventory held`);
        continue;
      }

      // Age this inventory's dead links; the expired ones leave the inventory
      // so they re-enter the "new page" flow and get one more read.
      const deadNow: Record<string, number> = {};
      const expired = new Set<string>();
      for (const [path, runs] of Object.entries(prior.dead[pub.id] ?? {})) {
        if (runs + 1 >= DEAD_RECHECK_RUNS) expired.add(path);
        else deadNow[path] = runs + 1;
      }
      nextDead[pub.id] = deadNow;
      const known =
        expired.size > 0
          ? prior.pages[pub.id]?.filter((p) => !expired.has(p))
          : prior.pages[pub.id];
      // A partial listing can only ever ADD to what we know.
      next[pub.id] = partial && known ? [...new Set([...known, ...paths])].sort() : paths;
      nextMissing[pub.id] = {};
      if (!known) {
        ctx.log(`${pub.id}: seeded ${paths.length} pages (no records on a first run)`);
        continue;
      }

      const current = new Set(paths);
      const knownSet = new Set(known);
      const fresh = paths.filter((p) => !knownSet.has(p));
      const gone = partial ? [] : known.filter((p) => !current.has(p));
      if (partial) nextMissing[pub.id] = prior.missing[pub.id] ?? {};

      // Either direction, a wholesale change is a URL rewrite (a locale move,
      // a sitemap rebuild), not 100 stories. Re-seed and file nothing.
      if (fresh.length > RESEED_THRESHOLD || gone.length > RESEED_THRESHOLD) {
        ctx.log(
          `${pub.id}: ${fresh.length} unseen / ${gone.length} vanished paths (> ${RESEED_THRESHOLD}) — treating as a URL-scheme change, re-seeded`,
        );
        continue;
      }

      // Removals: count consecutive misses, and only file once a path has been
      // gone for MISSING_RUNS runs. Anything still inside the grace period
      // stays in the inventory so the next run keeps counting it.
      const priorMissing = prior.missing[pub.id] ?? {};
      const removed: string[] = [];
      for (const path of gone) {
        const misses = (priorMissing[path] ?? 0) + 1;
        if (misses < MISSING_RUNS) {
          nextMissing[pub.id]![path] = misses;
          next[pub.id] = [...next[pub.id]!, path].sort();
          continue;
        }
        removed.push(path);
        records.push({
          externalId: `${pub.id}:${path}#removed`,
          url: pub.publicUrl(path),
          fetchedAt: new Date(),
          body: {
            publication: pub.id,
            path,
            url: pub.publicUrl(path),
            removed: true,
            missedRuns: misses,
          } satisfies RemovedBody,
        });
      }
      if (removed.length > 0)
        ctx.log(`${pub.id}: ${removed.length} page(s) removed — ${removed.slice(0, 5).join(", ")}`);
      const pending = Object.keys(nextMissing[pub.id]!);
      if (pending.length > 0)
        ctx.log(`${pub.id}: ${pending.length} page(s) missing but inside the grace window`);

      if (fresh.length === 0) {
        if (removed.length === 0) ctx.log(`${pub.id}: ${paths.length} pages, none new`);
        continue;
      }

      ctx.log(`${pub.id}: ${fresh.length} new page(s) — ${fresh.slice(0, 5).join(", ")}`);
      const filed = new Set<string>();
      for (const path of fresh) {
        if (budget <= 0) {
          // Whatever we didn't file stays OUT of the cursor, so the next run
          // still sees it as new rather than silently swallowing it.
          next[pub.id] = paths.filter((p) => knownSet.has(p) || filed.has(p));
          ctx.log(
            `${pub.id}: page budget spent — ${fresh.length - filed.size} page(s) deferred to the next run`,
          );
          break;
        }
        budget--;
        filed.add(path);
        const url = pub.publicUrl(path);
        let body: PageBody | null = null;
        let readFailed = false;
        try {
          const doc = await contentdataDoc(pub.publication, path, ctx);
          body = doc ? pageBody(pub.id, path, url, doc) : null;
        } catch (err) {
          readFailed = true;
          ctx.log(
            `${pub.id}${path}: body fetch failed (${err instanceof Error ? err.message : err})`,
          );
        }
        // A clean 301 means the path resolves to nothing — a stale sitemap
        // entry or a dead link the crawl followed. File nothing, remember it.
        if (!body && !readFailed) {
          nextDead[pub.id]![path] = 0;
          if (PAGE_GAP_MS > 0) await sleep(PAGE_GAP_MS);
          continue;
        }
        records.push({
          externalId: `${pub.id}:${path}`,
          url,
          fetchedAt: new Date(),
          body:
            body ??
            ({
              publication: pub.id,
              path,
              url,
              seoTitle: null,
              seoDescription: null,
              canonicalUrl: null,
              revisionDate: null,
              cmsTitle: null,
            } satisfies PageBody),
        });
        if (PAGE_GAP_MS > 0) await sleep(PAGE_GAP_MS);
      }
    }

    return { records, cursor: { pages: next, missing: nextMissing, dead: nextDead } };
  },

  normalize(raw: RawRecord): PublicRecordInput | null {
    const body = raw.body as PageBody | RemovedBody;
    if (!body || typeof body.path !== "string") throw new Error("uor_web: body has no path");
    if (IGNORED_SECTIONS.test(body.path)) return null;

    // A removal has no document to read — the page is gone. Title it from the
    // slug and say so, so a feed card is never mistaken for a publication.
    if (body.removed) {
      return {
        kind: "web_page",
        externalId: raw.externalId,
        url: raw.url,
        title: `${pathTitle(body.path)} — page removed`,
        description: `Universal removed ${body.path} from ${body.publication}; the page was absent from the listing for ${body.missedRuns} consecutive runs.`,
        filer: "Universal Orlando Resort",
        operator: "universal",
        resortSlug: "universal-orlando",
        filedAt: raw.fetchedAt,
        status: "removed",
        payload: {
          publication: body.publication,
          path: body.path,
          section: sectionOf(body.path),
          removed: true,
          missedRuns: body.missedRuns,
        },
        linkText: [body.path.replace(/[-/]/g, " ")],
        entityNames: [pathTitle(body.path)],
      };
    }

    const title = body.seoTitle ? trimSiteSuffix(body.seoTitle) : pathTitle(body.path);
    const section = sectionOf(body.path);
    const filedAt = body.revisionDate ? new Date(body.revisionDate) : raw.fetchedAt;

    return {
      kind: "web_page",
      externalId: raw.externalId,
      url: raw.url,
      title,
      description: body.seoDescription,
      // Jurisdiction, not a filing party: the publication IS the operator.
      filer: "Universal Orlando Resort",
      operator: "universal",
      resortSlug: "universal-orlando",
      filedAt,
      status: null,
      // No job grouping: a page is not a project, and grouping by section
      // would pile every /things-to-do page into one ever-growing job card.
      payload: {
        publication: body.publication,
        path: body.path,
        section,
        seoTitle: body.seoTitle,
        seoDescription: body.seoDescription,
        canonicalUrl: body.canonicalUrl,
        revisionDate: body.revisionDate,
        cmsTitle: body.cmsTitle,
      },
      linkText: [body.cmsTitle ?? "", body.path.replace(/[-/]/g, " ")].filter(Boolean),
      entityNames: [title],
    };
  },

  linkTextOf(payload) {
    const cms = typeof payload.cmsTitle === "string" ? payload.cmsTitle : "";
    const path = typeof payload.path === "string" ? payload.path.replace(/[-/]/g, " ") : "";
    return [cms, path].filter(Boolean);
  },

  entityNamesOf(payload) {
    const seo = typeof payload.seoTitle === "string" ? trimSiteSuffix(payload.seoTitle) : null;
    const path = typeof payload.path === "string" ? pathTitle(payload.path) : null;
    return [seo ?? path ?? ""].filter(Boolean);
  },

  resortFor: () => "universal-orlando",
};
