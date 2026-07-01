import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { createPortal } from "react-dom";
import {
  BedDoubleIcon,
  CornerDownLeftIcon,
  FerrisWheelIcon,
  MapPinIcon,
  NewspaperIcon,
  SearchIcon,
  TicketIcon,
  UtensilsIcon,
} from "lucide-react";

import { slugifyMenuItem } from "#/components/dining/menu-content.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { buttonVariants } from "#/components/ui/button.tsx";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "#/components/ui/drawer.tsx";
import { MorphingText } from "#/components/ui/morphing-text.tsx";
import { useIsMobile } from "#/hooks/use-mobile.ts";
import { cn } from "#/lib/utils.ts";

import type { ReactNode } from "react";

// Shared-layout ids morph the trigger box ↔ the palette container — the same
// device the Eats "Filters" control uses (see dining-filters-modal.tsx).
const RADIUS = 18;
const SPRING = { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.9 };

// The 3D outline-button surface, reused so the open palette reads as the trigger
// grown large.
const SURFACE =
  "bg-background border-3d btn-3d-outline shadow-[0_4px_0_0_var(--btn-3d),inset_0_1px_0_0_var(--btn-glare)] dark:bg-popover dark:border-border dark:ring-1 dark:ring-foreground/10";

const GROUP_ORDER = ["Parks", "Attractions", "Dining", "Menu", "Resorts", "Blog"] as const;
type Group = (typeof GROUP_ORDER)[number];

const LIMITS: Record<Group, number> = {
  Parks: 6,
  Attractions: 6,
  Dining: 6,
  Menu: 8,
  Resorts: 6,
  Blog: 4,
};

// One icon per group; the tile itself stays a single neutral tone so a mixed
// result list doesn't turn into a clash of colors.
const GROUP_ICON: Record<Group, ReactNode> = {
  Parks: <MapPinIcon />,
  Attractions: <FerrisWheelIcon />,
  Dining: <UtensilsIcon />,
  Menu: <UtensilsIcon />,
  Resorts: <BedDoubleIcon />,
  Blog: <NewspaperIcon />,
};

function formatPrice(price: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency ?? "USD",
      minimumFractionDigits: Number.isInteger(price) ? 0 : 2,
    }).format(price);
  } catch {
    return `$${price}`;
  }
}

type Item = {
  key: string;
  group: Group;
  title: string;
  subtitle?: string | null;
  image?: string | null;
  // Small capability chips under the subtitle (e.g. dining: Park ticket,
  // Characters, Dinner show, Package).
  tags?: Array<string>;
  // Trailing price badge. `ticket` adds a ticket icon above the figure (parks).
  price?: string | null;
  priceKind?: "ticket";
  onSelect: () => void;
};

/**
 * `bar` (default) renders the full search-box trigger that morphs into the
 * palette via the shared `layoutId`. `icon` renders a compact icon-only trigger
 * (e.g. for the blog masthead) that opens the very same palette — it skips the
 * morph and the palette simply animates in.
 */
export function OmniSearch({
  variant = "bar",
  placeholderTexts,
  className,
}: {
  variant?: "bar" | "icon" | "inline";
  /** When set (inline variant), the placeholder morphs through these strings. */
  placeholderTexts?: Array<string>;
  /** Extra classes for the trigger (inline variant). */
  className?: string;
} = {}) {
  const [open, setOpen] = React.useState(false);
  // Per-instance so the palette's shared-layout morph connects to *this*
  // trigger. A module-level constant would make every OmniSearch on the page
  // (e.g. the footer bar) share one id, and the palette would fly out of
  // whichever one Motion matched first instead of the trigger that opened it.
  const panelId = React.useId();
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const navigate = useNavigate();
  const trpc = useTRPC();
  const isMobile = useIsMobile();
  const listRef = React.useRef<HTMLDivElement>(null);

  // The palette renders through a portal into `document.body`, which doesn't
  // exist during SSR. Gate it on a client-mounted flag so the server (and the
  // first hydration pass) skip the portal entirely instead of crashing.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const hasQuery = query.trim().length > 0;

  // Lean pre-search set (a few parks + latest posts) drives the empty-state view.
  // It's cheap, so the drawer opens instantly instead of waiting on the full
  // corpus.
  const defaultsQ = useQuery({
    ...trpc.search.defaults.queryOptions(),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  // The full corpus is fetched on open (see the warm-up effect below) so it's
  // ready by the time the user types; then cached and filtered in-memory so
  // subsequent keystrokes never hit the network.
  const indexQ = useQuery({
    ...trpc.search.index.queryOptions(),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const queryClient = useQueryClient();

  // Prefetch the lean default set during idle time after mount, so even the very
  // first open renders its parks + posts instantly. React Query dedupes by key,
  // so multiple OmniSearch instances on a page only trigger one fetch.
  React.useEffect(() => {
    const warm = () =>
      void queryClient.prefetchQuery({
        ...trpc.search.defaults.queryOptions(),
        staleTime: 5 * 60 * 1000,
      });
    const ric = window.requestIdleCallback;
    if (ric) {
      const id = ric(warm, { timeout: 2000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = setTimeout(warm, 200);
    return () => clearTimeout(t);
  }, [queryClient, trpc]);

  // Menu items don't ship in the canned index (too many, change too often), so
  // they're searched on the server. Debounce the query so typing doesn't fire a
  // request per keystroke; only search once there are ≥2 characters.
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 160);
    return () => clearTimeout(t);
  }, [query]);

  const menuQ = useQuery({
    ...trpc.search.menuItems.queryOptions({ q: debouncedQuery, limit: LIMITS.Menu }),
    enabled: open && debouncedQuery.length >= 2,
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const close = React.useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const items = React.useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const go = (to: () => void) => () => {
      to();
      close();
    };

    const parkPrice = (cents: number | null | undefined): Pick<Item, "price" | "priceKind"> =>
      cents == null ? {} : { price: formatPrice(cents / 100, "USD"), priceKind: "ticket" };

    // Empty query → a useful default (from the lean `defaults` query): jump
    // straight to a park, plus latest reads.
    if (!q) {
      const data = defaultsQ.data;
      if (!data) return [];
      return [
        ...data.parks.slice(0, LIMITS.Parks).map<Item>((p) => ({
          key: `park-${p.id}`,
          group: "Parks",
          title: p.name,
          subtitle: p.resortName,
          image: p.imageUrl,
          ...parkPrice(p.ticketPriceCents),
          onSelect: go(() => navigate({ to: "/park/$slug", params: { slug: p.slug } })),
        })),
        ...data.blogPosts.slice(0, LIMITS.Blog).map<Item>((b) => ({
          key: `blog-${b.id}`,
          group: "Blog",
          title: b.title,
          subtitle: b.dek,
          image: b.imageUrl,
          onSelect: go(() => navigate({ to: "/blog/$slug", params: { slug: b.slug } })),
        })),
      ];
    }

    const data = indexQ.data;
    if (!data) return [];
    const m = (s: string | null | undefined) => !!s && s.toLowerCase().includes(q);
    return [
      ...data.parks
        .filter((p) => m(p.name) || m(p.resortName))
        .slice(0, LIMITS.Parks)
        .map<Item>((p) => ({
          key: `park-${p.id}`,
          group: "Parks",
          title: p.name,
          subtitle: p.resortName,
          image: p.imageUrl,
          ...parkPrice(p.ticketPriceCents),
          onSelect: go(() => navigate({ to: "/park/$slug", params: { slug: p.slug } })),
        })),
      ...data.attractions
        .filter((a) => m(a.name) || m(a.land))
        .slice(0, LIMITS.Attractions)
        .map<Item>((a) => ({
          key: `attr-${a.id}`,
          group: "Attractions",
          title: a.name,
          subtitle: [a.parkName, a.land].filter(Boolean).join(" · "),
          image: a.imageUrl,
          onSelect: go(() =>
            navigate({
              to: "/park/$slug/ride/$rideSlug",
              params: { slug: a.parkSlug, rideSlug: a.slug },
            }),
          ),
        })),
      ...data.dining
        .filter((d) => m(d.name) || m(d.cuisine))
        .slice(0, LIMITS.Dining)
        .map<Item>((d) => ({
          key: `dining-${d.id}`,
          group: "Dining",
          title: d.name,
          subtitle: [d.cuisine, d.parkName, d.priceRange].filter(Boolean).join(" · "),
          image: d.imageUrl,
          tags: [
            d.requiresParkTicket && "Needs Park Entry",
            d.characterDining && "Characters",
            d.dinnerShow && "Dinner show",
            d.diningPackage && "Package",
          ].filter((t): t is string => Boolean(t)),
          onSelect: go(() => navigate({ to: "/dining/$facilityId", params: { facilityId: d.id } })),
        })),
      ...(menuQ.data ?? []).map<Item>((mi) => ({
        key: `menu-${mi.facilityId}-${mi.title}`,
        group: "Menu",
        title: mi.title,
        subtitle: [mi.restaurantName, mi.parkResort].filter(Boolean).join(" · "),
        price: mi.price == null ? null : formatPrice(mi.price, mi.currency),
        // Deep link to the venue page, scrolled to (and highlighting) the item.
        onSelect: go(() =>
          navigate({
            to: "/dining/$facilityId",
            params: { facilityId: mi.facilityId },
            hash: `menu-${slugifyMenuItem(mi.title)}`,
          }),
        ),
      })),
      ...data.resorts
        .filter((r) => m(r.name) || m(r.area))
        .slice(0, LIMITS.Resorts)
        .map<Item>((r) => ({
          key: `resort-${r.id}`,
          group: "Resorts",
          title: r.name,
          subtitle: r.area,
          image: r.imageUrl,
          onSelect: go(() => navigate({ to: "/resort/$slug", params: { slug: r.slug } })),
        })),
      ...data.blogPosts
        .filter((b) => m(b.title) || m(b.dek))
        .slice(0, LIMITS.Blog)
        .map<Item>((b) => ({
          key: `blog-${b.id}`,
          group: "Blog",
          title: b.title,
          subtitle: b.dek,
          image: b.imageUrl,
          onSelect: go(() => navigate({ to: "/blog/$slug", params: { slug: b.slug } })),
        })),
    ];
  }, [defaultsQ.data, indexQ.data, menuQ.data, query, navigate, close]);

  // Keep the highlight valid as the result set changes under the cursor.
  React.useEffect(() => {
    setActive((a) => (a >= items.length ? 0 : a));
  }, [items.length]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.onSelect();
    }
  };

  React.useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Show the spinner for whichever query backs the current view.
  const showLoading = open && (hasQuery ? indexQ.isLoading : defaultsQ.isLoading);

  return (
    <>
      {variant === "inline" ? (
        // Bare, transparent trigger meant to sit inside a custom inset bar (the
        // mobile header). No own border/3D — the wrapper supplies the inset look —
        // and it never fades on open, so the bar stays put while the drawer is up.
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Search parks, rides, dining…"
          className={cn(
            // Icon stays left (in flow); the placeholder text centers in the space
            // after it — which runs right up to the avatar — so it reads centered
            // between the icon and the avatar.
            "flex h-full min-w-0 flex-1 items-center gap-2 bg-transparent text-[15px] leading-6 font-normal text-muted-foreground outline-none",
            className,
          )}
        >
          <SearchIcon className="size-5 shrink-0" />
          {placeholderTexts && placeholderTexts.length > 0 ? (
            // Morphing subject, centered in the space after the icon.
            <span className="flex min-w-0 flex-1 items-center justify-center">
              <MorphingText
                texts={placeholderTexts}
                smooth
                fit
                morphDuration={0.7}
                pauseDuration={2}
                className="h-6 text-[15px] leading-6 font-normal"
              />
            </span>
          ) : (
            <span className="flex-1 truncate text-center">Search parks, rides…</span>
          )}
        </button>
      ) : variant === "icon" ? (
        // Same 3D outline surface as the bar, collapsed to a circle. Carries the
        // shared `layoutId` so the palette morphs out of *this* button.
        <motion.button
          layoutId={panelId}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Search parks, rides, dining…"
          initial={false}
          animate={{ opacity: open ? 0 : 1 }}
          transition={{
            layout: SPRING,
            opacity: { duration: open ? 0.06 : 0.18, delay: open ? 0 : 0.2 },
          }}
          // Match the palette's corner radius so the shared-layout morph has no
          // border-radius delta to animate (a circle → 18px delta bounces).
          style={{ borderRadius: RADIUS, opacity: 1 }}
          className={cn(
            buttonVariants({ variant: "outline", size: "icon" }),
            "size-11 text-muted-foreground",
          )}
        >
          <SearchIcon className="size-5 shrink-0" />
        </motion.button>
      ) : (
        <motion.button
          layoutId={panelId}
          type="button"
          onClick={() => setOpen(true)}
          initial={false}
          animate={{ opacity: open ? 0 : 1 }}
          transition={{
            layout: SPRING,
            opacity: { duration: open ? 0.06 : 0.18, delay: open ? 0 : 0.2 },
          }}
          // A concrete `opacity` in `style` gives Motion's layout-animation
          // keyframe resolver a defined base to read — without it the shared
          // `layoutId` path reads `undefined` from the DOM and warns.
          style={{ borderRadius: RADIUS, opacity: 1 }}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-12 w-full justify-start gap-2 px-4 text-[15px] font-normal text-muted-foreground md:h-10 md:max-w-xs md:px-3 md:text-sm",
          )}
        >
          <SearchIcon className="size-4 shrink-0" />
          <span className="truncate">Search parks, rides…</span>
          <kbd className="ml-auto hidden h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
            <span className="text-xs">⌘</span>K
          </kbd>
        </motion.button>
      )}

      {/* Mobile: a bottom drawer — easier to reach, full-width, denser type.
          Desktop: the morphing centered palette. */}
      {isMobile ? (
        <Drawer open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
          <DrawerContent className="h-[85vh]">
            <DrawerTitle className="sr-only">Search</DrawerTitle>
            <DrawerDescription className="sr-only">
              Search across parks, attractions, dining, and posts
            </DrawerDescription>
            <div className="flex min-h-0 flex-1 flex-col">
              <SearchBody
                compact
                query={query}
                setQuery={setQuery}
                setActive={setActive}
                onKeyDown={onKeyDown}
                listRef={listRef}
                showLoading={showLoading}
                items={items}
                active={active}
              />
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        mounted &&
        createPortal(
          <AnimatePresence>
            {open && (
              <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
                <motion.div
                  className="absolute inset-0 bg-black/40 supports-backdrop-filter:backdrop-blur-sm"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.14 } }}
                  exit={{ opacity: 0, transition: { duration: 0.07 } }}
                  onClick={close}
                />

                {/* Fixed height: the panel morphs to this size once and never
                  resizes as results change, so the layout never jumps. */}
                <motion.div
                  layoutId={panelId}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Search"
                  style={{ borderRadius: RADIUS }}
                  transition={{ layout: SPRING }}
                  className={cn(
                    "relative z-10 h-[clamp(22rem,60vh,34rem)] w-full max-w-xl overflow-hidden",
                    SURFACE,
                  )}
                >
                  {/* Contents fade in after the morph settles so they don't stretch
                    while the container is animating its size. */}
                  <motion.div
                    className="flex h-full flex-col"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, transition: { delay: 0.14, duration: 0.12 } }}
                    exit={{ opacity: 0, transition: { duration: 0.05 } }}
                  >
                    <SearchBody
                      query={query}
                      setQuery={setQuery}
                      setActive={setActive}
                      onKeyDown={onKeyDown}
                      listRef={listRef}
                      showLoading={showLoading}
                      items={items}
                      active={active}
                    />
                  </motion.div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )
      )}
    </>
  );
}

/** Shared search input + grouped results list. `compact` tightens type and
 *  spacing for the mobile drawer. */
function SearchBody({
  compact = false,
  query,
  setQuery,
  setActive,
  onKeyDown,
  listRef,
  showLoading,
  items,
  active,
}: {
  compact?: boolean;
  query: string;
  setQuery: (v: string) => void;
  setActive: (n: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  listRef: React.RefObject<HTMLDivElement | null>;
  showLoading: boolean;
  items: Item[];
  active: number;
}) {
  return (
    <>
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 border-b",
          compact ? "px-3 py-2.5" : "px-4 py-3.5",
        )}
      >
        <SearchIcon
          className={cn("shrink-0 text-muted-foreground", compact ? "size-4" : "size-5")}
        />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search parks, attractions, dining, blog posts…"
          className={cn(
            "w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground",
            compact ? "text-sm" : "text-base md:text-sm",
          )}
        />
      </div>

      <div
        ref={listRef}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain",
          compact ? "p-1.5" : "p-2",
        )}
      >
        {showLoading ? (
          <div className="px-3 py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <div className="px-3 py-12 text-center text-sm text-muted-foreground">
            {query ? (
              <>
                No matches for <span className="font-medium text-foreground">“{query.trim()}”</span>
              </>
            ) : (
              "Type to search across parks, attractions, dining, and posts"
            )}
          </div>
        ) : (
          items.map((item, i) => {
            const newGroup = i === 0 || items[i - 1].group !== item.group;
            return (
              <React.Fragment key={item.key}>
                {newGroup && (
                  <div
                    className={cn(
                      "font-semibold tracking-widest text-muted-foreground uppercase first:pt-1",
                      compact ? "px-2 pt-2 pb-0.5 text-[10px]" : "px-2 pt-3 pb-1 text-[11px]",
                    )}
                  >
                    {item.group}
                  </div>
                )}
                <ResultRow
                  item={item}
                  active={i === active}
                  onMouseMove={() => setActive(i)}
                  idx={i}
                  compact={compact}
                />
              </React.Fragment>
            );
          })
        )}
      </div>

      <div className="hidden shrink-0 items-center gap-3 border-t px-4 py-2 text-[11px] text-muted-foreground sm:flex">
        <Hint keys={["↑", "↓"]}>navigate</Hint>
        <Hint keys={["↵"]}>open</Hint>
        <Hint keys={["esc"]}>close</Hint>
      </div>
    </>
  );
}

function ResultRow({
  item,
  active,
  onMouseMove,
  idx,
  compact = false,
}: {
  item: Item;
  active: boolean;
  onMouseMove: () => void;
  idx: number;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      data-idx={idx}
      onClick={item.onSelect}
      onMouseMove={onMouseMove}
      className={cn(
        "flex w-full items-center rounded-xl text-left transition-colors",
        compact ? "gap-2.5 px-2 py-1.5" : "gap-3 px-2 py-2",
        active && "bg-accent/12",
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground",
          compact ? "size-9 [&_svg]:size-4.5" : "size-10 [&_svg]:size-5",
        )}
      >
        {item.image ? (
          <img src={item.image} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          GROUP_ICON[item.group]
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
        {item.subtitle && (
          <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
        )}
        {item.tags && item.tags.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {item.tags.map((tag) => (
              <span
                key={tag}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] leading-none",
                  tag === "Needs Park Entry"
                    ? "bg-yellow-400 text-black"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {tag}
              </span>
            ))}
          </span>
        )}
      </span>
      {item.price && (
        <span className="flex shrink-0 flex-col items-end leading-none">
          <span className="text-sm font-semibold tabular-nums text-foreground">{item.price}</span>
          {item.priceKind === "ticket" && (
            <span className="mt-0.5 flex items-center gap-1 text-[10px] tracking-wide text-muted-foreground uppercase">
              <TicketIcon className="size-3.5" />
              from
            </span>
          )}
        </span>
      )}
      <CornerDownLeftIcon
        className={cn(
          "size-3.5 shrink-0 text-muted-foreground transition-opacity",
          active ? "opacity-100" : "opacity-0",
        )}
      />
    </button>
  );
}

function Hint({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k) => (
        <kbd
          key={k}
          className="flex h-4 min-w-4 items-center justify-center rounded border bg-muted px-1 font-mono text-[10px]"
        >
          {k}
        </kbd>
      ))}
      {children}
    </span>
  );
}
