import type { Browser, CookieParam, Frame, HTTPRequest, Page } from "puppeteer-core";

import { config } from "#/server/parks/config.ts";

import { loadSecret, loadSession, saveSecret, saveSession, type StorageState } from "./session.ts";

/**
 * MyDisney (OneID) login automation + session reuse, per
 * research/disney-ticket-deep-dive.md §8. The form is a CROSS-ORIGIN iframe
 * (`cdn.registerdisney.go.com`), so we operate on that frame, not the page.
 * Login is rare — we persist `storageState` and reuse it; re-login only when a
 * stored session fails to validate.
 */

const SESSION_NAME = "disney_oneid";
const HOME = "https://disneyworld.disney.go.com/";
const LOGIN_URL = "https://disneyworld.disney.go.com/login/";
// The dine-res bundle (not the home page) mints the LBJS token cookie — load a
// dining page so the cookie exists before we read it.
const DINING_URL = "https://disneyworld.disney.go.com/dining/";
// The OneID/LBJS token has shipped under different cookie suffixes (`.token`,
// `.api`); match the whole family rather than one fixed name.
const LBJS_COOKIE_PREFIX = "TPR-WDW-LBJS";
const NAV_TIMEOUT_MS = 60_000;
const BROWSER_UA =
  process.env.DISNEY_BROWSER_UA ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── OneID refresh-token bearer mint (no browser) ───────────────────────────
//
// The dine-vas bearer is just the OneID `access_token` (24h). Rather than drive
// a browser login (which trips an email-OTP step-up on the datacenter/headless
// Browserless fingerprint), we exchange a long-lived (180d) refresh token for a
// fresh access_token over plain HTTP — VERIFIED live: refresh → 200 + bearer →
// dine-vas availability → 200. The refresh token ROTATES on every use, so we
// persist the new one each time; as long as the cron runs at least once per
// 180d the window rolls forward indefinitely. Seed the first token with the
// `seed-token` bootstrap. See research/disney-ticket-deep-dive.md.
const ONEID_REFRESH_SESSION = "disney_oneid_refresh";

export interface OneIdRefreshState {
  refreshToken: string;
}

/** Recursively find the first string value under `key` anywhere in `obj`. */
function deepFindString(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === key && typeof v === "string") return v;
    if (v && typeof v === "object") {
      const found = deepFindString(v, key);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Mint a fresh dine-vas bearer by exchanging the stored OneID refresh token,
 * persisting the rotated refresh token before returning. Throws if no token is
 * seeded or the exchange fails (e.g. a 180d-expired / revoked token → re-seed).
 * `signal` lets the cron's budget abort a hung request.
 */
export async function refreshDineBearer(signal?: AbortSignal): Promise<string> {
  const apiKey = config.disneyOneIdApiKey;
  if (!apiKey) throw new Error("DISNEY_ONEID_APIKEY not set");
  const stored = await loadSecret<OneIdRefreshState>(ONEID_REFRESH_SESSION);
  if (!stored?.refreshToken) {
    throw new Error(
      `no OneID refresh token stored (session "${ONEID_REFRESH_SESSION}") — run the seed-token bootstrap`,
    );
  }

  const url = `${config.disneyOneIdBase}/client/${config.disneyOneIdClientId}/guest/refresh-auth`;
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      Authorization: `APIKEY ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": BROWSER_UA,
    },
    body: JSON.stringify({ refreshToken: stored.refreshToken }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OneID refresh failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json().catch(() => null)) as unknown;
  const accessToken = deepFindString(json, "access_token");
  if (!accessToken) throw new Error("OneID refresh: no access_token in response");

  // Rotation: the response carries a NEW refresh token and the old one is now
  // spent. Persist the new one BEFORE returning — if this save fails the old
  // token is already dead, so we surface it loudly (next run re-seeds) rather
  // than hand back a bearer atop an unsaved rotation.
  const newRefresh = deepFindString(json, "refresh_token");
  if (newRefresh && newRefresh !== stored.refreshToken) {
    await saveSecret(ONEID_REFRESH_SESSION, {
      refreshToken: newRefresh,
    } satisfies OneIdRefreshState);
  }
  return accessToken;
}

/** Seed (bootstrap) the OneID refresh token — used once by the seed-token CLI. */
export function seedDineRefreshToken(refreshToken: string): Promise<void> {
  return saveSecret(ONEID_REFRESH_SESSION, { refreshToken } satisfies OneIdRefreshState);
}

/** Wait for the OneID iframe (cdn.registerdisney.go.com) and return its Frame. */
async function oneidFrame(page: Page, timeoutMs = 25_000): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const f = page.frames().find((fr) => /registerdisney\.go\.com/.test(fr.url()));
    if (f) return f;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("OneID frame never appeared");
}

/** Click a button/link inside a frame by its visible text (IDs are dynamic). */
function clickByText(frame: Frame, text: string): Promise<void> {
  return frame.evaluate((t: string) => {
    const el = [...document.querySelectorAll("button,[role=button],a,[type=submit]")].find(
      (e) => (e.textContent ?? "").trim().toLowerCase() === t.toLowerCase(),
    );
    if (!el) throw new Error(`OneID: no button "${t}"`);
    (el as HTMLElement).click();
  }, text);
}

/** Snapshot cookies + localStorage from the logged-in page. */
async function harvest(page: Page): Promise<StorageState> {
  const cookies = (await page.cookies()) as unknown as Array<Record<string, unknown>>;
  const ls = await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k) out[k] = window.localStorage.getItem(k) ?? "";
    }
    return out;
  });
  return { cookies, localStorage: ls };
}

/** Run the identifier-first OneID login on `page`, persist + return the session. */
export async function disneyLogin(page: Page): Promise<StorageState> {
  const email = process.env.DISNEY_EMAIL;
  const pass = process.env.DISNEY_PASS;
  if (!email || !pass) throw new Error("DISNEY_EMAIL / DISNEY_PASS not set");

  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
  // OneTrust consent lives in the top doc and can intercept clicks — dismiss it.
  await page
    .evaluate(() => document.querySelector<HTMLElement>("#onetrust-accept-btn-handler")?.click())
    .catch(() => {});

  const frame = await oneidFrame(page);
  // screen 1: email
  await frame.waitForSelector('input[type="email"]', { visible: true, timeout: 20_000 });
  await frame.type('input[type="email"]', email, { delay: 60 });
  await clickByText(frame, "Continue");
  // screen 2: password (same iframe)
  await frame.waitForSelector('input[type="password"]', { visible: true, timeout: 20_000 });
  await frame.type('input[type="password"]', pass, { delay: 60 });
  await clickByText(frame, "Log In");
  // success: redirected back to disneyworld with the SWID session cookie set
  await page.waitForFunction(
    () => /disneyworld\.disney\.go\.com/.test(location.host) && /SWID/i.test(document.cookie),
    { timeout: 45_000 },
  );

  const state = await harvest(page);
  await saveSession(SESSION_NAME, state, { accountLabel: email });
  return state;
}

/** Apply a stored session to a page (cookies, then localStorage on-origin). */
async function applySession(page: Page, state: StorageState): Promise<void> {
  if (state.cookies?.length) {
    await page.setCookie(...(state.cookies as unknown as Array<CookieParam>));
  }
  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => {});
  await page
    .evaluate((ls: Record<string, string>) => {
      for (const [k, v] of Object.entries(ls)) window.localStorage.setItem(k, v);
    }, state.localStorage ?? {})
    .catch(() => {});
}

async function looksLoggedIn(page: Page): Promise<boolean> {
  return page.evaluate(() => /SWID/i.test(document.cookie) && !/\/login/.test(location.pathname));
}

/**
 * Return a page with a valid logged-in session: reuse the stored one if it
 * validates, else run the (rare) login. Caller issues dine-vas fetches on it.
 */
export async function ensureLoggedIn(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.setUserAgent(BROWSER_UA);
  await page.setViewport({ width: 1280, height: 900 });

  const stored = await loadSession(SESSION_NAME);
  if (stored?.cookies?.length) {
    await applySession(page, stored);
    if (await looksLoggedIn(page)) return page;
  }
  await disneyLogin(page);
  return page;
}

/**
 * Mint the dine-vas bearer. The token isn't persisted in a readable cookie /
 * localStorage — the dine-res SPA mints it on demand — so we drive the
 * reservation widget on a real restaurant page to fire a `getAvailability` call
 * and sniff `Authorization: BEARER …` off it. The browser is needed ONLY for
 * this; the caller then fires dine-vas requests as plain `fetch`es with the
 * returned bearer, so the session needn't stay alive.
 *
 * `triggerUrls` are bookable restaurant detail pages (their widget fires the
 * call); we try each, then re-login once and retry, before giving up.
 */
export async function mintDineBearer(
  browser: Browser,
  triggerUrls: Array<string> = [],
): Promise<string> {
  const page = await ensureLoggedIn(browser);
  const urls = [...triggerUrls, DINING_URL];
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of urls) {
      const token = await sniffBearer(page, url);
      if (token) return token;
    }
    if (attempt === 0) await disneyLogin(page); // session stale → re-login, retry once
  }
  throw new Error(`dine-vas: could not obtain OneID bearer token\n${await dumpTokenSources(page)}`);
}

/** Structure (not secrets) of the LBJS cookies + localStorage, for diagnosing a miss. */
async function dumpTokenSources(page: Page): Promise<string> {
  const lbjs = (await page.cookies(HOME))
    .filter((c) => c.name.startsWith(LBJS_COOKIE_PREFIX))
    .map((c) => `  ${c.name} (len=${c.value.length}, head=${c.value.slice(0, 48)}…)`);
  const lsKeys = await page.evaluate(() => {
    const out: Array<string> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = k ? (localStorage.getItem(k) ?? "") : "";
      if (k && /token|oauth|access|bearer|eyJ/i.test(`${k}${v}`))
        out.push(`${k} (len=${v.length})`);
    }
    return out;
  });
  const dineApi = lastSeenDineApi.length
    ? lastSeenDineApi.map((u) => `  ${u}`).join("\n")
    : "  none — the widget never called /dine-res/api/ (wrong trigger page/button?)";
  return (
    `LBJS cookies:\n${lbjs.join("\n") || "  none"}\n` +
    `token-ish localStorage keys:\n  ${lsKeys.join("\n  ") || "none"}\n` +
    `dine-res API calls seen:\n${dineApi}`
  );
}

const BEARER_JWT = /bearer\s+(eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+)/i;
// Reservation widget buttons that kick off a getAvailability call. IDs/classes
// are dynamic, so match visible text.
const SEARCH_TRIGGER =
  /search times|check (dining )?availability|find a table|reserve|search for a table/i;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
// dine-res API calls observed during the most recent sniff, for diagnostics
// (did the widget call the API at all? did the call carry an auth header?).
let lastSeenDineApi: Array<string> = [];

/**
 * Navigate to `url`, drive the reservation widget to fire a `getAvailability`
 * call, and sniff the bearer off its `Authorization` header. Falls back to a
 * cookie/localStorage decode if a request still slips the sniffer. Returns null
 * if nothing surfaces a token.
 */
async function sniffBearer(page: Page, url: string): Promise<string | null> {
  let sniffed: string | null = null;
  lastSeenDineApi = [];
  const onRequest = (req: HTTPRequest): void => {
    const auth = req.headers().authorization;
    if (/\/dine-res\/api\//.test(req.url())) {
      lastSeenDineApi.push(`${req.url().slice(0, 90)} [auth:${auth ? "yes" : "no"}]`);
    }
    if (sniffed) return;
    const m = auth?.match(BEARER_JWT);
    if (m) sniffed = m[1];
  };
  page.on("request", onRequest);
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS }).catch(() => {});
    // The widget often pre-loads times on mount; if not, click its search button
    // and wait for the resulting XHR.
    if (!sniffed) {
      await page
        .evaluate((rxSrc: string) => {
          const rx = new RegExp(rxSrc, "i");
          const el = [...document.querySelectorAll("button,[role=button],a,[type=submit]")].find(
            (e) => rx.test((e.textContent ?? "").trim()),
          );
          (el as HTMLElement | undefined)?.click();
        }, SEARCH_TRIGGER.source)
        .catch(() => {});
      for (let i = 0; i < 12 && !sniffed; i++) await sleep(500);
    }
    return sniffed ?? (await getDineAccessToken(page));
  } finally {
    page.off("request", onRequest);
  }
}

/** Numeric suffix of a chunked cookie (`…name.0`, `…name.1`); base sorts first. */
function chunkIndex(name: string): number {
  const m = name.match(/\.(\d+)$/);
  return m ? Number(m[1]) : -1;
}

const ACCESS_TOKEN_IN_JSON = /"access_token"\s*:\s*"(eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+)"/;
const BARE_JWT = /^(eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+)$/;

/**
 * Pull an OneID access_token JWT out of one cookie/localStorage value. The store
 * holds `<n>=<base64(JSON{access_token,…})>`; a stray trailing byte can break a
 * full base64 decode, but access_token is an early field, so the longest valid
 * prefix still contains it — scan down from a generous bound. Also handles a
 * value that's already plain JSON or a bare JWT.
 */
function extractAccessToken(raw: string): string | null {
  if (!raw) return null;
  let val = raw;
  try {
    val = decodeURIComponent(val);
  } catch {
    // keep the raw value if it isn't percent-encoded
  }
  const data = val.replace(/^\d+=/, ""); // strip the `<n>=` chunk-format prefix
  const plain = data.match(ACCESS_TOKEN_IN_JSON);
  if (plain) return plain[1];
  for (let len = Math.min(data.length - (data.length % 4), 8000); len >= 16; len -= 4) {
    try {
      const m = Buffer.from(data.slice(0, len), "base64")
        .toString("utf8")
        .match(ACCESS_TOKEN_IN_JSON);
      if (m) return m[1];
    } catch {
      // not a valid base64 prefix at this length — try a shorter one
    }
  }
  const whole = data.match(BARE_JWT);
  return whole ? whole[1] : null;
}

/**
 * The OneID access-token the dine-res SPA attaches as `Authorization: BEARER …`.
 * The dine-vas API (`facilities`, `getAvailability`) 401s on cookies alone —
 * VERIFIED live: cookies-only → 401, +bearer +routing headers → 200. The token
 * lives in the LBJS store, which Disney has shipped under different cookie
 * suffixes (`.token`, `.api`) and can split a large value across numbered chunk
 * cookies (`…name.0`, `…name.1`); the SDK also mirrors it into localStorage. So
 * we scan the whole `TPR-WDW-LBJS` cookie family (chunks reassembled per base
 * name) and then localStorage for an embedded access_token. It is NOT
 * `pep_oauth_token` (a 32-char opaque token → 403).
 *
 * Read via `page.cookies()` (Node-side) rather than `document.cookie`: it sees
 * httpOnly cookies and every path, and runs after the dine-res bundle has set
 * them. Returns null when nothing yields a token (bundle not loaded / expired)
 * so the caller can re-login. See research/disney-ticket-deep-dive.md §9.
 */
export async function getDineAccessToken(page: Page): Promise<string | null> {
  // 1) LBJS cookie family, chunked values reassembled under their base name.
  const groups = new Map<string, Array<{ idx: number; value: string }>>();
  for (const c of await page.cookies(HOME)) {
    if (!c.name.startsWith(LBJS_COOKIE_PREFIX)) continue;
    const idx = chunkIndex(c.name);
    const base = idx >= 0 ? c.name.replace(/\.\d+$/, "") : c.name;
    const arr = groups.get(base);
    if (arr) arr.push({ idx, value: c.value });
    else groups.set(base, [{ idx, value: c.value }]);
  }
  for (const arr of groups.values()) {
    const joined = arr
      .sort((a, b) => a.idx - b.idx)
      .map((x) => x.value)
      .join("");
    const token = extractAccessToken(joined);
    if (token) return token;
  }

  // 2) localStorage — the OneID SDK mirrors the token blob here too.
  const lsValues = await page.evaluate(() => {
    const out: Array<string> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) out.push(localStorage.getItem(k) ?? "");
    }
    return out;
  });
  for (const v of lsValues) {
    const token = extractAccessToken(v);
    if (token) return token;
  }
  return null;
}
