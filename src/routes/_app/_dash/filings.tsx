import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { FileTextIcon } from "lucide-react";

import {
  KIND_LABELS,
  RecordCard,
  dayKey,
  fmtDay,
  fmtDayLong,
} from "#/components/records/record-card.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/components/ui/empty.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { seo } from "#/lib/seo.ts";
import type { Operator, PublicRecordKind } from "#/lib/records.ts";
import { cn } from "#/lib/utils.ts";

/**
 * `/filings` — the public-records feed (docs/plans/public-records-intelligence.md
 * §6.1). Government records the cron ingested, newest as-filed activity
 * first, grouped by day and filterable by resort, kind and window. Public
 * and indexable: every record is a unique, citable government filing.
 */
export const Route = createFileRoute("/_app/_dash/filings")({
  component: FilingsPage,
  head: () =>
    seo({
      title: "Filings — permits and public records for the parks — ParkFi",
      description:
        "Building permits and public filings for Walt Disney World and Universal Orlando, straight from government records and linked to the rides and parks they concern.",
      path: "/filings",
    }),
});

const WINDOWS: Array<{ label: string; days: number | undefined }> = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
  { label: "All time", days: undefined },
];

/**
 * Filter by OPERATOR, not resort: permits carry a resort, but trademarks and
 * patents name IP and attach only to the operator (Disney Enterprises,
 * Universal City Studios), so a resort chip would hide every Disney filing.
 */
const OPERATORS: Array<{ label: string; operator: Operator | undefined }> = [
  { label: "All", operator: undefined },
  { label: "Disney", operator: "disney" },
  { label: "Universal", operator: "universal" },
];

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-card text-foreground hover:bg-accent max-md:border-sidebar-foreground/30",
      )}
    >
      {children}
    </button>
  );
}

function FilingsPage() {
  const trpc = useTRPC();
  const [operator, setOperator] = React.useState<Operator | undefined>(undefined);
  const [kind, setKind] = React.useState<string | undefined>(undefined);
  const [days, setDays] = React.useState<number | undefined>(90);

  const summaryQ = useQuery(trpc.records.summary.queryOptions({ operator, days: days ?? 365 }));
  const feedQ = useInfiniteQuery(
    trpc.records.feed.infiniteQueryOptions(
      {
        operator,
        kinds: kind ? [kind as PublicRecordKind] : undefined,
        days,
        limit: 30,
      },
      { getNextPageParam: (last) => last.nextCursor ?? undefined },
    ),
  );

  const items = React.useMemo(() => feedQ.data?.pages.flatMap((p) => p.items) ?? [], [feedQ.data]);
  const groups = React.useMemo(() => {
    const out: Array<{ day: string; items: typeof items }> = [];
    for (const item of items) {
      const day = dayKey(item.activityAt ?? item.firstSeenAt);
      const last = out.at(-1);
      if (last && last.day === day) last.items.push(item);
      else out.push({ day, items: [item] });
    }
    return out;
  }, [items]);

  const kinds = summaryQ.data?.byKind ?? [];
  const lastRun = summaryQ.data?.sources
    .map((s) => s.ranAt)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 max-md:text-sidebar-foreground">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Filings</h1>
        <p className="mt-1 text-sm text-muted-foreground max-md:text-sidebar-foreground/80">
          Permits and public records for the parks, straight from government databases and linked to
          the rides and places they concern. A permit is a request, not an announcement.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {OPERATORS.map((o) => (
            <Chip
              key={o.label}
              active={operator === o.operator}
              onClick={() => setOperator(o.operator)}
            >
              {o.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={kind === undefined} onClick={() => setKind(undefined)}>
            All kinds
          </Chip>
          {kinds.map((k) => (
            <Chip key={k.kind} active={kind === k.kind} onClick={() => setKind(k.kind)}>
              {KIND_LABELS[k.kind] ?? k.kind}
              <span className="ml-1 opacity-70">{k.n.toLocaleString()}</span>
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {WINDOWS.map((w) => (
            <Chip key={w.label} active={days === w.days} onClick={() => setDays(w.days)}>
              {w.label}
            </Chip>
          ))}
        </div>
        {summaryQ.data && (
          <p className="text-xs text-muted-foreground max-md:text-sidebar-foreground/70">
            {summaryQ.data.total.toLocaleString()} records on file
            {lastRun ? ` · last checked ${fmtDay(lastRun)}` : ""}
            {summaryQ.data.sources.length > 0 &&
              ` · sources: ${summaryQ.data.sources.map((s) => s.agency).join(", ")}`}
          </p>
        )}
      </div>

      {feedQ.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      ) : feedQ.isError ? (
        <p className="text-sm text-destructive">Couldn’t load filings. Try again in a moment.</p>
      ) : items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileTextIcon />
            </EmptyMedia>
            <EmptyTitle>No filings in this window</EmptyTitle>
            <EmptyDescription>
              Try a wider window or another operator. Records land here after each daily check of
              the government portals.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.day} className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground max-md:text-sidebar-foreground/70">
                {fmtDayLong(`${g.day}T12:00:00-05:00`)}
              </h2>
              {g.items.map((item) => (
                <RecordCard key={item.id} record={item} />
              ))}
            </section>
          ))}
          {feedQ.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => void feedQ.fetchNextPage()}
                disabled={feedQ.isFetchingNextPage}
              >
                {feedQ.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground max-md:text-sidebar-foreground/70">
        Records are public filings republished with their government citation. We describe what was
        filed; we don’t infer a project’s purpose beyond the filing text.
      </p>
    </div>
  );
}
