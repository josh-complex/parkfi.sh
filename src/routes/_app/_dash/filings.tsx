import * as React from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BellIcon, FileTextIcon } from "lucide-react";

import { FilingsFilterBar } from "#/components/records/filings-filter-bar.tsx";
import { FilingsRail } from "#/components/records/filings-rail.tsx";
import {
  cleanSearch,
  validateFilingsSearch,
  windowDays,
  type FilingsSearch,
} from "#/components/records/filings-search-params.ts";
import { JobCard } from "#/components/records/job-card.tsx";
import { RecordCard, dayKey, fmtDayLong } from "#/components/records/record-card.tsx";
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

/**
 * `/filings` — the public-records feed (docs/plans/public-records-intelligence.md
 * §6.1a). Government records the cron ingested, folded into JOBS (the trade
 * permits of one project, the classes of one mark), newest as-filed activity
 * first, with URL-synced filters and a rail of what's active. `?view=records`
 * is the flat, one-card-per-record view. Public and indexable.
 */
export const Route = createFileRoute("/_app/_dash/filings")({
  component: FilingsPage,
  validateSearch: validateFilingsSearch,
  head: () =>
    seo({
      title: "Filings — permits and public records for the parks — ParkFi",
      description:
        "Building permits, trademarks, patents and FAA filings for Walt Disney World and Universal Orlando, straight from government records and grouped by project.",
      path: "/filings",
    }),
});

/** Coarse recency buckets for the activity sort — exact dates stay on the cards. */
function bucketFor(d: Date, now: number): string {
  const days = (now - d.getTime()) / 86_400_000;
  if (days < 7) return "This week";
  if (days < 31) return "This month";
  if (days < 92) return "Last three months";
  return "Older";
}

function FilingsPage() {
  const trpc = useTRPC();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const setSearch = React.useCallback(
    (patch: Partial<FilingsSearch>) =>
      void navigate({
        search: (prev: FilingsSearch) => cleanSearch({ ...prev, ...patch }),
        replace: true,
        resetScroll: false,
      }),
    [navigate],
  );

  const days = windowDays(search);
  const summaryQ = useQuery(
    trpc.records.summary.queryOptions({ operator: search.op, days: Math.min(days ?? 365, 365) }),
  );
  const jobsView = search.view !== "records";
  const jobsQ = useInfiniteQuery({
    ...trpc.records.jobs.infiniteQueryOptions(
      {
        operator: search.op,
        parkId: search.park,
        kinds: search.kind,
        days,
        q: search.q,
        status: search.status,
        routine: search.routine ?? false,
        sort: search.sort ?? "activity",
        limit: 30,
      },
      { getNextPageParam: (last) => last.nextCursor ?? undefined },
    ),
    enabled: jobsView,
  });
  const feedQ = useInfiniteQuery({
    ...trpc.records.feed.infiniteQueryOptions(
      { operator: search.op, parkId: search.park, kinds: search.kind, days, limit: 30 },
      { getNextPageParam: (last) => last.nextCursor ?? undefined },
    ),
    enabled: !jobsView,
  });

  const jobs = React.useMemo(() => jobsQ.data?.pages.flatMap((p) => p.items) ?? [], [jobsQ.data]);
  const records = React.useMemo(
    () => feedQ.data?.pages.flatMap((p) => p.items) ?? [],
    [feedQ.data],
  );

  // Group under the activity sort only; score/size orders are flat lists.
  const jobGroups = React.useMemo(() => {
    const now = Date.now();
    const out: Array<{ label: string; items: typeof jobs }> = [];
    for (const job of jobs) {
      const label = search.sort ? "" : bucketFor(job.latestAt, now);
      const last = out.at(-1);
      if (last && last.label === label) last.items.push(job);
      else out.push({ label, items: [job] });
    }
    return out;
  }, [jobs, search.sort]);
  const recordGroups = React.useMemo(() => {
    const out: Array<{ day: string; items: typeof records }> = [];
    for (const item of records) {
      const day = dayKey(item.activityAt ?? item.firstSeenAt);
      const last = out.at(-1);
      if (last && last.day === day) last.items.push(item);
      else out.push({ day, items: [item] });
    }
    return out;
  }, [records]);

  const active = jobsView ? jobsQ : feedQ;
  const empty = jobsView ? jobs.length === 0 : records.length === 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 max-md:text-sidebar-foreground">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Filings</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground max-md:text-sidebar-foreground/80">
            Permits, trademarks, patents and airspace studies for the parks, straight from
            government databases, grouped by the job they belong to and linked to the rides and
            places they concern. A permit is a request, not an announcement.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 max-md:hidden"
          render={<Link to="/account/alerts" />}
        >
          <BellIcon className="size-4" />
          Watch filings
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <main className="min-w-0 space-y-5">
          <FilingsFilterBar
            search={search}
            onChange={setSearch}
            kinds={summaryQ.data?.byKind ?? []}
            parks={summaryQ.data?.byPark ?? []}
            className="lg:sticky lg:top-3 lg:z-10 lg:rounded-2xl lg:border lg:bg-background/95 lg:p-3 lg:backdrop-blur"
          />

          <div className="flex items-center justify-between text-xs text-muted-foreground max-md:text-sidebar-foreground/70">
            <span>
              {jobsView ? "Grouped by job" : "Every record"}
              {summaryQ.data ? ` · ${summaryQ.data.total.toLocaleString()} records on file` : ""}
            </span>
            <button
              type="button"
              className="hover:underline"
              onClick={() => setSearch({ view: jobsView ? "records" : undefined })}
            >
              {jobsView ? "Show every record" : "Group by job"}
            </button>
          </div>

          {active.isPending ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-32 w-full rounded-2xl" />
              ))}
            </div>
          ) : active.isError ? (
            <p className="text-sm text-destructive">
              Couldn’t load filings. Try again in a moment.
            </p>
          ) : empty ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileTextIcon />
                </EmptyMedia>
                <EmptyTitle>No filings match</EmptyTitle>
                <EmptyDescription>
                  Try a wider window, another operator, or clear a filter. Records land here after
                  each daily check of the government portals.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : jobsView ? (
            <div className="space-y-6">
              {jobGroups.map((g, i) => (
                <section key={g.label || i} className="space-y-3">
                  {g.label && (
                    <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase max-md:text-sidebar-foreground/70">
                      {g.label}
                    </h2>
                  )}
                  {g.items.map((job) => (
                    <JobCard key={job.jobKey} job={job} />
                  ))}
                </section>
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              {recordGroups.map((g) => (
                <section key={g.day} className="space-y-3">
                  <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase max-md:text-sidebar-foreground/70">
                    {fmtDayLong(`${g.day}T12:00:00-05:00`)}
                  </h2>
                  {g.items.map((item) => (
                    <RecordCard key={item.id} record={item} />
                  ))}
                </section>
              ))}
            </div>
          )}

          {!active.isPending && !active.isError && active.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => void active.fetchNextPage()}
                disabled={active.isFetchingNextPage}
              >
                {active.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}

          <p className="text-xs text-muted-foreground max-md:text-sidebar-foreground/70">
            Records are public filings republished with their government citation. We describe what
            was filed; we don’t infer a project’s purpose beyond the filing text.
          </p>
        </main>

        <div className="lg:sticky lg:top-3 lg:self-start">
          <FilingsRail search={search} summary={summaryQ.data} onChange={setSearch} />
        </div>
      </div>
    </div>
  );
}
