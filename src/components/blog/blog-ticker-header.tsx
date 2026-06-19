import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { OmniSearch } from "#/components/omni-search.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

/**
 * Tracks vertical scroll *direction* to drive the auto-hiding nav menu: hidden
 * while scrolling down (past a small threshold so it doesn't flicker at the very
 * top), revealed the instant you scroll up — the pattern the Walt Disney Company
 * site uses. Disabled under reduced-motion. Returns false on the server/first
 * paint so the menu always renders open initially.
 */
function useHideOnScrollDown(): boolean {
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

/** Measures an element's pixel height, kept current across resizes/reflows. */
function useMeasuredHeight<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
): number | undefined {
  const [height, setHeight] = useState<number>();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return height;
}

/** Hide the live-waits marquee entirely unless at least this many rides are
 *  open — a near-empty ticker (or the loading flash) reads as broken. */
const MIN_OPEN_RIDES = 5;

const NAV_LEFT = [
  { label: "Park News", to: "/blog" },
  { label: "Wait Times", to: "/" },
] as const;
const NAV_RIGHT = [
  { label: "Dining", to: "/dining" },
  { label: "Stays", to: "/stays" },
] as const;

function NavLinks({ items }: { items: ReadonlyArray<{ label: string; to: string }> }) {
  return (
    <>
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="font-heading text-sm font-semibold tracking-wide whitespace-nowrap text-foreground/80 uppercase transition-colors hover:text-primary"
        >
          {item.label}
        </Link>
      ))}
    </>
  );
}

/** A single live-wait chip in the marquee. */
function TickerChip({
  rideName,
  parkName,
  waitMin,
  delta,
  trend,
}: {
  rideName: string;
  parkName: string;
  waitMin: number;
  delta: number;
  trend: "up" | "down" | "flat";
}) {
  const tone =
    trend === "up"
      ? "text-red-600 dark:text-red-400"
      : trend === "down"
        ? "text-emerald-500 dark:text-emerald-400"
        : "text-muted-foreground";
  const Arrow = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;

  return (
    <span className="flex items-center gap-3 border-r border-border px-4 py-2.5">
      {/* Ride name over its location, stacked. */}
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-medium whitespace-nowrap text-foreground">{rideName}</span>
        <span className="text-xs whitespace-nowrap text-muted-foreground">{parkName}</span>
      </span>
      {/* `key` on the value remounts this node when the wait changes, replaying
          the flash animation: red when it ticked up, green when it dropped. */}
      <span
        key={waitMin}
        className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs font-medium tabular-nums ${tone} ${
          trend === "up" ? "parkfi-flash-up" : trend === "down" ? "parkfi-flash-down" : ""
        }`}
      >
        {waitMin}m
        <Arrow className="size-3.5" aria-hidden />
        {delta !== 0 && <span className="text-xs">{Math.abs(delta)}</span>}
      </span>
    </span>
  );
}

/**
 * Walt-Disney-Company-style masthead for the blog: a thick metallic gradient bar
 * pinned at the very top, a centered wordmark flanked by nav links, and a
 * screen-width "LIVE WAITS" marquee standing in for Disney's TRENDING strip.
 *
 * The bar and the marquee stay sticky; the nav menu auto-hides on scroll-down
 * and reveals on scroll-up. To keep the page from jumping as the menu collapses,
 * a sibling spacer grows by exactly the menu's height as the menu shrinks, so
 * the total reserved space never changes. The bar also carries a reading-progress
 * sheen.
 */
export function BlogTickerHeader() {
  const trpc = useTRPC();
  const { data: ticker } = useQuery({
    ...trpc.parks.ticker.queryOptions(),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  // A motion value (0..1) for the reading-progress sheen. Driving the bar off
  // this directly — rather than React state — means it updates on the compositor
  // without a re-render per scroll frame, so the sweep stays smooth.
  const { scrollYProgress } = useScroll();
  const hidden = useHideOnScrollDown();
  const navRef = useRef<HTMLDivElement>(null);
  const navHeight = useMeasuredHeight(navRef);

  const chips = ticker ?? [];
  // The track is two identical halves and slides by exactly -50%, so the loop is
  // seamless only if one half already overflows the viewport. With a short ride
  // list that wouldn't hold, so repeat the list within each half until it's wide
  // enough to fill even a large screen (~10 chips' worth) before doubling.
  const repeatsPerHalf = chips.length > 0 ? Math.max(1, Math.ceil(10 / chips.length)) : 1;
  const itemsPerHalf = chips.length * repeatsPerHalf;
  // A slow, readable drift; scales with one half's width so the pace stays even.
  const durationSec = Math.max(80, itemsPerHalf * 7);

  const collapse = { duration: 0.3, ease: "easeInOut" } as const;

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-md">
        {/* Metallic masthead bar (Disney's dark-red gradient, in brand blue),
            with the reading-progress sheen sweeping across it. */}
        <div className="relative h-2.5 w-full overflow-hidden" aria-hidden>
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(90deg,#08152e 0%,#14346b 22%,#3f74cf 50%,#14346b 78%,#08152e 100%)",
            }}
          />
          <motion.div
            className="absolute inset-0 origin-left"
            style={{
              scaleX: scrollYProgress,
              background:
                "linear-gradient(to right, transparent, color-mix(in oklch, white, transparent 55%))",
            }}
          />
        </div>

        {/* Nav menu: collapses to nothing on scroll-down, springs back on
            scroll-up — only the bar above and the marquee below stay pinned. */}
        <motion.div
          initial={false}
          animate={{
            height: hidden && navHeight ? 0 : (navHeight ?? "auto"),
            opacity: hidden ? 0 : 1,
          }}
          transition={collapse}
          className="overflow-hidden"
        >
          <div
            ref={navRef}
            className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-6 sm:px-6"
          >
            <Link to="/" aria-label="ParkFi — Home" className="flex shrink-0 items-center">
              <img src="/img/brand/blue.webp" alt="ParkFi" className="h-11 w-auto" />
            </Link>

            <div className="flex flex-1 items-center justify-center gap-6">
              <nav className="hidden items-center gap-6 md:flex">
                <NavLinks items={NAV_LEFT} />
              </nav>

              <Link to="/blog" className="flex flex-col items-center leading-none">
                <span className="font-heading text-3xl font-bold tracking-tight">ParkFi</span>
              </Link>

              <nav className="hidden items-center gap-6 md:flex">
                <NavLinks items={NAV_RIGHT} />
              </nav>
            </div>

            <div className="flex shrink-0 items-center gap-4 sm:gap-6">
              <OmniSearch variant="icon" />
            </div>
          </div>
        </motion.div>

        {/* Ticker strip, bracketed by thin primary rules (Disney's TRENDING bar).
            Hidden when too few rides are open (or while still loading) so it
            never shows a near-empty marquee or a "Loading…" flash. */}
        {chips.length >= MIN_OPEN_RIDES && (
          <div className="border-t border-primary/40">
            <div className="flex items-stretch">
              <div className="flex shrink-0 items-center gap-2 border-r border-primary/40 bg-primary/5 px-4 py-2">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-primary" />
                </span>
                <span className="font-heading text-xs font-bold tracking-widest text-primary uppercase">
                  Live Waits
                </span>
              </div>

              <div className="parkfi-marquee relative flex-1 overflow-hidden">
                <div
                  className="parkfi-marquee-track"
                  style={{ "--marquee-duration": `${durationSec}s` } as React.CSSProperties}
                >
                  {[0, 1].map((copy) => (
                    <div key={copy} className="flex items-center" aria-hidden={copy === 1}>
                      {Array.from({ length: repeatsPerHalf }).flatMap((_, rep) =>
                        chips.map((c) => (
                          <TickerChip
                            key={`${copy}-${rep}-${c.parkSlug}-${c.rideSlug}`}
                            rideName={c.rideName}
                            parkName={c.parkName}
                            waitMin={c.waitMin}
                            delta={c.delta}
                            trend={c.trend}
                          />
                        )),
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Compensating spacer: grows exactly as the nav menu collapses so the
          content below never jumps when the menu hides or reveals. */}
      <motion.div
        aria-hidden
        initial={false}
        animate={{ height: hidden ? (navHeight ?? 0) : 0 }}
        transition={collapse}
      />
    </>
  );
}
