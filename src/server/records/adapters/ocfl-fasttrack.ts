/**
 * Orange County Fast Track — unincorporated-county building permits
 * (plan §5.4, A4). **This is where Epic Universe lives**: the park sits in
 * unincorporated Orange County (`CITY_CODE=ORG`), so the City of Orlando feed
 * (§5.1) has no Epic permit at all, and the County publishes no open-data
 * permit feed.
 *
 * The portal's HTML search is captcha-walled and we never touch it. The one
 * surface we use is the page method the site's own quick-search box calls:
 *
 *   POST /OnlineServices/QuickSearch.aspx/GetFolderInfo
 *   {"sMode":"F"|"A"|"P","sVal":"<permit no>"|"<address>"|"<parcel>"}
 *
 * No captcha, no session, no token. It returns permit number, status, folder
 * type, address, parcel roll, apply/issue dates and — the field this whole
 * adapter exists for — **PROJECT NAME**, which is where a project's internal
 * cover name sits until the day it changes ("Sound Stage" for the Celestial
 * Park event building, project P915).
 *
 * `A` and `P` modes are capped at two rows by the server, so they can't
 * enumerate a parcel's permits; only exact-number `F` lookups are complete.
 * Hence three passes, each separately budgeted, in priority order:
 *
 *   1. **watchlist** — `A`/`P` on our own addresses and parcels. ~20 requests,
 *      catches most new permits within a day of filing.
 *   2. **recheck** — `F` on permits we have already filed, rotating. This is
 *      what catches a STATUS or PROJECT NAME change on a permit we know: the
 *      rename is the story.
 *   3. **sweep** (OFF by default, `RECORDS_FASTTRACK_SWEEP=1`) — `F` walking a
 *      `<prefix><yy>` series upward from a watermark. Probed 2026-09-15: `F`
 *      is exact-match, with no prefix search, so enumeration is the only way
 *      to be complete — and permit numbers are county-wide, so most of what a
 *      walk reads is somebody else's shed. It therefore never blind-starts:
 *      a series is only walked once a real permit has revealed its numbering,
 *      and the watermark carries across runs. The first two passes cost ~35
 *      requests a day and catch almost everything; the sweep is the optional
 *      completeness pass behind an explicit flag.
 *
 * Etiquette (plan §9 — and the user's explicit go-ahead on 2026-09-15): one
 * request at a time, `GAP_MS` apart, a hard per-run request budget, our honest
 * user agent, and an immediate stop on 403/429/503 (the portal telling us to
 * back off) which also holds the cursor so the next run resumes rather than
 * retries harder. The adapter refuses to run until `RECORDS_FASTTRACK_ENABLE`
 * is set, so it can never start by accident from a registry import.
 */
import { cleanText, jobSlug, matchAlias, normalizeFiler } from "../normalize.ts";

import type { Adapter, FetchResult, Operator, PublicRecordInput, RawRecord } from "../types.ts";

export const FASTTRACK_SOURCE = "ocfl_fasttrack";

const ENDPOINT =
  process.env.RECORDS_FASTTRACK_URL ??
  "https://fasttrack.ocfl.net/OnlineServices/QuickSearch.aspx/GetFolderInfo";
const PORTAL = "https://fasttrack.ocfl.net/OnlineServices/QuickSearch.aspx";

/** Hard ceiling on requests per run, across all three passes. */
const MAX_REQUESTS = Number(process.env.RECORDS_FASTTRACK_MAX ?? 250);
/** Gap between requests on the cheap targeted passes — one per second. */
const GAP_MS = Number(process.env.RECORDS_FASTTRACK_GAP_MS ?? 1000);
/**
 * Gap between requests during ENUMERATION, which is the pass that got this IP
 * blocked on 2026-09-15 at ~1.5/s. Four seconds is ~15/minute, slower than a
 * person clicking through the portal, and the walk is resumable so a night's
 * budget is all that matters — not how fast it finishes.
 */
const SWEEP_GAP_MS = Number(process.env.RECORDS_FASTTRACK_SWEEP_GAP_MS ?? 4000);
/**
 * Fraction of the gap to jitter by, so the request train is not a metronome.
 * This is load-shaping, not concealment: the user agent stays honest and the
 * stand-down still fires the moment the portal objects.
 */
const JITTER = Number(process.env.RECORDS_FASTTRACK_JITTER ?? 0.25);
/**
 * How long the adapter stands down after the portal stops answering. Learned
 * the hard way on 2026-09-15: a 4,200-number enumeration got the page method
 * blocked for this IP (the site's home page kept answering in 150 ms while
 * every `GetFolderInfo` POST hung to timeout). When that happens the right
 * behaviour is to go away for a day, not to retry into a wall.
 */
const COOLDOWN_HOURS = Number(process.env.RECORDS_FASTTRACK_COOLDOWN_HOURS ?? 24);
/** Attempts per request before a transient failure stops the run. */
const RETRIES = Number(process.env.RECORDS_FASTTRACK_RETRIES ?? 3);
/** Permits re-read per run to catch a status or project-name change. */
const RECHECK_PER_RUN = Number(process.env.RECORDS_FASTTRACK_RECHECK ?? 30);
/** Consecutive misses that end a series' walk for this run. */
const GAP_TOLERANCE = Number(process.env.RECORDS_FASTTRACK_GAP_TOLERANCE ?? 20);
/** Misses from a series that has never hit before we retire it for good. */
const DEAD_SERIES_MISSES = Number(process.env.RECORDS_FASTTRACK_DEAD_AFTER ?? 40);
/** Permit-number prefixes to walk (observed live: B, Z, X, T). */
const PREFIXES = (process.env.RECORDS_FASTTRACK_PREFIXES ?? "B,Z,X,T,E,M,P")
  .split(",")
  .map((p) => p.trim().toUpperCase())
  .filter(Boolean);
/**
 * Sequence bands inside one prefix-year. The county issues ordinary permits
 * from 1 and a separate "special projects" band from 900000 (`B25906558`, the
 * Epic site-work permit, is in that band).
 */
const BANDS = (process.env.RECORDS_FASTTRACK_BANDS ?? "1,900001")
  .split(",")
  .map((b) => Number(b.trim()))
  .filter((b) => Number.isFinite(b) && b > 0);
/**
 * The enumeration pass is opt-in. Without it the adapter makes ~35 targeted
 * requests a day; with it, it will spend its whole budget walking numbers.
 */
const SWEEP_ENABLED = process.env.RECORDS_FASTTRACK_SWEEP === "1";
/**
 * Optional `YYYY-MM-DD..YYYY-MM-DD` window for the sweep. Permit numbers are
 * issued in filing order, so the sweep can BINARY-SEARCH the sequence space on
 * each permit's apply date and then walk only the window — measured live on
 * 2026-09-15, the `Z26` series runs at ~1,000 permits a month, so a one-month
 * window is ~1,000 reads instead of the ~8,000 a year-to-date walk would cost.
 * Without it the sweep just walks forward from the watermark.
 */
const BACKFILL_WINDOW = (process.env.RECORDS_FASTTRACK_BACKFILL ?? "").trim();
/**
 * `lo..hi` sequence bounds that REPLACE the date search for this run. The
 * search is robust but not cheap — a probe into an unissued stretch costs up
 * to `SEARCH_STEP` requests — so when the bounds are already known (sample a
 * handful of numbers and read their apply dates; the ordering is monotonic)
 * passing them directly saves hundreds of requests. Applies to every series
 * the run selects, so pair it with a single `PREFIXES`/`YEARS`/`BANDS`.
 */
const EXPLICIT_RANGE = (process.env.RECORDS_FASTTRACK_RANGE ?? "").trim();

/** `900001..904200` → the two bounds, or null. */
export function parseRange(raw: string): { lo: number; hi: number } | null {
  const m = /^(\d+)\.\.(\d+)$/.exec(raw);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  return hi >= lo ? { lo, hi } : null;
}
/**
 * How far above a band's base an unseeded series is searched when a backfill
 * window is set. A binary search over this span costs ~20 probes and retires
 * the series if nothing is there, which is how a series we have never seen a
 * permit from (a prefix that only appears on somebody else's paperwork) gets
 * covered without a blind walk.
 */
const SEARCH_SPAN = Number(process.env.RECORDS_FASTTRACK_SEARCH_SPAN ?? 20000);
/**
 * Consecutive unissued numbers the binary search steps over before deciding a
 * region is genuinely empty. Measured live 2026-09-15: the `B26` 9xx band runs
 * 5–10 permits per 12 numbers with holes up to 5 long, so a shallow step (the
 * original 5) collapses the search downward and "proves" a live series is
 * empty. Thirty is comfortably past the longest hole seen.
 */
const SEARCH_STEP = Number(process.env.RECORDS_FASTTRACK_SEARCH_STEP ?? 30);
/** Two-digit years to walk, newest first. */
const YEARS = (process.env.RECORDS_FASTTRACK_YEARS ?? "26,25")
  .split(",")
  .map((y) => y.trim())
  .filter(Boolean);

/** Addresses and parcels whose permits are ours, with the attribution to use. */
interface Target {
  value: string;
  mode: "A" | "P";
  operator: Operator;
  resortSlug: string;
  place: string;
}

export const TARGETS: readonly Target[] = [
  // `A` is a LIKE match (verified live), so the bare street name is the single
  // best tripwire: it returns the two newest permits anywhere on Epic Blvd.
  {
    value: "Epic Blvd",
    mode: "A",
    operator: "universal",
    resortSlug: "universal-orlando",
    place: "Epic Universe campus",
  },
  {
    value: "1001 Epic Blvd",
    mode: "A",
    operator: "universal",
    resortSlug: "universal-orlando",
    place: "Universal Epic Universe",
  },
  {
    value: "4700 W Sand Lake Rd",
    mode: "A",
    operator: "universal",
    resortSlug: "universal-orlando",
    place: "Universal Epic Universe",
  },
  {
    value: "2000 Epic Blvd",
    mode: "A",
    operator: "universal",
    resortSlug: "universal-orlando",
    place: "Epic Universe campus (site work)",
  },
  {
    value: "5500 Epic Blvd",
    mode: "A",
    operator: "universal",
    resortSlug: "universal-orlando",
    place: "Universal Helios Grand Hotel",
  },
  {
    value: "4500 Epic Blvd",
    mode: "A",
    operator: "universal",
    resortSlug: "universal-orlando",
    place: "Universal Stella Nova Resort",
  },
  {
    value: "31-23-29-8851-01-000",
    mode: "P",
    operator: "universal",
    resortSlug: "universal-orlando",
    place: "Epic Universe parcel",
  },
];

/**
 * Address patterns that make an arbitrary swept permit ours. Kept narrow and
 * anchored on the street numbers the county actually uses for the campus.
 */
const ADDRESS_RULES: ReadonlyArray<{
  re: RegExp;
  operator: Operator;
  resortSlug: string;
  place: string;
}> = [
  {
    re: /\bepic\s+blvd/i,
    operator: "universal",
    resortSlug: "universal-orlando",
    place: "Epic Universe campus",
  },
  {
    re: /\b4700\s+w\.?\s*sand\s*lake\s*rd/i,
    operator: "universal",
    resortSlug: "universal-orlando",
    place: "Universal Epic Universe",
  },
];

/** Parcel rolls (Fast Track's dashed form) that are operator land. */
const PARCEL_RULES: Readonly<
  Record<string, { operator: Operator; resortSlug: string; place: string }>
> = {
  "31-23-29-8851-01-000": {
    operator: "universal",
    resortSlug: "universal-orlando",
    place: "Universal Epic Universe",
  },
};

/**
 * The Property Appraiser's anonymous parcel layer. Fast Track gives a permit's
 * parcel but never its owner, so this is what turns "some permit in the county"
 * into "Universal's permit" without a hand-maintained address list — including
 * on land they buy next year. Verified live 2026-09-15: Fast Track's
 * `31-23-29-8851-01-000` is OCPA `292331885101000` =
 * `UNIVERSAL CITY DEVELOPMENT PARTNERS LTD / EPIC UNIVERSE / 341.89 ac`.
 */
const OCPA_QUERY =
  process.env.RECORDS_OCPA_URL ??
  "https://vgispublic.ocpafl.org/server/rest/services/DYNAMIC/Dynamic_Parcels/MapServer/3/query";
/** Parcels resolved per ArcGIS request, and the per-run ceiling on lookups. */
const OWNER_BATCH = Number(process.env.RECORDS_OCPA_BATCH ?? 50);
const OWNER_MAX = Number(process.env.RECORDS_OCPA_MAX ?? 1500);

/**
 * Fast Track's `SS-TT-RR-SSSS-BB-LLL` → OCPA's 15-digit `RRTTSS…`. The first
 * three components are in the opposite order; the rest concatenate as-is.
 */
export function ocpaParcel(raw: string | null | undefined): string | null {
  const s = cleanText(raw);
  if (!s) return null;
  const parts = s.split("-");
  if (parts.length !== 6 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const [ss, tt, rr, sub, blk, lot] = parts as [string, string, string, string, string, string];
  const out = `${rr}${tt}${ss}${sub}${blk}${lot}`;
  return out.length === 15 ? out : null;
}

/** One parcel's ownership, as the layer reports it. */
export interface ParcelOwner {
  parcel: string;
  owner: string | null;
  propName: string | null;
  situs: string | null;
}

/** Read the layer's response into our shape; tolerant of an error envelope. */
export function parseParcels(body: unknown): ParcelOwner[] {
  const features = (body as { features?: Array<{ attributes?: Record<string, unknown> }> })
    ?.features;
  if (!Array.isArray(features)) return [];
  return features.map((f) => {
    const a = f.attributes ?? {};
    return {
      parcel: String(a.PARCEL ?? ""),
      owner: cleanText(a.NAME1),
      propName: cleanText(a.PROP_NAME),
      situs: cleanText(a.SITUS),
    };
  });
}

/** One row as the page method returns it (keys verbatim, spaces included). */
export interface FolderRow {
  REFERENCEFILE?: string;
  STATUS?: string;
  "FOLDER TYPE"?: string;
  FOLDERTYPE?: string;
  STATUSCODE?: string;
  PROPERTY_ADDRESS?: string;
  PROPERTY_ADDRESS_FULL?: string;
  "APPLY DATE"?: string;
  ISSUEDATE?: string;
  "PROJECT NAME"?: string;
  PROPERTYROLL?: string;
  FOLDERRSN?: string;
  PROPERTYRSN?: string;
}

/** What we store per kept permit. */
export interface FastTrackBody {
  row: FolderRow;
  operator: Operator;
  resortSlug: string;
  place: string;
  /** Which pass found it — for the log and the payload, not the identity. */
  pass: "watchlist" | "recheck" | "sweep" | "owner";
}

/** The portal answering "slow down" / "go away". */
export class PortalPushback extends Error {
  constructor(readonly status: number) {
    super(`Fast Track returned ${status} — backing off for this run`);
  }
}

/**
 * The connection dropped and kept dropping. A sweep makes thousands of
 * requests, so a transient `ECONNRESET` must never cost the whole pass: it is
 * retried, and if it persists the run stops gracefully with everything it has
 * already found, exactly like portal pushback.
 */
export class NetworkTrouble extends Error {
  constructor(cause: unknown) {
    super(`network trouble: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/** Transient transport failures worth retrying, by the codes Bun/undici use. */
export function isTransient(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  const code = e?.code ?? "";
  if (["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN"].includes(code))
    return true;
  return /socket connection was closed|fetch failed|connection closed|terminated/i.test(
    e?.message ?? "",
  );
}

/** The step's wall-clock budget ran out mid-pass. */
export class BudgetSpent extends Error {
  constructor() {
    super("step budget spent — stopping this run where it stands");
  }
}

/** An aborted fetch, however the runtime spells it. */
export function isAbort(err: unknown): boolean {
  if (err instanceof BudgetSpent) return true;
  const name = (err as { name?: string })?.name;
  return name === "AbortError" || name === "TimeoutError";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `MM/DD/YY` or `MM/DD/YYYY` → ISO day. The feed mixes both. */
export function ftDate(raw: string | null | undefined): string | null {
  const s = cleanText(raw);
  if (!s) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
  return `${year}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

/** `{"d":"[{…}]"}` — the rows arrive as a JSON string inside the envelope. */
export function parseFolderResponse(body: unknown): FolderRow[] {
  const d = (body as { d?: unknown })?.d;
  const raw = typeof d === "string" ? (JSON.parse(d) as unknown) : d;
  return Array.isArray(raw) ? (raw as FolderRow[]) : [];
}

/** `B` + `26` + zero-padded sequence. */
export function permitNumber(prefix: string, year: string, seq: number): string {
  return `${prefix}${year}${String(seq).padStart(6, "0")}`;
}

/** Attribution for one row, or null when it is not on operator land. */
export function attribute(
  row: FolderRow,
): { operator: Operator; resortSlug: string; place: string } | null {
  const parcel = cleanText(row.PROPERTYROLL);
  if (parcel && PARCEL_RULES[parcel]) return PARCEL_RULES[parcel]!;
  const address = cleanText(row.PROPERTY_ADDRESS_FULL) ?? cleanText(row.PROPERTY_ADDRESS);
  if (!address) return null;
  const rule = ADDRESS_RULES.find((r) => r.re.test(address));
  return rule ? { operator: rule.operator, resortSlug: rule.resortSlug, place: rule.place } : null;
}

interface SeriesState {
  /** Next sequence number to try. */
  next: number;
  /** Windowed backfill: the resolved sequence range and where the walk is. */
  window?: { lo: number; hi: number; at: number; done?: boolean };
  /** True once the series produced a hit — an unhit series is retired faster. */
  seen: boolean;
  /** Consecutive misses carried across runs, for the retirement rule. */
  misses: number;
  /** Retired: walked past the end, or never existed. */
  done?: boolean;
}

interface Cursor {
  /** ISO time before which the adapter must not touch the portal at all. */
  blockedUntil: string | null;
  series: Record<string, SeriesState>;
  /** Permit numbers we have filed, rotated through the recheck pass. */
  known: string[];
  /** Offset into `known` for this run's recheck slice. */
  recheckAt: number;
}

export function parseCursor(raw: Record<string, unknown> | null): Cursor {
  const series: Record<string, SeriesState> = {};
  for (const [k, v] of Object.entries((raw?.series ?? {}) as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const s = v as Partial<SeriesState>;
    const w = s.window;
    series[k] = {
      next: typeof s.next === "number" && s.next > 0 ? s.next : 1,
      seen: s.seen === true,
      misses: typeof s.misses === "number" ? s.misses : 0,
      done: s.done === true,
      window:
        w && typeof w.lo === "number" && typeof w.hi === "number" && typeof w.at === "number"
          ? { lo: w.lo, hi: w.hi, at: w.at, done: w.done === true }
          : undefined,
    };
  }
  const known = Array.isArray(raw?.known)
    ? (raw.known as unknown[]).filter((k): k is string => typeof k === "string")
    : [];
  const recheckAt = typeof raw?.recheckAt === "number" ? raw.recheckAt : 0;
  const blockedUntil = typeof raw?.blockedUntil === "string" ? raw.blockedUntil : null;
  return { blockedUntil, series, known, recheckAt };
}

/** `YYYY-MM-DD..YYYY-MM-DD` → the two ISO days, or null when unset/!parseable. */
export function parseWindow(raw: string): { from: string; to: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(raw);
  return m ? { from: m[1]!, to: m[2]! } : null;
}

/** Every series key this run considers, newest year and lowest band first. */
export function seriesKeys(): string[] {
  const keys: string[] = [];
  for (const year of YEARS)
    for (const prefix of PREFIXES) for (const band of BANDS) keys.push(`${prefix}${year}:${band}`);
  return keys;
}

export const ocflFastTrackAdapter: Adapter = {
  source: FASTTRACK_SOURCE,
  agency: "Orange County Fast Track",
  cadence: "daily",
  // Explicit opt-in: the sweep only runs when the operator of this repo turns
  // it on, never as a side effect of the adapter being registered.
  requiredEnv: ["RECORDS_FASTTRACK_ENABLE"],
  quietWhenEmpty: true,

  async fetchSince(cursor, ctx): Promise<FetchResult> {
    const state = parseCursor(cursor);
    if (state.blockedUntil && Date.parse(state.blockedUntil) > Date.now()) {
      ctx.log(
        `standing down until ${state.blockedUntil} — the portal stopped answering on an earlier run`,
      );
      return { records: [], cursor: cursor ?? {} };
    }
    const records: RawRecord[] = [];
    const filed = new Set<string>(state.known);
    let requests = 0;
    /** Swapped to the slower cadence before the enumeration pass. */
    let gapMs = GAP_MS;
    let pushback: PortalPushback | null = null;
    let stoppedEarly = false;
    let blockedUntil: string | null = state.blockedUntil;

    async function lookup(mode: "F" | "A" | "P", value: string): Promise<FolderRow[]> {
      if (requests >= MAX_REQUESTS) return [];
      // A paced sweep will meet the step's wall clock long before its request
      // budget; stopping cleanly keeps the run's records AND its cursor.
      if (ctx.signal.aborted) throw new BudgetSpent();
      if (requests > 0 && gapMs > 0) {
        const spread = gapMs * JITTER;
        await sleep(Math.round(gapMs - spread + Math.random() * spread * 2));
      }
      requests++;
      let lastErr: unknown;
      for (let attempt = 1; attempt <= RETRIES; attempt++) {
        try {
          const res = await ctx.fetch(ENDPOINT, {
            method: "POST",
            headers: {
              "content-type": "application/json; charset=UTF-8",
              "x-requested-with": "XMLHttpRequest",
              accept: "application/json",
            },
            body: JSON.stringify({ sMode: mode, sVal: value }),
            signal: ctx.signal,
          });
          if (res.status === 403 || res.status === 429 || res.status === 503) {
            throw new PortalPushback(res.status);
          }
          if (!res.ok) throw new Error(`POST GetFolderInfo(${mode}) -> ${res.status}`);
          return parseFolderResponse(await res.json());
        } catch (err) {
          if (err instanceof PortalPushback || isAbort(err)) throw err;
          if (!isTransient(err) || attempt === RETRIES) {
            if (isTransient(err)) throw new NetworkTrouble(err);
            throw err;
          }
          lastErr = err;
          // Back off before retrying: 2 s, then 6 s.
          await sleep(gapMs + attempt * 2000);
        }
      }
      throw new NetworkTrouble(lastErr);
    }

    /**
     * Teach the sweep where a series' numbering currently sits. Every permit
     * number we see — ours or not — moves its series' watermark forward, which
     * is why the sweep never has to start from 1.
     */
    function observe(id: string): void {
      const m = /^([A-Z]+)(\d{2})(\d{6})$/.exec(id);
      if (!m) return;
      const seq = Number(m[3]);
      const band = [...BANDS].sort((a, b) => b - a).find((b) => seq >= b) ?? BANDS[0] ?? 1;
      const key = `${m[1]}${m[2]}:${band}`;
      const cur = state.series[key];
      if (!cur) {
        state.series[key] = { next: seq + 1, seen: true, misses: 0 };
        return;
      }
      // Seeing ANY permit proves the series exists — that is independent of
      // whether this number is past the watermark. (A windowed pass starts its
      // watermark at the TOP of the search span, so gating `seen` on the
      // watermark made every windowed search declare a live series empty.)
      cur.seen = true;
      cur.done = false;
      if (seq >= cur.next) {
        cur.next = seq + 1;
        cur.misses = 0;
      }
    }

    /** Keep a row if it is on operator land; dedupe within the run. */
    const seenThisRun = new Set<string>();
    /**
     * Rows we could not attribute from the address/parcel rules but which DO
     * carry a parcel — resolved against the Property Appraiser in one batched
     * pass at the end, so an unknown Universal parcel still lands.
     */
    const unattributed = new Map<string, FolderRow[]>();
    function keep(row: FolderRow, pass: FastTrackBody["pass"]): void {
      const id = cleanText(row.REFERENCEFILE);
      if (!id || seenThisRun.has(id)) return;
      const who = attribute(row);
      if (!who) {
        const parcel = cleanText(row.PROPERTYROLL);
        if (parcel && ocpaParcel(parcel) && unattributed.size < OWNER_MAX) {
          const list = unattributed.get(parcel) ?? [];
          list.push(row);
          unattributed.set(parcel, list);
        }
        return;
      }
      seenThisRun.add(id);
      filed.add(id);
      observe(id);
      records.push({
        externalId: id,
        url: `${PORTAL}?Mode=F&Value=${encodeURIComponent(id)}`,
        fetchedAt: new Date(),
        body: { row, ...who, pass } satisfies FastTrackBody,
      });
    }

    try {
      // 1. Watchlist — our own addresses and parcels, every run.
      for (const target of TARGETS) {
        if (requests >= MAX_REQUESTS) break;
        for (const row of await lookup(target.mode, target.value)) {
          const id = cleanText(row.REFERENCEFILE);
          if (id) observe(id);
          keep(row, "watchlist");
        }
      }
      ctx.log(
        `watchlist: ${records.length} permit(s) on operator land after ${requests} request(s)`,
      );

      // 2. Recheck — a rotating slice of what we have already filed, so a
      //    status change or a renamed project reaches the ledger as a revision.
      if (state.known.length > 0) {
        const start = state.recheckAt % state.known.length;
        const slice = [...state.known.slice(start), ...state.known.slice(0, start)].slice(
          0,
          RECHECK_PER_RUN,
        );
        for (const id of slice) {
          if (requests >= MAX_REQUESTS) break;
          if (seenThisRun.has(id)) continue;
          for (const row of await lookup("F", id)) keep(row, "recheck");
        }
        state.recheckAt = (start + slice.length) % Math.max(state.known.length, 1);
        ctx.log(`recheck: re-read ${slice.length} known permit(s)`);
      }

      // 3. Sweep — walk each series upward from its watermark with whatever
      //    budget is left. Newest year first, so today's permits win the budget.
      if (!SWEEP_ENABLED) {
        ctx.log("sweep: disabled (set RECORDS_FASTTRACK_SWEEP=1 to enumerate)");
      } else {
        gapMs = SWEEP_GAP_MS;
        ctx.log(
          `sweep: pacing down to one request per ${(gapMs / 1000).toFixed(1)}s ±${Math.round(JITTER * 100)}%`,
        );
      }
      const explicit = EXPLICIT_RANGE ? parseRange(EXPLICIT_RANGE) : null;
      if (EXPLICIT_RANGE && !explicit)
        ctx.log(`backfill: ignoring unparseable range "${EXPLICIT_RANGE}"`);
      const window = explicit
        ? { from: "", to: "" }
        : BACKFILL_WINDOW
          ? parseWindow(BACKFILL_WINDOW)
          : null;
      if (BACKFILL_WINDOW && !explicit && !window)
        ctx.log(`backfill: ignoring unparseable window "${BACKFILL_WINDOW}"`);

      for (const key of SWEEP_ENABLED ? seriesKeys() : []) {
        if (requests >= MAX_REQUESTS) break;
        const [series, bandRaw] = key.split(":");
        const band = Number(bandRaw);
        const prefix = series!.slice(0, series!.length - 2);
        const year = series!.slice(-2);
        const windowed = Boolean(
          (EXPLICIT_RANGE && parseRange(EXPLICIT_RANGE)) ||
          (BACKFILL_WINDOW && parseWindow(BACKFILL_WINDOW)),
        );
        // A forward walk is never blind-started: without a real permit to
        // anchor it, walking from the band base is thousands of requests into
        // empty space. A WINDOWED pass may start cold, because the binary
        // search that opens it is ~20 probes and retires a series that is not
        // there — that is how a prefix we have never seen still gets covered.
        const s = (state.series[key] ??= windowed
          ? { next: band + SEARCH_SPAN, seen: false, misses: 0 }
          : { next: band, seen: false, misses: 0 });
        if (s.done || (!windowed && !s.seen)) continue;

        /** The apply date of one sequence number, or null when there is no permit. */
        const dateAt = async (seq: number): Promise<string | null> => {
          const rows = await lookup("F", permitNumber(prefix!, year!, seq));
          for (const row of rows) {
            const id = cleanText(row.REFERENCEFILE);
            if (id) observe(id);
            keep(row, "sweep");
          }
          return rows.length > 0 ? ftDate(rows[0]!["APPLY DATE"]) : null;
        };

        /**
         * Lowest sequence in [lo, hi] whose apply date reaches `target`.
         * Numbers are issued in filing order, so the date is monotonic; gaps
         * (numbers the county never issued) are stepped over, up to a few.
         */
        const searchFor = async (target: string, lo: number, hi: number): Promise<number> => {
          let low = lo;
          let high = hi;
          while (low < high && requests < MAX_REQUESTS) {
            const mid = Math.floor((low + high) / 2);
            let probe = mid;
            let date: string | null = null;
            for (
              let step = 0;
              step < SEARCH_STEP && probe <= high && requests < MAX_REQUESTS;
              step++
            ) {
              date = await dateAt(probe);
              if (date) break;
              probe++;
            }
            if (!date)
              high = mid; // a run of empty numbers: search below it
            else if (date < target) low = probe + 1;
            else high = probe;
          }
          return low;
        };

        if (window) {
          if (s.window?.done) continue;
          if (!s.window && explicit) {
            s.window = { lo: explicit.lo, hi: explicit.hi, at: explicit.lo };
            ctx.log(
              `series ${key}: walking ${permitNumber(prefix!, year!, explicit.lo)}..${permitNumber(prefix!, year!, explicit.hi)} (${explicit.hi - explicit.lo + 1} numbers, explicit range)`,
            );
          }
          if (!s.window) {
            // Resolve the window to a sequence range once, then persist it.
            const hiBound = Math.max(s.next - 1, band);
            const lo = await searchFor(window.from, band, hiBound);
            if (requests >= MAX_REQUESTS) {
              ctx.log(`series ${key}: budget spent while locating ${window.from}`);
              break;
            }
            const hi = await searchFor(window.to, lo, hiBound);
            if (!s.seen) {
              // The search never landed on a permit. That can mean the series
              // does not exist — or that it is sparse and the walk-over was
              // unlucky. Never retire on this evidence: leave the series
              // unresolved and let the next run try again.
              ctx.log(`series ${key}: no permit found while locating the window — left unresolved`);
              continue;
            }
            s.window = { lo, hi: Math.max(hi, lo), at: lo };
            ctx.log(
              `series ${key}: window ${window.from}..${window.to} = ${permitNumber(prefix!, year!, lo)}..${permitNumber(prefix!, year!, s.window.hi)} (${s.window.hi - lo + 1} numbers)`,
            );
          }
          const w = s.window;
          while (requests < MAX_REQUESTS && w.at <= w.hi) {
            await dateAt(w.at);
            w.at++;
          }
          if (w.at > w.hi) {
            w.done = true;
            ctx.log(`series ${key}: window complete`);
          }
          continue;
        }

        let misses = 0;
        while (requests < MAX_REQUESTS && misses < GAP_TOLERANCE) {
          const id = permitNumber(prefix!, year!, s.next);
          const rows = await lookup("F", id);
          if (rows.length === 0) {
            misses++;
            s.misses++;
            s.next++;
            continue;
          }
          misses = 0;
          s.misses = 0;
          for (const row of rows) {
            const found = cleanText(row.REFERENCEFILE);
            if (found) observe(found);
            keep(row, "sweep");
          }
          s.next++;
        }
        // Walked into a long gap: rewind to the first miss so tomorrow resumes
        // there rather than skipping the numbers the county hasn't issued yet.
        if (misses >= GAP_TOLERANCE) s.next -= misses;
        if (!s.seen && s.misses >= DEAD_SERIES_MISSES) {
          s.done = true;
          ctx.log(`series ${key}: retired after ${s.misses} misses with no hit`);
        }
      }
      // 4. Owner resolution — everything the rules missed, in batches.
      const parcels = [...unattributed.keys()];
      if (parcels.length > 0) {
        let matched = 0;
        for (let i = 0; i < parcels.length; i += OWNER_BATCH) {
          const batch = parcels.slice(i, i + OWNER_BATCH);
          const ids = batch
            .map(ocpaParcel)
            .filter((v): v is string => Boolean(v))
            .map((v) => `'${v}'`);
          if (ids.length === 0) continue;
          const url = `${OCPA_QUERY}?f=json&returnGeometry=false&outFields=${encodeURIComponent(
            "PARCEL,NAME1,PROP_NAME,SITUS",
          )}&where=${encodeURIComponent(`PARCEL IN (${ids.join(",")})`)}`;
          let owners: ParcelOwner[];
          try {
            const res = await ctx.fetch(url, {
              headers: { accept: "application/json" },
              signal: ctx.signal,
            });
            if (!res.ok) throw new Error(`GET parcels -> ${res.status}`);
            owners = parseParcels(await res.json());
          } catch (err) {
            ctx.log(`owners: lookup failed (${err instanceof Error ? err.message : err})`);
            break;
          }
          const byOcpa = new Map(owners.map((o) => [o.parcel, o]));
          for (const ftParcel of batch) {
            const o = byOcpa.get(ocpaParcel(ftParcel)!);
            if (!o?.owner) continue;
            const alias = matchAlias(normalizeFiler(o.owner), ctx.aliases);
            if (!alias) continue;
            matched++;
            for (const row of unattributed.get(ftParcel) ?? []) {
              const id = cleanText(row.REFERENCEFILE);
              if (!id || seenThisRun.has(id)) continue;
              seenThisRun.add(id);
              filed.add(id);
              records.push({
                externalId: id,
                url: `${PORTAL}?Mode=F&Value=${encodeURIComponent(id)}`,
                fetchedAt: new Date(),
                body: {
                  row,
                  operator: alias.operator,
                  resortSlug: alias.resortSlug ?? "universal-orlando",
                  place: o.propName ?? o.situs ?? "operator parcel",
                  pass: "owner",
                } satisfies FastTrackBody,
              });
            }
          }
        }
        ctx.log(
          `owners: resolved ${parcels.length} unknown parcel(s), ${matched} belong to an operator`,
        );
      }
    } catch (err) {
      if (err instanceof PortalPushback) {
        pushback = err;
        blockedUntil = new Date(Date.now() + COOLDOWN_HOURS * 3_600_000).toISOString();
        ctx.log(`${err.message} — standing down until ${blockedUntil}`);
      } else if (isAbort(err)) {
        stoppedEarly = true;
        ctx.log("step budget spent — returning what this run found");
      } else if (err instanceof NetworkTrouble) {
        stoppedEarly = true;
        blockedUntil = new Date(Date.now() + COOLDOWN_HOURS * 3_600_000).toISOString();
        ctx.log(
          `${err.message} — keeping what this run found and standing down until ${blockedUntil}`,
        );
      } else throw err;
    }

    ctx.log(
      `${requests} request(s), ${records.length} permit(s) kept${pushback || stoppedEarly ? " (stopped early)" : ""}`,
    );
    return {
      records,
      cursor: {
        blockedUntil,
        series: state.series,
        // Cap the recheck list so the cursor can't grow without bound.
        known: [...filed].slice(-2000),
        recheckAt: state.recheckAt,
      },
    };
  },

  normalize(raw: RawRecord): PublicRecordInput | null {
    const body = raw.body as FastTrackBody;
    const row = body?.row;
    if (!row || typeof row !== "object") throw new Error("ocfl_fasttrack: body has no row");
    const id = cleanText(row.REFERENCEFILE);
    if (!id) return null;

    const projectName = cleanText(row["PROJECT NAME"]);
    const folderType = cleanText(row["FOLDER TYPE"]);
    const address = cleanText(row.PROPERTY_ADDRESS_FULL) ?? cleanText(row.PROPERTY_ADDRESS);
    const applied = ftDate(row["APPLY DATE"]);
    const issued = ftDate(row.ISSUEDATE);

    return {
      kind: "permit",
      externalId: id,
      url: raw.url,
      title: projectName ?? folderType ?? id,
      description: [folderType, address].filter(Boolean).join(" · ") || null,
      // The page method returns no owner or contractor — attribution is the
      // parcel/address, asserted by the adapter.
      filer: null,
      operator: body.operator,
      resortSlug: body.resortSlug,
      filedAt: applied ? new Date(`${applied}T12:00:00Z`) : null,
      status: cleanText(row.STATUS),
      statusAt: issued ? new Date(`${issued}T12:00:00Z`) : null,
      address,
      parcelId: cleanText(row.PROPERTYROLL),
      // Trade permits of one project share its project name.
      jobKey: projectName ? jobSlug(projectName) : null,
      jobTitle: projectName,
      payload: {
        permitNumber: id,
        projectName,
        applicationType: folderType,
        folderTypeCode: cleanText(row.FOLDERTYPE),
        statusCode: cleanText(row.STATUSCODE),
        appliedOn: applied,
        issuedOn: issued,
        address,
        parcel: cleanText(row.PROPERTYROLL),
        place: body.place,
        folderRsn: cleanText(row.FOLDERRSN),
      },
      linkText: [projectName, body.place].filter((v): v is string => Boolean(v)),
      entityNames: projectName ? [projectName] : [],
    };
  },

  linkTextOf(payload) {
    return [payload.projectName, payload.place].filter((v): v is string => typeof v === "string");
  },

  entityNamesOf(payload) {
    return typeof payload.projectName === "string" ? [payload.projectName] : [];
  },

  resortFor: (operator) => (operator === "universal" ? "universal-orlando" : null),
};
