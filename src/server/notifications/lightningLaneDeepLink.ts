/**
 * My Disney Experience's `mdx://` deep-link scheme (route table recovered by
 * static decompile, see `docs/plans/jiminy/write-spike.md`). There is no
 * ride-scoped "open this Lightning Lane" route in that table — Multi/Single
 * *modify* links need a `planId`/`orderId` from the user's own MDE plan, which
 * parkfi has no delegated read of. The best honest link is "My Genie Day" for
 * today, which lands the user on the day's LL/Genie+ screen so they can grab
 * the ride themselves — a couple of taps, not zero-touch.
 *
 * Returns the **raw** `mdx://` URI, which only resolves on a device with MDE
 * installed. Callers own the platform context: the mailer wraps it through
 * `/deep-link` (see `deepLinkRedirect.ts`, since email sanitizers strip raw
 * custom-scheme hrefs), and web UI must never hand this scheme to a browser —
 * Lightning Lane has no web equivalent, so on web the button is simply hidden.
 *
 * Shared by the ride-alert manager (`rideAlerts` router) and the live ride
 * detail page (`parks.attraction`) — the same day-level ceiling applies to
 * both, so the link is built once here.
 */
export function buildLightningLaneDeepLink(completionDeepLink: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const qs = new URLSearchParams({
    tab: "day",
    displayDate: today,
    completionDeepLink,
  });
  return `mdx://magicaccess/mygenieday?${qs.toString()}`;
}
