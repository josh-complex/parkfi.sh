"use client";

import * as React from "react";

import { disneyResizeUrl, imageFocusClass } from "#/lib/image.ts";
import { cn } from "#/lib/utils.ts";

/**
 * Shared hero-media pieces (plan item 1.9) used by the park dashboard, ride
 * detail, and dining venue detail heroes. Both render as overlays above an
 * existing base `Image` (SSR'd, thumbhash placeholder) so the still always
 * paints first, and both sit out under prefers-reduced-motion.
 */

/** How long each still holds before the hero crossfades to the next. */
export const HERO_SLIDE_MS = 8000;

/**
 * The hero's still rotation, lifted out of `HeroCrossfade` so the indicator
 * dots can read it (and drive it). Slide 0 is the hero's base image, 1..n are
 * the extra stills, so `total` is one more than the slide list.
 *
 * Each hold is its own `setTimeout` keyed on the active index rather than one
 * standing interval: tapping a dot then restarts the clock, so a slide you
 * chose yourself doesn't get half a beat before moving on.
 */
export function useHeroSlides(slideCount: number) {
  const total = slideCount + 1;
  const [active, setActive] = React.useState(0);
  // Whether the *current* still was chosen rather than rotated to. The ambient
  // rotation wants a long, unnoticeable dissolve; an answer to a thumb wants to
  // land now — same crossfade, two speeds (see `HeroCrossfade`).
  const [manual, setManual] = React.useState(false);
  // Held while a finger is on the hero: an 8-second timer firing mid-swipe
  // would change the slide out from under the drag.
  const [held, setHeld] = React.useState(false);
  // Resolved on the client only — the server can't ask for the media query, and
  // a hero that auto-advances under `prefers-reduced-motion` is exactly what
  // that setting is for.
  const [rotating, setRotating] = React.useState(false);
  React.useEffect(() => {
    setRotating(total > 1 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, [total]);
  // The gallery lands after the base image, so the index can outrun the list.
  React.useEffect(() => {
    setActive((i) => (i < total ? i : 0));
  }, [total]);
  React.useEffect(() => {
    if (!rotating || held) return;
    const t = setTimeout(() => {
      setActive((i) => (i + 1) % total);
      setManual(false);
    }, HERO_SLIDE_MS);
    return () => clearTimeout(t);
  }, [rotating, held, active, total]);
  const select = React.useCallback((index: number) => {
    setActive(index);
    setManual(true);
  }, []);
  return { active, total, rotating, manual, select, hold: setHeld };
}

export type HeroSlides = ReturnType<typeof useHeroSlides>;

/** Where a swipe of `direction` (+1 next, -1 previous) lands, wrapping. */
function stepSlide(active: number, direction: number, total: number): number {
  return (active + direction + total) % total;
}

/** Axis lock: past this much travel the gesture is committed to one direction. */
const SWIPE_AXIS_LOCK_PX = 8;
/** Share of the hero's width that counts as a full swipe. */
const SWIPE_COMMIT_RATIO = 0.25;
/** …or this much travel inside this long, which is a flick. */
const SWIPE_FLICK_PX = 24;
const SWIPE_FLICK_MS = 300;
/** Drag distance, as a share of the hero's width, that fully reveals the next
 *  still — shorter than the commit threshold's reciprocal on purpose, so the
 *  photo is most of the way there by the time the swipe counts. */
const SWIPE_TRAVEL_RATIO = 0.6;

/**
 * Swipe the hero's gallery with a thumb. The drag *previews* its result — the
 * still you're heading for fades in under the finger and snaps back if you
 * don't go far enough — so the gesture reads as direct manipulation rather than
 * a button press with extra steps.
 *
 * Touch and pen only: a mouse has the dots (and dragging a photo with a mouse
 * means "drag the image" to most people). The element it's spread on needs
 * `touch-action: pan-y`, which is what leaves vertical scrolling to the browser
 * while giving us every horizontal move; a vertical gesture bails at the axis
 * lock and the page scrolls as though we were never here.
 *
 * Previews are flushed on an animation frame, so a fast drag re-renders the
 * hero once per frame rather than once per pointer event.
 */
export function useHeroSwipe({
  total,
  active,
  select,
  hold,
  enabled,
}: {
  total: number;
  active: number;
  select: (index: number) => void;
  hold: (held: boolean) => void;
  enabled: boolean;
}) {
  const [drag, setDrag] = React.useState<{ next: number; t: number } | null>(null);
  const gesture = React.useRef<{
    x: number;
    y: number;
    at: number;
    width: number;
    axis: "undecided" | "x";
  } | null>(null);
  const frame = React.useRef(0);
  const pending = React.useRef<{ next: number; t: number } | null>(null);

  const flush = React.useCallback(() => {
    frame.current = 0;
    setDrag(pending.current);
  }, []);
  const schedule = React.useCallback(
    (next: { next: number; t: number } | null) => {
      pending.current = next;
      if (frame.current === 0) frame.current = requestAnimationFrame(flush);
    },
    [flush],
  );
  const stop = React.useCallback(() => {
    if (frame.current !== 0) cancelAnimationFrame(frame.current);
    frame.current = 0;
    pending.current = null;
    gesture.current = null;
    setDrag(null);
    hold(false);
  }, [hold]);
  React.useEffect(() => () => stop(), [stop]);

  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (!enabled || total < 2 || e.pointerType === "mouse") return;
      // Never steal the gesture from something that acts: the indicator dots
      // and any chip a page overlays on the hero.
      if ((e.target as HTMLElement | null)?.closest("a, button, [role='button']")) return;
      gesture.current = {
        x: e.clientX,
        y: e.clientY,
        at: performance.now(),
        width: e.currentTarget.getBoundingClientRect().width || 1,
        axis: "undecided",
      };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g) return;
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (g.axis === "undecided") {
        if (Math.abs(dx) < SWIPE_AXIS_LOCK_PX && Math.abs(dy) < SWIPE_AXIS_LOCK_PX) return;
        // Vertical: hand the gesture back to the page and stay out of it.
        if (Math.abs(dy) >= Math.abs(dx)) {
          gesture.current = null;
          return;
        }
        g.axis = "x";
        hold(true);
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      schedule({
        next: stepSlide(active, dx < 0 ? 1 : -1, total),
        t: Math.min(1, Math.abs(dx) / (g.width * SWIPE_TRAVEL_RATIO)),
      });
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g) return;
      const dx = e.clientX - g.x;
      const committed =
        g.axis === "x" &&
        (Math.abs(dx) > g.width * SWIPE_COMMIT_RATIO ||
          (Math.abs(dx) > SWIPE_FLICK_PX && performance.now() - g.at < SWIPE_FLICK_MS));
      // Either way the change is now "manual", so the crossfade settles at the
      // short duration — a swipe that snaps back must not take a full second.
      if (g.axis === "x") select(committed ? stepSlide(active, dx < 0 ? 1 : -1, total) : active);
      stop();
    },
    onPointerCancel: () => {
      if (gesture.current?.axis === "x") select(active);
      stop();
    },
  };

  return { drag, handlers };
}

/** Crossfade length: a long dissolve for the ambient rotation, a short one for
 *  a still the reader asked for (a dot, a swipe). */
const FADE_AMBIENT_MS = 1000;
const FADE_MANUAL_MS = 320;

/**
 * Crossfading extra stills layered over the base hero image. The base stays
 * slide 0; the extra stills fade in above it on the rotation `useHeroSlides`
 * drives. Renders nothing when there are no extra slides.
 *
 * The stack paints in DOM order, so which still moves during a transition
 * depends on direction: going *up* the stack the arriving one fades in on top;
 * going down, the current one fades out to reveal what's underneath (which is
 * how slide 0 — the base `<Image>`, which has no element here — comes back).
 * `drag` runs exactly that, untransitioned, at whatever fraction the finger has
 * travelled.
 */
export function HeroCrossfade({
  slides,
  active,
  drag,
  fast,
}: {
  slides: Array<{ url: string; alt: string | null }>;
  /** 0 = the base image underneath; 1..n = `slides`. */
  active: number;
  /** Live swipe preview: `t` of the way from `active` to `next` (see `useHeroSwipe`). */
  drag?: { next: number; t: number } | null;
  /** Settle at the short duration — the still was chosen, not rotated to. */
  fast?: boolean;
}) {
  if (slides.length === 0) return null;
  const up = drag ? drag.next > active : false;
  const opacityFor = (slide: number) => {
    if (!drag) return slide === active ? 1 : 0;
    if (slide === active) return up ? 1 : 1 - drag.t;
    if (slide === drag.next) return up ? drag.t : 1;
    return 0;
  };
  return (
    <>
      {slides.map((s, i) => (
        <img
          key={s.url}
          src={disneyResizeUrl(s.url, 1600)}
          alt={s.alt ?? ""}
          loading="lazy"
          aria-hidden={active !== i + 1}
          className={cn("absolute inset-0 size-full object-cover", imageFocusClass(s.url))}
          style={{
            opacity: opacityFor(i + 1),
            // No transition under the finger: the preview *is* the drag.
            transition: drag
              ? "none"
              : `opacity ${fast ? FADE_MANUAL_MS : FADE_AMBIENT_MS}ms ease-out`,
          }}
        />
      ))}
    </>
  );
}

/**
 * The hero gallery's indicator row: a dot per still, with the current one drawn
 * as a pill that fills across the slide's hold — so it reads as "how long until
 * this changes" rather than just "which one is this". Tapping a dot jumps to
 * that still and restarts the clock.
 *
 * The fill is a `scaleX` on a child (compositor-only, no layout per frame), and
 * it is keyed on the active index so each slide replays it from zero. Under
 * prefers-reduced-motion nothing rotates, so the pill just sits full.
 */
export function HeroSlideDots({
  total,
  active,
  onSelect,
  rotating,
  paused,
  className,
  style,
}: {
  total: number;
  active: number;
  onSelect: (index: number) => void;
  rotating: boolean;
  /** A finger is on the hero, so the hold clock is stopped — stop the fill too,
   *  rather than let it run out on a slide that isn't going anywhere. */
  paused?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (total < 2) return null;
  return (
    <div
      // Tagged so the hero can measure the pill's width: where it lands on a
      // ticket page depends on how wide it is (see `--dots-left`).
      data-hero-dots
      style={style}
      className={cn(
        "flex items-center gap-1.5 rounded-full bg-black/30 px-2 py-1.5 backdrop-blur-sm",
        className,
      )}
    >
      {Array.from({ length: total }, (_, i) => {
        const current = i === active;
        return (
          <button
            key={i}
            type="button"
            aria-label={`Photo ${i + 1} of ${total}`}
            aria-current={current ? "true" : undefined}
            onClick={() => onSelect(i)}
            // The hit target is the full row height; only the mark inside it
            // changes size, so the dots never jump under a thumb.
            className="group/dot flex h-4 items-center px-0.5"
          >
            <span
              className={cn(
                "relative block h-1.5 overflow-hidden rounded-full transition-[width,background-color] duration-300 ease-out",
                current ? "w-7 bg-white/40" : "w-1.5 bg-white/55 group-hover/dot:bg-white/80",
              )}
            >
              {current && (
                <span
                  // Remounted per slide (`key`) so the fill restarts from zero.
                  key={active}
                  className="absolute inset-0 origin-left rounded-full bg-white"
                  style={
                    rotating
                      ? {
                          animation: `hero-slide-fill ${HERO_SLIDE_MS}ms linear forwards`,
                          animationPlayState: paused ? "paused" : "running",
                        }
                      : undefined
                  }
                />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Ambient hero video: a muted, looping, inline-playing overlay above the base
 * hero still, faded in only once the video can actually play — so slow
 * connections never see a black box. Mounted client-side only, and not at all
 * when the user prefers reduced motion.
 */
export function AmbientHeroVideo({ src, poster }: { src: string; poster: string | null }) {
  const [enabled, setEnabled] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    setEnabled(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  if (!enabled) return null;
  return (
    <video
      src={src}
      poster={poster ?? undefined}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden
      onCanPlay={() => setReady(true)}
      className={cn(
        "absolute inset-0 size-full object-cover transition-opacity duration-700",
        ready ? "opacity-100" : "opacity-0",
      )}
    />
  );
}
