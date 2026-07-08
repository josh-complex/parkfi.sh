/**
 * Public redirect bounce for custom-scheme app deep links (`mdx://`, `dlr://`)
 * — see `server/notifications/deepLinkRedirect.ts` for why this exists (email
 * clients strip raw custom-scheme hrefs). Scheme is allowlisted, not just
 * "any URL", so this can't be turned into an open redirect to an arbitrary
 * http(s) site.
 */
import { createFileRoute } from "@tanstack/react-router";

const ALLOWED_SCHEMES = new Set(["mdx:", "dlr:"]);

function handle(request: Request): Response {
  const to = new URL(request.url).searchParams.get("to");
  if (!to) return new Response("Missing ?to", { status: 400 });

  let target: URL;
  try {
    target = new URL(to);
  } catch {
    return new Response("Invalid target", { status: 400 });
  }
  if (!ALLOWED_SCHEMES.has(target.protocol)) {
    return new Response("Unsupported target scheme", { status: 400 });
  }
  return new Response(null, { status: 302, headers: { Location: to } });
}

export const Route = createFileRoute("/deep-link")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
    },
  },
});
