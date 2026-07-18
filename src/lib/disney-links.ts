import type { Resort } from "#/lib/parks.ts";

/**
 * Outbound deep links to the operators' own ticket-purchase surfaces.
 *
 * Two carriers, per the platform-gating rule (see the MDE deep-link notes and
 * `src/components/park-dashboard/ride-detail.tsx` for the load-bearing example):
 *
 * - **Web / cross-platform**: a plain `https://` link to the operator's ticket
 *   store. Opens the web store in a browser; on the native shell the OS App
 *   Links / universal-links association hands it off to the installed My Disney
 *   Experience / Universal app. Always safe to render.
 * - **Native `mdx://`**: the My Disney Experience custom scheme, which only
 *   resolves on a device with MDE installed. Callers MUST gate these on
 *   `useIsNative()` and fall back to the https link on the web — a browser can't
 *   open `mdx://`. Universal has no public scheme, so its native builder is null.
 *
 * These are public, version-stable URLs, so they're hardcoded here (client-safe)
 * rather than read from the server ingestion config.
 */

const WDW_SITE = "https://disneyworld.disney.go.com";
const UOR_SITE = "https://www.universalorlando.com";

/**
 * The operator's official admission-ticket page. Disney and Universal both
 * price tickets resort-wide by date rather than per park, so this is keyed on
 * the resort, not the individual park.
 */
export function ticketStoreUrl(resort: Resort): string {
  return resort === "UOR"
    ? `${UOR_SITE}/web/en/us/tickets-packages`
    : `${WDW_SITE}/admission/tickets/`;
}

/**
 * My Disney Experience native ticket-purchase deep link: `mdx://tickets/buy`
 * — the `BUY` entry of the app's `DeepLinkTicketSales` route enum, verified by
 * decompiling MDE v8.0 (see the MDE deep-link memory). Lands the guest directly
 * on the ticket-purchase flow. `mdx://` only resolves inside the installed MDE
 * app, so callers MUST gate on `useIsNative()` and fall back to
 * `ticketStoreUrl` on the web. Universal has no public scheme → null.
 */
export function ticketPurchaseDeepLink(resort: Resort): string | null {
  if (resort === "UOR") return null;
  return "mdx://tickets/buy";
}

/**
 * The right "buy tickets" href for the current platform: the native MDE
 * purchase deep link when we're in the app and it exists, otherwise the https
 * ticket store (which itself hands off to the app via OS App Links). Pass
 * `isNative` from `useIsNative()`.
 */
export function buyTicketsHref(resort: Resort, isNative: boolean): string {
  const deepLink = isNative ? ticketPurchaseDeepLink(resort) : null;
  return deepLink ?? ticketStoreUrl(resort);
}

/** Human-readable host of a resort's ticket store, for card sublabels. */
export function ticketStoreLabel(resort: Resort): string {
  return resort === "UOR" ? "universalorlando.com" : "disneyworld.com";
}

/**
 * The operator's "make a park reservation" (Disney Park Pass) booking page —
 * the availability calendar where a guest who *already holds* a ticket or pass
 * picks a park + date. Distinct from `ticketStoreUrl` (which sells admission).
 *
 * Disney only: park reservations are a Walt Disney World / Disneyland concept,
 * and Universal has no equivalent system → null. Post-2024 only some admission
 * types (annual passes, non-date-based tickets) still require a reservation, so
 * this is a secondary affordance, not the primary CTA.
 *
 * There is **no native `mdx://` deep link** for this flow — the My Disney
 * Experience app's own "Make a Park Reservation" button opens a plain web URL,
 * not a custom-scheme route (verified by decompiling MDE v8.0:
 * `MakeParkReservationDelegate` fires an `ACTION_VIEW` intent at a
 * server-configured `makeParkReservationUrl`; the only `magicaccess/parkpass/*`
 * route is a detail view of an existing reservation). So this is a plain https
 * URL, safe on every platform — on the native shell OS App Links hands it off
 * to the installed MDE app, same as `ticketStoreUrl`.
 */
export function parkReservationUrl(resort: Resort): string | null {
  if (resort === "UOR") return null;
  return `${WDW_SITE}/park-reservations/`;
}
