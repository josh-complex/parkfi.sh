/**
 * Bridge between the system-browser OAuth flow and the native (Capacitor) shell.
 *
 * Native social sign-in (Google / Microsoft / Apple-on-Android) can't use the
 * WebView — providers block embedded user agents — so it opens the system
 * browser (`@capacitor/browser`) and completes OAuth there. better-auth sets a
 * *cookie* session in that browser context, which is useless to the app
 * (different origin, no shared cookie jar). This route is the hand-off: the
 * OAuth `callbackURL` points here, so this GET runs with the freshly-set session
 * cookie, mints a short-lived one-time token from it, and bounces to
 * `parkfi://auth-callback?ott=…`. The OS routes that custom scheme back into the
 * app, where native-oauth.ts exchanges the token for a bearer session.
 *
 * The token is single-use and expires in minutes (oneTimeToken plugin), so it's
 * safe to carry through a redirect URL. Only the native origins ever reach here;
 * the web app signs in with cookies directly and never opens this route.
 */
import { createFileRoute } from "@tanstack/react-router";

import { auth } from "#/lib/auth.ts";

const APP_SCHEME = "parkfi://auth-callback";

// A raw 302 to a custom scheme is dropped by some in-app browsers; an HTML page
// that navigates via JS (with a manual-tap fallback) is the reliable path back
// into the app across Custom Tabs and SFSafariViewController.
function bounce(params: Record<string, string>): Response {
  const target = `${APP_SCHEME}?${new URLSearchParams(params).toString()}`;
  const safe = target.replace(/"/g, "&quot;");
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Returning to ParkFi…</title><script>location.replace(${JSON.stringify(target)})</script></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f4f4f5;margin:0;padding:48px 16px;color:#18181b;text-align:center"><p style="margin:0 0 16px">Returning to ParkFi…</p><a href="${safe}" style="color:#2563eb">Tap here if the app doesn't reopen</a></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

async function handle(request: Request): Promise<Response> {
  // better-auth sends provider/consent failures here via `errorCallbackURL`
  // with `?error=…` — forward the real reason to the app instead of masking it
  // as a missing session below.
  const incomingError = new URL(request.url).searchParams.get("error");
  if (incomingError) return bounce({ error: incomingError });
  try {
    // Requires the session cookie the OAuth callback just set (sessionMiddleware
    // on the endpoint). Throws if there's no valid session on the request.
    const { token } = await auth.api.generateOneTimeToken({ headers: request.headers });
    return bounce({ ott: token });
  } catch {
    // No session (user cancelled, or the callback cookie never landed) — hand the
    // app an error so it can drop the spinner and show a retry.
    return bounce({ error: "no_session" });
  }
}

export const Route = createFileRoute("/native-callback")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
    },
  },
});
