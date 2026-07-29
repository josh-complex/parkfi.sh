import * as React from "react";

import { cfImagesStore } from "#/integrations/posthog/feature-flags.ts";
import { cfImageUrl, disneyResizeUrl } from "#/lib/image.ts";
import { formatParkName, PARK_TAGLINE } from "#/lib/parks.ts";

/**
 * Cross-route shared-element flight: the open map card → a detail page's hero.
 *
 * The map card isn't React — `openAttractionCard` builds it imperatively out of
 * the marker's own disc — so motion's `layoutId` can't pair it with anything on
 * the destination page. This does the pairing by hand, the same way `map-morph`
 * carries the singleton map between route slots: on press we snapshot the card's
 * shared elements (photo header, live-wait chip, title), clone them into a fixed
 * overlay on `document.body` (which outlives the route swap), and fly the clones
 * to the hero's matching boxes once it mounts. The landing contract is the
 * `data-hero*` tags stamped by `DetailHero`; the return pad is the
 * `data-marker-key` each marker builder stamps.
 *
 * The press also publishes a **seed** — the name, subtitle, wait and photo the
 * card was already showing. The destination paints its hero from that seed while
 * its own query is still in flight, so the clones land on a real hero
 * instead of a grey skeleton, and the page reads as loaded a round trip early.
 *
 * Landing is a dissolve, not a swap: the real elements are revealed underneath
 * at full opacity and the clones fade off the top of them. Nothing has to line
 * up to the pixel, which is what lets the wait chip and the title cross *layout*
 * (a "25 min standby" pill → a stacked "25 / MIN / WAIT NOW" block; a 15px card
 * title → a 30px white headline) rather than only geometry.
 */

/** The travel itself. Matches the disc→card morph's feel (see CARD_MS). */
const FLIGHT_MS = 460;
const FLIGHT_EASE = "cubic-bezier(.16,1,.3,1)";
/** The clones' dissolve once they've landed on the real hero. */
const SETTLE_MS = 180;
/** The hero never mounted (bad slug, route error) — dissolve in place. */
const LAND_TIMEOUT_MS = 1400;
/** Longest we'll hold a landed photo clone waiting on the hero's own <img>. */
const PHOTO_HOLD_MS = 1200;
/** Content crossfade inside a travelling box, as a fraction of the flight. */
const SWAP_DELAY_MS = Math.round(FLIGHT_MS * 0.3);
const SWAP_MS = Math.round(FLIGHT_MS * 0.5);
/**
 * The marker pill's white hairline border clears at the *start* of the flight,
 * not over it. It's the one bit of dressing that reads as marker chrome rather
 * than as content, so carrying it the whole way leaves a bordered pill hovering
 * over a hero that has no such thing — same reasoning as the card's own close,
 * which sheds its 3d edge on CARD_CLOSE_FX_MS while the geometry takes CARD_MS.
 */
const DRESS_MS = 140;

/**
 * What the map card already knows about the entity, handed to the hero so it
 * can paint before its own query resolves. Everything here is what the *card*
 * was showing, so a seeded hero and the flown clones agree by construction.
 */
export type HeroFlightSeed = {
  /** Flight identity — matches the destination hero's `data-hero`. Built by
   *  {@link heroFlightKey}, e.g. `ride:magic-kingdom/space-mountain`. */
  key: string;
  /** The return pad — matches the origin marker's `data-marker-key` (see the
   *  builders in `shared.tsx`), so backing out can find the marker again. */
  markerKey: string;
  /** Pathnames that count as "backed out to the map": the return flight only
   *  launches when, at the page's unmount, history already points at one of
   *  these (so the marker is known to exist there). */
  returnPaths: string[];
  name: string;
  /** e.g. "Park name · Land" — one line, exactly the hero's own subtitle. */
  subtitle: string;
  /** Live standby minutes, or null when the card showed no live wait. */
  waitMinutes: number | null;
  /** Operating status code, so the hero's status pill doesn't pop in later.
   *  Null for kinds that carry no live status. */
  status: string | null;
  /** The ride's own photo URL, resolved exactly as the hero resolves it, so the
   *  hero's `<img>` never changes `src` when the query lands. */
  imageUrl: string | null;
  /** The *rendition* the card header was painting (`currentSrc`) — already
   *  decoded, and where the flight's photo starts. */
  cardImageUrl: string | null;
  /** A light copy of the photo **as the hero will frame it** — see
   *  {@link heroPreviewUrl}. The flight crossfades to this in mid-air and the
   *  hero holds it underneath its own copy. */
  previewImageUrl: string | null;
};

/** Width for the hero-crop preview. Deliberately small: its job is to establish
 *  the hero's *framing* early and cheaply, not to be sharp — the hero's own
 *  `<Image>` lands the full-resolution copy on top of it. */
const HERO_PREVIEW_W = 640;

/**
 * A cheap rendition of `url` cropped the way the ride hero crops it.
 *
 * This exists because the marker and the hero don't always show the same photo.
 * `markerPhotoUrls` deliberately prefers the *thumb* asset when it isn't the same
 * asset as the hero — for Universal that's a 3:2 list crop where the hero is an
 * ultra-wide 2.33:1 one of the same shot. Flying one and landing on the other
 * re-frames the picture, which reads as the hero sliding or zooming once it has
 * settled. So the flight carries both and swaps between them *in mid-air*, where
 * the box is still scaling and translating and a re-frame is invisible.
 *
 * Both paths here are width-only, so they resize the master without re-cropping
 * it — which is what makes this the hero's framing rather than a third one.
 */
function heroPreviewUrl(url: string | null): string | null {
  if (!url) return null;
  // Disney's own resize segment, where the url has one (mode 1 fits the master
  // to a bounding box rather than cropping it — see `disneyResizeUrl`).
  const disney = disneyResizeUrl(url, HERO_PREVIEW_W);
  if (disney !== url) return disney;
  // Everything else (Universal's own hosts) goes through the edge resizer, under
  // the same guard `<Image>` and the markers use — `fit=scale-down`, aspect kept.
  if (!cfImagesStore.state || import.meta.env.DEV) return url;
  return cfImageUrl(url, { width: HERO_PREVIEW_W, quality: 60 });
}

/**
 * The card elements that fly. `openAttractionCard` owns them and hands them to
 * `onPress`; by then the wait chip and name pill have already flown into their
 * card positions, so their boxes are the card's, not the marker's.
 */
export type CardFlightNodes = {
  /** The card's photo header (the marker's face, grown into the header). */
  fill: HTMLElement | null;
  /** The live-wait chip, resting over the header's top-left. */
  waitEl: HTMLElement | null;
  /** The name pill, already restyled into the card's title. */
  nameEl: HTMLElement | null;
  /**
   * Hand the card off: hide it instantly and collapse it back to a resting disc
   * out of sight. Called once the clones exist — until then the card is what the
   * clones are copied from, and after it there'd be two of everything on screen.
   */
  dismiss: () => void;
};

type FlightState = {
  key: string;
  seed: HeroFlightSeed;
  /** True while clones still cover the hero, which keeps its targets hidden. */
  flying: boolean;
};

/** Flight identity, `kind:id` — one namespace across every marker/page kind. */
export function heroFlightKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

export function rideFlightKey(parkSlug: string, rideSlug: string): string {
  return heroFlightKey("ride", `${parkSlug}/${rideSlug}`);
}

// Return-pad keys, matched against the `data-marker-key` each marker builder
// stamps (`buildAttractionEl` / `buildPoiEl` / `buildParkBadgeEl`). Separate
// from the flight key: a marker doesn't know everything the page key encodes
// (an attraction marker has no park slug), and one pad can serve several
// flights (a SHOW's showtime marker lands the ride-page return).
export function attractionMarkerKey(slug: string): string {
  return `attraction:${slug}`;
}
export function poiMarkerKey(id: string): string {
  return `poi:${id}`;
}
export function parkMarkerKey(slug: string): string {
  return `park:${slug}`;
}

// --- store ----------------------------------------------------------------
// Module state rather than context: the launch happens inside a map event
// handler on the *outgoing* route, so there's no React tree in common with the
// hero that's about to mount.

let state: FlightState | null = null;
const listeners = new Set<() => void>();

function publish(next: FlightState | null): void {
  state = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The seed for *this* page plus whether clones are still covering it.
 * Null when the page wasn't opened from a map card — the ordinary case for a
 * deep link or a crawler, which just renders the normal skeleton.
 */
export function useHeroFlight(key: string): FlightState | null {
  const snapshot = React.useSyncExternalStore(
    subscribe,
    () => state,
    () => null,
  );
  return snapshot?.key === key ? snapshot : null;
}

/**
 * Build the seed from a board item, matching what the ride hero would render
 * from `parks.attraction` — same photo fallback chain, same "Park · Land"
 * subtitle, same live-wait rule — so nothing re-lays-out when the query lands.
 */
export function rideFlightSeed(opts: {
  parkSlug: string;
  parkName: string | null;
  ride: {
    slug: string;
    name: string;
    status?: string | null;
    standbyWait?: number | null;
    meta?: {
      land?: string | null;
      imageHeroUrl?: string | null;
      imageThumbUrl?: string | null;
    } | null;
  };
}): HeroFlightSeed {
  const { parkSlug, parkName, ride } = opts;
  const operating = ride.status === "OPERATING";
  const imageUrl = ride.meta?.imageHeroUrl ?? ride.meta?.imageThumbUrl ?? null;
  return {
    key: rideFlightKey(parkSlug, ride.slug),
    markerKey: attractionMarkerKey(ride.slug),
    // A ride page can only have been card-launched from the roam map or its
    // park's map view — the two places its marker lives.
    returnPaths: ["/map", `/park/${parkSlug}`],
    name: ride.name,
    subtitle: [parkName, ride.meta?.land].filter(Boolean).join(" · "),
    // Only a *live* wait: the hero's other source (the 24–48h typical) isn't on
    // the map item, and it lands in an absolutely-positioned overlay, so letting
    // it appear a moment later costs no layout.
    waitMinutes: operating && ride.standbyWait != null ? ride.standbyWait : null,
    status: ride.status ?? null,
    imageUrl,
    // Filled in by `launchHeroFlight`, which can read what the card is actually
    // painting rather than guess at which rendition won.
    cardImageUrl: null,
    previewImageUrl: heroPreviewUrl(imageUrl),
  };
}

/**
 * Build the seed for a dining/shop POI card press, matching what the
 * destination hero renders — the same "Park · Land" subtitle and the same feed
 * photo (`restaurant_dim` / `shop_dim` `image_url`, which the `dining.venue` /
 * `parks.shop` queries also serve), so the seeded hero and the loaded page
 * agree. POI cards carry no live wait or status, so those legs stay empty.
 */
export function poiFlightSeed(opts: {
  /** Destination page kind — also the flight-key namespace. */
  kind: "dining" | "shop";
  /** Route id: the dining facility id, or the shop's finder slug. */
  id: string;
  poi: { id: string; name: string; land: string | null; imageUrl: string | null };
  parkSlug: string;
  parkName: string | null;
}): HeroFlightSeed {
  const { kind, id, poi, parkSlug, parkName } = opts;
  return {
    key: heroFlightKey(kind, id),
    markerKey: poiMarkerKey(poi.id),
    // POI layers only draw on park map views (boundary-clipped), reached from
    // either the roam map or the park's own map view.
    returnPaths: ["/map", `/park/${parkSlug}`],
    name: poi.name,
    subtitle: [parkName, poi.land].filter(Boolean).join(" · "),
    waitMinutes: null,
    status: null,
    imageUrl: poi.imageUrl,
    cardImageUrl: null,
    previewImageUrl: heroPreviewUrl(poi.imageUrl),
  };
}

/**
 * Build the seed for a park-badge tap on the overview map, matching what the
 * park page's hero renders — the same `formatParkName` display name (the badge's
 * chip already shows it) and the same `parks.image_url` asset both the overview
 * and `parks.list` publish, plus the page's static tagline as the subtitle. Park
 * badges carry no live wait or status.
 */
export function parkFlightSeed(park: {
  slug: string;
  name: string;
  imageUrl?: string | null;
}): HeroFlightSeed {
  const imageUrl = park.imageUrl ?? null;
  return {
    key: heroFlightKey("park", park.slug),
    markerKey: parkMarkerKey(park.slug),
    // Park badges only exist on the zoomed-out overview, so the launch site is
    // the one place the return can land — capture wherever that is right now.
    returnPaths: [window.location.pathname],
    name: formatParkName(park.name),
    subtitle: PARK_TAGLINE,
    waitMinutes: null,
    status: null,
    imageUrl,
    cardImageUrl: null,
    previewImageUrl: heroPreviewUrl(imageUrl),
  };
}

/**
 * Drop this page's seed (on unmount), so navigating back to the same page later
 * from somewhere that *isn't* the map doesn't paint a stale hero from it.
 */
export function releaseHeroFlight(key: string): void {
  // Never mid-flight: clearing the seed there would swap the seeded hero back to
  // a skeleton and reveal the landing targets under clones still in the air. A
  // flight that outlives its page dissolves on its own timers anyway.
  if (state?.flying) return;
  if (state?.key === key) publish(null);
}

// --- clone builders -------------------------------------------------------

type Flown = {
  /** The travelling box: it draws the pill/photo frame and owns the geometry. */
  box: HTMLElement;
  /** The card's content, riding inside the box. */
  from: HTMLElement;
  /** Card-only trimmings with no counterpart on the hero, shed on DRESS_MS. */
  shed?: HTMLElement[];
  /** The chip's number was isolated, so it can morph onto the hero's own. */
  morphNum?: boolean;
  /** The hero's crop of the photo, faded in over the card's while in mid-air. */
  swap?: HTMLImageElement | null;
  /** The hero's text-clarity gradient, faded in over the photo while in mid-air. */
  scrim?: HTMLElement;
};

/**
 * The travelling frame: it draws the pill's dressing (background, radius,
 * border, shadow) so those can animate to the hero's, and owns the geometry.
 */
function pillBox(rect: DOMRect, cs: CSSStyleDeclaration): HTMLElement {
  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    boxSizing: "border-box",
    borderRadius: cs.borderRadius,
    backgroundColor: cs.backgroundColor,
    boxShadow: cs.boxShadow,
    border: `${cs.borderTopWidth} solid ${cs.borderTopColor}`,
    // The incoming hero copy rides at its *final* size while the pill is still
    // growing into it (see `flyWait`) — keep the overspill inside the pill.
    overflow: "hidden",
    transition: "none",
  });
  return box;
}

/**
 * A travelling copy of the card's live-wait chip.
 *
 * The two ends are the *same shape* once you look past the copy: a number, then
 * a label, laid out in a row. So the number isn't crossfaded — it's the shared
 * element within the shared element, and it simply grows from the pill's 10px
 * into the hero's 30px headline. What differs is only the wording around it, so
 * the chip's own trimmings (the " min" the hero spells out in its label column,
 * and the "standby" tail) are shed up front, leaving a bare number that lands
 * exactly on the hero's. By the time the hero's copy crossfades in, the dominant
 * element is already in the right place at the right size, so the swap has
 * nothing visible to disagree about — instead of a small pill sitting in the
 * corner of a box that's grown past it.
 *
 * The chip is mid-`scale()` from its own flight into the card, so that factor is
 * baked into the starting type and padding rather than carried as a transform:
 * a transform can't hand off to the font-size animation that does the growing.
 */
function cloneWaitChip(src: HTMLElement | null): Flown | null {
  if (!src) return null;
  const rect = src.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const cs = getComputedStyle(src);
  const k = src.offsetWidth ? rect.width / src.offsetWidth : 1;
  const box = pillBox(rect, cs);

  const from = src.cloneNode(true) as HTMLElement;
  const shed: HTMLElement[] = [];
  const sub = from.querySelector<HTMLElement>("[data-wait-sub]");
  if (sub) shed.push(sub);
  // Split the unit off the number ("55 min" → "55" + " min"). A cluster head can
  // carry a range instead ("20–55 min"); that still splits cleanly. Anything the
  // pattern doesn't recognise is left whole and simply crossfades, as before.
  const num = from.querySelector<HTMLElement>("[data-wait-num]");
  const parts = /^(\s*\d[\d\s–-]*?)(\s*[a-z].*)$/i.exec(num?.textContent ?? "");
  const morphNum = !!(num && parts);
  if (num && parts) {
    num.textContent = parts[1];
    const unit = document.createElement("span");
    unit.textContent = parts[2];
    num.after(unit);
    shed.push(unit);
  }

  const px = (v: string) => parseFloat(v) * k;
  Object.assign(from.style, {
    // Fill the frame and align the way the hero's block does, so growing the box
    // moves the content with it rather than stranding it in a corner.
    position: "absolute",
    inset: "0",
    // The open card *holds* this chip in place with an inline translate+scale
    // (the marker→card flight's resting state, cloned along with the node). The
    // box already starts at the transformed rect and `k` bakes the scale into
    // the type, so carrying the transform would displace the content by the
    // whole marker→card delta a second time — by a different amount for every
    // marker position.
    transform: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    margin: "0",
    maxWidth: "none",
    padding: `${px(cs.paddingTop)}px ${px(cs.paddingRight)}px ${px(cs.paddingBottom)}px ${px(cs.paddingLeft)}px`,
    fontSize: `${px(cs.fontSize)}px`,
    // The hero's number is `tabular-nums`; match it so the two copies of the
    // number sit glyph-for-glyph on each other when the wording crosses over.
    fontVariantNumeric: "tabular-nums",
    backgroundColor: "transparent",
    borderColor: "transparent",
    boxShadow: "none",
    transition: "none",
  });
  for (const el of shed) {
    Object.assign(el.style, {
      display: "inline-block",
      overflow: "hidden",
      whiteSpace: "nowrap",
      maxWidth: "8rem",
      opacity: "1",
      transition: "none",
    });
  }
  box.append(from);
  return { box, from, shed, morphNum };
}

/**
 * A travelling copy of the card's title.
 *
 * One text element the whole way, morphing its type — never two copies
 * crossfading, which is what produced a doubled name at two different wraps
 * mid-flight. The name is identical at both ends, so there is nothing to
 * crossfade *to*: it just grows from the card's 15px card-foreground into the
 * hero's white headline while the box carries it down.
 *
 * It keeps wrapping normally throughout rather than adopting the hero's own
 * truncation. A name that needs two lines at hero size does briefly overhang the
 * subtitle before the dissolve tidies it — but that's at the very end, over a
 * name whose first line already reads correctly, where taking the hero's
 * `truncate` instead would re-flow the title in the first frame of the flight.
 *
 * `pill` is the marker-rest launch (see `launchHeroFlightFromMarker`): the
 * source is the marker's resting name chip, still wearing its pill dressing —
 * so the box carries that dressing (background, border, radius, shadow) and
 * `flyTitle`'s moveBox sheds it across the flight, the exact mirror of the
 * return leg's `dressHome` gathering it back. Shedding it at frame zero
 * instead would strand white 10px text over the open map for the whole
 * flight. The card path keeps its bare box: `openAttractionCard` already
 * stripped the chip down to the card title before handing it over.
 */
function cloneTitle(src: HTMLElement | null, pill = false): Flown | null {
  if (!src) return null;
  const rect = src.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const cs = getComputedStyle(src);
  const box = pill ? pillBox(rect, cs) : document.createElement("div");
  Object.assign(box.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    // The pill clips (a clamped name may wrap once its nowrap is lifted below;
    // the second line has no business peeking out of a half-shed pill). The
    // card title overhangs freely, as before.
    overflow: pill ? "hidden" : "visible",
    transition: "none",
  });

  const from = src.cloneNode(true) as HTMLElement;
  Object.assign(from.style, {
    // Absolute, not a flex child: with `white-space` in play a flex item's
    // `min-width: auto` lets it blow past the box to its content width, which is
    // what threw the name off its box entirely. Pinned top-left is also simply
    // correct at both ends — the card title and the hero's h1 are each the top
    // of their own measured box.
    position: "absolute",
    left: "0",
    top: "0",
    // Like the wait chip, the card title rests at an inline translate (its own
    // marker→card flight holds it on the title slot) and the clone inherits it.
    // The box already starts at the translated rect, so the copy inside rides
    // untransformed — with it, the title lands offset by the marker→card delta.
    transform: "none",
    // The *resting* chip centres itself with Tailwind's `-translate-x-1/2`,
    // which rides the CSS `translate` property — `transform: none` doesn't
    // touch it (see the return leg's wait copy for the same gotcha). The card
    // path never hits this (`openAttractionCard` strips the class), but the
    // marker-rest launch clones the chip as it sits.
    translate: "none",
    display: "block",
    width: "100%",
    margin: "0",
    // The pill's padding is part of its resting look — it rides along and
    // `flyTitle` eases it to the hero title's bare box. Already 0 on the card
    // path, so the transition there is a no-op.
    padding: pill
      ? `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`
      : "0",
    border: "0",
    maxWidth: "none",
    whiteSpace: "normal",
    textAlign: "left",
    backgroundColor: "transparent",
    boxShadow: "none",
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing,
    color: cs.color,
    filter: cs.filter === "none" ? "" : cs.filter,
    transition: "none",
  });
  box.append(from);
  return { box, from };
}

/**
 * A travelling copy of the card's photo header. The box reproduces the card's
 * clip — rounded on top (the card's own corners), square at the bottom where
 * the body meets it — and the image fills it `object-cover`, so growing the box
 * re-frames the crop continuously instead of stretching the photo. A
 * marker-rest launch (`round`) starts from the disc instead, whose clip is
 * round on all four corners — the card's square bottom would clip a wedge off
 * the disc on the first frame.
 */
function clonePhoto(fill: HTMLElement | null, preview: string | null, round = false): Flown | null {
  if (!fill) return null;
  const rect = fill.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const wrap = fill.parentElement ? getComputedStyle(fill.parentElement) : null;
  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    borderRadius: !wrap
      ? "0px"
      : round
        ? "50%"
        : `${wrap.borderTopLeftRadius} ${wrap.borderTopRightRadius} 0px 0px`,
    overflow: "hidden",
    backgroundColor: getComputedStyle(fill).backgroundColor,
    transition: "none",
  });

  const from = fill.cloneNode(true) as HTMLElement;
  from.removeAttribute("data-face-fill");
  // Pin the exact bytes the card is already showing. Cloning the `srcset`/`sizes`
  // would let the clone re-pick a candidate for its new (much larger) box and
  // fetch it, which is the one thing a shared-element flight can't afford.
  if (from instanceof HTMLImageElement && fill instanceof HTMLImageElement) {
    if (fill.currentSrc) from.src = fill.currentSrc;
    from.removeAttribute("srcset");
    from.removeAttribute("sizes");
    from.removeAttribute("loading");
  }
  from.className = "";
  Object.assign(from.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
    // The disc's resting dressing (round clip, colour ring, the un-decoded blur
    // from `wireFaceFadeIn`) has no business on a full-bleed hero photo.
    borderRadius: "0",
    boxShadow: "none",
    opacity: "1",
    filter: "none",
    transform: "none",
    transition: "none",
  });
  box.append(from);

  // The hero's crop, when it differs from the one the card is showing. Layered
  // over `from` at zero opacity and faded in as soon as it decodes, so the
  // re-frame happens while the box is still travelling rather than on a hero
  // that has already come to rest.
  let swap: HTMLImageElement | null = null;
  const showing = fill instanceof HTMLImageElement ? fill.currentSrc || fill.src : null;
  if (preview && preview !== showing) {
    swap = document.createElement("img");
    swap.src = preview;
    swap.alt = "";
    Object.assign(swap.style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
      objectFit: "cover",
      display: "block",
      opacity: "0",
      transition: "none",
    });
    box.append(swap);
  }

  // The hero draws a text-clarity gradient over its photo; the card header has
  // none. Carry an initially-invisible layer for it on top of both photo copies
  // and fade it in across the flight (`flyPhoto` fills in the hero's own
  // gradient once it can read it), so the scrim is already at full strength
  // when the clone dissolves instead of popping in underneath it at settle.
  const scrim = document.createElement("div");
  Object.assign(scrim.style, {
    position: "absolute",
    inset: "0",
    opacity: "0",
    transition: "none",
  });
  box.append(scrim);

  return { box, from, swap, scrim };
}

/** Strip the hero's landing hooks off a clone so it can't be found by a query. */
function scrubTarget(el: HTMLElement): void {
  for (const a of ["data-hero", "data-hero-image", "data-hero-wait", "data-hero-title"])
    el.removeAttribute(a);
}

// --- the flight -----------------------------------------------------------

let teardown: (() => void) | null = null;

type HeroFlightOpts = {
  /** Launching from a *resting marker* (park badges never stage a card): the
   *  photo box starts fully round (the disc, not a card header) and the title
   *  clone keeps its pill dressing to shed in flight. */
  fromMarker?: boolean;
};

/**
 * Snapshot the open card and start the flight. Call this immediately *before*
 * `navigate()` — the card is still laid out at that point, and the seed has to
 * be published before the destination route's first render reads it.
 */
export function launchHeroFlight(
  input: HeroFlightSeed,
  nodes: CardFlightNodes,
  opts?: HeroFlightOpts,
): void {
  if (typeof window === "undefined") return;
  teardown?.();
  const key = input.key;
  // Carry over the exact bytes the card header is painting, so the hero can hold
  // them underneath its own copy instead of fading in from nothing.
  const face = nodes.fill instanceof HTMLImageElement ? nodes.fill : null;
  const seed: HeroFlightSeed = { ...input, cardImageUrl: face?.currentSrc || face?.src || null };

  // Reduced motion still gets the seeded hero — that's a load-time win, not an
  // animation — but nothing travels, so the targets are visible from the start.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    publish({ key, seed, flying: false });
    nodes.dismiss();
    return;
  }

  const flown = [
    clonePhoto(nodes.fill, seed.previewImageUrl, opts?.fromMarker),
    cloneWaitChip(nodes.waitEl),
    cloneTitle(nodes.nameEl, opts?.fromMarker),
  ];
  const [photo, wait, title] = flown;
  // Copies made — the card can go. From here the clones are the only visible
  // copy of it, right up until they dissolve onto the hero.
  nodes.dismiss();
  if (!photo && !wait && !title) {
    publish({ key, seed, flying: false });
    return;
  }

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    // Under the floating header (`sticky top-0 z-30` — see SiteHeader), because
    // that's where the clones are going: the hero is full-bleed *beneath* the
    // search pill, back button and avatar. Anything higher and the photo flies
    // over the chrome on its way in and blots it out mid-transition.
    zIndex: "20",
    pointerEvents: "none",
  });
  for (const f of flown) if (f) host.append(f.box);
  document.body.append(host);

  publish({ key, seed, flying: true });

  const timers: number[] = [];
  const later = (fn: () => void, ms: number) => {
    timers.push(window.setTimeout(fn, ms));
  };
  let raf = 0;
  const destroy = () => {
    cancelAnimationFrame(raf);
    for (const t of timers) clearTimeout(t);
    host.remove();
    if (teardown === destroy) teardown = null;
  };
  teardown = destroy;

  /** Hand the hero back to itself: real elements opaque, clones fading off. */
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    if (state?.key === key) publish({ key, seed, flying: false });
    // A frame's grace before the clones thin: the publish above is what makes
    // React reveal the real targets, and fading over a still-hidden target
    // reads as a flicker at the handoff.
    raf = requestAnimationFrame(() => {
      for (const f of flown) {
        if (!f) continue;
        f.box.style.transition = `opacity ${SETTLE_MS}ms ease`;
        f.box.style.opacity = "0";
      }
    });
    later(destroy, SETTLE_MS + 160);
  };

  /** A clone whose counterpart never rendered: dissolve it where it is. */
  const orphan = (f: Flown) => {
    f.box.style.transition = `opacity ${SETTLE_MS}ms ease`;
    f.box.style.opacity = "0";
  };

  /** Move a travelling box onto its target's geometry over the full flight. */
  const moveBox = (box: HTMLElement, r: DOMRect, radius: string, dress?: CSSStyleDeclaration) => {
    box.style.transition = [
      ...["left", "top", "width", "height", "border-radius", "background-color", "box-shadow"].map(
        (p) => `${p} ${FLIGHT_MS}ms ${FLIGHT_EASE}`,
      ),
      // The border is marker chrome, not content — shed it up front (DRESS_MS)
      // rather than dragging a white hairline across the whole flight.
      `border-color ${DRESS_MS}ms ease`,
      `border-width ${DRESS_MS}ms ease`,
    ].join(", ");
    Object.assign(box.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      borderRadius: radius,
      backgroundColor: dress?.backgroundColor ?? "transparent",
      // The hero's chips carry no border, so this lands on 0 — and because the
      // box is `border-box`, shrinking it moves nothing.
      borderWidth: dress?.borderTopWidth ?? "0px",
      borderColor: dress?.borderTopColor ?? "transparent",
      boxShadow: dress?.boxShadow ?? "none",
    });
  };

  /**
   * Photo: geometry, plus — when the marker and the hero don't publish the same
   * crop (see `heroPreviewUrl`) — a fade to the hero's framing as soon as it
   * decodes. Deliberately un-timed: in flight it lands under the motion, and if
   * the fetch is slow it merges into the settle instead, which waits on that
   * same image anyway.
   */
  const flyPhoto = (f: Flown | null, target: HTMLElement | null, radius: string) => {
    if (!f) return;
    if (!target) return orphan(f);
    const swap = f.swap;
    if (swap) {
      const begin = () => {
        swap.style.transition = `opacity ${SWAP_MS}ms ease`;
        swap.style.opacity = "1";
      };
      if (swap.complete && swap.naturalWidth > 0) begin();
      else swap.addEventListener("load", begin, { once: true });
    }
    // The scrim layer takes the hero's own gradient (read live, so it can't
    // drift from the design) and rides up to full strength over the whole
    // flight — landing already scrimmed, so the settle dissolve reveals an
    // identical gradient underneath rather than popping one in.
    if (f.scrim) {
      const real = target.parentElement?.querySelector<HTMLElement>("[data-hero-scrim]");
      if (real) {
        f.scrim.style.backgroundImage = getComputedStyle(real).backgroundImage;
        f.scrim.style.transition = `opacity ${FLIGHT_MS}ms ease`;
        f.scrim.style.opacity = "1";
      }
    }
    moveBox(f.box, target.getBoundingClientRect(), radius);
  };

  /**
   * Wait chip: the number *morphs* onto the hero's, the wording crossfades. The
   * card's own trimmings collapse away first (DRESS_MS) so the number is alone
   * and left-anchored well before it reaches full size; the hero's copy then
   * fades in over a number that already matches it, which is what keeps the swap
   * from reading as two pills stacked on each other.
   */
  const flyWait = (f: Flown | null, target: HTMLElement | null) => {
    if (!f) return;
    if (!target) return orphan(f);
    const cs = getComputedStyle(target);
    const tr = target.getBoundingClientRect();
    const numTarget =
      target.querySelector<HTMLElement>("[data-hero-wait-num]") ?? target.firstElementChild;
    const ncs = numTarget instanceof HTMLElement ? getComputedStyle(numTarget) : null;

    for (const el of f.shed ?? []) {
      el.style.transition = `opacity ${DRESS_MS}ms ease, max-width ${DRESS_MS}ms ease`;
      el.style.opacity = "0";
      el.style.maxWidth = "0px";
    }

    f.from.style.transition = [
      ...["padding", "font-size", "line-height", "letter-spacing"].map(
        (p) => `${p} ${FLIGHT_MS}ms ${FLIGHT_EASE}`,
      ),
      `opacity ${SWAP_MS}ms ease ${SWAP_DELAY_MS}ms`,
    ].join(", ");
    Object.assign(f.from.style, {
      padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      fontSize: ncs?.fontSize ?? cs.fontSize,
      lineHeight: ncs?.lineHeight ?? cs.lineHeight,
      letterSpacing: ncs?.letterSpacing ?? cs.letterSpacing,
      // With the number isolated, only the *wording* hands over — and the number
      // underneath has already become the hero's, so it holds at full opacity
      // rather than crossfading with its own twin (which would dip through a
      // half-transparent trough at the midpoint). Without the split there are two
      // different labels in play, so fall back to fading the card's out.
      opacity: f.morphNum ? "1" : "0",
    });

    const to = target.cloneNode(true) as HTMLElement;
    scrubTarget(to);
    // When the number is morphing over from the card's own copy, the incoming
    // clone contributes only the wording — its number rides along invisible
    // (still occupying its final width, which is what seats the label column)
    // so there's never a second number at a second size mid-flight.
    if (f.morphNum) {
      const n = to.querySelector<HTMLElement>("[data-hero-wait-num]");
      if (n) n.style.visibility = "hidden";
    }
    Object.assign(to.style, {
      // Laid out at its *landing* size from the first frame — never `inset: 0`,
      // which would size the copy to the still-growing pill and re-wrap the
      // "wait now" wording line by line as the box widens. The pill's own
      // overflow clip is what reveals it progressively instead.
      position: "absolute",
      left: "0",
      top: "0",
      width: `${tr.width}px`,
      height: `${tr.height}px`,
      margin: "0",
      maxWidth: "none",
      opacity: "0",
      // The target is a *hidden* landing pad while the flight is up — inline
      // `visibility: hidden` (see DetailHero) that cloneNode carries over. The
      // copy exists to be seen mid-air, so put it back; the number's own
      // hidden marker above stays, being the more specific inline style.
      visibility: "visible",
      // The box draws the dressing for both ends, so the incoming copy brings
      // only its content — otherwise its (already final) pill would pop in at
      // full size over the box that's still growing into it. Backdrop blur is
      // dressing too, and worse: Chrome paints it at full strength even while
      // the copy is transparent, which read as a flickering blur patch.
      backgroundColor: "transparent",
      borderColor: "transparent",
      boxShadow: "none",
      backdropFilter: "none",
      transition: `opacity ${SWAP_MS}ms ease ${SWAP_DELAY_MS}ms`,
    });
    to.style.setProperty("-webkit-backdrop-filter", "none");
    f.box.append(to);
    void to.offsetWidth;
    to.style.opacity = "1";

    moveBox(f.box, tr, cs.borderRadius, cs);
  };

  /** Title: one element, type morphing card-title → headline. No second copy.
   *  Padding rides the same clock — a marker-rest launch starts from the name
   *  chip's padded pill; the card path starts (and stays) at 0. */
  const flyTitle = (f: Flown | null, target: HTMLElement | null) => {
    if (!f) return;
    if (!target) return orphan(f);
    const cs = getComputedStyle(target);
    f.from.style.transition = [
      "font-size",
      "font-weight",
      "line-height",
      "letter-spacing",
      "color",
      "filter",
      "padding",
    ]
      .map((p) => `${p} ${FLIGHT_MS}ms ${FLIGHT_EASE}`)
      .join(", ");
    Object.assign(f.from.style, {
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      color: cs.color,
      filter: cs.filter === "none" ? "" : cs.filter,
      padding: "0px",
    });
    moveBox(f.box, target.getBoundingClientRect(), "0px");
  };

  const land = (hero: HTMLElement) => {
    const photoTarget = hero.querySelector<HTMLElement>("[data-hero-image]");
    // A hero that's mounted but not yet laid out (zero-height on the frame it
    // commits) would hand back a meaningless box — wait for a real one.
    if (photoTarget && !photoTarget.getBoundingClientRect().height) {
      raf = requestAnimationFrame(tick);
      return;
    }
    // The photo layer is `inset-0` with no radius of its own — what actually
    // rounds the photo is the hero box clipping it (square full-bleed on mobile,
    // `rounded-2xl` from md up), so that's the shape the clone has to land on.
    flyPhoto(photo, photoTarget, getComputedStyle(hero).borderRadius);
    flyWait(wait, hero.querySelector<HTMLElement>("[data-hero-wait]"));
    flyTitle(title, hero.querySelector<HTMLElement>("[data-hero-title]"));

    // Don't dissolve onto an empty box: hold the photo clone past the travel
    // until there's a decoded photo underneath it. Arriving from a card that's
    // seeded the hero, its underlay copy is already decoded and this resolves
    // at once; on a cold hero it waits for the real <img>.
    const img = photoTarget?.querySelector("img") ?? null;
    later(() => {
      if (!photo || !img || (img.complete && img.naturalWidth > 0)) {
        settle();
        return;
      }
      img.addEventListener("load", settle, { once: true });
      img.addEventListener("error", settle, { once: true });
      later(settle, PHOTO_HOLD_MS);
    }, FLIGHT_MS);
  };

  const started = performance.now();
  const tick = () => {
    const hero = document.querySelector<HTMLElement>(`[data-hero="${CSS.escape(key)}"]`);
    if (hero) {
      land(hero);
      return;
    }
    if (performance.now() - started > LAND_TIMEOUT_MS) {
      settle();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

/**
 * The marker-direct launch (park badges): there's no card stage — `onActivate`
 * navigates straight away — so the flight leaves from the marker *at rest*: the
 * 64px disc face flies onto the hero's photo, the name chip onto its title.
 * This wrapper locates those pads itself (`[data-face-fill]` /
 * `[data-name-chip]`, the same sub-targets the return leg lands on) and hides
 * the whole marker for the trip — same discipline as the return's `hideMarker`:
 * a marker seen resting under its own airborne clones reads as a duplicate. No
 * un-hide is needed: the park-context switch the navigation triggers rebuilds
 * the marker set from scratch.
 */
export function launchHeroFlightFromMarker(seed: HeroFlightSeed, markerEl: HTMLElement): void {
  if (typeof window === "undefined") return;
  launchHeroFlight(
    seed,
    {
      fill: markerEl.querySelector<HTMLElement>("[data-face-fill]"),
      waitEl: null,
      nameEl: markerEl.querySelector<HTMLElement>("[data-name-chip]"),
      dismiss: () => markerEl.style.setProperty("visibility", "hidden"),
    },
    { fromMarker: true },
  );
}

// --- the return flight ------------------------------------------------------

/**
 * The reverse trip: the detail hero pops back down into its map marker.
 *
 * Invoked from the detail page's unmount cleanup — the one moment the hero is
 * still measurable while history already points at the destination — and only
 * when that destination is one of the seed's `returnPaths` (a map view this
 * page was card-launched from, so the marker is known to exist). The hero's
 * photo, wait chip and title are cloned into the same kind of fixed overlay as
 * the forward flight and fly down onto the marker's face, wait badge and name
 * pill. The marker itself — already restored to a resting disc by the card's
 * `dismiss` — is never touched: the clones shrink onto it and dissolve.
 *
 * Same grammar as the outbound leg, run backwards: the wait number is the
 * shared element (its wording sheds, the badge's " min" fades in), the title
 * is one text element morphing headline → pill, and the photo re-rounds into
 * the disc while the scrim fades off it. Legs whose pad the marker doesn't
 * carry (a POI has no wait badge) simply orphan, as on the way out.
 */
export function launchHeroReturn(key: string): void {
  if (typeof window === "undefined") return;
  if (state?.key !== key) return;
  const { markerKey, returnPaths } = state.seed;
  // By unmount time the history entry is already the destination's.
  if (!returnPaths.includes(window.location.pathname)) return;
  if (state.flying) {
    // Backed out with the forward flight still airborne — drop everything.
    teardown?.();
    publish(null);
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const hero = document.querySelector<HTMLElement>(`[data-hero="${CSS.escape(key)}"]`);
  if (!hero) return;
  const heroRect = hero.getBoundingClientRect();
  if (!heroRect.width || !heroRect.height) return;
  teardown?.();

  // Photo: a fresh copy of whatever the hero is showing (the topmost decoded,
  // visible <img> — the gallery crossfade keeps its idle slides at opacity 0),
  // under the scrim at full strength, in a box that clips like the hero.
  const heroCs = getComputedStyle(hero);
  const photoBox = document.createElement("div");
  Object.assign(photoBox.style, {
    position: "fixed",
    left: `${heroRect.left}px`,
    top: `${heroRect.top}px`,
    width: `${heroRect.width}px`,
    height: `${heroRect.height}px`,
    borderRadius: heroCs.borderRadius,
    overflow: "hidden",
    backgroundColor: heroCs.backgroundColor,
    // A ride with no published photo heroes a gradient instead — carry it, so
    // the return isn't an empty grey box shrinking into the disc.
    backgroundImage: heroCs.backgroundImage,
    transition: "none",
  });
  const shown = Array.from(hero.querySelectorAll<HTMLImageElement>("[data-hero-image] img"))
    .filter(
      (i) =>
        i.currentSrc && i.complete && i.naturalWidth > 0 && getComputedStyle(i).opacity !== "0",
    )
    .pop();
  if (shown) {
    const img = document.createElement("img");
    img.src = shown.currentSrc;
    img.alt = "";
    Object.assign(img.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      objectFit: "cover",
      display: "block",
    });
    photoBox.append(img);
  }
  const scrimSrc = hero.querySelector<HTMLElement>("[data-hero-scrim]");
  let scrim: HTMLElement | null = null;
  if (scrimSrc) {
    scrim = document.createElement("div");
    Object.assign(scrim.style, {
      position: "absolute",
      inset: "0",
      backgroundImage: getComputedStyle(scrimSrc).backgroundImage,
      transition: "none",
    });
    photoBox.append(scrim);
  }

  // Wait chip: the hero block, its number ready to shrink back into the badge.
  const waitSrc = hero.querySelector<HTMLElement>("[data-hero-wait]");
  let wait: { box: HTMLElement; from: HTMLElement; label: HTMLElement | null } | null = null;
  if (waitSrc) {
    const r = waitSrc.getBoundingClientRect();
    if (r.width && r.height) {
      const cs = getComputedStyle(waitSrc);
      const box = pillBox(r, cs);
      const from = waitSrc.cloneNode(true) as HTMLElement;
      scrubTarget(from);
      Object.assign(from.style, {
        position: "absolute",
        inset: "0",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        margin: "0",
        maxWidth: "none",
        padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
        fontVariantNumeric: "tabular-nums",
        backgroundColor: "transparent",
        boxShadow: "none",
        backdropFilter: "none",
        transition: "none",
      });
      from.style.setProperty("-webkit-backdrop-filter", "none");
      box.append(from);
      wait = {
        box,
        from,
        label: from.querySelector<HTMLElement>("[data-hero-wait-label]"),
      };
    }
  }

  // Title: one text element, headline type ready to morph down into the pill's.
  const titleSrc = hero.querySelector<HTMLElement>("[data-hero-title]");
  let title: { box: HTMLElement; from: HTMLElement } | null = null;
  if (titleSrc) {
    const r = titleSrc.getBoundingClientRect();
    if (r.width && r.height) {
      const cs = getComputedStyle(titleSrc);
      const box = document.createElement("div");
      Object.assign(box.style, {
        position: "fixed",
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        overflow: "hidden",
        borderRadius: "0px",
        backgroundColor: "transparent",
        border: "0px solid transparent",
        boxSizing: "border-box",
        transition: "none",
      });
      const from = titleSrc.cloneNode(true) as HTMLElement;
      scrubTarget(from);
      Object.assign(from.style, {
        position: "absolute",
        left: "0",
        top: "0",
        width: "100%",
        margin: "0",
        padding: "0",
        border: "0",
        maxWidth: "none",
        display: "block",
        // Nowrap from the first frame: the pill it's becoming is one clipped
        // line, and an ellipsis emerging as the box narrows *is* the pill's
        // own clamp arriving.
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        textAlign: "left",
        backgroundColor: "transparent",
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        color: cs.color,
        filter: cs.filter === "none" ? "" : cs.filter,
        transition: "none",
      });
      box.append(from);
      title = { box, from };
    }
  }

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    zIndex: "20",
    pointerEvents: "none",
  });
  host.append(photoBox);
  if (wait) host.append(wait.box);
  if (title) host.append(title.box);
  document.body.append(host);

  // The marker is the landing pad, and it must not be *seen* waiting: a
  // resting disc sitting under clones that are still descending reads as the
  // hero landing on an already-there duplicate. Mirror the forward flight's
  // hidden hero targets — keep the marker invisible for the whole descent
  // (re-asserted every frame, since the map can rebuild markers mid-flight)
  // and reveal it the moment the dissolve starts.
  const markerEl = () =>
    document.querySelector<HTMLElement>(`[data-marker-key="${CSS.escape(markerKey)}"]`);
  let revealed = false;
  const hideMarker = () => {
    if (!revealed) markerEl()?.style.setProperty("visibility", "hidden");
  };
  const revealMarker = () => {
    revealed = true;
    markerEl()?.style.removeProperty("visibility");
  };

  const timers: number[] = [];
  const later = (fn: () => void, ms: number) => {
    timers.push(window.setTimeout(fn, ms));
  };
  let raf = 0;
  const destroy = () => {
    cancelAnimationFrame(raf);
    for (const t of timers) clearTimeout(t);
    // Whatever path got us here, never leave the marker hidden behind.
    revealMarker();
    host.remove();
    if (teardown === destroy) teardown = null;
  };
  teardown = destroy;

  const boxes = [photoBox, wait?.box, title?.box];
  const settle = () => {
    revealMarker();
    for (const b of boxes) {
      if (!b) continue;
      b.style.transition = `opacity ${SETTLE_MS}ms ease`;
      b.style.opacity = "0";
    }
    later(destroy, SETTLE_MS + 80);
  };
  const orphan = (b: HTMLElement) => {
    b.style.transition = `opacity ${SETTLE_MS}ms ease`;
    b.style.opacity = "0";
  };

  /** Dressing toward the landing look — geometry is the tracker's job (below).
   *  The border *arrives* on the last DRESS_MS — the mirror of the outbound
   *  leg shedding it on the first. */
  const dressHome = (box: HTMLElement, dress: CSSStyleDeclaration, radius: string) => {
    box.style.transition = [
      ...["border-radius", "background-color", "box-shadow"].map(
        (p) => `${p} ${FLIGHT_MS}ms ${FLIGHT_EASE}`,
      ),
      `border-color ${DRESS_MS}ms ease ${FLIGHT_MS - DRESS_MS}ms`,
      `border-width ${DRESS_MS}ms ease ${FLIGHT_MS - DRESS_MS}ms`,
    ].join(", ");
    Object.assign(box.style, {
      borderRadius: radius,
      backgroundColor: dress.backgroundColor,
      borderWidth: dress.borderTopWidth,
      borderColor: dress.borderTopColor,
      boxShadow: dress.boxShadow,
    });
  };

  /**
   * Per-frame geometry. A one-shot CSS transition flies to wherever the marker
   * was at launch — but the map is often still morphing its container and
   * settling its camera in the first few hundred ms after the route swap, so
   * the clones kept landing *beside* the marker. Each box instead eases from
   * its snapshot toward the marker's live rect, re-read every frame (and
   * re-queried, so a marker rebuild mid-flight is survivable), then keeps
   * pinning to it through the dissolve so a late camera settle drags the
   * clones along rather than leaving them hanging.
   */
  type Tracked = {
    box: HTMLElement;
    start: DOMRect;
    target: () => DOMRect | undefined;
    last?: DOMRect;
    /** Consecutive frames the target has been gone (unlaid-out / removed). */
    misses: number;
    /** Content sized on the same clock as the box — type shrinking on a CSS
     *  clock of its own let the pill close faster than its number, clipping
     *  it into a squish just before touchdown. */
    sync?: (k: number) => void;
  };
  const tracked: Tracked[] = [];
  /** Frames of target loss to tolerate (rebuild blips) before giving up. */
  const TARGET_LOSS_FRAMES = 5;
  // Close cousin of FLIGHT_EASE, for the leg driven from JS.
  const easeOut = (t: number) => 1 - (1 - t) ** 4;
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  const startTracking = () => {
    const t0 = performance.now();
    const step = () => {
      hideMarker();
      const k = easeOut(Math.min(1, (performance.now() - t0) / FLIGHT_MS));
      for (const f of tracked) {
        const cur = f.target();
        if (cur && cur.width && cur.height) {
          f.last = cur;
          f.misses = 0;
        } else if (++f.misses === TARGET_LOSS_FRAMES) {
          // The landing pad left the map mid-flight — the declutter pass hides
          // wait badges as markers crowd, and a suppressed badge never comes
          // back at settle either. There is nothing to land on, so this clone
          // bows out where it is instead of freezing at the pad's last rect.
          orphan(f.box);
        }
        if (f.misses >= TARGET_LOSS_FRAMES) continue;
        const r = f.last;
        if (!r) continue;
        f.box.style.left = `${f.start.left + (r.left - f.start.left) * k}px`;
        f.box.style.top = `${f.start.top + (r.top - f.start.top) * k}px`;
        f.box.style.width = `${f.start.width + (r.width - f.start.width) * k}px`;
        f.box.style.height = `${f.start.height + (r.height - f.start.height) * k}px`;
        f.sync?.(k);
      }
      // Runs until `destroy` cancels it — pinning is part of the dissolve too.
      raf = requestAnimationFrame(step);
    };
    step();
  };

  const flyBack = (marker: HTMLElement) => {
    const face = marker.querySelector<HTMLElement>("[data-face-fill]");
    const badge = marker.querySelector<HTMLElement>("[data-wait-badge]");
    const chip = marker.querySelector<HTMLElement>("[data-name-chip]");
    /** A live rect reader for the tracker — re-queried from the document each
     *  frame, so it follows the marker through camera moves and rebuilds. */
    const live = (sel: string) => () =>
      document
        .querySelector<HTMLElement>(`[data-marker-key="${CSS.escape(markerKey)}"]`)
        ?.querySelector<HTMLElement>(sel)
        ?.getBoundingClientRect();

    // Photo → the round disc face. The scrim clears early, while the box is
    // still big enough for its gradient to read as anything.
    const fr = face?.getBoundingClientRect();
    if (face && fr && fr.width && fr.height) {
      dressHome(photoBox, getComputedStyle(face), "50%");
      tracked.push({
        box: photoBox,
        start: photoBox.getBoundingClientRect(),
        target: live("[data-face-fill]"),
        last: fr,
        misses: 0,
      });
      if (scrim) {
        scrim.style.transition = `opacity ${SWAP_MS}ms ease`;
        scrim.style.opacity = "0";
      }
    } else {
      orphan(photoBox);
    }

    // Wait chip → the badge. The number is the shared element again: the
    // hero's wording sheds up front, the number rides down to badge size, and
    // the badge's own "75 min" fades in with its number hidden beneath ours.
    if (wait) {
      const br = badge?.getBoundingClientRect();
      if (badge && br && br.width && br.height) {
        const bcs = getComputedStyle(badge);
        if (wait.label) {
          wait.label.style.maxWidth = `${wait.label.offsetWidth}px`;
          wait.label.style.overflow = "hidden";
          // A flex child's `min-width: auto` holds it at content width no
          // matter the max-width — same gotcha as `data-wait-sub`'s min-w-0.
          wait.label.style.minWidth = "0";
          void wait.label.offsetWidth;
          wait.label.style.transition = `opacity ${DRESS_MS}ms ease, max-width ${DRESS_MS}ms ease`;
          wait.label.style.opacity = "0";
          wait.label.style.maxWidth = "0px";
        }
        // The number's size lives on its own span (text-3xl), so the shrink
        // has to be driven there, not on the chip root. Both it and the
        // padding ride the tracker's own clock (`sync` below) rather than a
        // CSS transition: the box geometry is per-frame now, and a type clock
        // that lags it gets the number clipped by the closing pill.
        const num = wait.from.querySelector<HTMLElement>("[data-hero-wait-num]");
        const fcs = getComputedStyle(wait.from);
        const p0 = [fcs.paddingTop, fcs.paddingRight, fcs.paddingBottom, fcs.paddingLeft].map(
          parseFloat,
        );
        const p1 = [bcs.paddingTop, bcs.paddingRight, bcs.paddingBottom, bcs.paddingLeft].map(
          parseFloat,
        );
        const fs0 = parseFloat(fcs.fontSize);
        const fs1 = parseFloat(bcs.fontSize);
        const nfs0 = num ? parseFloat(getComputedStyle(num).fontSize) : 0;
        if (num) {
          num.style.transition = "none";
          // The badge it lands on sets its digits proportionally — the hero's
          // own `tabular-nums` (still on the cloned span) draws a wider "10",
          // which double-strikes against the real badge's glyphs through the
          // settle dissolve. Same trade as the outbound leg: bake the *landing*
          // end's numeric metrics in at launch, where the route swap masks it.
          num.style.fontVariantNumeric = "normal";
        }
        wait.from.style.transition = "none";
        // Sub-pixel per letter — not worth a clock of its own.
        wait.from.style.letterSpacing = bcs.letterSpacing;
        const to = badge.cloneNode(true) as HTMLElement;
        // Same split as the outbound leg, backwards: the badge says "75 min",
        // our number is already the "75", so only the " min" may fade in.
        const toNum = to.querySelector<HTMLElement>("[data-wait-num]");
        const parts = /^(\s*\d[\d\s–-]*?)(\s*[a-z].*)$/i.exec(toNum?.textContent ?? "");
        if (toNum && parts) {
          toNum.textContent = parts[1];
          toNum.style.visibility = "hidden";
          const unit = document.createElement("span");
          unit.textContent = parts[2];
          // The unit keeps its leading space (" min"). As a flex item's first
          // character it would otherwise collapse, seating "min" a few px left
          // of where the real badge's single "10 min" span draws it — a smear,
          // not a dissolve, when the badge is revealed underneath at settle.
          unit.style.whiteSpace = "pre";
          toNum.after(unit);
        }
        Object.assign(to.style, {
          // Landing size, but ride the box's vertical *center*, not its top:
          // the hero clone underneath is centered (flex, inset-0), so a
          // top-pinned copy hangs its " min" in the corner of the still-tall
          // pill, away from the number it labels.
          position: "absolute",
          left: "0",
          top: "0",
          bottom: "0",
          margin: "auto 0",
          width: `${br.width}px`,
          height: `${br.height}px`,
          maxWidth: "none",
          transform: "none",
          // Tailwind's -translate-x-1/2 rides the CSS `translate` *property*,
          // which `transform: none` doesn't touch — left un-cleared it slid
          // this copy half a pill left, drawing "min" squarely over the number.
          translate: "none",
          opacity: "0",
          backgroundColor: "transparent",
          borderColor: "transparent",
          boxShadow: "none",
          transition: "none",
        });
        wait.box.append(to);

        const waitSync = (k: number) => {
          wait.from.style.padding = `${lerp(p0[0], p1[0], k)}px ${lerp(p0[1], p1[1], k)}px ${lerp(p0[2], p1[2], k)}px ${lerp(p0[3], p1[3], k)}px`;
          wait.from.style.fontSize = `${lerp(fs0, fs1, k)}px`;
          if (num) num.style.fontSize = `${lerp(nfs0, fs1, k)}px`;
          // The " min" arrives on the geometry's own clock, and only over its
          // last stretch. The outbound leg's fixed SWAP_DELAY runs the fade
          // while this box is still well oversized — which painted the wording
          // at its *landed* spot across a number still mid-shrink: overlapping
          // glyphs scrunched into the corner of the pill.
          to.style.opacity = String(Math.min(1, Math.max(0, (k - 0.92) / 0.08)));
        };

        dressHome(wait.box, bcs, bcs.borderRadius);
        tracked.push({
          box: wait.box,
          start: wait.box.getBoundingClientRect(),
          target: live("[data-wait-badge]"),
          last: br,
          misses: 0,
          sync: waitSync,
        });
      } else {
        orphan(wait.box);
      }
    }

    // Title → the name pill: type shrinks to pill scale while the pill's
    // dressing gathers around it.
    if (title) {
      const cr = chip?.getBoundingClientRect();
      if (chip && cr && cr.width && cr.height) {
        const ccs = getComputedStyle(chip);
        // Size-affecting type props ride the tracker's clock (`sync`), like the
        // wait chip's — the clipped box would squish a slower CSS clock's text.
        // The non-geometric hand-offs (weight, color, shadow) stay on CSS.
        title.from.style.transition = ["font-weight", "letter-spacing", "color", "filter"]
          .map((p) => `${p} ${FLIGHT_MS}ms ${FLIGHT_EASE}`)
          .join(", ");
        Object.assign(title.from.style, {
          fontWeight: ccs.fontWeight,
          letterSpacing: ccs.letterSpacing,
          color: ccs.color,
          // "none", not "" — clearing the override would let the clone's own
          // `drop-shadow-md` class reassert itself.
          filter: "none",
        });
        const tcs = getComputedStyle(title.from);
        const tf0 = parseFloat(tcs.fontSize);
        const tf1 = parseFloat(ccs.fontSize);
        const tl0 = parseFloat(tcs.lineHeight) || tf0 * 1.2;
        const tl1 = parseFloat(ccs.lineHeight) || tf1;
        const tp0 = [tcs.paddingTop, tcs.paddingRight, tcs.paddingBottom, tcs.paddingLeft].map(
          parseFloat,
        );
        const tp1 = [ccs.paddingTop, ccs.paddingRight, ccs.paddingBottom, ccs.paddingLeft].map(
          parseFloat,
        );
        dressHome(title.box, ccs, ccs.borderRadius);
        tracked.push({
          box: title.box,
          start: title.box.getBoundingClientRect(),
          target: live("[data-name-chip]"),
          last: cr,
          misses: 0,
          sync: (k) => {
            title.from.style.fontSize = `${lerp(tf0, tf1, k)}px`;
            title.from.style.lineHeight = `${lerp(tl0, tl1, k)}px`;
            title.from.style.padding = `${lerp(tp0[0], tp1[0], k)}px ${lerp(tp0[1], tp1[1], k)}px ${lerp(tp0[2], tp1[2], k)}px ${lerp(tp0[3], tp1[3], k)}px`;
          },
        });
      } else {
        orphan(title.box);
      }
    }

    later(settle, FLIGHT_MS);
    startTracking();
  };

  const started = performance.now();
  const tick = () => {
    // Out of sight from its very first frame, laid out or not.
    hideMarker();
    const marker = markerEl();
    // The marker exists but may not be laid out yet (the map slot is still
    // reattaching); wait for a real face box before measuring anything. No
    // need to wait for it to hold *still* — the tracker follows it live.
    if (marker?.querySelector<HTMLElement>("[data-face-fill]")?.getBoundingClientRect().height) {
      flyBack(marker);
      return;
    }
    if (performance.now() - started > LAND_TIMEOUT_MS) {
      settle();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  hideMarker();
  raf = requestAnimationFrame(tick);
}
