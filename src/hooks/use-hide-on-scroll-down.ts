import { useRef, useState } from "react";
import { useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";

// Don't start hiding until scrolled past this — keeps the bar pinned at the top.
const REVEAL_AT = 150;
// Pixels of continuous travel in one direction before the bar reacts. Without
// this buffer a 1px jitter (or the natural wobble at a momentum-scroll direction
// change) flips the bar every frame — "a fit". Measured from the turning point,
// so a real swipe still crosses it almost immediately.
const BUFFER = 24;

/**
 * Tracks vertical scroll *direction* to drive an auto-hiding top bar: hidden
 * while scrolling down, revealed as soon as you scroll up — the pattern the Walt
 * Disney Company site uses. A directional buffer keeps tiny jitters from
 * toggling it. Disabled under reduced-motion. Returns false on the server/first
 * paint so the bar always renders open initially.
 *
 * Tracks the document scroll (motion's default), which is what actually scrolls
 * on mobile — the app shell is `min-h-svh` with no inner scroll container.
 */
export function useHideOnScrollDown(): boolean {
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

    if (current <= REVEAL_AT) {
      setHidden(false);
      return;
    }

    const travelled = current - anchor.current; // positive down, negative up
    if (goingDown && travelled > BUFFER) setHidden(true);
    else if (!goingDown && -travelled > BUFFER) setHidden(false);
  });

  return hidden;
}
