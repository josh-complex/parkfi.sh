import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon, FileTextIcon } from "lucide-react";

import { KIND_LABELS, StatusBadge, fmtDay } from "#/components/records/record-card.tsx";
import { WatchFilingsButton } from "#/components/records/watch-filings-button.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

/**
 * "Paper trail" (public-records plan §6.2): the government records linked to
 * one of our entities — permits, trademarks, patents, FAA studies — as a
 * compact list under the entity page. Copy keeps the §9 rule: records are
 * "filed", never "announced", and every row links to the agency.
 *
 * Renders nothing at all when the entity has no records, so Disney rides
 * (whose permits sit behind CFTOD's login wall) don't grow an empty section.
 */

type TrailEntityKind = "park" | "attraction" | "facility" | "shop";

export function usePaperTrail(
  entityKind: TrailEntityKind,
  entityId: string | number | null | undefined,
  opts: { limit?: number; days?: number } = {},
) {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.records.paperTrail.queryOptions({
      entityKind,
      entityId: String(entityId ?? ""),
      limit: opts.limit ?? 6,
      days: opts.days ?? 365,
    }),
    enabled: entityId != null && entityId !== "",
  });
}

function KindMix({ byKind, days }: { byKind: Array<{ kind: string; n: number }>; days: number }) {
  if (byKind.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Last {days === 365 ? "year" : `${days} days`}:{" "}
      {byKind
        .map(
          (k) => `${k.n} ${(KIND_LABELS[k.kind] ?? k.kind).toLowerCase()}${k.n === 1 ? "" : "s"}`,
        )
        .join(" · ")}
    </p>
  );
}

function TrailRow({
  record,
}: {
  record: {
    id: number;
    kind: string;
    title: string;
    status: string | null;
    filedAt: Date | null;
    statusAt: Date | null;
    url: string;
    agency: string;
    jobKey: string | null;
    jobSize: number;
  };
}) {
  const when = fmtDay(record.statusAt ?? record.filedAt);
  return (
    <li className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{KIND_LABELS[record.kind] ?? record.kind}</Badge>
        <StatusBadge status={record.status} />
        {when && <span className="text-xs text-muted-foreground">{when}</span>}
        <a
          href={record.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {record.agency}
          <ExternalLinkIcon className="size-3" aria-hidden />
        </a>
      </div>
      <Link
        to="/filings/$id"
        params={{ id: String(record.id) }}
        className="text-sm leading-snug hover:underline"
      >
        {record.title}
      </Link>
      {record.jobKey && record.jobSize > 1 && (
        <Link
          to="/filings/job/$key"
          params={{ key: record.jobKey }}
          className="text-xs text-muted-foreground hover:underline"
        >
          Part of a {record.jobSize}-ticket job
        </Link>
      )}
    </li>
  );
}

/**
 * The section itself. `watch` adds the "Watch filings" toggle for entities a
 * watch can scope to (rides, restaurants, shops — not parks, which the alerts
 * page already offers).
 */
export function PaperTrail({
  entityKind,
  entityId,
  entityName,
  parkId,
  className,
  watch = true,
}: {
  entityKind: TrailEntityKind;
  entityId: string | number;
  entityName: string;
  /** Lets "See all" open the feed pre-filtered to the park. */
  parkId?: number | null;
  className?: string;
  watch?: boolean;
}) {
  const q = usePaperTrail(entityKind, entityId);
  if (q.isPending) return <Skeleton className={cn("h-24 w-full rounded-2xl", className)} />;
  const data = q.data;
  if (!data || data.total === 0) return null;

  const canWatch = watch && entityKind !== "park";
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <FileTextIcon className="size-4 text-muted-foreground" aria-hidden />
          Paper trail
        </h2>
        <span className="text-sm text-muted-foreground">
          {data.total} public record{data.total === 1 ? "" : "s"}
          {data.activePermits > 0 &&
            ` · ${data.activePermits} open permit${data.activePermits === 1 ? "" : "s"}`}
          {data.cranes > 0 && ` · ${data.cranes} FAA determination${data.cranes === 1 ? "" : "s"}`}
        </span>
        {canWatch && (
          <WatchFilingsButton
            entityKind={entityKind}
            entityId={String(entityId)}
            entityName={entityName}
            className="ml-auto"
          />
        )}
      </div>
      <KindMix byKind={data.byKind} days={365} />
      <ul className="divide-y rounded-2xl border bg-card px-4 py-3 text-card-foreground">
        {data.items.map((r) => (
          <TrailRow key={r.id} record={r} />
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Records as filed with the agency named on each row; a permit is a request, not an
        announcement.{" "}
        {data.total > data.items.length && (
          <Link
            to="/filings"
            search={parkId ? { park: parkId, days: "all" } : { days: "all" }}
            className="text-primary hover:underline"
          >
            See all {parkId ? "park " : ""}filings
          </Link>
        )}
      </p>
    </section>
  );
}
