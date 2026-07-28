"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
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
  // Full price-tier list (plan item 1.6) — "Per Glass $16 / Per Bottle $64".
  // Null/absent for single-priced items and pre-upgrade menu generations.
  prices?: Array<{ amount: number; type: string | null; currency: string | null }> | null;
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

/**
 * One entry in a venue's recent-activity feed — a price move or an item
 * add/remove event (from `dining.menuChanges` + `dining.recentItemEvents`),
 * normalized to a common shape and sorted newest-first for the "Recent changes"
 * panel. Unlike `changesBySlug`/`newSlugs`, this isn't scoped to the active meal
 * period — it's a flat feed across the whole venue.
 */
export interface MenuChangeEntry {
  kind: "added" | "removed" | "price";
  title: string;
  price: number | null;
  oldPrice: number | null;
  newPrice: number | null;
  currency: string | null;
  mealPeriod: string;
  /**
   * Menu group(s) the change touched. A venue often lists one item under
   * several groups (a cider under both "Draft Beer" and "Bottle & Can"), and
   * the diff logs one event per group — those collapse into a single feed
   * entry carrying every group name.
   */
  groups: string[];
  changedAt: string;
}

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

/**
 * Whether an item's price is charged per guest (family-style tables, prix-fixe,
 * bottomless offerings). The displayed price for these scales with the party
 * size, so surfaces can multiply the unit price by the number of guests.
 */
export function isPerPerson(priceType: string | null | undefined): boolean {
  return priceType === "Per Person";
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
  isNew,
  facilityId,
  guestCount = 1,
}: {
  item: MenuItemData;
  allergyFriendly: boolean;
  isKids: boolean;
  highlight: boolean;
  change?: MenuItemChange;
  /** Item was added to the menu within the last month. */
  isNew?: boolean;
  /** When set, the title links to the item's detail/price-history page. */
  facilityId?: string;
  /** Party size — per-guest prices are multiplied by this. */
  guestCount?: number;
}) {
  // Per-person items (family-style, prix-fixe) scale with the party size; the
  // main price shows the party total and a note carries the per-guest basis.
  const perPerson = isPerPerson(item.priceType);
  const guests = perPerson ? Math.max(1, guestCount) : 1;
  const price = formatPrice(item.price == null ? null : item.price * guests, item.currency);
  const unitPrice = perPerson ? formatPrice(item.price, item.currency) : null;
  const slug = slugifyMenuItem(item.title);
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
          {facilityId ? (
            <Link
              to="/dining/$facilityId/item/$slug"
              params={{ facilityId, slug }}
              className="text-sm font-medium leading-snug hover:underline"
            >
              {item.title}
            </Link>
          ) : (
            <p className="text-sm font-medium leading-snug">{item.title}</p>
          )}
          {isNew && (
            <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold leading-none text-emerald-700 dark:text-emerald-400">
              New
            </span>
          )}
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
          {/* Multi-tier items (plan item 1.6) list every tier; the single-price
              case keeps the plain number. Per-person scaling never applies to
              tiered items (tiers are per-glass/bottle/serving). */}
          {item.prices != null && item.prices.length > 1 ? (
            item.prices.map((t) => (
              <span key={t.type ?? "base"} className="text-xs tabular-nums text-muted-foreground">
                {t.type ? `${t.type} ` : ""}
                {formatPrice(t.amount, t.currency ?? item.currency)}
              </span>
            ))
          ) : price ? (
            <span className="text-sm tabular-nums text-muted-foreground">{price}</span>
          ) : null}
          {perPerson && (
            <span className="text-[10px] leading-none tabular-nums text-muted-foreground/60">
              {guests > 1 ? `${unitPrice} × ${guests}` : "per person"}
            </span>
          )}
          {change && <PriceChangeIndicator change={change} />}
        </div>
      )}
    </div>
  );
}

// ── Recent changes panel ────────────────────────────────────────────────────────

function RecentChangeRow({ change, facilityId }: { change: MenuChangeEntry; facilityId: string }) {
  const slug = slugifyMenuItem(change.title);
  const addedPrice = change.kind === "added" ? formatPrice(change.price, change.currency) : null;
  const newPrice = change.kind === "price" ? formatPrice(change.newPrice, change.currency) : null;
  // Menu group(s) the change touched, e.g. "Draft Beer, Bottle & Can". Long
  // parenthetical suffixes ("Tinto / Red Wine (Available in 5-oz or 8-oz
  // pours)") are trimmed, and a group merely restating the meal period is
  // dropped as noise.
  const groupList = [...new Set(change.groups.map((g) => g.replace(/\s*\(.*\)\s*$/, "").trim()))]
    .filter((g) => g && g !== change.mealPeriod)
    .join(", ");
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/40 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <Link
          to="/dining/$facilityId/item/$slug"
          params={{ facilityId, slug }}
          className="text-sm font-medium leading-snug hover:underline"
        >
          {change.title}
        </Link>
        <p className="mt-0.5 text-xs text-muted-foreground/70">
          {change.mealPeriod}
          {groupList && <> · {groupList}</>} ·{" "}
          {formatDistanceToNowStrict(new Date(change.changedAt))} ago
        </p>
      </div>
      {(addedPrice || change.kind === "price") && (
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          {addedPrice && (
            <span className="text-sm tabular-nums text-muted-foreground">{addedPrice}</span>
          )}
          {newPrice && (
            <span className="text-sm tabular-nums text-muted-foreground">{newPrice}</span>
          )}
          {change.kind === "price" && (
            <PriceChangeIndicator
              change={{
                oldPrice: change.oldPrice,
                newPrice: change.newPrice,
                currency: change.currency,
              }}
            />
          )}
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
  newSlugs,
  facilityId,
  recentChanges,
  viewingChanges,
  onShowChanges,
  guestCount,
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
  /** Slugs of items introduced in the last month, for the "New" badge. */
  newSlugs?: Set<string>;
  /** When set, item titles link to their detail pages. */
  facilityId?: string;
  /** Venue-wide activity feed backing the "Updates" pseudo-tab. */
  recentChanges?: Array<MenuChangeEntry>;
  /** When true, the "Updates" tab is active instead of a meal period. */
  viewingChanges?: boolean;
  onShowChanges?: () => void;
  /** Party size — per-guest menu prices scale with it. Defaults to 1. */
  guestCount?: number;
}) {
  const hasMultiplePeriods = periods.length > 1;
  const hasTypeSections = typeSections.length > 1;

  const [activeChangeKind, setActiveChangeKind] = React.useState<
    "price" | "added" | "removed" | null
  >(null);
  const priceChanges = (recentChanges ?? []).filter((c) => c.kind === "price");
  const additions = (recentChanges ?? []).filter((c) => c.kind === "added");
  const removals = (recentChanges ?? []).filter((c) => c.kind === "removed");
  const hasChanges = (recentChanges?.length ?? 0) > 0;
  const changeKindTabs = [
    { key: "price" as const, label: "Price changes", items: priceChanges },
    { key: "added" as const, label: "Additions", items: additions },
    { key: "removed" as const, label: "Removals", items: removals },
  ];
  const activeKind =
    activeChangeKind ?? (priceChanges.length ? "price" : additions.length ? "added" : "removed");
  const activeChangeList = changeKindTabs.find((t) => t.key === activeKind)?.items ?? [];

  // ── Scroll spy ────────────────────────────────────────────────────────────
  // Highlight the quick-jump pill for whichever type section the reader is
  // currently looking at. We score each section by how much of it is visible in
  // the scroll viewport and pick the winner — that stays stable in the desktop
  // two-column masonry (where headings in both columns cross the top together
  // and a "topmost heading" rule flickers) as well as the mobile single column.
  const [activeType, setActiveType] = React.useState<string | null>(null);
  React.useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || viewingChanges || typeSections.length <= 1) {
      setActiveType(null);
      return;
    }
    let frame = 0;
    const compute = () => {
      frame = 0;
      const view = scroller.getBoundingClientRect();
      let bestKey: string | null = null;
      let bestVisible = -1;
      for (const s of typeSections) {
        const el = sectionRefs.current.get(s.typeKey);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const visible = Math.min(r.bottom, view.bottom) - Math.max(r.top, view.top);
        // Prefer the section covering the most viewport height; on a tie keep the
        // earlier one (document order) so the pill doesn't jitter between columns.
        if (visible > bestVisible + 1) {
          bestVisible = visible;
          bestKey = s.typeKey;
        }
      }
      setActiveType(bestKey ?? typeSections[0]?.typeKey ?? null);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(compute);
    };
    compute();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scrollRef, sectionRefs, typeSections, viewingChanges, menuIsLoading]);

  // Keep the active pill centered in the horizontally-scrolling chip strip.
  React.useEffect(() => {
    if (!activeType) return;
    const strip = pillsRef.current;
    const pill = strip?.querySelector<HTMLElement>(`[data-pill="${activeType}"]`);
    if (!strip || !pill) return;
    strip.scrollTo({
      left: pill.offsetLeft - strip.clientWidth / 2 + pill.clientWidth / 2,
      behavior: "smooth",
    });
  }, [activeType, pillsRef]);

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
                  isNew={newSlugs?.has(slug)}
                  facilityId={facilityId}
                  guestCount={guestCount}
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
      {/* Period tabs, plus an "Updates" pseudo-tab for recent menu activity */}
      {(hasMultiplePeriods || hasChanges) && (
        <div className="flex shrink-0 gap-2 border-b px-4 py-3">
          {periods.map((p, i) => (
            <button
              key={p.mealPeriod}
              type="button"
              onClick={() => onSwitchPeriod(i)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
                !viewingChanges && i === activePeriodIdx
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.mealPeriod}
            </button>
          ))}
          {hasChanges && (
            <button
              type="button"
              onClick={onShowChanges}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
                viewingChanges
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Updates
            </button>
          )}
        </div>
      )}

      {/* Quick-jump pills — category chips normally, or the change-kind filter
          when the "Updates" tab is active. Same chip styling either way. */}
      {viewingChanges
        ? hasChanges && (
            <div
              ref={pillsRef}
              className="flex shrink-0 snap-x snap-mandatory gap-1.5 overflow-x-auto scroll-px-4 border-b px-4 py-2.5 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {changeKindTabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveChangeKind(t.key)}
                  className={cn(
                    "shrink-0 snap-start rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    activeKind === t.key
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                  )}
                >
                  {t.label} ({t.items.length})
                </button>
              ))}
            </div>
          )
        : hasTypeSections && (
            <div
              ref={pillsRef}
              className="flex shrink-0 snap-x snap-mandatory gap-1.5 overflow-x-auto scroll-px-4 border-b px-4 py-2.5 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {typeSections.map((s) => (
                <button
                  key={s.typeKey}
                  type="button"
                  data-pill={s.typeKey}
                  onClick={() => onJumpToType(s.typeKey)}
                  className={cn(
                    "shrink-0 snap-start rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    activeType === s.typeKey
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

      {/* Scrollable sections */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {viewingChanges ? (
          <div className="px-4 pt-4 pb-10">
            {activeChangeList.length ? (
              activeChangeList.map((c, i) => (
                <RecentChangeRow
                  key={`${activeKind}-${c.title}-${c.changedAt}-${i}`}
                  change={c}
                  facilityId={facilityId ?? ""}
                />
              ))
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">
                {activeKind === "price"
                  ? "No price changes in the last 30 days."
                  : activeKind === "added"
                    ? "No new items in the last 30 days."
                    : "No removed items in the last 30 days."}
              </p>
            )}
          </div>
        ) : menuIsLoading ? (
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
  // Recent item lifecycle events, so the menu can flag newly-added items.
  const eventsQ = useQuery({
    ...trpc.dining.recentItemEvents.queryOptions({ facilityId, sinceDays: 30 }),
    enabled: open,
  });

  const periods = (menuQ.data?.mealPeriods ?? []) as Array<{
    mealPeriod: string;
    groups: RawGroup[];
  }>;

  const [activePeriodIdx, setActivePeriodIdx] = React.useState(0);
  const [highlightSlug, setHighlightSlug] = React.useState<string | null>(null);
  const [viewingChanges, setViewingChanges] = React.useState(false);

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

  // Slugs of items added to the menu within the last month, for the current
  // meal period — drives the inline "New" badges.
  const newSlugs = React.useMemo<Set<string>>(() => {
    const s = new Set<string>();
    const period = currentPeriod?.mealPeriod;
    if (!period) return s;
    for (const e of eventsQ.data ?? []) {
      if (e.mealPeriod !== period) continue;
      if (e.changeType === "added") s.add(slugifyMenuItem(e.title));
    }
    return s;
  }, [eventsQ.data, currentPeriod]);

  // Flat, venue-wide activity feed for the "Recent changes" panel — unlike
  // `changesBySlug`/`newSlugs` above, not scoped to the active meal period, since
  // it's meant to be scanned independently of whichever period is on screen.
  const recentChanges = React.useMemo<Array<MenuChangeEntry>>(() => {
    const priceEntries: Array<MenuChangeEntry> = (changesQ.data ?? []).map((c) => ({
      kind: "price",
      title: c.title,
      price: null,
      oldPrice: c.oldPrice,
      newPrice: c.newPrice,
      currency: c.currency,
      mealPeriod: c.mealPeriod,
      groups: c.groupName ? [c.groupName] : [],
      changedAt: c.changedAt,
    }));
    const eventEntries: Array<MenuChangeEntry> = (eventsQ.data ?? []).map((e) => ({
      kind: e.changeType,
      title: e.title,
      price: e.price,
      oldPrice: null,
      newPrice: null,
      currency: e.currency,
      mealPeriod: e.mealPeriod,
      groups: e.groupName ? [e.groupName] : [],
      changedAt: e.changedAt,
    }));
    // The diff logs one row per menu group, so an item listed under several
    // groups (a cider under both "Draft Beer" and "Bottle & Can") arrives as
    // otherwise-identical entries. Collapse those into one entry accumulating
    // the group names. Keying on the exact `changedAt` keeps the merge within
    // a single cron batch — a remove-then-re-add on different days stays two
    // entries — and the price key includes the move itself so two tiers moving
    // differently in the same batch don't fuse. This key must mirror the
    // UNION dedupe in the `recentlyUpdated` rollup (dining.ts router), which
    // computes the "N updates" badge — the badge and this feed must agree.
    const merged = new Map<string, MenuChangeEntry>();
    for (const e of [...priceEntries, ...eventEntries]) {
      const key = [
        e.kind,
        e.mealPeriod,
        e.title,
        e.changedAt,
        e.kind === "price" ? `${e.oldPrice}\u0001${e.newPrice}` : "",
      ].join("\u0001");
      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, e);
        continue;
      }
      for (const g of e.groups) if (!prev.groups.includes(g)) prev.groups.push(g);
      if (prev.price === null) prev.price = e.price;
    }
    return [...merged.values()].sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt));
  }, [changesQ.data, eventsQ.data]);

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
    setViewingChanges(false);
    setHighlightSlug(null);
    sectionRefs.current.clear();
    scrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }

  function jumpToType(key: string) {
    sectionRefs.current.get(key)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showChanges() {
    setViewingChanges(true);
    setHighlightSlug(null);
    scrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }

  // Imperatively focus an item by slug — selects the meal period it lives in and
  // highlights it. Same mechanism as the deep-link effect, but caller-triggered
  // (e.g. the header's "Freshly updated" chip). Returns whether the item was
  // found so callers can decide how far to scroll. The MenuBody scroll effect
  // brings it into view once its period renders.
  function focusItem(slug: string): boolean {
    const idx = periods.findIndex((p) =>
      p.groups.some((g) => g.items.some((it) => slugifyMenuItem(it.title) === slug)),
    );
    if (idx === -1) return false;
    setViewingChanges(false);
    setActivePeriodIdx(idx);
    setHighlightSlug(slug);
    setTimeout(() => setHighlightSlug((s) => (s === slug ? null : s)), 2600);
    return true;
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
    focusItem,
    highlightSlug,
    changesBySlug,
    newSlugs,
    recentChanges,
    viewingChanges,
    showChanges,
  };
}
