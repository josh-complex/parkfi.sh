"use client";

import { useQuery } from "@tanstack/react-query";
import { TrendingDownIcon, TrendingUpIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

function fmt(price: number | null, currency: string | null): string {
  if (price === null) return "—";
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
 * Resort-wide "recent menu price changes" feed (`dining.menuChanges`). Renders
 * nothing until at least two catalog runs have observed a price move, so it
 * stays invisible during cold start rather than showing an empty shell.
 */
export function DiningMenuChanges() {
  const trpc = useTRPC();
  const changesQ = useQuery(trpc.dining.menuChanges.queryOptions({ sinceDays: 30, limit: 24 }));
  const changes = changesQ.data ?? [];
  if (!changes.length) return null;

  return (
    <Card className="@container/changes">
      <CardHeader>
        <CardTitle className="text-base">Recent menu price changes</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 @2xl/changes:grid-cols-2">
        {changes.map((c, i) => {
          const up = (c.newPrice ?? 0) > (c.oldPrice ?? 0);
          return (
            <div
              key={`${c.facilityId}-${c.title}-${i}`}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{c.title}</div>
                <div className="text-muted-foreground truncate text-xs">
                  {c.name}
                  {c.mealPeriod ? ` · ${c.mealPeriod}` : ""}
                </div>
              </div>
              <div
                className={cn(
                  "flex shrink-0 items-center gap-1 tabular-nums",
                  up ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
                )}
              >
                {up ? (
                  <TrendingUpIcon className="size-3.5" />
                ) : (
                  <TrendingDownIcon className="size-3.5" />
                )}
                <span className="text-muted-foreground line-through">
                  {fmt(c.oldPrice, c.currency)}
                </span>
                <span>→ {fmt(c.newPrice, c.currency)}</span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
