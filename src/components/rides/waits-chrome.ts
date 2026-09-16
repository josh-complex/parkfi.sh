/**
 * The Waits board's sticky geometry, in one place.
 *
 * Three things stack under the masthead — the toolbar, and below it the filter
 * rail and the map pane — and they have to agree on where the toolbar ends, or
 * the gap under it changes as you scroll. That was the visible bug: unstuck,
 * the map sat the toolbar's own margin below it; stuck, it sat wherever its
 * `top` put it, and the difference read as the map drifting away from the bar
 * on the way down the page.
 *
 *     masthead │ 0.5rem │ toolbar │ 1.25rem │ rail / map │ 1rem
 *
 * `0.5rem` is the toolbar's stuck offset, `1.25rem` is the gap below it — and
 * `mb-5` *is* that gap, so the stuck and unstuck geometry are the same and
 * nothing moves when the bar latches. The two below it therefore stick at
 * `0.5 + 1.25 = 1.75rem` past the toolbar's own height, and a full-height
 * column keeps `1rem` of air at the bottom (`1.75 + 1 = 2.75rem` off the
 * viewport).
 *
 * The toolbar measures itself onto `--waits-bar-height` (`useToolbarHeight` in
 * `cross-park-waits.tsx`), which is how a rule here can say "below the toolbar"
 * without knowing how tall it is; the `var()` fallback only covers the frames
 * before the first measurement.
 *
 * Written out in full rather than composed from parts: Tailwind reads class
 * names as literal text in the source, so a class built by template literal
 * would never be generated. Change one number and change its twin.
 */

/** The toolbar: sticky under the masthead, its flow gap carried as `mb-5`. */
export const TOOLBAR_STICKY = "sticky top-[calc(var(--site-header-height)+0.5rem)] z-20 mb-5";

/** A column that sticks under the toolbar — the filter rail, the map pane. */
export const UNDER_TOOLBAR_TOP =
  "top-[calc(var(--site-header-height)+var(--waits-bar-height,4rem)+1.75rem)]";

/** That column's height: whatever the viewport has left under the toolbar. A
 *  `max-h` for the rail, which is as tall as its own contents, and a hard `h`
 *  for the map pane, which has no contents of its own to be sized by. */
export const UNDER_TOOLBAR_MAX_HEIGHT =
  "max-h-[calc(100svh-var(--site-header-height)-var(--waits-bar-height,4rem)-2.75rem)]";
export const UNDER_TOOLBAR_HEIGHT =
  "h-[calc(100svh-var(--site-header-height)-var(--waits-bar-height,4rem)-2.75rem)]";
