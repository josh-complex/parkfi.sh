import { useState } from "react";
import { useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";

/**
 * Tracks vertical scroll *direction* to drive an auto-hiding top bar: hidden
 * while scrolling down (past a small threshold so it doesn't flicker at the very
 * top), revealed the instant you scroll up — the pattern the Walt Disney Company
 * site uses. Disabled under reduced-motion. Returns false on the server/first
 * paint so the bar always renders open initially.
 *
 * Tracks the document scroll (motion's default), which is what actually scrolls
 * on mobile — the app shell is `min-h-svh` with no inner scroll container.
 */
export function useHideOnScrollDown(): boolean {
  const { scrollY } = useScroll();
  const reduce = useReducedMotion();
  const [hidden, setHidden] = useState(false);

  useMotionValueEvent(scrollY, "change", (current) => {
    if (reduce) {
      setHidden(false);
      return;
    }
    const previous = scrollY.getPrevious() ?? 0;
    setHidden(current > previous && current > 150);
  });

  return hidden;
}
