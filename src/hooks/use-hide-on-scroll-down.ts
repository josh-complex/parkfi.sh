import { useRef, useState } from "react";
import { useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";

// Don't start hiding until scrolled past this — keeps the bar pinned at the top.
const REVEAL_AT = 150;
// Pixels of continuous travel in one direction before the bar reacts. Without
// this buffer a 1px jitter (or the natural wobble at a momentum-scroll direction
// change) flips the bar every frame — "a fit". Measured from the turning point,
// so a real swipe still crosses it almost immediately.
const BUFFER = 24;

export interface HideOnScrollOptions {
  /**
   * The band at the top of the page where the bar is always shown, in px. Also
   * the default depth past which scroll-up stops bringing it back.
   */
  revealAt?: number;
  /**
   * How deep into the page scroll-up keeps reopening the bar.
   *
   * The Disney-style "always reopen on scroll-up" is the wrong default for a
   * long board: once you've committed to the page you're scrolling both ways
   * inside it, and a masthead that reappears on every upward nudge eats the
   * rows you were reading. So past this depth the bar stays away once it has
   * hidden, and comes back when you return to the top band — which is also
   * where you'd be heading if you actually wanted it.
   *
   * Defaults to `revealAt` (reopen only inside the top band). Pass a larger
   * number to keep the classic behaviour that much deeper into the page, or
   * `Infinity` for reveal-on-scroll-up everywhere.
   */
  reopenAbove?: number;
}

/**
 * Tracks vertical scroll *direction* to drive an auto-hiding top bar: hidden
 * while scrolling down, and revealed on scroll-up for as long as you're above
 * `reopenAbove` (see that option — the default is a deliberate departure from
 * reveal-everywhere). A directional buffer keeps tiny jitters from toggling it.
 * Disabled under reduced-motion. Returns false on the server/first paint so the
 * bar always renders open initially.
 *
 * Tracks the document scroll (motion's default), which is what actually scrolls
 * on mobile — the app shell is `min-h-svh` with no inner scroll container.
 */
export function useHideOnScrollDown(options: HideOnScrollOptions = {}): boolean {
  const { revealAt = REVEAL_AT, reopenAbove = revealAt } = options;
  const { scrollY } = useScroll();
  const reduce = useReducedMotion();
  const [hidden, setHidden] = useState(false);

  // Last observed position, the direction we're travelling, and the position
  // where that direction last began (the turning point the buffer measures from).
  const prevY = useRef(0);
  const dir = useRef<"up" | "down">("up");
  const anchor = useRef(0);

  useMotionValueEvent(scrollY, "change", (current) => {
    if (reduce) {
      setHidden(false);
      return;
    }

    const previous = prevY.current;
    prevY.current = current;
    const delta = current - previous;
    if (delta === 0) return;
    const goingDown = delta > 0;

    // On a direction reversal, plant the anchor at the turning point so the
    // buffer counts travel *since* the reversal, not since we last toggled.
    if (goingDown ? dir.current === "up" : dir.current === "down") {
      dir.current = goingDown ? "down" : "up";
      anchor.current = previous;
    }

    if (current <= revealAt) {
      setHidden(false);
      return;
    }

    const travelled = current - anchor.current; // positive down, negative up
    if (goingDown && travelled > BUFFER) setHidden(true);
    else if (!goingDown && -travelled > BUFFER && current <= reopenAbove) setHidden(false);
  });

  return hidden;
}
