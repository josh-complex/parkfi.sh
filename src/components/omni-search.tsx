import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { createPortal } from "react-dom";
import {
  CornerDownLeftIcon,
  FerrisWheelIcon,
  MapPinIcon,
  NewspaperIcon,
  SearchIcon,
  TicketIcon,
  UtensilsIcon,
} from "lucide-react";

import { useTRPC } from "#/integrations/trpc/react.ts";
import { buttonVariants } from "#/components/ui/button.tsx";
import { cn } from "#/lib/utils.ts";

import type { ReactNode } from "react";

// Shared-layout ids morph the trigger box ↔ the palette container — the same
// device the Eats "Filters" control uses (see dining-filters-modal.tsx).
const PANEL_ID = "omni-search-panel";
const RADIUS = 18;
const SPRING = { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.9 };

// The 3D outline-button surface, reused so the open palette reads as the trigger
// grown large.
const SURFACE =
  "bg-background border-3d btn-3d-outline shadow-[0_4px_0_0_var(--btn-3d),inset_0_1px_0_0_var(--btn-glare)] dark:bg-popover dark:border-border dark:ring-1 dark:ring-foreground/10";

const GROUP_ORDER = ["Parks", "Attractions", "Dining", "Menu", "Blog"] as const;
type Group = (typeof GROUP_ORDER)[number];

const LIMITS: Record<Group, number> = {
  Parks: 6,
  Attractions: 6,
  Dining: 6,
  Menu: 8,
  Blog: 4,
};

// One icon per group; the tile itself stays a single neutral tone so a mixed
// result list doesn't turn into a clash of colors.
const GROUP_ICON: Record<Group, ReactNode> = {
  Parks: <MapPinIcon />,
  Attractions: <FerrisWheelIcon />,
  Dining: <UtensilsIcon />,
  Menu: <UtensilsIcon />,
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
  // Trailing price badge. `ticket` adds a ticket icon above the figure (parks).
  price?: string | null;
  priceKind?: "ticket";
  onSelect: () => void;
};

export function OmniSearch() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const navigate = useNavigate();
  const trpc = useTRPC();
  const listRef = React.useRef<HTMLDivElement>(null);

  // The full corpus is fetched once on first open and cached; filtering happens
  // in-memory so typing never hits the network.
  const indexQ = useQuery({
    ...trpc.search.index.queryOptions(),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

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
    const data = indexQ.data;
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const go = (to: () => void) => () => {
      to();
      close();
    };

    const parkPrice = (cents: number | null | undefined): Pick<Item, "price" | "priceKind"> =>
      cents == null ? {} : { price: formatPrice(cents / 100, "USD"), priceKind: "ticket" };

    // Empty query → a useful default: jump straight to a park, plus latest reads.
    if (!q) {
      return [
        ...data.parks.slice(0, LIMITS.Parks).map<Item>((p) => ({
          key: `park-${p.id}`,
          group: "Parks",
          title: p.name,
          subtitle: p.resortName,
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
          onSelect: go(() => navigate({ to: "/park/$slug", params: { slug: a.parkSlug } })),
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
          onSelect: go(() => navigate({ to: "/dining" })),
        })),
      ...(menuQ.data ?? []).map<Item>((mi) => ({
        key: `menu-${mi.facilityId}-${mi.title}`,
        group: "Menu",
        title: mi.title,
        subtitle: [mi.restaurantName, mi.parkResort].filter(Boolean).join(" · "),
        price: mi.price == null ? null : formatPrice(mi.price, mi.currency),
        onSelect: go(() => navigate({ to: "/dining" })),
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
  }, [indexQ.data, menuQ.data, query, navigate, close]);

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

  const showLoading = open && indexQ.isLoading;

  return (
    <>
      <motion.button
        layoutId={PANEL_ID}
        type="button"
        onClick={() => setOpen(true)}
        animate={{ opacity: open ? 0 : 1 }}
        transition={{
          layout: SPRING,
          opacity: { duration: open ? 0.06 : 0.18, delay: open ? 0 : 0.2 },
        }}
        style={{ borderRadius: RADIUS }}
        className={cn(
          buttonVariants({ variant: "outline" }),
          "w-full justify-start gap-2 px-3 font-normal text-muted-foreground md:max-w-xs",
        )}
      >
        <SearchIcon className="size-4 shrink-0" />
        <span className="truncate">Search parks, rides…</span>
        <kbd className="ml-auto hidden h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </motion.button>

      {createPortal(
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
                layoutId={PANEL_ID}
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
                  <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3.5">
                    <SearchIcon className="size-5 shrink-0 text-muted-foreground" />
                    <input
                      autoFocus
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setActive(0);
                      }}
                      onKeyDown={onKeyDown}
                      placeholder="Search parks, attractions, dining, blog posts…"
                      className="w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground md:text-sm"
                    />
                  </div>

                  <div
                    ref={listRef}
                    className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
                  >
                    {showLoading ? (
                      <div className="px-3 py-12 text-center text-sm text-muted-foreground">
                        Loading…
                      </div>
                    ) : items.length === 0 ? (
                      <div className="px-3 py-12 text-center text-sm text-muted-foreground">
                        {query ? (
                          <>
                            No matches for{" "}
                            <span className="font-medium text-foreground">“{query.trim()}”</span>
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
                              <div className="px-2 pt-3 pb-1 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase first:pt-1">
                                {item.group}
                              </div>
                            )}
                            <ResultRow
                              item={item}
                              active={i === active}
                              onMouseMove={() => setActive(i)}
                              idx={i}
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
                </motion.div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function ResultRow({
  item,
  active,
  onMouseMove,
  idx,
}: {
  item: Item;
  active: boolean;
  onMouseMove: () => void;
  idx: number;
}) {
  return (
    <button
      type="button"
      data-idx={idx}
      onClick={item.onSelect}
      onMouseMove={onMouseMove}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors",
        active && "bg-accent/12",
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground [&_svg]:size-5">
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
      </span>
      {item.price && (
        <span className="flex shrink-0 flex-col items-end leading-none">
          {item.priceKind === "ticket" && (
            <TicketIcon className="mb-0.5 size-3.5 text-muted-foreground" />
          )}
          <span className="text-sm font-semibold tabular-nums text-foreground">{item.price}</span>
          {item.priceKind === "ticket" && (
            <span className="mt-0.5 text-[10px] tracking-wide text-muted-foreground uppercase">
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
