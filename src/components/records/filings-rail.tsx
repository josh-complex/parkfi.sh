import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BellIcon } from "lucide-react";

import { KIND_LABELS, fmtDay } from "#/components/records/record-card.tsx";
import type { FilingsSearch } from "#/components/records/filings-search-params.ts";
import { Button } from "#/components/ui/button.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import type { Operator, PublicRecordKind } from "#/lib/records.ts";

/**
 * The right rail of `/filings` (plan §6.1a): the jobs with the most tickets
 * lately, the kind mix, source freshness, and the watch call-to-action. On
 * small screens the page renders it under the feed instead.
 */

interface Summary {
  total: number;
  byKind: Array<{ kind: string; n: number }>;
  sources: Array<{ source: string; agency: string; ranAt: Date | null }>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-4 text-card-foreground">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ActiveProjects({ operator }: { operator: Operator | undefined }) {
  const trpc = useTRPC();
  const q = useQuery(
    trpc.records.jobs.queryOptions({ operator, days: 90, sort: "size", limit: 5, routine: false }),
  );
  if (q.isPending) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  const items = (q.data?.items ?? []).filter((j) => j.ticketCount > 1);
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No multi-permit jobs in the last 90 days.</p>
    );
  }
  return (
    <ol className="space-y-2">
      {items.map((j) => (
        <li key={j.jobKey} className="text-sm leading-snug">
          <Link to="/filings/job/$key" params={{ key: j.jobKey }} className="hover:underline">
            {j.title}
          </Link>
          <p className="text-xs text-muted-foreground">
            {j.ticketCount} tickets
            {(j.statuses.open ?? 0) > 0 ? ` · ${j.statuses.open} open` : ""}
            {j.park ? ` · ${j.park.name}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}

function KindBars({
  byKind,
  onPick,
}: {
  byKind: Summary["byKind"];
  onPick: (kind: PublicRecordKind) => void;
}) {
  const max = Math.max(1, ...byKind.map((k) => k.n));
  const rows = [...byKind].sort((a, b) => b.n - a.n);
  if (rows.length === 0)
    return <p className="text-xs text-muted-foreground">Nothing in this window.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((k) => (
        <li key={k.kind}>
          <button
            type="button"
            onClick={() => onPick(k.kind as PublicRecordKind)}
            className="group flex w-full items-center gap-2 text-left text-xs"
          >
            <span className="w-24 shrink-0 truncate group-hover:underline">
              {KIND_LABELS[k.kind] ?? k.kind}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-primary/70"
                style={{ width: `${Math.max(4, (k.n / max) * 100)}%` }}
              />
            </span>
            <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
              {k.n.toLocaleString()}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function FilingsRail({
  search,
  summary,
  onChange,
}: {
  search: FilingsSearch;
  summary: Summary | undefined;
  onChange: (patch: Partial<FilingsSearch>) => void;
}) {
  return (
    <aside className="space-y-4">
      <Section title="Active projects">
        <ActiveProjects operator={search.op} />
      </Section>
      <Section title="By kind">
        {summary ? (
          <KindBars byKind={summary.byKind} onPick={(kind) => onChange({ kind: [kind] })} />
        ) : (
          <Skeleton className="h-24 w-full rounded-lg" />
        )}
      </Section>
      <Section title="Sources">
        {summary ? (
          <ul className="space-y-1 text-xs">
            {summary.sources.map((s) => (
              <li key={s.source} className="flex justify-between gap-2">
                <span className="truncate">{s.agency}</span>
                <span className="shrink-0 text-muted-foreground">
                  {s.ranAt ? fmtDay(s.ranAt) : "—"}
                </span>
              </li>
            ))}
            <li className="pt-1 text-muted-foreground">
              {summary.total.toLocaleString()} records on file
            </li>
          </ul>
        ) : (
          <Skeleton className="h-16 w-full rounded-lg" />
        )}
      </Section>
      <Button variant="outline" className="w-full" render={<Link to="/account/alerts" />}>
        <BellIcon className="size-4" aria-hidden />
        Watch filings
      </Button>
    </aside>
  );
}
