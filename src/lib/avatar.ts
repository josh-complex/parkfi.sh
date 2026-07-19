import { Avatar, Style } from "@dicebear/core";
import botttsDefinition from "@dicebear/styles/bottts-neutral.json";

const style = new Style(botttsDefinition);

/** Raw SVG markup for a deterministic bot avatar. Served by the
 *  `/api/avatar/$seed` route — never stored inline (see `botAvatarUrl`). */
export function generateBotAvatarSvg(seed: string): string {
  return new Avatar(style, { seed }).toString();
}

// Origin the stored avatar URL points at. Native builds bake VITE_API_BASE
// (=https://parkfi.sh) so the WebView's cross-origin `<img>` resolves; the web
// prod build has no base (→ apex); dev stays same-origin relative.
const AVATAR_ORIGIN =
  import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "" : "https://parkfi.sh");

/**
 * Stable URL for a user's bot avatar. The avatar is a pure function of the seed,
 * so the `/api/avatar/$seed` route regenerates it on demand and Cloudflare caches
 * it immutably — which lets us store this ~40-byte URL on `user.image` instead of
 * a ~27 KB data URI. The data URI on the user row was fat enough to blow the
 * session cookie past the request-header limit once `cookieCache` serialized it
 * (431s on every request); keeping `image` small keeps every session read, SSR
 * payload, and the cookie cache lean.
 */
export function botAvatarUrl(seed: string): string {
  return `${AVATAR_ORIGIN}/api/avatar/${encodeURIComponent(seed)}`;
}
