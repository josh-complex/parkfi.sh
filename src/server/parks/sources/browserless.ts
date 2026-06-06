import { config } from "../config.ts";
import { UpstreamError } from "./themeparks.ts";

/**
 * Thin client over a Browserless v2 instance (its own Railway service) via the
 * `/function` REST API — no local puppeteer/playwright dependency. We POST a JS
 * module that runs inside headless Chromium with `{ page, context }` in scope;
 * it returns `{ data, type }` which Browserless serializes back as the HTTP
 * body. We use this for feeds gated by a real-browser session (Universal),
 * where a plain HTTPS client is blocked. See research/gated-feeds-report.md §U1.
 */

export function browserlessConfigured(): boolean {
  return config.browserlessUrl.length > 0;
}

/**
 * Run `code` (a `export default async ({ page, context }) => ({ data, type })`
 * module) in Browserless and return its `data` parsed as JSON.
 */
export async function runBrowserFunction<T>(
  code: string,
  context: Record<string, unknown>,
  signal: AbortSignal,
): Promise<T> {
  if (!browserlessConfigured()) {
    throw new UpstreamError("BROWSERLESS_URL not set — cannot run browser feed");
  }
  const token = config.browserlessToken
    ? `?token=${encodeURIComponent(config.browserlessToken)}`
    : "";
  const url = `${config.browserlessUrl}/function${token}`;
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ code, context }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new UpstreamError(
      `POST ${config.browserlessUrl}/function -> ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}`,
      res.status,
    );
  }
  return (await res.json()) as T;
}
