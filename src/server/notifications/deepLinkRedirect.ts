/**
 * Wrap a custom-scheme deep link (`mdx://`, `dlr://`) behind our own `https://`
 * redirect. Email HTML sanitizers — Gmail included — strip `href` values on
 * unrecognized URI schemes, silently neutering the anchor (verified: the raw
 * `mdx://` link shipped in the dining-alert email rendered but wasn't
 * clickable). A same-origin https:// link always survives sanitization; the
 * `/deep-link` route (see `src/routes/deep-link.ts`) 302s straight through to
 * the real scheme, which mobile browsers do follow into the native app.
 */
import { config } from "#/server/parks/config.ts";

export function wrapDeepLink(rawUrl: string): string {
  return `${config.appBaseUrl}/deep-link?to=${encodeURIComponent(rawUrl)}`;
}
