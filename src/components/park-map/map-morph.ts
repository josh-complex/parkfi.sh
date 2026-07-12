/**
 * The hero⇄card FLIP morph for the singleton map host. The stage measures the
 * outgoing slot's rect, hands it to `morph`, and the host's *real* geometry
 * (left/top/width/height) animates to the incoming slot while the map's own
 * `resize()` runs every frame — so the map re-lays-out as the box changes
 * instead of stretching a stale-size canvas with a CSS transform.
 */

// Length of the hero⇄card morph. Snappy, then the camera fly follows (see
// MORPH_MS in shared.tsx, kept in lockstep so the fly waits for the box).
export const MORPH_MS = 420;

const INLINE_PROPS = [
  "position",
  "margin",
  "z-index",
  "left",
  "top",
  "width",
  "height",
  "will-change",
] as const;

// easeOutBack — overshoots slightly past the target before settling, for a
// springy little landing. `c1` tunes the bounce (higher = more overshoot).
function ease(t: number): number {
  const c1 = 1.5;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Tears down any morph currently in flight on a given host, so a fast second
// navigation can claim the map without the prior morph's resize loop stomping
// the new morph's inline geometry.
const morphCleanup = new WeakMap<HTMLElement, () => void>();

/**
 * Settle the host back into normal flow: cancel any morph still animating and
 * strip the inline geometry it left behind (`position: fixed`, left/top/size),
 * so the host sits as a plain `size-full` child of whatever slot now owns it —
 * and is clipped by that slot's rounded `overflow-hidden`. Without this, an
 * interrupted morph can leave the host as a `fixed` overlay that escapes the
 * slot's clip, so the square map canvas spills past the card's rounded corners.
 * Safe to call right before a fresh `morph`, which re-applies what it needs.
 */
export function settleMorph(host: HTMLElement) {
  morphCleanup.get(host)?.();
  for (const p of INLINE_PROPS) host.style.removeProperty(p);
}

/**
 * Morph `host` from `first` toward `slot`'s box by animating its *real* geometry
 * — left/top/width/height — and calling MapLibre's own `resize()` on every frame
 * so the map re-lays-out to fill its container as the box changes. We transition
 * the parent and let the map track it, rather than scaling a fixed-size canvas
 * with a CSS transform (which leaves the map's dimensions stale mid-flight, so
 * the layout appears not to adjust while the camera flies).
 *
 * The target is re-read from `slot.getBoundingClientRect()` *every frame* rather
 * than snapshotted once: the destination slot's flex height can still be
 * settling when the morph starts (its content/scroll height isn't final until
 * after paint), and snapshotting a stale value is what made the box land short
 * and then "pop" to full size at the end. Tracking the live rect lands it
 * exactly, no pop.
 *
 * The host is lifted to <body> as a fixed overlay so no transformed/clipped
 * ancestor distorts the coordinates, then re-homed into `slot` when done.
 */
export function morph(host: HTMLElement, first: DOMRect, slot: HTMLElement, resize: () => void) {
  morphCleanup.get(host)?.();
  document.body.appendChild(host);
  Object.assign(host.style, {
    position: "fixed",
    margin: "0",
    // Below the floating chrome — the mobile header is z-30 and the bottom nav
    // z-40, and on the fullscreen `/map` route the map rests at z-0 *behind*
    // them (they show it through their transparent areas). Lifting the morph
    // overlay above the bars (it used to be z-40) covered them for the whole
    // morph, then dropped back to z-0 — so the chrome blinked out and popped
    // back in on every return to the map. Staying under the bars keeps them
    // visible throughout; z-20 is still above page content for the card morph.
    zIndex: "20",
    left: `${first.left}px`,
    top: `${first.top}px`,
    width: `${first.width}px`,
    height: `${first.height}px`,
    willChange: "left, top, width, height",
  });
  resize();

  let raf = 0;
  let start = 0;
  let done = false;
  const teardown = () => {
    done = true;
    cancelAnimationFrame(raf);
    morphCleanup.delete(host);
  };
  morphCleanup.set(host, teardown);

  const tick = (now: number) => {
    if (!start) start = now;
    const t = Math.min(1, (now - start) / MORPH_MS);
    const e = ease(t);
    // Live target — picks up the slot's settling height/width as it finalizes.
    const to = slot.getBoundingClientRect();
    host.style.left = `${lerp(first.left, to.left, e)}px`;
    host.style.top = `${lerp(first.top, to.top, e)}px`;
    host.style.width = `${lerp(first.width, to.width, e)}px`;
    host.style.height = `${lerp(first.height, to.height, e)}px`;
    resize();
    if (t < 1 && !done) {
      raf = requestAnimationFrame(tick);
      return;
    }
    teardown();
    // Re-home into the slot only if it's still the one we were animating into;
    // otherwise a newer navigation already claimed the map and we must not
    // steal it back.
    if (host.parentElement !== slot && slot.isConnected) slot.appendChild(host);
    for (const p of INLINE_PROPS) host.style.removeProperty(p);
    resize();
  };
  raf = requestAnimationFrame(tick);
}
