import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutGroup, motion, useReducedMotion, useScroll } from "motion/react";
import { ArrowDownRight, ArrowUpRight, ChevronDownIcon, MenuIcon, Minus } from "lucide-react";

import { CastMemberHeadline } from "#/components/cast-member-badge.tsx";
import { useCloseOnScroll } from "#/components/core-search.tsx";
import { NotificationCenter } from "#/components/notifications/notification-center.tsx";
import { OmniSearch } from "#/components/omni-search.tsx";
import { parkRank } from "#/components/rides/waits-data.ts";
import { HeaderAccountMenu } from "#/components/site-chrome/header-account-menu.tsx";
import { ThemeToggle } from "#/components/theme-toggle.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { Image } from "#/components/ui/image.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { useHideOnScrollDown } from "#/hooks/use-hide-on-scroll-down.ts";
import { useIsMobile } from "#/hooks/use-mobile.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { formatParkName } from "#/lib/parks.ts";
import { cn } from "#/lib/utils.ts";

import type { TRPCRouter } from "#/integrations/trpc/router.ts";
import type { inferRouterOutputs } from "@trpc/server";

type TRPCOutputs = inferRouterOutputs<TRPCRouter>;

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

/** How often the ticker re-reads the live feed — and the meter's full sweep. */
const TICKER_POLL_MS = 60_000;
/** The meter ring's circumference (r=10), which CSS can't derive from `r`. */
const RING_C = 2 * Math.PI * 10;
/**
 * How often the meter redraws. A 60s sweep moves ~0.3% per tick at this rate —
 * under a pixel — so it reads as continuous without a `requestAnimationFrame`
 * loop running all day for a decoration.
 */
const METER_TICK_MS = 250;

/** "12s ago" / "3m ago" — how old the reading on screen is. */
function agoLabel(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

/**
 * The Live Waits label, doubling as the strip's refresh meter: a ring closing
 * over one poll cycle around the live dot, the label, how old the reading is,
 * and a wash filling the label left-to-right as the cycle runs. The strip is
 * the always-live thing on the page, so "when does this update" is answered
 * here once instead of as a line of grey text on every board.
 *
 * Every frame is written straight to the DOM off `dataUpdatedAt` and the wall
 * clock — no CSS keyframe, and no React state. A keyframe has to be *told* how
 * long the cycle is and where in it to start, which makes it a prediction: it
 * finished early and sat there whenever a fetch ran long, it drifted from the
 * text beside it, and it snapped back on every re-key. Reading the real elapsed
 * time instead means the ring, the wash and the words can't disagree, and an
 * overdue poll simply shows as a full ring over a reading that says it's a
 * minute old — which is the truth.
 */
function LiveWaitsMeter({
  innerRef,
  updatedAt,
  fetching,
}: {
  innerRef: React.RefCallback<HTMLDivElement>;
  /** `dataUpdatedAt` of the ticker query; 0 before the first reading lands. */
  updatedAt: number;
  fetching: boolean;
}) {
  const reduce = useReducedMotion();
  const ringRef = useRef<SVGCircleElement>(null);
  const washRef = useRef<HTMLSpanElement>(null);
  const ageRef = useRef<HTMLSpanElement>(null);
  // The loop below runs for the life of the header and reads the latest props
  // through this, so it never has to be torn down and rebuilt on a refetch.
  const latest = useRef({ updatedAt, fetching });
  latest.current = { updatedAt, fetching };

  useEffect(() => {
    let lastLabel: string | null = null;
    const draw = () => {
      if (document.hidden) return;
      const { updatedAt: at, fetching: busy } = latest.current;
      const elapsed = at ? Math.max(Date.now() - at, 0) : 0;
      const progress = at ? Math.min(elapsed / TICKER_POLL_MS, 1) : 0;
      if (ringRef.current) {
        ringRef.current.style.strokeDashoffset = String(RING_C * (1 - progress));
      }
      if (washRef.current) washRef.current.style.transform = `scaleX(${progress})`;
      const label = !at ? "loading…" : busy ? "refreshing…" : agoLabel(elapsed);
      if (ageRef.current && label !== lastLabel) {
        ageRef.current.textContent = label;
        lastLabel = label;
      }
    };
    draw();
    const t = setInterval(draw, METER_TICK_MS);
    // A backgrounded tab stops polling (`refetchIntervalInBackground: false`)
    // and stops drawing; catch the meter up the moment it comes back rather
    // than up to a tick later.
    document.addEventListener("visibilitychange", draw);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", draw);
    };
  }, []);

  return (
    <div
      ref={innerRef}
      className="relative flex w-max items-center gap-2.5 overflow-hidden border-r border-primary/40 bg-primary/5 py-1 pr-4 pl-3.5"
    >
      {!reduce && (
        <span
          ref={washRef}
          aria-hidden
          className="absolute inset-0 origin-left scale-x-0 bg-primary/10"
        />
      )}
      <span className="relative flex size-6 shrink-0 items-center justify-center text-primary">
        <svg viewBox="0 0 24 24" className="absolute inset-0 size-full -rotate-90" aria-hidden>
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="opacity-20"
          />
          <circle
            ref={ringRef}
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C}
          />
        </svg>
        {/* The live dot pings only while a fetch is actually in flight — a
            permanent ping is decoration; this one means something. */}
        <span className="relative flex size-1.5">
          {fetching && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
          )}
          <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
        </span>
      </span>
      <span className="relative flex flex-col leading-tight">
        <span className="font-heading text-xs font-bold tracking-widest text-primary uppercase">
          Live Waits
        </span>
        <span
          ref={ageRef}
          className="text-[10px] font-semibold tracking-wide text-primary/65 tabular-nums"
        >
          loading…
        </span>
      </span>
    </div>
  );
}

/**
 * Measures an element's pixel height, for a node that mounts late. Same shape
 * (and reason) as {@link useMeasuredWidth} below.
 */
function useMeasuredHeightOf<T extends HTMLElement>(): [number | undefined, React.RefCallback<T>] {
  const [height, setHeight] = useState<number>();
  const observer = useRef<ResizeObserver | null>(null);
  const setNode = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) {
      setHeight(undefined);
      return;
    }
    setHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    observer.current = ro;
  }, []);
  return [height, setNode];
}

/**
 * Measures an element's pixel width, kept current across resizes/reflows.
 * Returns a callback ref rather than taking a `RefObject` because the measured
 * node mounts late (only once the ticker has rides to show), which a mount-time
 * effect would miss entirely.
 */
function useMeasuredWidth<T extends HTMLElement>(): [number | undefined, React.RefCallback<T>] {
  const [width, setWidth] = useState<number>();
  const observer = useRef<ResizeObserver | null>(null);
  const setNode = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    setWidth(el.offsetWidth);
    const ro = new ResizeObserver(() => setWidth(el.offsetWidth));
    ro.observe(el);
    observer.current = ro;
  }, []);
  return [width, setNode];
}

/** Hide the live-waits marquee entirely unless at least this many rides are
 *  open — a near-empty ticker (or the loading flash) reads as broken. */
const MIN_OPEN_RIDES = 5;

/** How long the "Live Waits" label stays put on phones before folding away to
 *  hand its width back to the marquee. Desktop keeps the label for good. */
const LABEL_FADE_DELAY_MS = 2000;

/**
 * The site's primary navigation, split around the centred wordmark. This is the
 * whole app's nav now — the desktop sidebar it replaced is gone
 * (docs/plans/dining-redesign §5), so anything reachable from the old rail has
 * to be reachable from here, the account menu, or the footer.
 *
 * Four labels and a menu, deliberately: Queue Times · Eats · Stays — wordmark —
 * Parks · Blog. A longer row read as clutter (Josh, 2026-09-15), so the rest of
 * the old rail lives one level down instead: Tickets and Forecast along the
 * bottom of the Parks menu (and, with Pins, in the footer's Explore/Pins
 * columns and the mobile nav island), the two *personal* destinations
 * (Activity, Badges) and the admin-only Filings feed in the account menu.
 * `Parks` is not a link but a menu — the sidebar's resort-grouped park list,
 * as a panel the width of the nav itself (see {@link ParksMegaMenu}).
 */
type NavItem = { label: string; to: string };

const NAV_LEFT: ReadonlyArray<NavItem> = [
  { label: "Queue Times", to: "/" },
  { label: "Eats", to: "/dining" },
  { label: "Stays", to: "/stays" },
];
const NAV_RIGHT: ReadonlyArray<NavItem> = [{ label: "Blog", to: "/blog" }];

/** The Parks menu's key in {@link activeNavKey} — it has no `to` of its own. */
const PARKS_KEY = "parks";

/**
 * Which single nav item owns the current page. At most one, ever: the marker is
 * a single sliding element, so two claims on one route would leave it stranded
 * between them.
 *
 * A park page belongs to **Parks**, not to Queue Times (Josh, 2026-09-15) —
 * you got there through that menu and the menu shows you where you are, so the
 * marker should be sitting over it when the page lands. Queue Times keeps the
 * cross-park board at `/` alone.
 */
function activeNavKey(pathname: string): string | undefined {
  if (pathname === "/") return "/";
  if (pathname.startsWith("/park")) return PARKS_KEY;
  return [...NAV_LEFT, ...NAV_RIGHT].find((item) => item.to !== "/" && pathname.startsWith(item.to))
    ?.to;
}

const navLinkClass =
  "relative rounded-lg px-2 py-1 font-heading text-sm font-semibold tracking-wide whitespace-nowrap uppercase transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45";

/**
 * "You are here" — the one place yellow appears in the chrome, the same job it
 * does as the "now" marker in the charts.
 *
 * One element for the whole nav, shared by `layoutId`: only the active item
 * renders it, so when the route changes motion tears it out of the old item and
 * grows it into the new one's box, which reads as the bar *sliding* along the
 * row (across the wordmark included — the two link groups sit in one
 * `LayoutGroup`). A per-item border can only blink from one place to another.
 */
function NavMarker() {
  const reduce = useReducedMotion();
  return (
    <motion.span
      layoutId="site-nav-marker"
      aria-hidden
      className="absolute inset-x-2 -bottom-0.5 h-[3px] rounded-full bg-brand-yellow"
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 40 }}
    />
  );
}

function NavLinks({ items, activeKey }: { items: ReadonlyArray<NavItem>; activeKey?: string }) {
  return (
    <>
      {items.map((item) => {
        const active = item.to === activeKey;
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              navLinkClass,
              active ? "text-primary" : "text-foreground/80 hover:text-primary",
            )}
          >
            {item.label}
            {active && <NavMarker />}
          </Link>
        );
      })}
    </>
  );
}

/**
 * The park list the sidebar used to carry, grouped by resort. Same query and
 * the same active-slug logic; a dropdown rather than a rail now.
 *
 * Fetched on open, not on mount: this header rides every page of the site
 * (blog and landing included), and the sidebar only ever loaded the list on the
 * dashboard. One shared query key, so the second menu to open pays nothing.
 */
function useParkGroups(enabled: boolean) {
  const trpc = useTRPC();
  const { data: parks } = useQuery({ ...trpc.parks.list.queryOptions(), enabled });
  return useMemo(() => {
    if (!parks) return [];
    const map = new Map<string, typeof parks>();
    for (const p of parks) {
      const key = p.resortName ?? "Other";
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return [...map.entries()].map(([resort, items]) => ({ resort, items }));
  }, [parks]);
}

/** The menu body — resort headings over their parks, shared by both layouts. */
function ParkGroups({
  groups,
  activeSlug,
  separateFirst,
}: {
  groups: ReturnType<typeof useParkGroups>;
  activeSlug?: string;
  /** Compact menu: the parks follow the section links, so every group needs a rule above it. */
  separateFirst?: boolean;
}) {
  const navigate = useNavigate();
  if (groups.length === 0) {
    return <div className="px-2 py-1.5 text-sm text-muted-foreground">Loading parks…</div>;
  }
  return (
    <>
      {groups.map((group, i) => (
        // A real `DropdownMenuGroup`, not a plain div: Base UI's group *label*
        // reads its id off `MenuGroupContext` and throws without one. The rule
        // between groups sits outside them, where a separator belongs.
        <Fragment key={group.resort}>
          {(separateFirst || i > 0) && <DropdownMenuSeparator />}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs tracking-widest uppercase">
              {group.resort}
            </DropdownMenuLabel>
            {group.items.map((park) => (
              <DropdownMenuItem
                key={park.slug}
                className={cn(park.slug === activeSlug && "text-primary")}
                onClick={() => void navigate({ to: "/park/$slug", params: { slug: park.slug } })}
              >
                {park.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </Fragment>
      ))}
    </>
  );
}

/**
 * Where the menu sends you that isn't a single park. These are the cross-park
 * surfaces the old sidebar rail carried; the footer lists them too, but this is
 * the one place a reader is already thinking about parks.
 */
const PARK_SHORTCUTS: ReadonlyArray<NavItem> = [
  { label: "Live map", to: "/map" },
  { label: "Tickets", to: "/tickets" },
  { label: "Crowd forecast", to: "/predictions" },
];

/** One park as `parks.overview` ships it — the menu's poster. */
type ParkNow = TRPCOutputs["parks"]["overview"]["parks"][number];

/**
 * One park, as a poster: its own hero photograph full-bleed under a scrim, the
 * name across the bottom over a brand-yellow rule, and a single glassy chip
 * with the live wait.
 *
 * Deliberately one number and no more. The panel's job is to make you *want* a
 * park — these are the best photographs we hold of each one, and they carry the
 * menu; the live board, the crowd chart and the ride list are all one click
 * further in, and putting a reading of each in the nav turned a place you go
 * into a dashboard you read.
 *
 * The photo scales under a fixed frame on hover, which is the whole hover
 * state: a card that lifts, brightens, grows a rule *and* zooms is four things
 * competing. The yellow rule doubles as the "you are here" mark — it runs the
 * width of the name on the park you're already looking at.
 */
function ParkPoster({
  park,
  active,
  index,
  onNavigate,
}: {
  park: ParkNow;
  active: boolean;
  /** Position in the panel, for the cascade as it opens. */
  index: number;
  onNavigate: () => void;
}) {
  const reduce = useReducedMotion();
  const closed = park.isOpen === false;
  const chip = closed ? "Closed" : park.avgWait != null ? `${park.avgWait} min` : "Open";

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut", delay: reduce ? 0 : index * 0.035 }}
      className="min-h-[7.5rem]"
    >
      <Link
        to="/park/$slug"
        params={{ slug: park.slug }}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex size-full flex-col justify-end overflow-hidden rounded-2xl bg-neutral-900 p-3.5 text-white outline-none",
          "focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover",
          active && "ring-2 ring-brand-yellow",
        )}
      >
        <Image
          src={park.imageUrl}
          placeholder={park.imageThumbhash}
          alt=""
          // Sized by box rather than `sizes`: the two columns' posters are
          // deliberately different heights, so there's no one aspect to crop to
          // and CF resizes on width alone. No `transition-transform` here —
          // `Image` already carries the scale transition (its own, or the
          // ThumbHash wrapper's), and Tailwind's last-wins merge would drop the
          // load fade on the floor.
          boxWidth={240}
          className={cn(
            "absolute inset-0 size-full scale-100 object-cover duration-700 ease-out group-hover:scale-[1.07]",
            closed && "grayscale-[0.55]",
          )}
        />
        {/* Deep at the foot, barely there at the top: the name has to hold
            against a bright sky, but a flat wash over the whole card is what
            makes a photo menu look like a table of grey boxes. */}
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/5"
        />

        <span className="absolute top-3 right-3 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-bold tracking-wide backdrop-blur-sm">
          {chip}
        </span>

        <span className="relative">
          <span className="block text-base leading-tight font-bold [text-shadow:0_1px_4px_rgb(0_0_0_/_0.8)]">
            {formatParkName(park.name)}
          </span>
          <span
            aria-hidden
            className={cn(
              "mt-2 block h-[3px] rounded-full bg-brand-yellow transition-[width] duration-300 ease-out",
              active ? "w-full" : "w-7 group-hover:w-full",
            )}
          />
        </span>
      </Link>
    </motion.div>
  );
}

/** The panel's shape before the photos land, so opening it never shows a bare box. */
function ParkPostersSkeleton() {
  return (
    <>
      {[0, 1].map((col) => (
        <div key={col} className="animate-pulse">
          <div className="mb-4 h-3 w-44 rounded-full bg-muted" />
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((card) => (
              <div key={card} className="h-[7.5rem] rounded-2xl bg-muted" />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * The Parks menu at desktop width: a panel the width of the nav itself, holding
 * every park as a photograph — one column per resort.
 *
 * It's a popover anchored to the *nav row* rather than to its own trigger, so
 * it spans the masthead instead of hanging off one word. That width is what
 * makes the pictures worth having: at drop-down width they'd be thumbnails
 * beside a list, which is a list with decoration. Here they *are* the menu.
 *
 * The photos come from `parks.overview` — the map's and dashboard's own query,
 * edge-cached, ten rows — which also carries the one live number each poster
 * shows. It's fetched when the menu opens, never on page load.
 *
 * Both columns stretch to the same height, so the four Universal parks sit on
 * taller posters than the six Disney ones rather than leaving a hole under the
 * shorter column. The compact (md → lg) menu keeps the plain list.
 */
function ParksMegaMenu({
  activeSlug,
  active,
  anchor,
}: {
  activeSlug?: string;
  /** The nav marker is ours right now (we're on a park page). */
  active: boolean;
  /** The nav row, which the panel sizes and positions itself against. */
  anchor: React.RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const trpc = useTRPC();
  const { data } = useQuery({ ...trpc.parks.overview.queryOptions(), enabled: open });
  const close = useCallback(() => setOpen(false), []);
  // The nav row collapses on scroll-down; a panel anchored to it would ride the
  // collapse down the page, so it closes with the first scroll instead.
  useCloseOnScroll(open, close);

  const columns = useMemo(() => {
    if (!data) return [];
    const byResort = new Map<string, Array<ParkNow>>();
    for (const park of data.parks) {
      const key = park.resortName ?? "Other";
      const list = byResort.get(key) ?? [];
      list.push(park);
      byResort.set(key, list);
    }
    // Resort order is the query's (alphabetical); within a resort it's the
    // canonical running order the Waits strip uses — Magic Kingdom first, water
    // parks last. Alphabetical inside a column shelved Blizzard Beach between
    // Animal Kingdom and Hollywood Studios, which reads as a sorting accident.
    return [...byResort.entries()].map(([resort, parks]) => ({
      resort,
      parks: [...parks].sort((a, b) => parkRank(a.slug) - parkRank(b.slug)),
    }));
  }, [data]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              navLinkClass,
              "flex items-center gap-1",
              active || open ? "text-primary" : "text-foreground/80 hover:text-primary",
            )}
          >
            Parks
            <ChevronDownIcon
              className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")}
              aria-hidden
            />
            {active && <NavMarker />}
          </button>
        }
      />
      <PopoverContent
        anchor={anchor}
        align="center"
        sideOffset={14}
        className="w-(--anchor-width) max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0"
      >
        <div className="grid items-stretch gap-x-8 gap-y-7 p-6 sm:grid-cols-2">
          {columns.length === 0 ? (
            <ParkPostersSkeleton />
          ) : (
            columns.map((column, col) => (
              <div key={column.resort} className="flex flex-col">
                <p className="mb-4 font-heading text-xs font-bold tracking-widest text-muted-foreground uppercase">
                  {column.resort}
                </p>
                {/* `auto-rows-fr` against a stretched column is what evens the
                    two sides up: the shorter resort spends the leftover height
                    on bigger pictures instead of white space. */}
                <div className="grid flex-1 auto-rows-fr grid-cols-2 gap-3">
                  {column.parks.map((park, i) => (
                    <ParkPoster
                      key={park.slug}
                      park={park}
                      active={park.slug === activeSlug}
                      // Cascade reads left-to-right across the whole panel, not
                      // twice down each column.
                      index={col + i * 2}
                      onNavigate={close}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border/70 bg-muted/40 px-6 py-3">
          <span className="text-xs text-muted-foreground">
            Live waits, hours and crowd levels for every park we track.
          </span>
          <div className="flex items-center gap-1">
            {PARK_SHORTCUTS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={close}
                className="rounded-full px-3 py-1 text-xs font-semibold text-foreground/80 transition-colors outline-none hover:bg-background hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/45"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Tablet-width fallback (md → lg): the two link groups would wrap the row, so
 * they fold into one menu beside the wordmark. The parks list rides along as a
 * trailing group rather than a nested submenu — one level is enough here.
 */
function NavMenuCompact({
  items,
  activeKey,
  activeSlug,
}: {
  items: ReadonlyArray<NavItem>;
  activeKey?: string;
  activeSlug?: string;
}) {
  const [open, setOpen] = useState(false);
  const groups = useParkGroups(open);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Open navigation"
            className="inline-flex size-9 items-center justify-center rounded-full text-foreground/80 transition-colors outline-none hover:bg-muted hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/45"
          />
        }
      >
        <MenuIcon className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="min-w-52">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.to}
            className={cn(item.to === activeKey && "text-primary")}
            render={<Link to={item.to} />}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
        <ParkGroups groups={groups} activeSlug={activeSlug} separateFirst />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A single live-wait chip in the marquee; links to that ride's page. */
function TickerChip({
  rideName,
  rideSlug,
  parkName,
  parkSlug,
  waitMin,
  delta,
  trend,
  duplicate,
}: {
  rideName: string;
  rideSlug: string;
  parkName: string;
  parkSlug: string;
  waitMin: number;
  delta: number;
  trend: "up" | "down" | "flat";
  /** True for the loop's second, `aria-hidden` half — kept out of the tab order
   *  so the same ride isn't a duplicate stop for keyboard and screen readers. */
  duplicate: boolean;
}) {
  const flat = trend === "flat" || delta === 0;
  const tone = flat
    ? "text-muted-foreground"
    : trend === "up"
      ? "text-red-600 dark:text-red-400"
      : "text-emerald-600 dark:text-emerald-400";
  const Arrow = flat ? Minus : trend === "up" ? ArrowUpRight : ArrowDownRight;
  const change = flat
    ? "no change"
    : `${trend === "up" ? "up" : "down"} ${Math.abs(delta)} min${Math.abs(delta) === 1 ? "" : "s"}`;

  return (
    // Rows, not columns: the ride line and the park line each size themselves,
    // so a short park name lets the change text tuck under the ride name instead
    // of every chip paying for the widest column on both lines.
    <Link
      to="/park/$slug/ride/$rideSlug"
      params={{ slug: parkSlug, rideSlug }}
      tabIndex={duplicate ? -1 : undefined}
      className="flex flex-col justify-center gap-0.5 border-r border-border px-4 py-2.5 transition-colors hover:bg-muted/60"
    >
      <span className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium whitespace-nowrap text-foreground">{rideName}</span>
        {/* `key` on the value remounts this node when the wait changes, replaying
            the flash animation: red when it ticked up, green when it dropped. */}
        <span
          key={waitMin}
          className={`rounded-md px-1.5 py-0.5 font-mono text-sm font-semibold tabular-nums text-foreground ${
            trend === "up" ? "parkfi-flash-up" : trend === "down" ? "parkfi-flash-down" : ""
          }`}
        >
          {waitMin}m
        </span>
      </span>
      <span className="flex items-baseline justify-between gap-4">
        <span className="text-xs whitespace-nowrap text-muted-foreground">{parkName}</span>
        <span
          className={`flex items-center gap-0.5 px-1.5 text-[11px] font-medium whitespace-nowrap ${tone}`}
        >
          <Arrow className="size-3" aria-hidden />
          {change}
        </span>
      </span>
    </Link>
  );
}

/**
 * The site masthead — one header for every page: a thick metallic gradient bar
 * pinned at the very top, a centered wordmark flanked by the primary nav, and —
 * where the `ticker` prop asks for it — a screen-width "LIVE WAITS" marquee
 * standing in for Disney's TRENDING strip.
 *
 * As of the top-nav migration (docs/plans/dining-redesign §5) this is also the
 * *app's* desktop chrome: the sidebar rail and blue toolbar are gone, so the
 * nav row carries the sections, the actions cluster carries what the toolbar
 * used to (cast-member greeting, alerts, theme, search, account, support), and
 * the account menu carries the personal/admin destinations. Mobile never sees
 * this header — the shell gates it behind `md:` and keeps the floating search
 * bar + nav island — except on the marketing/blog pages, which have always worn
 * it at every width (there the nav folds away below `md`, as before).
 *
 * The bar and the marquee stay sticky; the nav menu auto-hides on scroll-down
 * and reveals on scroll-up. To keep the page from jumping as the menu collapses,
 * a sibling spacer grows by exactly the menu's height as the menu shrinks, so
 * the total reserved space never changes. The bar also carries a reading-progress
 * sheen.
 *
 * `--site-header-height` is published on `:root` for fixed-height routes (the
 * overview map). It is the height of the parts that *stay* — stripe + ticker —
 * and deliberately excludes the auto-hiding nav row, which overlays the top of
 * such a page while visible; counting it would make the map resize on every
 * scroll.
 */
export function SiteHeaderDesktop({
  className,
  desktopOnly = false,
  progress,
  ticker: tickerEnabled = false,
}: {
  className?: string;
  /**
   * Draw the reading-progress sheen across the masthead stripe. Defaults to
   * "on the blog, nowhere else": a progress bar answers "how much of this is
   * left to read", which is a question an article asks and a live board — where
   * the page's length is a filter result, not a text — doesn't. Pass it
   * explicitly to force it on or off for one route.
   */
  progress?: boolean;
  /**
   * Set by the app shell, which hides this header below `md` with CSS (so the
   * markup matches on the server) — the flag stops the ticker from *querying*
   * on a phone that will never paint it. Marketing pages leave it off: they
   * wear the header, ticker and all, at every width.
   */
  desktopOnly?: boolean;
  /**
   * Show the "LIVE WAITS" marquee under the nav. Off by default: the strip is
   * an attract loop for readers who aren't already looking at a board, so for
   * now only the marketing pages (`/welcome`, `/blog`) opt in — inside the app
   * every page either *is* a live board or sits one click from one, and a
   * second scrolling copy of the same numbers only competes with it.
   */
  ticker?: boolean;
}) {
  const trpc = useTRPC();
  const isMobile = useIsMobile();
  const tickerQ = useQuery({
    ...trpc.parks.ticker.queryOptions(),
    enabled: tickerEnabled && !(desktopOnly && isMobile),
    refetchInterval: TICKER_POLL_MS,
    refetchIntervalInBackground: false,
  });
  const ticker = tickerQ.data;
  // A motion value (0..1) for the reading-progress sheen. Driving the bar off
  // this directly — rather than React state — means it updates on the compositor
  // without a re-render per scroll frame, so the sweep stays smooth.
  const { scrollYProgress } = useScroll();
  const hidden = useHideOnScrollDown();
  const navRef = useRef<HTMLDivElement>(null);
  const navHeight = useMeasuredHeight(navRef);
  const [stripeHeight, stripeRef] = useMeasuredHeightOf<HTMLDivElement>();
  const [tickerHeight, tickerRef] = useMeasuredHeightOf<HTMLDivElement>();

  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const showProgress = progress ?? pathname.startsWith("/blog");
  // strict:false so this resolves everywhere; the slug only exists under
  // `/park/$slug` (and its ride child), where it lights the parks menu.
  const { slug: activeSlug } = useParams({ strict: false }) as { slug?: string };
  const allLinks = [...NAV_LEFT, ...NAV_RIGHT];
  const activeKey = activeNavKey(pathname);

  // Publish the *persistent* part of the header — stripe + ticker — so the
  // surfaces that hang off it (the overview map's height, the Waits rail's
  // sticky offset and cap) can subtract it from the viewport.
  //
  // Measured from those two elements directly. It used to be `header − nav`,
  // and that arithmetic is what made the reveal judder: the header's own height
  // changes on every frame of the collapse animation, so its ResizeObserver
  // re-rendered the whole masthead ~60 times a second *and* walked this
  // variable down with it — dragging the sticky rail's top and max-height along
  // for the ride. (Hiding looked fine only because the `hidden` guard froze the
  // write on the way down.) Neither of these two elements resizes during the
  // animation, so there's nothing left to guard against.
  // (The header's own 1px bottom border is left out of the sum; every consumer
  // already pads away from this value by whole rems.)
  useEffect(() => {
    if (stripeHeight == null) return;
    const sticky = stripeHeight + (tickerHeight ?? 0);
    document.documentElement.style.setProperty("--site-header-height", `${sticky}px`);
  }, [stripeHeight, tickerHeight]);

  // On phones the marquee is starved for width, so the "Live Waits" label gets
  // a couple of seconds to identify the strip and then folds away, handing its
  // width to the chips. Desktop has room to spare and keeps the label.
  const [labelWidth, labelRef] = useMeasuredWidth<HTMLDivElement>();
  const [labelExpired, setLabelExpired] = useState(false);

  const chips = ticker ?? [];
  const tickerVisible = tickerEnabled && chips.length >= MIN_OPEN_RIDES;
  // The countdown starts when the strip actually appears, not when the header
  // mounts — the ticker waits on its query, and a timer that had already fired
  // would collapse the label before anyone saw it.
  useEffect(() => {
    if (!tickerVisible) return;
    const t = setTimeout(() => setLabelExpired(true), LABEL_FADE_DELAY_MS);
    return () => clearTimeout(t);
  }, [tickerVisible]);
  const hideLabel = isMobile && labelExpired;
  // The track is two identical halves and slides by exactly -50%, so the loop is
  // seamless only if one half already overflows the viewport. With a short ride
  // list that wouldn't hold, so repeat the list within each half until it's wide
  // enough to fill even a large screen (~10 chips' worth) before doubling.
  const repeatsPerHalf = chips.length > 0 ? Math.max(1, Math.ceil(10 / chips.length)) : 1;
  const itemsPerHalf = chips.length * repeatsPerHalf;
  // A slow, readable drift; scales with one half's width so the pace stays even.
  const durationSec = Math.max(80, itemsPerHalf * 7);

  const collapse = { duration: 0.3, ease: "easeInOut" } as const;
  // The label's fade is slower than the nav collapse: it plays against the
  // marquee's own constant drift, where a quick change reads as a jerk.
  const handoff = { duration: 0.55, ease: "easeInOut" } as const;

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-md",
          className,
        )}
      >
        {/* Metallic masthead bar (Disney's dark-red gradient, in brand blue),
            with the reading-progress sheen sweeping across it. */}
        <div ref={stripeRef} className="relative h-2.5 w-full overflow-hidden" aria-hidden>
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(90deg,#08152e 0%,#14346b 22%,#3f74cf 50%,#14346b 78%,#08152e 100%)",
            }}
          />
          {showProgress && (
            <motion.div
              className="absolute inset-0 origin-left"
              style={{
                scaleX: scrollYProgress,
                background:
                  "linear-gradient(to right, transparent, color-mix(in oklch, white, transparent 55%))",
              }}
            />
          )}
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
            // A three-track grid, not a flex row: the side tracks are both
            // `1fr`, so the wordmark in the middle track is dead centre on the
            // page at every width no matter how lopsided the brand mark and the
            // actions cluster are. Each side track then pushes its own links
            // inward (`justify-between`), so the links hug the wordmark
            // symmetrically while the mark and the keys hold the outer edges.
            className="mx-auto grid max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-6 sm:px-6"
          >
            {/* One group across both sides of the wordmark: the yellow marker is
                a single `layoutId` element, so motion can only slide it between
                the left and right nav if they share a group. */}
            <LayoutGroup id="site-nav">
              <div className="flex min-w-0 items-center justify-between gap-4">
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    to="/"
                    aria-label="ParkFi — Home"
                    className="flex shrink-0 items-center rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45"
                  >
                    <img src="/img/brand/blue.webp" alt="ParkFi" className="h-11 w-auto" />
                  </Link>
                  {/* md → lg: one menu instead of two link groups, so the row never
                      wraps. Below md the links are gone entirely — on the app that
                      breakpoint has the bottom-nav island, and on the marketing
                      pages this header has always shed its links there. */}
                  <div className="hidden md:block lg:hidden">
                    <NavMenuCompact
                      items={allLinks}
                      activeKey={activeKey}
                      activeSlug={activeSlug}
                    />
                  </div>
                </div>
                <nav className="hidden items-center gap-5 lg:flex">
                  <NavLinks items={NAV_LEFT} activeKey={activeKey} />
                </nav>
              </div>

              <Link
                to="/"
                className="flex flex-col items-center rounded-xl px-4 leading-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45"
              >
                <span className="font-heading text-3xl font-bold tracking-tight">ParkFi</span>
              </Link>

              <div className="flex min-w-0 items-center justify-between gap-4">
                <nav className="hidden items-center gap-5 lg:flex">
                  <ParksMegaMenu
                    activeSlug={activeSlug}
                    active={activeKey === PARKS_KEY}
                    anchor={navRef}
                  />
                  <NavLinks items={NAV_RIGHT} activeKey={activeKey} />
                </nav>
                {/* Everything the blue toolbar used to carry, right-aligned and
                    on one chrome: the search button's 44px outline key is the
                    reference, so the bell and the theme toggle wear it too and
                    the avatar and sign-in keys match its height. The bell only
                    exists for a signed-in reader — nothing to say otherwise. */}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <CastMemberHeadline className="hidden bg-primary/10 text-primary ring-primary/20 xl:inline-flex" />
                  <div className="hidden md:block">
                    <NotificationCenter />
                  </div>
                  <OmniSearch variant="icon" />
                  <div className="hidden md:block">
                    <ThemeToggle />
                  </div>
                  <div className="hidden md:block">
                    <HeaderAccountMenu />
                  </div>
                  {/* The support key (`BuyMeACoffee`) is parked for now — Josh,
                      2026-09-15. The component is still there; drop it back in
                      here when the header should ask again. */}
                </div>
              </div>
            </LayoutGroup>
          </div>
        </motion.div>

        {/* Ticker strip, bracketed by thin primary rules (Disney's TRENDING bar).
            Hidden when too few rides are open (or while still loading) so it
            never shows a near-empty marquee or a "Loading…" flash. */}
        {tickerVisible && (
          <div ref={tickerRef} className="relative border-t border-primary/40">
            {/* The marquee always spans the full strip, at a fixed width the
                label never touches — the label sits *over* it, not beside it.
                The only concession is a static lead-in of exactly the label's
                width: the first chips start where the label ends and then scroll
                out through that gap on their own, so the hand-off costs no
                animation at all and nothing here ever re-lays-out.
                (Clipping happens at the padding edge, so chips stay visible as
                they travel across it.) */}
            <div
              className="parkfi-marquee relative overflow-hidden"
              style={{ paddingLeft: labelWidth }}
            >
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
                          rideSlug={c.rideSlug}
                          parkName={c.parkName}
                          parkSlug={c.parkSlug}
                          waitMin={c.waitMin}
                          delta={c.delta}
                          trend={c.trend}
                          duplicate={copy === 1}
                        />
                      )),
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Fades while sliding off its own width to the left, so it reads as
                clearing out rather than dissolving in place. Opaque so the chips
                pass behind it, and click-through so hovering here still pauses
                the marquee underneath. */}
            <motion.div
              initial={false}
              animate={{ opacity: hideLabel ? 0 : 1, x: hideLabel ? -(labelWidth ?? 0) : 0 }}
              transition={handoff}
              className="pointer-events-none absolute inset-y-0 left-0 flex bg-background"
            >
              <LiveWaitsMeter
                innerRef={labelRef}
                updatedAt={tickerQ.dataUpdatedAt}
                fetching={tickerQ.isFetching}
              />
            </motion.div>
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
