"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { XIcon } from "lucide-react";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "#/components/ui/drawer.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useIsMobile } from "#/hooks/use-mobile.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
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

// ── Data types ─────────────────────────────────────────────────────────────────

interface MenuItemData {
  title: string;
  description: string | null;
  price: number | null;
  priceType: string | null;
  currency: string | null;
}

interface RawGroup {
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

function MenuItem({
  item,
  allergyFriendly,
  isKids,
}: {
  item: MenuItemData;
  allergyFriendly: boolean;
  isKids: boolean;
}) {
  const price = formatPrice(item.price, item.currency);
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/40 py-3 last:border-0">
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
      {price && (
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{price}</span>
      )}
    </div>
  );
}

// ── Shared menu content ────────────────────────────────────────────────────────

/**
 * The scrollable body shared by both the desktop dialog and mobile drawer.
 * `twoColumn` splits type sections into a left + right column with a vertical
 * divider rule between them, like a traditional printed menu. On mobile
 * sections stack single-column.
 */
function MenuBody({
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
}) {
  const hasMultiplePeriods = periods.length > 1;
  const hasTypeSections = typeSections.length > 1;

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
            {group.items.map((item, ii) => (
              <MenuItem
                key={`${item.title}-${ii}`}
                item={item}
                allergyFriendly={group.allergyFriendly}
                isKids={group.isKids}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Period tabs */}
      {hasMultiplePeriods && (
        <div className="flex shrink-0 gap-2 border-b px-4 pb-3">
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
          className="flex shrink-0 gap-1.5 overflow-x-auto border-b px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {typeSections.map((s) => (
            <button
              key={s.typeKey}
              type="button"
              onClick={() => onJumpToType(s.typeKey)}
              className="shrink-0 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
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

function useMenuState(facilityId: string, open: boolean) {
  const trpc = useTRPC();
  const menuQ = useQuery({
    ...trpc.dining.menu.queryOptions({ facilityId }),
    enabled: open,
  });

  const periods = (menuQ.data?.mealPeriods ?? []) as Array<{
    mealPeriod: string;
    groups: RawGroup[];
  }>;

  const [activePeriodIdx, setActivePeriodIdx] = React.useState(0);

  const currentPeriod = periods[activePeriodIdx];
  const typeSections = React.useMemo(
    () => buildTypeSections(currentPeriod?.groups ?? []),
    [currentPeriod],
  );

  const sectionRefs = React.useRef<Map<string, HTMLElement>>(new Map());
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const pillsRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (open) setActivePeriodIdx(0);
  }, [open]);

  function switchPeriod(idx: number) {
    setActivePeriodIdx(idx);
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
  };
}

// ── Desktop dialog (motion-powered) ───────────────────────────────────────────

const LAYOUT_ID_PREFIX = "menu-popup-";

function DesktopMenuDialog({ facilityId, name }: { facilityId: string; name: string }) {
  const [open, setOpen] = React.useState(false);
  const layoutId = `${LAYOUT_ID_PREFIX}${facilityId}`;

  const state = useMenuState(facilityId, open);

  // Close on Escape.
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/*
       * The trigger button stays mounted and uses the same layoutId as the dialog
       * popup. When the dialog opens, the trigger fades out; motion's layoutId
       * animates the popup from the trigger's last known position/size.
       * When the dialog closes, the popup exits and the trigger fades back in.
       */}
      <motion.button
        layoutId={layoutId}
        type="button"
        onClick={() => setOpen(true)}
        animate={{ opacity: open ? 0 : 1 }}
        transition={{ opacity: { duration: open ? 0.05 : 0.15, delay: open ? 0 : 0.25 } }}
        style={{ borderRadius: 8 }}
        className="inline-flex h-8 w-full items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium shadow-xs hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label={`View menu for ${name}`}
      >
        View menu
      </motion.button>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
            />

            {/* Dialog popup — shares layoutId with the trigger button */}
            <motion.div
              layoutId={layoutId}
              role="dialog"
              aria-modal="true"
              aria-label={name}
              style={{ borderRadius: 24 }}
              className="relative z-10 flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden bg-popover shadow-2xl ring-1 ring-foreground/5 dark:ring-foreground/10"
            >
              {/* Compact header */}
              <motion.div
                layout="position"
                className="flex shrink-0 items-center justify-between gap-4 px-6 py-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold">{name}</p>
                  <p className="text-xs text-muted-foreground">Prices excl. tax &amp; gratuity</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 bg-secondary"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                >
                  <XIcon className="size-4" />
                </Button>
              </motion.div>

              <motion.div layout="position" className="contents">
                <MenuBody
                  periods={state.periods}
                  activePeriodIdx={state.activePeriodIdx}
                  onSwitchPeriod={state.switchPeriod}
                  typeSections={state.typeSections}
                  onJumpToType={state.jumpToType}
                  sectionRefs={state.sectionRefs}
                  scrollRef={state.scrollRef}
                  pillsRef={state.pillsRef}
                  twoColumn
                  menuIsLoading={state.menuQ.isLoading}
                />
              </motion.div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Mobile drawer ──────────────────────────────────────────────────────────────

function MobileMenuDrawer({ facilityId, name }: { facilityId: string; name: string }) {
  const [open, setOpen] = React.useState(false);
  const state = useMenuState(facilityId, open);

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          View menu
        </Button>
      </DrawerTrigger>
      <DrawerContent className="flex max-h-[90vh] flex-col">
        <DrawerHeader className="shrink-0 pb-3 text-left">
          <DrawerTitle>{name}</DrawerTitle>
        </DrawerHeader>
        <MenuBody
          periods={state.periods}
          activePeriodIdx={state.activePeriodIdx}
          onSwitchPeriod={state.switchPeriod}
          typeSections={state.typeSections}
          onJumpToType={state.jumpToType}
          sectionRefs={state.sectionRefs}
          scrollRef={state.scrollRef}
          pillsRef={state.pillsRef}
          twoColumn={false}
          menuIsLoading={state.menuQ.isLoading}
        />
      </DrawerContent>
    </Drawer>
  );
}

// ── Public export ──────────────────────────────────────────────────────────────

/**
 * Renders a "View menu" button that:
 *  - On desktop: morphs into a full dialog via motion's `layoutId` shared-layout
 *    animation. Sections are displayed in two columns with a vertical divider.
 *  - On mobile: opens a bottom Drawer with single-column sections.
 *
 * The `trigger` prop is no longer accepted; the button is owned internally so
 * that the motion layout animation has full control of the element.
 */
export function DiningMenuDrawer({ facilityId, name }: { facilityId: string; name: string }) {
  const isMobile = useIsMobile();
  return isMobile ? (
    <MobileMenuDrawer facilityId={facilityId} name={name} />
  ) : (
    <DesktopMenuDialog facilityId={facilityId} name={name} />
  );
}
