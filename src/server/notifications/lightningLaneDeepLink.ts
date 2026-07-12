/**
 * My Disney Experience's `mdx://` deep-link scheme (route table recovered by
 * static decompile, see `docs/plans/jiminy/write-spike.md`). There is no
 * ride-scoped "open this Lightning Lane" route in that table — Multi/Single
 * *modify* links need a `planId`/`orderId` from the user's own MDE plan, which
 * parkfi has no delegated read of. The best honest link is "My Genie Day" for
 * today, which lands the user on the day's LL/Genie+ screen so they can grab
 * the ride themselves — a couple of taps, not zero-touch. Returned wrapped
 * through `/deep-link` (see `deepLinkRedirect.ts`) since a raw `mdx://` href
 * gets silently stripped by email HTML sanitizers — moot for an in-app anchor
 * tag, but this keeps one code path instead of two.
 *
 * Shared by the ride-alert manager (`rideAlerts` router) and the live ride
 * detail page (`parks.attraction`) — the same day-level ceiling applies to
 * both, so the link is built once here.
 */
import { wrapDeepLink } from "#/server/notifications/deepLinkRedirect.ts";

export function buildLightningLaneDeepLink(completionDeepLink: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const qs = new URLSearchParams({
    tab: "day",
    displayDate: today,
    completionDeepLink,
  });
  return wrapDeepLink(`mdx://magicaccess/mygenieday?${qs.toString()}`);
}
