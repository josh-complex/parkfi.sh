import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";

import { FamilyMix, StatusRollup, spanLabel } from "#/components/records/job-card.tsx";
import {
  EntityChips,
  KIND_LABELS,
  RESORT_LABELS,
  RecordCard,
  fmtDay,
} from "#/components/records/record-card.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { load } from "#/lib/loader.ts";
import { seo } from "#/lib/seo.ts";

/**
 * `/filings/job/$key` — one job: every ticket the agency issued for it and the
 * merged revision timeline across them (plan §6.1a). Server-rendered like the
 * record page so a project has one crawlable, citable URL.
 */
export const Route = createFileRoute("/_app/_dash/filings_/job/$key")({
  component: JobPage,
  loader: async ({ context, params }) => {
    const job = await load(
      context.queryClient,
      context.trpc.records.job.queryOptions({ jobKey: params.key }),
    );
    return { title: job?.title ?? null, count: job?.ticketCount ?? 0 };
  },
  head: ({ loaderData, params }) =>
    seo({
      title: `${loaderData?.title ?? "Job"} — ParkFi Filings`,
      description: loaderData?.count
        ? `${loaderData.count} public filings for one project, as filed, with their status history.`
        : "Public filings for one project, as filed.",
      path: `/filings/job/${encodeURIComponent(params.key)}`,
    }),
});

function tally(values: Array<string | null>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    const k = v ?? "unknown";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function statusClass(status: string | null): string {
  if (!status) return "unknown";
  const s = status.toLowerCase();
  if (/issued|approved|registered|granted|active/.test(s)) return "issued";
  if (/final|closed|complete|expired|abandoned|void|denied|cancel/.test(s)) return "closed";
  return "open";
}

function JobPage() {
  const { key } = Route.useParams();
  const trpc = useTRPC();
  const q = useQuery(trpc.records.job.queryOptions({ jobKey: key }));

  const back = (
    <Link
      to="/filings"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
    >
      <ArrowLeftIcon className="size-4" aria-hidden />
      All filings
    </Link>
  );

  if (q.isPending) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        {back}
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        {back}
        <h1 className="text-2xl font-semibold tracking-tight">Job not found</h1>
        <p className="text-sm text-muted-foreground">
          This project may have been removed or never existed.
        </p>
      </div>
    );
  }

  const j = q.data;
  const families = tally(
    j.tickets.map((t) =>
      t.source === "orlando_soda" ? (/^[A-Z]+/.exec(t.externalId)?.[0] ?? "OTHER") : t.kind,
    ),
  );
  const statuses = tally(j.tickets.map((t) => statusClass(t.status)));
  const titleById = new Map(j.tickets.map((t) => [t.id, t]));
  const lead = j.tickets[0]!;

  const facts: Array<[string, string | null]> = [
    ["Tickets", String(j.ticketCount)],
    ["Agency", j.agency],
    ["First filed", j.firstFiledAt ? fmtDay(j.firstFiledAt) : null],
    ["Latest activity", fmtDay(j.latestAt)],
    ["Span", j.firstFiledAt ? spanLabel(j.firstFiledAt, j.latestAt) : null],
    ["Filed by", lead.filer],
    ["Address", j.address],
    ["Resort", j.resortSlug ? (RESORT_LABELS[j.resortSlug] ?? j.resortSlug) : null],
    ["Park", j.park?.name ?? null],
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {back}

      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{KIND_LABELS[lead.kind] ?? lead.kind}</Badge>
          <StatusRollup statuses={statuses} />
          <span className="ml-auto text-xs text-muted-foreground">{j.agency}</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{j.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {j.ticketCount} {j.ticketCount === 1 ? "filing" : "filings"}
          {j.address ? ` · ${j.address}` : ""}
          {j.firstFiledAt ? ` · ${spanLabel(j.firstFiledAt, j.latestAt)}` : ""}
        </p>
        <FamilyMix families={families} max={12} className="mt-2" />
        <EntityChips links={j.links} className="mt-3" />
      </div>

      <section className="rounded-2xl border bg-card p-4 text-card-foreground">
        <h2 className="text-sm font-semibold">Summary</h2>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {facts
            .filter((f): f is [string, string] => f[1] != null)
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b py-1 last:border-0">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Tickets
        </h2>
        {j.tickets.map((t) => (
          <RecordCard key={t.id} record={t} />
        ))}
      </section>

      {j.revisions.length > 0 && (
        <section className="rounded-2xl border bg-card p-4 text-card-foreground">
          <h2 className="text-sm font-semibold">Timeline</h2>
          <ol className="mt-2 space-y-2 text-sm">
            {j.revisions.map((rev) => {
              const t = titleById.get(rev.recordId);
              return (
                <li key={rev.id} className="border-b pb-2 last:border-0">
                  <p>
                    <span className="text-muted-foreground">{fmtDay(rev.seenAt)}</span>
                    {t && (
                      <>
                        {" · "}
                        <Link
                          to="/filings/$id"
                          params={{ id: String(t.id) }}
                          className="font-mono text-xs hover:underline"
                        >
                          {t.externalId}
                        </Link>
                      </>
                    )}
                    {rev.prevStatus !== rev.nextStatus && (
                      <span>
                        {" "}
                        · {rev.prevStatus ?? "—"} → {rev.nextStatus ?? "—"}
                      </span>
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        These are public records republished with their government citation. A filing describes what
        was requested, not what will be built.
      </p>
    </div>
  );
}
