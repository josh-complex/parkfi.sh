/**
 * Ride hero loops — the silent cinemagraph Disney publishes alongside a ride's
 * stills, transcoded to animated WebP and republished on our own R2 domain.
 *
 * Why a generated manifest instead of reading `hero_media` at request time:
 * `head()` runs on the client too (route navigation), so it can't reach the DB
 * or `process.env`; and the source feed can't tell us which entries are loops
 * anyway — `disneyEntityHeroSlides` collapses the feed's `cinemagraph` and
 * `video` types into one `kind: "video"`. `scripts/build-hero-loops.ts` does
 * that classification once, at publish time, and bakes absolute URLs in here.
 *
 * Only Discord link previews read this. The page hero still plays the source
 * mp4 directly — it has a real <video> element and doesn't need the transcode.
 */
import { HERO_LOOPS } from "./hero-loops.generated.ts";

/**
 * The published loop for a ride, or null when it has no silent cinemagraph
 * (most rides) or the asset hasn't been published yet. Keyed on the ride slug
 * that appears in the URL, so `head()` can look it up from `params` alone
 * without waiting on loader data.
 */
export function heroLoopUrl(rideSlug: string): string | null {
  return HERO_LOOPS[rideSlug] ?? null;
}
