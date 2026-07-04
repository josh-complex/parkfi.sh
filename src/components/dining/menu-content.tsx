"use client";

import * as React from "react";
import { TrendingDownIcon, TrendingUpIcon } from "lucide-react";

import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { useQuery } from "@tanstack/react-query";
import { cn } from "#/lib/utils.ts";

// ── Type taxonomy ──────────────────────────────────────────────────────────────

const TYPE_ORDER = [
  "Featured",
  "Appetizer",
  "Entree",
  "Side",
  "Snack",
  "Dessert",
  "Beverage",
  "Alcoholic Beverage",
  "Kids",
  "Allergy Friendly",
  "Holiday",
];

const TYPE_LABELS: Record<string, string> = {
  Featured: "Featured",
  Appetizer: "Appetizers",
  Entree: "Entrées",
  Side: "Sides",
  Snack: "Snacks",
  Dessert: "Desserts",
  Beverage: "Beverages",
  "Alcoholic Beverage": "Cocktails & Wine",
  Kids: "Kids",
  "Allergy Friendly": "Allergy Friendly",
  "Allergy-Friendly Request": "Allergy Friendly",
  Holiday: "Holiday",
};

const ALLERGY_TYPES = new Set(["Allergy Friendly", "Allergy-Friendly Request"]);

function primaryType(itemType: string | null): string {
  if (!itemType) return "Other";
  const parts = itemType.split("|").map((t) => t.trim());
  return parts.find((p) => !ALLERGY_TYPES.has(p)) ?? parts[0] ?? "Other";
}

function hasTag(itemType: string | null, tag: string): boolean {
  if (!itemType) return false;
  return itemType.split("|").some((t) => t.trim() === tag);
}

// ── Anchors ──────────────────────────────────────────────────────────────────

/**
 * Stable slug for a menu item, derived from its title. Used to build
 * `#menu-<slug>` deep links (omni-search menu-item rows) and the matching
 * element id on the page so the link scrolls straight to the item. Mirrors the
 * dedupe key the search uses (`lower(title)`), so a row's link resolves.
 */
export function slugifyMenuItem(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function menuItemAnchorId(title: string): string {
  return `menu-${slugifyMenuItem(title)}`;
}

// ── Data types ─────────────────────────────────────────────────────────────────

export interface MenuItemData {
  title: string;
  description: string | null;
  price: number | null;
  priceType: string | null;
  currency: string | null;
}

/**
 * A recent price move on a menu item (from `dining.menuChanges`). `oldPrice`
 * null = the item just gained a price ("New price"); `newPrice` null = its price
 * was pulled; otherwise it's an increase/decrease from old → current.
 */
export interface MenuItemChange {
  oldPrice: number | null;
  newPrice: number | null;
  currency: string | null;
}

/** Map of item slug → its recent price change, for the active meal period. */
export type MenuChangeMap = Map<string, MenuItemChange>;

export interface RawGroup {
  groupName: string | null;
  itemType: string | null;
  items: MenuItemData[];
}

interface TypeSectionGroup {
  groupName: string | null;
  allergyFriendly: boolean;
  isKids: boolean;
  items: MenuItemData[];
}

interface TypeSection {
  typeKey: string;
  label: string;
  groups: TypeSectionGroup[];
}

function buildTypeSections(rawGroups: RawGroup[]): TypeSection[] {
  const sectionMap = new Map<string, TypeSection>();
  const insertOrder: string[] = [];

  for (const group of rawGroups) {
    const key = primaryType(group.itemType);
    const label = TYPE_LABELS[key] ?? key;
    if (!sectionMap.has(key)) {
      sectionMap.set(key, { typeKey: key, label, groups: [] });
      insertOrder.push(key);
    }
    sectionMap.get(key)!.groups.push({
      groupName: group.groupName,
      allergyFriendly:
        ALLERGY_TYPES.has(group.itemType ?? "") ||
        hasTag(group.itemType, "Allergy Friendly") ||
        hasTag(group.itemType, "Allergy-Friendly Request"),
      isKids: hasTag(group.itemType, "Kids"),
      items: group.items,
    });
  }

  return insertOrder
    .map((k) => sectionMap.get(k)!)
    .sort((a, b) => {
      const oa = TYPE_ORDER.indexOf(a.typeKey);
      const ob = TYPE_ORDER.indexOf(b.typeKey);
      return (oa === -1 ? 999 : oa) - (ob === -1 ? 999 : ob);
    });
}

// ── Formatting ─────────────────────────────────────────────────────────────────

function formatPrice(price: number | null, currency: string | null): string | null {
  if (price === null) return null;
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

// ── Item components ────────────────────────────────────────────────────────────

function ItemBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border px-1 py-px text-[10px] font-medium leading-none text-muted-foreground">
      {children}
    </span>
  );
}

/**
 * Small "recently updated" indicator shown beneath an item's price: a strike-
 * through of the old price with an up/down arrow for a move, or a "New price" /
 * "Price removed" pill for the null-boundary cases.
 */
function PriceChangeIndicator({ change }: { change: MenuItemChange }) {
  const { oldPrice, newPrice, currency } = change;
  if (oldPrice == null && newPrice != null) {
    return (
      <span className="inline-flex items-center rounded border border-emerald-200 px-1 py-px text-[10px] font-medium leading-none text-emerald-600 dark:border-emerald-900">
        New price
      </span>
    );
  }
  if (newPrice == null) {
    return (
      <span className="inline-flex items-center rounded border border-amber-200 px-1 py-px text-[10px] font-medium leading-none text-amber-600 dark:border-amber-900">
        Price removed
      </span>
    );
  }
  const up = newPrice > (oldPrice ?? 0);
  return (
    <span
      title={`Was ${formatPrice(oldPrice, currency) ?? "—"}`}
      className={cn(
        "inline-flex items-center gap-0.5 text-[11px] leading-none tabular-nums",
        up ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
      )}
    >
      {up ? <TrendingUpIcon className="size-3" /> : <TrendingDownIcon className="size-3" />}
      <span className="text-muted-foreground line-through">{formatPrice(oldPrice, currency)}</span>
    </span>
  );
}

function MenuItem({
  item,
  allergyFriendly,
  isKids,
  highlight,
  change,
}: {
  item: MenuItemData;
  allergyFriendly: boolean;
  isKids: boolean;
  highlight: boolean;
  change?: MenuItemChange;
}) {
  const price = formatPrice(item.price, item.currency);
  return (
    <div
      id={menuItemAnchorId(item.title)}
      data-anchor={menuItemAnchorId(item.title)}
      className={cn(
        "flex items-start justify-between gap-3 border-b border-border/40 py-3 last:border-0 scroll-mt-24 rounded-md transition-colors",
        highlight && "bg-primary/10 ring-2 ring-primary/40 ring-offset-2 ring-offset-background",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-1.5">
          <p className="text-sm font-medium leading-snug">{item.title}</p>
          {isKids && <ItemBadge>Kids</ItemBadge>}
          {allergyFriendly && (
            <span className="inline-flex items-center rounded border border-emerald-200 px-1 py-px text-[10px] font-medium leading-none text-emerald-600">
              AF
            </span>
          )}
        </div>
        {item.description && (
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {item.description}
          </p>
        )}
      </div>
      {(price || change) && (
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          {price && <span className="text-sm tabular-nums text-muted-foreground">{price}</span>}
          {change && <PriceChangeIndicator change={change} />}
        </div>
      )}
    </div>
  );
}

// ── Shared menu body ───────────────────────────────────────────────────────────

/**
 * The scrollable menu body shared by the dining drawer/dialog and the standalone
 * venue detail page. `twoColumn` splits type sections into a left + right column
 * with a vertical divider rule between them, like a traditional printed menu. On
 * mobile sections stack single-column.
 */
export function MenuBody({
  periods,
  activePeriodIdx,
  onSwitchPeriod,
  typeSections,
  onJumpToType,
  sectionRefs,
  scrollRef,
  pillsRef,
  twoColumn,
  menuIsLoading,
  highlightSlug,
  changesBySlug,
}: {
  periods: Array<{ mealPeriod: string; groups: RawGroup[] }>;
  activePeriodIdx: number;
  onSwitchPeriod: (i: number) => void;
  typeSections: TypeSection[];
  onJumpToType: (key: string) => void;
  sectionRefs: React.RefObject<Map<string, HTMLElement>>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  pillsRef: React.RefObject<HTMLDivElement | null>;
  twoColumn: boolean;
  menuIsLoading: boolean;
  highlightSlug?: string | null;
  changesBySlug?: MenuChangeMap;
}) {
  const hasMultiplePeriods = periods.length > 1;
  const hasTypeSections = typeSections.length > 1;

  // Scroll the deep-linked item into view once it (and its period) are rendered.
  React.useEffect(() => {
    if (!highlightSlug) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-anchor="menu-${highlightSlug}"]`,
    );
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightSlug, scrollRef, activePeriodIdx]);

  function renderSection(section: TypeSection) {
    return (
      <div
        key={section.typeKey}
        data-type-key={section.typeKey}
        ref={(el) => {
          if (el) sectionRefs.current.set(section.typeKey, el);
          else sectionRefs.current.delete(section.typeKey);
        }}
        className="mb-10 mt-6 first:mt-0"
        style={{ breakInside: "avoid" }}
      >
        {/* Section header — decorative underline marks each category */}
        <p className="mb-3 text-sm font-semibold [text-decoration:underline] [text-decoration-color:hsl(var(--primary)/0.45)] [text-decoration-thickness:2px] [text-underline-offset:5px]">
          {section.label}
        </p>

        {section.groups.map((group, gi) => (
          <div key={`${group.groupName ?? "g"}-${gi}`}>
            {group.groupName && (
              <p className="pb-0.5 pt-4 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 first:pt-0">
                {group.groupName}
              </p>
            )}
            {group.items.map((item, ii) => {
              const slug = slugifyMenuItem(item.title);
              return (
                <MenuItem
                  key={`${item.title}-${ii}`}
                  item={item}
                  allergyFriendly={group.allergyFriendly}
                  isKids={group.isKids}
                  highlight={!!highlightSlug && slug === highlightSlug}
                  change={changesBySlug?.get(slug)}
                />
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Period tabs */}
      {hasMultiplePeriods && (
        <div className="flex shrink-0 gap-2 border-b px-4 py-3">
          {periods.map((p, i) => (
            <button
              key={p.mealPeriod}
              type="button"
              onClick={() => onSwitchPeriod(i)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
                i === activePeriodIdx
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.mealPeriod}
            </button>
          ))}
        </div>
      )}

      {/* Type quick-jump pills — stateless, clicking just scrolls to that section */}
      {hasTypeSections && (
        <div
          ref={pillsRef}
          className="flex shrink-0 snap-x snap-mandatory gap-1.5 overflow-x-auto border-b px-4 py-2.5 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {typeSections.map((s) => (
            <button
              key={s.typeKey}
              type="button"
              onClick={() => onJumpToType(s.typeKey)}
              className="shrink-0 snap-start rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Scrollable sections */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {menuIsLoading ? (
          <div className="flex flex-col gap-0 px-6 pt-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="flex items-start justify-between gap-3 border-b border-border/40 py-3"
              >
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-4 w-10 shrink-0" />
              </div>
            ))}
          </div>
        ) : twoColumn && typeSections.length > 1 ? (
          /*
           * Desktop masonry: CSS `column-count: 2` auto-balances sections into two
           * columns of equal height. `break-inside: avoid` on each section ensures
           * they never split mid-content. The column-rule draws the vertical divider.
           */
          <div
            className="px-8 pt-6 pb-12"
            style={{
              columnCount: 2,
              columnGap: "3.5rem",
              columnRule: "1px solid hsl(var(--border))",
            }}
          >
            {typeSections.map((s) => renderSection(s))}
          </div>
        ) : (
          /* Mobile / single-column */
          <div className="px-4 pt-6 pb-10">{typeSections.map((s) => renderSection(s))}</div>
        )}
      </div>
    </>
  );
}

// ── Shared state / query hook ──────────────────────────────────────────────────

/**
 * Loads + groups one venue's live menu and owns the period/section/scroll state
 * shared by every menu surface. Pass `targetItemSlug` (from a `#menu-<slug>` deep
 * link) to auto-select the meal period containing that item, scroll to it, and
 * briefly highlight it on mount.
 */
export function useMenuState(facilityId: string, open: boolean, targetItemSlug?: string | null) {
  const trpc = useTRPC();
  const menuQ = useQuery({
    ...trpc.dining.menu.queryOptions({ facilityId }),
    enabled: open,
  });
  // Recent price moves for this venue, so the menu can flag updated items.
  const changesQ = useQuery({
    ...trpc.dining.menuChanges.queryOptions({ facilityId, sinceDays: 30, limit: 200 }),
    enabled: open,
  });

  const periods = (menuQ.data?.mealPeriods ?? []) as Array<{
    mealPeriod: string;
    groups: RawGroup[];
  }>;

  const [activePeriodIdx, setActivePeriodIdx] = React.useState(0);
  const [highlightSlug, setHighlightSlug] = React.useState<string | null>(null);

  const currentPeriod = periods[activePeriodIdx];
  const typeSections = React.useMemo(
    () => buildTypeSections(currentPeriod?.groups ?? []),
    [currentPeriod],
  );

  // Recent price changes for the meal period on screen, keyed by item slug.
  const changesBySlug = React.useMemo<MenuChangeMap>(() => {
    const m: MenuChangeMap = new Map();
    const period = currentPeriod?.mealPeriod;
    if (!period) return m;
    for (const c of changesQ.data ?? []) {
      if (c.mealPeriod !== period) continue;
      m.set(slugifyMenuItem(c.title), {
        oldPrice: c.oldPrice,
        newPrice: c.newPrice,
        currency: c.currency,
      });
    }
    return m;
  }, [changesQ.data, currentPeriod]);

  const sectionRefs = React.useRef<Map<string, HTMLElement>>(new Map());
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const pillsRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (open) setActivePeriodIdx(0);
  }, [open]);

  // Resolve a deep-linked item: pick the meal period it lives in, then highlight
  // it. The MenuBody scroll effect carries the rest once that period renders.
  React.useEffect(() => {
    if (!open || !targetItemSlug || periods.length === 0) return;
    const idx = periods.findIndex((p) =>
      p.groups.some((g) => g.items.some((it) => slugifyMenuItem(it.title) === targetItemSlug)),
    );
    if (idx === -1) return;
    setActivePeriodIdx(idx);
    setHighlightSlug(targetItemSlug);
    const t = setTimeout(() => setHighlightSlug(null), 2600);
    return () => clearTimeout(t);
  }, [open, targetItemSlug, menuQ.data]);

  function switchPeriod(idx: number) {
    setActivePeriodIdx(idx);
    setHighlightSlug(null);
    sectionRefs.current.clear();
    scrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }

  function jumpToType(key: string) {
    sectionRefs.current.get(key)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return {
    menuQ,
    periods,
    activePeriodIdx,
    typeSections,
    sectionRefs,
    scrollRef,
    pillsRef,
    switchPeriod,
    jumpToType,
    highlightSlug,
    changesBySlug,
  };
}
