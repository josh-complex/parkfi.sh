import * as React from "react";

import { cfImagesStore } from "#/integrations/posthog/feature-flags.ts";
import { cfImageUrl, disneyResizeUrl } from "#/lib/image.ts";

/**
 * Cross-route shared-element flight: the open map card → the ride page hero.
 *
 * The map card isn't React — `openAttractionCard` builds it imperatively out of
 * the marker's own disc — so motion's `layoutId` can't pair it with anything on
 * the ride page. This does the pairing by hand, the same way `map-morph` carries
 * the singleton map between route slots: on press we snapshot the card's three
 * shared elements (photo header, live-wait chip, title), clone them into a fixed
 * overlay on `document.body` (which outlives the route swap), and fly the clones
 * to the hero's matching boxes once it mounts.
 *
 * The press also publishes a **seed** — the name, subtitle, wait and photo the
 * card was already showing. `RideDetail` paints its hero from that seed while
 * `parks.attraction` is still in flight, so the clones land on a real hero
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
 * What the map card already knows about the ride, handed to the hero so it can
 * paint before its own query resolves. Everything here is what the *card* was
 * showing, so a seeded hero and the flown clones agree by construction.
 */
export type RideFlightSeed = {
  parkSlug: string;
  rideSlug: string;
  name: string;
  /** "Park name · Land" — one line, exactly the hero's own subtitle. */
  subtitle: string;
  /** Live standby minutes, or null when the card showed no live wait. */
  waitMinutes: number | null;
  /** Operating status code, so the hero's status pill doesn't pop in later. */
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
  seed: RideFlightSeed;
  /** True while clones still cover the hero, which keeps its targets hidden. */
  flying: boolean;
};

export function rideFlightKey(parkSlug: string, rideSlug: string): string {
  return `${parkSlug}/${rideSlug}`;
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
 * The seed for *this* ride page plus whether clones are still covering it.
 * Null when the page wasn't opened from a map card — the ordinary case for a
 * deep link or a crawler, which just renders the normal skeleton.
 */
export function useRideFlight(parkSlug: string, rideSlug: string): FlightState | null {
  const key = rideFlightKey(parkSlug, rideSlug);
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
}): RideFlightSeed {
  const { parkSlug, parkName, ride } = opts;
  const operating = ride.status === "OPERATING";
  const imageUrl = ride.meta?.imageHeroUrl ?? ride.meta?.imageThumbUrl ?? null;
  return {
    parkSlug,
    rideSlug: ride.slug,
    name: ride.name,
    subtitle: [parkName, ride.meta?.land].filter(Boolean).join(" · "),
    // Only a *live* wait: the hero's other source (the 24–48h typical) isn't on
    // the map item, and it lands in an absolutely-positioned overlay, so letting
    // it appear a moment later costs no layout.
    waitMinutes: operating && ride.standbyWait != null ? ride.standbyWait : null,
    status: ride.status ?? null,
    imageUrl,
    // Filled in by `launchRideFlight`, which can read what the card is actually
    // painting rather than guess at which rendition won.
    cardImageUrl: null,
    previewImageUrl: heroPreviewUrl(imageUrl),
  };
}

/**
 * Drop this ride's seed (on unmount), so navigating back to the same ride later
 * from somewhere that *isn't* the map doesn't paint a stale hero from it.
 */
export function releaseRideFlight(parkSlug: string, rideSlug: string): void {
  // Never mid-flight: clearing the seed there would swap the seeded hero back to
  // a skeleton and reveal the landing targets under clones still in the air. A
  // flight that outlives its page dissolves on its own timers anyway.
  if (state?.flying) return;
  if (state?.key === rideFlightKey(parkSlug, rideSlug)) publish(null);
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
 */
function cloneTitle(src: HTMLElement | null): Flown | null {
  if (!src) return null;
  const rect = src.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const cs = getComputedStyle(src);
  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    overflow: "visible",
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
    display: "block",
    width: "100%",
    margin: "0",
    padding: "0",
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
 * re-frames the crop continuously instead of stretching the photo.
 */
function clonePhoto(fill: HTMLElement | null, preview: string | null): Flown | null {
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
    borderRadius: wrap ? `${wrap.borderTopLeftRadius} ${wrap.borderTopRightRadius} 0px 0px` : "0px",
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
  for (const a of [
    "data-ride-hero",
    "data-ride-hero-image",
    "data-ride-hero-wait",
    "data-ride-hero-title",
  ])
    el.removeAttribute(a);
}

// --- the flight -----------------------------------------------------------

let teardown: (() => void) | null = null;

/**
 * Snapshot the open card and start the flight. Call this immediately *before*
 * `navigate()` — the card is still laid out at that point, and the seed has to
 * be published before the ride route's first render reads it.
 */
export function launchRideFlight(input: RideFlightSeed, nodes: CardFlightNodes): void {
  if (typeof window === "undefined") return;
  teardown?.();
  const key = rideFlightKey(input.parkSlug, input.rideSlug);
  // Carry over the exact bytes the card header is painting, so the hero can hold
  // them underneath its own copy instead of fading in from nothing.
  const face = nodes.fill instanceof HTMLImageElement ? nodes.fill : null;
  const seed: RideFlightSeed = { ...input, cardImageUrl: face?.currentSrc || face?.src || null };

  // Reduced motion still gets the seeded hero — that's a load-time win, not an
  // animation — but nothing travels, so the targets are visible from the start.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    publish({ key, seed, flying: false });
    nodes.dismiss();
    return;
  }

  const flown = [
    clonePhoto(nodes.fill, seed.previewImageUrl),
    cloneWaitChip(nodes.waitEl),
    cloneTitle(nodes.nameEl),
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
    for (const f of flown) {
      if (!f) continue;
      f.box.style.transition = `opacity ${SETTLE_MS}ms ease`;
      f.box.style.opacity = "0";
    }
    later(destroy, SETTLE_MS + 80);
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
      const real = target.parentElement?.querySelector<HTMLElement>("[data-ride-hero-scrim]");
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
      target.querySelector<HTMLElement>("[data-ride-hero-wait-num]") ?? target.firstElementChild;
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
      const n = to.querySelector<HTMLElement>("[data-ride-hero-wait-num]");
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
      // The box draws the dressing for both ends, so the incoming copy brings
      // only its content — otherwise its (already final) pill would pop in at
      // full size over the box that's still growing into it.
      backgroundColor: "transparent",
      borderColor: "transparent",
      boxShadow: "none",
      transition: `opacity ${SWAP_MS}ms ease ${SWAP_DELAY_MS}ms`,
    });
    f.box.append(to);
    void to.offsetWidth;
    to.style.opacity = "1";

    moveBox(f.box, tr, cs.borderRadius, cs);
  };

  /** Title: one element, type morphing card-title → headline. No second copy. */
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
    });
    moveBox(f.box, target.getBoundingClientRect(), "0px");
  };

  const land = (hero: HTMLElement) => {
    const photoTarget = hero.querySelector<HTMLElement>("[data-ride-hero-image]");
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
    flyWait(wait, hero.querySelector<HTMLElement>("[data-ride-hero-wait]"));
    flyTitle(title, hero.querySelector<HTMLElement>("[data-ride-hero-title]"));

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
    const hero = document.querySelector<HTMLElement>(`[data-ride-hero="${CSS.escape(key)}"]`);
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
