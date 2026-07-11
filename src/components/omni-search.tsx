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
import { useAchievementTrack } from "#/hooks/use-achievement-track.ts";
import { useIsMobile } from "#/hooks/use-mobile.ts";
import { cn } from "#/lib/utils.ts";

import type { ReactNode } from "react";

// Shared-layout ids morph the trigger box ↔ the palette container — the same
// device the Eats "Filters" control uses (see dining-filters-modal.tsx).
const RADIUS = 18;
const SPRING = { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.9 };

// Snappier + springier than the palette morph — the mobile search bar sweeping
// over/off the avatar wants a quick pop with a touch of overshoot, not a settle.
const INLINE_SPRING = { type: "spring" as const, stiffness: 700, damping: 26, mass: 0.7 };

// The 3D outline-button surface, reused so the open palette reads as the trigger
// grown large.
const SURFACE =
  "bg-background border-3d btn-3d-outline shadow-[0_4px_0_0_var(--btn-3d),inset_0_1px_0_0_var(--btn-glare)] dark:bg-popover dark:border-[color-mix(in_oklch,var(--border),white_25%)] dark:ring-1 dark:ring-foreground/10";

// The inset-input pill shared by the mobile inline trigger and its open search
// bar, so the two morph into one another with no chrome delta. Matches the look
// the SiteHeader wrapper used to carry (thicker top border, like our inputs).
const INLINE_PILL =
  "border border-t-[3px] border-[color-mix(in_oklch,var(--border),black_12%)] bg-background/95 dark:bg-muted/95 backdrop-blur dark:border-[color-mix(in_oklch,var(--border),white_25%)]";

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

// On mobile the drawer is a `vh`-sized bottom sheet, but the on-screen keyboard
// overlays the layout viewport (Android's default `resizes-visual`, iOS) without
// shrinking it — so an 85vh drawer keeps its full height and its lower half
// (most of the results) hides behind the keyboard. We size the panel straight
// off the *visual* viewport instead: when the keyboard is up we fill the whole
// band above it; otherwise we keep the usual ~85% sheet. Driving both height and
// the bottom offset ourselves (and turning vaul's own `repositionInputs`
// heuristic off) is what actually reclaims the space — vaul only shrinks the
// panel to `visualViewport − 15vh`, leaving a large dead gap up top.
function useKeyboardAwareDrawer(open: boolean): React.CSSProperties | undefined {
  const [style, setStyle] = React.useState<React.CSSProperties>();

  React.useEffect(() => {
    const vv = window.visualViewport;
    if (!open || !vv) {
      setStyle(undefined);
      return;
    }
    // Gap kept above the panel so it doesn't run into the status bar.
    const TOP_GAP = 8;
    // URL-bar show/hide also resizes the visual viewport; only a large bottom
    // inset (present in `resizes-visual` mode) counts as an open keyboard.
    const KEYBOARD_THRESHOLD = 150;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const keyboardOpen = inset >= KEYBOARD_THRESHOLD;
      // Keyboard up → fill the visible band above it. Keyboard down → the
      // familiar tall sheet, but measured off the visual viewport so a collapsed
      // URL bar (or `resizes-content` mode, where the inset stays ~0) still fits.
      const height = keyboardOpen ? vv.height - TOP_GAP : Math.round(vv.height * 0.85);
      setStyle({
        height: `${height}px`,
        // `bottom-0` sits behind the keyboard in `resizes-visual`; lift the panel
        // by the inset so its base rests on the keyboard's top edge.
        bottom: `${inset}px`,
        // Defeat the drawer's base `max-h-[80vh]`, which would otherwise cap the
        // height we just computed.
        maxHeight: "none",
      });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [open]);

  return style;
}

// The inline overlay is top-anchored (search bar up top, results below), so —
// unlike the bottom drawer — it must fit *between* the status bar and the
// keyboard. Size the whole overlay to the visual viewport: `top`/`height` track
// the visible band, and the results panel (flex-1) fills whatever is left above
// the keyboard. Without this the fixed overlay measures the layout viewport and
// its lower half hides behind the keyboard.
function useVisualViewportBox(open: boolean): React.CSSProperties | undefined {
  const [style, setStyle] = React.useState<React.CSSProperties>();

  React.useEffect(() => {
    const vv = window.visualViewport;
    if (!open || !vv) {
      setStyle(undefined);
      return;
    }
    const update = () => {
      setStyle({ top: `${vv.offsetTop}px`, height: `${vv.height}px` });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [open]);

  return style;
}

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
  className,
}: {
  variant?: "bar" | "icon" | "inline";
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
  const track = useAchievementTrack();
  const isMobile = useIsMobile();
  const listRef = React.useRef<HTMLDivElement>(null);
  const inline = variant === "inline";
  const drawerStyle = useKeyboardAwareDrawer(open && isMobile && !inline);
  const inlineBox = useVisualViewportBox(open && inline);

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

  // The whole corpus is searched on the server (pg_trgm fuzzy match), so we
  // debounce the query to one request per typing pause rather than per keystroke,
  // and only search once there are ≥2 characters.
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 100);
    return () => clearTimeout(t);
  }, [query]);

  const searchQ = useQuery({
    ...trpc.search.query.queryOptions({ q: debouncedQuery }),
    enabled: open && debouncedQuery.length >= 2,
    staleTime: 60 * 1000,
    // Keep the previous results on screen while the next fuzzy query resolves, so
    // the list doesn't flash empty between keystrokes.
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
      track("search");
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

    // Results are already fuzzy-matched, ranked, and capped server-side; we just
    // slice each section to its display density (LIMITS) for the dropdown.
    const data = searchQ.data;
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
      ...data.attractions.slice(0, LIMITS.Attractions).map<Item>((a) => ({
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
      ...data.dining.slice(0, LIMITS.Dining).map<Item>((d) => ({
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
          // Non-bookable venues (snack carts / quick service) surface now — badge
          // mobile order so they read differently from reservable restaurants.
          !d.bookable && d.mobileOrder && "Mobile order",
        ].filter((t): t is string => Boolean(t)),
        onSelect: go(() => navigate({ to: "/dining/$facilityId", params: { facilityId: d.id } })),
      })),
      ...data.menuItems.slice(0, LIMITS.Menu).map<Item>((mi) => ({
        key: `menu-${mi.facilityId}-${mi.title}`,
        group: "Menu",
        title: mi.title,
        subtitle: [mi.restaurantName, mi.parkResort].filter(Boolean).join(" · "),
        price: mi.price == null ? null : formatPrice(mi.price, mi.currency),
        onSelect: go(() =>
          navigate({
            to: "/dining/$facilityId/item/$slug",
            params: { facilityId: mi.facilityId, slug: slugifyMenuItem(mi.title) },
          }),
        ),
      })),
      ...data.resorts.slice(0, LIMITS.Resorts).map<Item>((r) => ({
        key: `resort-${r.id}`,
        group: "Resorts",
        title: r.name,
        subtitle: r.area,
        image: r.imageUrl,
        onSelect: go(() => navigate({ to: "/resort/$slug", params: { slug: r.slug } })),
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
  }, [defaultsQ.data, searchQ.data, query, navigate, close, track]);

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
  const showLoading = open && (hasQuery ? searchQ.isLoading : defaultsQ.isLoading);

  return (
    <>
      {inline ? (
        // The mobile header search: an inset pill sized to match the avatar
        // beside it. Carries the shared `layoutId` so opening springs it out to
        // the full-width search bar in the overlay (sweeping over the avatar);
        // closing morphs it back. Fades out while the overlay is up so only the
        // morph target shows.
        <motion.button
          layoutId={panelId}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Search parks, rides, dining…"
          initial={false}
          animate={{ opacity: open ? 0 : 1 }}
          transition={{
            layout: INLINE_SPRING,
            // No delay on the close fade-in: this button is the persistent
            // shared-`layoutId` element, so on close it becomes the lead and
            // springs its box back from the overlay's full-width bar to the
            // little pill. Delaying its reveal made that return morph run while
            // the button was still opacity 0 — the pill vanished, morphed home
            // invisibly, then popped in. Fading in from frame 0 keeps it visible
            // the whole way so it reads as one pill shrinking back.
            opacity: { duration: open ? 0.05 : 0.14, delay: 0 },
          }}
          style={{ borderRadius: 9999, opacity: 1 }}
          className={cn(
            // Icon and morphing subject both sit left — the text reads left-aligned
            // in the bar rather than floating centered.
            "flex h-13 min-w-0 items-center gap-2 px-4 text-left text-[15px] leading-6 font-normal text-muted-foreground outline-none",
            INLINE_PILL,
            className,
          )}
        >
          <SearchIcon className="size-5 shrink-0" />
          <span className="flex-1 truncate">Search for parks, rides, food…</span>
        </motion.button>
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
            // Delay 0 on close: this button leads the shared-`layoutId` morph
            // back to the collapsed trigger, so it must be visible the whole
            // return — a delayed fade-in left the pill morphing home invisibly,
            // then popping in at the end.
            opacity: { duration: open ? 0.06 : 0.18, delay: 0 },
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
            // Delay 0 on close: this button leads the shared-`layoutId` morph
            // back to the collapsed trigger, so it must be visible the whole
            // return — a delayed fade-in left the pill morphing home invisibly,
            // then popping in at the end.
            opacity: { duration: open ? 0.06 : 0.18, delay: 0 },
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

      {/* Inline (mobile header): a top-anchored overlay whose search bar IS the
          real input, morphed out of the header pill and floated above the blurred
          backdrop so what you type stays crisp. Bottom drawer otherwise on mobile;
          the morphing centered palette on desktop. */}
      {inline ? (
        mounted &&
        createPortal(
          <AnimatePresence>
            {open && (
              <>
                <motion.div
                  className="fixed inset-0 z-40 bg-black/40 supports-backdrop-filter:backdrop-blur-sm"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.14 } }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  onClick={close}
                />

                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Search"
                  className="fixed inset-x-0 top-0 z-50 flex flex-col"
                  style={{
                    ...inlineBox,
                    paddingTop: "calc(var(--safe-top) + 0.75rem)",
                    paddingBottom: "calc(var(--safe-bottom) + 0.75rem)",
                    paddingLeft: "0.75rem",
                    paddingRight: "0.75rem",
                  }}
                >
                  {/* Morph target for the header pill — same chrome and radius so
                        it grows out to full width (over the avatar) with no jump. */}
                  <motion.div
                    layoutId={panelId}
                    style={{ borderRadius: 9999 }}
                    transition={{ layout: INLINE_SPRING }}
                    className={cn("flex h-13 shrink-0 items-center gap-2 px-4", INLINE_PILL)}
                  >
                    <SearchIcon className="size-5 shrink-0 text-muted-foreground" />
                    <input
                      autoFocus
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setActive(0);
                      }}
                      onKeyDown={onKeyDown}
                      placeholder="Search parks, rides, dining…"
                      // 16px, not 15: iOS auto-zooms the page in when a focused
                      // input is under 16px (the viewport meta has no
                      // `maximum-scale`), and that zoom sticks — making the whole
                      // app look "grown" after the search opens. 16px is the
                      // threshold that stops it.
                      className="min-w-0 flex-1 bg-transparent text-left text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground"
                    />
                    <button
                      type="button"
                      onClick={close}
                      className="shrink-0 text-sm font-medium text-muted-foreground"
                    >
                      Cancel
                    </button>
                  </motion.div>

                  {/* Results fade/slide in under the bar once it has sprung out. */}
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: 0.08, duration: 0.16 } }}
                    exit={{ opacity: 0, transition: { duration: 0.08 } }}
                    className={cn(
                      "relative mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl",
                      INLINE_PILL,
                    )}
                  >
                    <SearchBody
                      compact
                      hideInput
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
                </div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )
      ) : isMobile ? (
        <Drawer
          open={open}
          onOpenChange={(o) => (o ? setOpen(true) : close())}
          repositionInputs={false}
        >
          <DrawerContent className="h-[85vh]" style={drawerStyle}>
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
  hideInput = false,
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
  // When the search box lives outside this body (the inline overlay's own bar is
  // the input), skip the input row entirely so the results reclaim the height.
  hideInput?: boolean;
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
      {!hideInput && (
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
              // `text-base` (16px), never smaller, on the mobile drawer input:
              // iOS auto-zooms the page when a focused input is under 16px and the
              // zoom sticks. Desktop (the non-compact palette) is safe at md:text-sm.
              compact ? "text-base" : "text-base md:text-sm",
            )}
          />
        </div>
      )}

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
