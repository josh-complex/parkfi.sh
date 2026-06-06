import type { Browser, CookieParam, Frame, Page } from "puppeteer-core";

import { loadSession, saveSession, type StorageState } from "./session.ts";

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
const NAV_TIMEOUT_MS = 60_000;
const BROWSER_UA =
  process.env.DISNEY_BROWSER_UA ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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

/** Force a re-login on an existing page (call when a dine-vas request 401s). */
export async function relogin(page: Page): Promise<void> {
  await disneyLogin(page);
}
