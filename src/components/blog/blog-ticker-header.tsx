import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Clock, Minus, Search } from "lucide-react";

import { useTRPC } from "#/integrations/trpc/react.ts";

/**
 * Reading progress through the document, 0..1. Drives the thick sidebar-blue
 * gradient line at the very top of the header, which grows as you scroll the
 * article — an homage to Disney's dark-red masthead bar, repurposed as a
 * scroll-position indicator.
 */
function useScrollProgress(): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = document.documentElement;
      const scrollable = el.scrollHeight - el.clientHeight;
      setProgress(scrollable > 0 ? Math.min(1, Math.max(0, el.scrollTop / scrollable)) : 0);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return progress;
}

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
    <span className="flex items-center gap-2 px-4 py-2">
      <span className="text-sm font-medium whitespace-nowrap text-foreground">{rideName}</span>
      <span className="hidden text-xs whitespace-nowrap text-muted-foreground sm:inline">
        {parkName}
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
 * Disney-masthead homage for the blog: a centered wordmark flanked by nav links,
 * bracketed by thin primary-color rules, with a screen-width "LIVE WAITS" marquee
 * standing in for Disney's TRENDING strip. Sticky; the top gradient line tracks
 * reading progress. Pass `readingMinutes` to surface a predicted read time.
 */
export function BlogTickerHeader({ readingMinutes }: { readingMinutes?: number }) {
  const trpc = useTRPC();
  const { data: ticker } = useQuery({
    ...trpc.parks.ticker.queryOptions(),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const progress = useScrollProgress();

  const chips = ticker ?? [];
  // A slow, readable drift; scales with list length so the pace stays even.
  const durationSec = Math.max(80, chips.length * 7);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-md">
      {/* Scroll-progress masthead line: sidebar blue fading to transparent, grown
          to the reading position. */}
      <div className="absolute inset-x-0 top-0 h-1" aria-hidden>
        <div
          className="h-full transition-[width] duration-150 ease-out"
          style={{
            width: `${progress * 100}%`,
            background:
              "linear-gradient(to right, var(--sidebar), color-mix(in oklch, var(--sidebar), transparent 100%))",
          }}
        />
      </div>

      {/* Nav row */}
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <nav className="hidden flex-1 items-center gap-6 md:flex">
          <NavLinks items={NAV_LEFT} />
        </nav>

        <Link to="/blog" className="flex flex-col items-center leading-none">
          <span className="font-heading text-2xl font-bold tracking-tight">ParkFi</span>
          <span className="font-heading text-[0.6rem] font-semibold tracking-[0.25em] text-muted-foreground uppercase">
            Park News
          </span>
        </Link>

        <div className="flex flex-1 items-center justify-end gap-6">
          <nav className="hidden items-center gap-6 md:flex">
            <NavLinks items={NAV_RIGHT} />
          </nav>
          {readingMinutes != null && (
            <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium whitespace-nowrap text-muted-foreground">
              <Clock className="size-3.5" aria-hidden />
              {readingMinutes} min read
            </span>
          )}
          <Link
            to="/"
            aria-label="Search live park data"
            className="text-foreground/70 transition-colors hover:text-primary"
          >
            <Search className="size-5" />
          </Link>
        </div>
      </div>

      {/* Ticker strip, bracketed by thin primary rules (Disney's TRENDING bar). */}
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
            {chips.length === 0 ? (
              <div className="px-4 py-2 text-sm text-muted-foreground">
                Loading live wait times…
              </div>
            ) : (
              <div
                className="parkfi-marquee-track"
                style={{ "--marquee-duration": `${durationSec}s` } as React.CSSProperties}
              >
                {[0, 1].map((copy) => (
                  <div
                    key={copy}
                    className="flex items-center divide-x divide-border"
                    aria-hidden={copy === 1}
                  >
                    {chips.map((c) => (
                      <TickerChip
                        key={`${copy}-${c.parkSlug}-${c.rideSlug}`}
                        rideName={c.rideName}
                        parkName={c.parkName}
                        waitMin={c.waitMin}
                        delta={c.delta}
                        trend={c.trend}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
