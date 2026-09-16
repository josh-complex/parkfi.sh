/**
 * The Waits board's URL state (docs/plans/waits-redesign §4).
 *
 * The board is the app's most-shared surface and, until now, a filtered one
 * couldn't be linked or even survive a reload. Every control on the page —
 * the park strip, the rail, the phone drawer, the sort chips, the view toggle —
 * writes here.
 *
 * **Every key is optional and absent when it holds its default**, so the
 * unfiltered board is exactly `/` and stays the canonical URL for SEO; a
 * filtered variant points its `<link rel="canonical">` back at `/`.
 */
import { EMPTY_RIDE_FILTER, HEIGHT_BAND_OPTIONS, MAX_WAIT_OPTIONS } from "./ride-filter.tsx";

import type { RideFilter } from "./ride-filter.tsx";

export type WaitsView = "list" | "tiles";
export type WaitsSort = "wait" | "name" | "park";
export type WaitsSortDir = "asc" | "desc";

export interface WaitsSearch {
  /** Comma-separated park slugs. */
  parks?: string;
  /** Comma-separated category keys. */
  cat?: string;
  /** Free-text name search. */
  q?: string;
  /** Open now. */
  open?: true;
  /** Longest wait, minutes. */
  max?: number;
  /** Rider height band, inches. */
  h?: number;
  /** No height minimum. */
  nh?: true;
  /** Single rider. */
  sr?: true;
  /** Accepts Express. */
  xp?: true;
  /** Child swap. */
  cs?: true;
  /**
   * Legacy: Halloween Horror Nights houses only, from when the houses were a
   * standalone toggle rather than the `house` type. Still parsed so shared
   * links keep working — it folds into `cat` and is never written back.
   */
  hhn?: true;
  view?: WaitsView;
  sort?: WaitsSort;
  dir?: WaitsSortDir;
}

const VIEWS: ReadonlyArray<WaitsView> = ["list", "tiles"];
const SORT_KEYS: ReadonlyArray<WaitsSort> = ["wait", "name", "park"];
const DIRS: ReadonlyArray<WaitsSortDir> = ["asc", "desc"];

/** A string param, trimmed; undefined when absent or empty. */
function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** `true` only for a present, truthy flag — anything else drops the key. */
function flag(v: unknown): true | undefined {
  return v === true || v === "true" || v === "1" ? true : undefined;
}

/** A number param, but only if it's one of the values the UI can actually show. */
function oneOfNumber(v: unknown, allowed: ReadonlyArray<number>): number | undefined {
  const n = typeof v === "number" ? v : Number(str(v));
  return Number.isFinite(n) && allowed.includes(n) ? n : undefined;
}

function oneOf<T extends string>(v: unknown, allowed: ReadonlyArray<T>): T | undefined {
  const s = str(v);
  return s != null && (allowed as ReadonlyArray<string>).includes(s) ? (s as T) : undefined;
}

/**
 * Parse whatever is in the query string into the board's state.
 *
 * Deliberately total and lenient: a hand-edited or stale URL degrades to the
 * default board rather than throwing a 404 at a shared link. Unknown park and
 * category values survive parsing (we don't have the catalog here) and simply
 * match nothing downstream.
 */
export function validateWaitsSearch(raw: Record<string, unknown>): WaitsSearch {
  const out: WaitsSearch = {
    parks: str(raw.parks),
    cat: str(raw.cat),
    q: str(raw.q),
    open: flag(raw.open),
    max: oneOfNumber(raw.max, MAX_WAIT_OPTIONS),
    h: oneOfNumber(raw.h, HEIGHT_BAND_OPTIONS),
    nh: flag(raw.nh),
    sr: flag(raw.sr),
    xp: flag(raw.xp),
    cs: flag(raw.cs),
    hhn: flag(raw.hhn),
    view: oneOf(raw.view, VIEWS),
    sort: oneOf(raw.sort, SORT_KEYS),
    dir: oneOf(raw.dir, DIRS),
  };
  // Strip the undefined keys so TanStack Router doesn't stamp `?open=` style
  // empties into the URL and `/` stays byte-identical to the default board.
  for (const k of Object.keys(out) as Array<keyof WaitsSearch>) {
    if (out[k] === undefined) delete out[k];
  }
  return out;
}

const splitSet = (v: string | undefined): Set<string> =>
  new Set(
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );

/** Old `?hhn=1` links mean the same thing the `house` type means now. */
const houseFold = (cat: Set<string>, hhn: boolean): Set<string> =>
  hhn ? new Set([...cat, "house"]) : cat;

/**
 * Overlay a parsed search onto the live filter. Written as a merge rather than
 * a construction so the map's overlay `layers` — which this page neither shows
 * nor serialises — survive a visit to the board.
 */
export function applySearchToFilter(current: RideFilter, s: WaitsSearch): RideFilter {
  return {
    ...current,
    parks: splitSet(s.parks),
    categories: houseFold(splitSet(s.cat), s.hhn === true),
    query: s.q ?? "",
    openOnly: s.open === true,
    maxWait: s.max ?? null,
    heightBand: s.h ?? null,
    noHeightReq: s.nh === true,
    singleRider: s.sr === true,
    expressPass: s.xp === true,
    childSwap: s.cs === true,
  };
}

/** Sorted-and-joined so the same selection always produces the same URL. */
const joinSet = (v: ReadonlySet<string>): string | undefined =>
  v.size > 0 ? [...v].sort().join(",") : undefined;

/**
 * The inverse: the smallest search object that reproduces this board. Defaults
 * are omitted, not spelled out — `wait`/`desc`/`list` never appear in the URL.
 */
export function filterToSearch(
  f: RideFilter,
  view: WaitsView,
  sort: WaitsSort,
  dir: WaitsSortDir,
): WaitsSearch {
  const out: WaitsSearch = {
    parks: joinSet(f.parks),
    cat: joinSet(f.categories),
    q: f.query.trim() || undefined,
    open: f.openOnly || undefined,
    max: f.maxWait ?? undefined,
    h: f.heightBand ?? undefined,
    nh: f.noHeightReq || undefined,
    sr: f.singleRider || undefined,
    xp: f.expressPass || undefined,
    cs: f.childSwap || undefined,
    view: view === "list" ? undefined : view,
    sort: sort === "wait" ? undefined : sort,
    dir: dir === "desc" ? undefined : dir,
  };
  for (const k of Object.keys(out) as Array<keyof WaitsSearch>) {
    if (out[k] === undefined) delete out[k];
  }
  return out;
}

/** True when a search object describes the plain, unfiltered, default board. */
export function isDefaultSearch(s: WaitsSearch): boolean {
  return Object.keys(s).length === 0;
}

/** The filter a bare `/` means — used to reset without importing two modules. */
export const DEFAULT_WAITS_FILTER = EMPTY_RIDE_FILTER;
