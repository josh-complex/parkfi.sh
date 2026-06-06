import puppeteer, { type Browser } from "puppeteer-core";

import { config } from "../config.ts";
import { UpstreamError } from "./themeparks.ts";

/**
 * Connection manager for a Browserless v2 instance (its own Railway service).
 * We connect puppeteer-core to it over WS/CDP — Browserless runs the real
 * Chromium, we drive it from typed code. Used for feeds gated by a real-browser
 * session (Universal), where a plain HTTPS client is blocked. See
 * research/gated-feeds-report.md §U1.
 */

export function browserlessConfigured(): boolean {
  return config.browserlessUrl.length > 0;
}

/** Derive the ws(s):// CDP endpoint (with token + optional proxy query). */
function wsEndpoint(): string {
  const base = config.browserlessUrl.replace(/^http/, "ws");
  const params = new URLSearchParams();
  if (config.browserlessToken) params.set("token", config.browserlessToken);
  const query = [params.toString(), config.browserlessQuery].filter(Boolean).join("&");
  return query ? `${base}?${query}` : base;
}

/** Reject when `signal` aborts, so a stuck connect/run can't hang the cron. */
function abortRejection(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new UpstreamError("browserless run aborted (timeout)"));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

/**
 * Connect to Browserless, run `fn` against the remote Browser, and always
 * release the session — even on abort or throw. The `signal` bounds the whole
 * connect+run.
 */
export async function withBrowser<T>(
  fn: (browser: Browser) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (!browserlessConfigured()) {
    throw new UpstreamError("BROWSERLESS_URL not set — cannot run browser feed");
  }
  const browser = await Promise.race([
    puppeteer.connect({ browserWSEndpoint: wsEndpoint() }),
    abortRejection(signal),
  ]);
  try {
    return await Promise.race([fn(browser), abortRejection(signal)]);
  } finally {
    // close() ends the Browserless session (frees the slot); disconnect() alone
    // would leave it running until its own TIMEOUT.
    await browser.close().catch(() => {});
  }
}
