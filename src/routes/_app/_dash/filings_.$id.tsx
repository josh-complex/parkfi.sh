import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";

import {
  EntityChips,
  KIND_LABELS,
  RESORT_LABELS,
  StatusBadge,
  fmtDay,
} from "#/components/records/record-card.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { load } from "#/lib/loader.ts";
import { seo } from "#/lib/seo.ts";

/**
 * `/filings/$id` — one public record: the as-filed fields, our entity links,
 * the revision timeline, and the government link. Server-rendered so each
 * filing is a crawlable, citable page (plan §6.1).
 */
export const Route = createFileRoute("/_app/_dash/filings_/$id")({
  component: FilingDetailPage,
  loader: async ({ context, params }) => {
    const id = Number(params.id);
    if (!Number.isFinite(id)) return { title: null as string | null };
    const record = await load(context.queryClient, context.trpc.records.byId.queryOptions({ id }));
    return { title: record?.title ?? null };
  },
  head: ({ loaderData, params }) =>
    seo({
      title: `${loaderData?.title ?? "Filing"} — ParkFi Filings`,
      description: "A public record, as filed, linked to the park or ride it concerns.",
      path: `/filings/${params.id}`,
    }),
});

/** camelCase payload keys → "Camel case" labels. */
function labelFor(key: string): string {
  const spaced = key.replace(/([A-Z])/g, " $1").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function fmtValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value.toLocaleString("en-US");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? (fmtDay(`${value}T12:00:00-05:00`) ?? value) : value;
  }
  return JSON.stringify(value);
}

function FilingDetailPage() {
  const { id } = Route.useParams();
  const trpc = useTRPC();
  const q = useQuery({
    ...trpc.records.byId.queryOptions({ id: Number(id) }),
    enabled: Number.isFinite(Number(id)),
  });

  const back = (
    <Link
      to="/filings"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline max-md:text-sidebar-foreground/80"
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
      <div className="mx-auto max-w-3xl space-y-4 p-6 max-md:text-sidebar-foreground">
        {back}
        <h1 className="text-2xl font-semibold tracking-tight">Filing not found</h1>
        <p className="text-sm text-muted-foreground">
          This record may have been removed or never existed.
        </p>
      </div>
    );
  }

  const r = q.data;
  const facts: Array<[string, string | null]> = [
    ["Kind", KIND_LABELS[r.kind] ?? r.kind],
    ["Agency", r.agency],
    ["Record number", r.externalId],
    ["Filed", fmtDay(r.filedAt)],
    ["Status", r.status],
    ["Status date", fmtDay(r.statusAt)],
    ["Filed by", r.filer],
    ["Address", r.address],
    ["Parcel", r.parcelId],
    ["Resort", r.resortSlug ? (RESORT_LABELS[r.resortSlug] ?? r.resortSlug) : null],
    ["Park", r.park?.name ?? null],
    ["First seen by ParkFi", fmtDay(r.firstSeenAt)],
    ["Last checked", fmtDay(r.lastSeenAt)],
  ];
  const payloadRows = Object.entries(r.payload)
    .map(([k, v]) => [labelFor(k), fmtValue(v)] as const)
    .filter((row): row is readonly [string, string] => row[1] != null);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 max-md:text-sidebar-foreground">
      {back}

      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{KIND_LABELS[r.kind] ?? r.kind}</Badge>
          <StatusBadge status={r.status} />
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{r.title}</h1>
        {r.description && (
          <p className="mt-2 text-sm text-muted-foreground max-md:text-sidebar-foreground/80">
            {r.description}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <EntityChips links={r.links} />
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            View on {r.agency}
            <ExternalLinkIcon className="size-3" aria-hidden />
          </a>
        </div>
      </div>

      <section className="rounded-2xl border bg-card p-4 text-card-foreground">
        <h2 className="text-sm font-semibold">Details</h2>
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

      {r.revisions.length > 0 && (
        <section className="rounded-2xl border bg-card p-4 text-card-foreground">
          <h2 className="text-sm font-semibold">Timeline</h2>
          <ol className="mt-2 space-y-2 text-sm">
            {r.revisions.map((rev) => {
              const changed = Object.keys(rev.diff);
              return (
                <li key={rev.id} className="border-b pb-2 last:border-0">
                  <p>
                    <span className="text-muted-foreground">{fmtDay(rev.seenAt)}</span>
                    {rev.prevStatus !== rev.nextStatus && (
                      <span>
                        {" "}
                        · {rev.prevStatus ?? "—"} → {rev.nextStatus ?? "—"}
                      </span>
                    )}
                  </p>
                  {changed.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Changed: {changed.map(labelFor).join(", ")}
                    </p>
                  )}
                </li>
              );
            })}
            <li className="text-muted-foreground">
              {fmtDay(r.firstSeenAt)} · first seen by ParkFi
            </li>
          </ol>
        </section>
      )}

      {payloadRows.length > 0 && (
        <section className="rounded-2xl border bg-card p-4 text-card-foreground">
          <h2 className="text-sm font-semibold">As filed</h2>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {payloadRows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b py-1 last:border-0">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <p className="text-xs text-muted-foreground max-md:text-sidebar-foreground/70">
        This is a public record republished with its government citation. A filing describes what
        was requested, not what will be built.
      </p>
    </div>
  );
}
