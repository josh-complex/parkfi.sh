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
 * Per-venue menu, lazily fetched (`dining.menu`) the first time the drawer opens.
 * Renders the live generation grouped meal-period → group → item. The trigger is
 * supplied by the caller so any control (a card button, a link) can open it.
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

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="text-left">
          <DrawerTitle>{name}</DrawerTitle>
          <DrawerDescription>
            {menuQ.isLoading
              ? "Loading menu…"
              : periods.length === 0
                ? "No menu captured for this restaurant yet."
                : "Menu — prices exclude tax & gratuity, and may change."}
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-col gap-6 overflow-y-auto px-4 pb-8">
          {menuQ.isLoading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          ) : (
            periods.map((period) => (
              <section key={period.mealPeriod} className="flex flex-col gap-4">
                <h3 className="border-b pb-1 text-lg font-semibold tracking-tight">
                  {period.mealPeriod}
                </h3>
                {period.groups.map((group, gi) => (
                  <div key={`${group.groupName ?? "g"}-${gi}`} className="flex flex-col gap-2">
                    {group.groupName && (
                      <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {group.groupName}
                      </h4>
                    )}
                    {group.items.map((item, ii) => {
                      const price = formatPrice(item.price, item.currency);
                      return (
                        <div key={`${item.title}-${ii}`} className="flex flex-col gap-0.5">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-sm font-medium">{item.title}</span>
                            {price && (
                              <span className="text-sm tabular-nums whitespace-nowrap">
                                {price}
                              </span>
                            )}
                          </div>
                          {item.description && (
                            <p className="text-muted-foreground text-xs">{item.description}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </section>
            ))
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
