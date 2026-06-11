"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "#/components/ui/drawer.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

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

interface MenuItemData {
  title: string;
  description: string | null;
  price: number | null;
  currency: string | null;
}

function MenuItem({ item }: { item: MenuItemData }) {
  const price = formatPrice(item.price, item.currency);
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug">{item.title}</p>
        {item.description && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {item.description}
          </p>
        )}
      </div>
      {price && (
        <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
          {price}
        </span>
      )}
    </div>
  );
}

/**
 * Per-venue menu drawer with Uber Eats-style navigation:
 * - Meal periods (Lunch/Dinner) are tabs that swap content, not scroll anchors.
 * - Named groups within the active period appear as quick-scroll pills below
 *   the period tabs; IntersectionObserver highlights the one in view.
 * - Items are laid out in a responsive two-column grid; sections are separated
 *   by a label + full-width rule rather than a muted background band.
 */
export function DiningMenuDrawer({
  facilityId,
  name,
  trigger,
}: {
  facilityId: string;
  name: string;
  trigger: React.ReactNode;
}) {
  const trpc = useTRPC();
  const [open, setOpen] = React.useState(false);
  const menuQ = useQuery({
    ...trpc.dining.menu.queryOptions({ facilityId }),
    enabled: open,
  });

  const periods = menuQ.data?.mealPeriods ?? [];

  const [activePeriodIdx, setActivePeriodIdx] = React.useState(0);
  const [activeGroupName, setActiveGroupName] = React.useState<string | null>(null);

  const currentPeriod = periods[activePeriodIdx];
  const groups = currentPeriod?.groups ?? [];
  const namedGroups = groups.filter((g) => g.groupName);

  const groupRefs = React.useRef<Map<string, HTMLElement>>(new Map());
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const subNavRef = React.useRef<HTMLDivElement>(null);

  function switchPeriod(idx: number) {
    setActivePeriodIdx(idx);
    setActiveGroupName(null);
    groupRefs.current.clear();
    scrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }

  function jumpToGroup(groupName: string) {
    setActiveGroupName(groupName);
    groupRefs.current.get(groupName)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Reset period selection whenever the drawer opens.
  React.useEffect(() => {
    if (open) {
      setActivePeriodIdx(0);
      setActiveGroupName(null);
    }
  }, [open]);

  // Highlight the group currently in the viewport.
  React.useEffect(() => {
    if (!scrollRef.current || !namedGroups.length) return;
    const container = scrollRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveGroupName(entry.target.getAttribute("data-group"));
            break;
          }
        }
      },
      { root: container, threshold: 0, rootMargin: "-15% 0px -70% 0px" },
    );
    for (const [, el] of groupRefs.current) observer.observe(el);
    return () => observer.disconnect();
  }, [namedGroups.length, activePeriodIdx]);

  // Scroll the active group pill into view in the sub-nav bar.
  React.useEffect(() => {
    if (!activeGroupName || !subNavRef.current) return;
    const btn = subNavRef.current.querySelector<HTMLElement>(
      `[data-group-btn="${activeGroupName}"]`,
    );
    btn?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeGroupName]);

  const hasMultiplePeriods = periods.length > 1;
  const hasSubNav = namedGroups.length > 1;

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent className="flex max-h-[90vh] flex-col">
        <DrawerHeader className="shrink-0 pb-3 text-left">
          <DrawerTitle>{name}</DrawerTitle>
          {!menuQ.isLoading && periods.length > 0 && (
            <DrawerDescription>Prices exclude tax &amp; gratuity and may change.</DrawerDescription>
          )}
          {!menuQ.isLoading && periods.length === 0 && (
            <DrawerDescription>No menu captured for this restaurant yet.</DrawerDescription>
          )}
        </DrawerHeader>

        {/* ── Meal-period tab bar ── */}
        {hasMultiplePeriods && (
          <div className="flex shrink-0 gap-2 border-b px-4 pb-3">
            {periods.map((p, i) => (
              <button
                key={p.mealPeriod}
                type="button"
                onClick={() => switchPeriod(i)}
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

        {/* ── Group quick-scroll sub-nav ── */}
        {hasSubNav && (
          <div
            ref={subNavRef}
            className="flex shrink-0 gap-1.5 overflow-x-auto border-b px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {namedGroups.map((g) => {
              const active =
                activeGroupName === g.groupName ||
                (!activeGroupName && namedGroups[0]?.groupName === g.groupName);
              return (
                <button
                  key={g.groupName}
                  type="button"
                  data-group-btn={g.groupName}
                  onClick={() => jumpToGroup(g.groupName!)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                  )}
                >
                  {g.groupName}
                </button>
              );
            })}
          </div>
        )}

        {/* ── Scrollable menu content ── */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {menuQ.isLoading ? (
            <div className="grid grid-cols-1 gap-x-8 px-6 pt-4 sm:grid-cols-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="flex items-start justify-between gap-4 py-4">
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <Skeleton className="h-4 w-10 shrink-0" />
                </div>
              ))}
            </div>
          ) : (
            <div className="pb-10">
              {groups.map((group, gi) => (
                <div
                  key={`${group.groupName ?? "g"}-${gi}`}
                  data-group={group.groupName ?? undefined}
                  ref={(el) => {
                    if (group.groupName) {
                      if (el) groupRefs.current.set(group.groupName, el);
                      else groupRefs.current.delete(group.groupName);
                    }
                  }}
                >
                  {/* Section divider */}
                  {group.groupName && (
                    <div
                      className={cn(
                        "flex items-center gap-3 px-6",
                        gi === 0 ? "pb-1 pt-6" : "pb-1 pt-10",
                      )}
                    >
                      <span className="shrink-0 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        {group.groupName}
                      </span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                  )}

                  {/* Two-column item grid */}
                  <div className="grid grid-cols-1 gap-x-8 px-6 sm:grid-cols-2">
                    {group.items.map((item, ii) => (
                      <div
                        key={`${item.title}-${ii}`}
                        className="border-b border-border/40 last:border-0"
                      >
                        <MenuItem item={item} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
