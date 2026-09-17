import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, ExternalLinkIcon, FileTextIcon, TriangleAlertIcon } from "lucide-react";

import { KIND_LABELS, fmtDay } from "#/components/records/record-card.tsx";
import { WatchFilingsButton } from "#/components/records/watch-filings-button.tsx";
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

/** "last year: 2 environmental permits" — folded into the header's one meta
 *  line rather than taking a paragraph of its own. */
function kindMix(byKind: Array<{ kind: string; n: number }>, days: number): string | null {
  if (byKind.length === 0) return null;
  const mix = byKind
    .map((k) => `${k.n} ${(KIND_LABELS[k.kind] ?? k.kind).toLowerCase()}${k.n === 1 ? "" : "s"}`)
    .join(" · ");
  return `last ${days === 365 ? "year" : `${days} days`}: ${mix}`;
}

/**
 * The colour a record's status is read in, and the dot it gets on the spine.
 *
 * Precedence matters and mirrors `StatusBadge`: "Pending-Expired" names both
 * states and the second is the one that happened, so anything matching the
 * closed set is closed however it starts. Live things are mint, dead things are
 * grey, and the genuinely-still-open middle is the wait palette's amber — the
 * same three readings the rest of the app uses.
 */
function statusTone(status: string | null): { dot: string; text: string } {
  const s = (status ?? "").toLowerCase();
  if (/final|closed|complete|expired|abandoned|void|denied|withdrawn/.test(s)) {
    return { dot: "bg-muted-foreground/35", text: "text-muted-foreground" };
  }
  if (/issued|approved|registered|granted|active/.test(s)) {
    return { dot: "bg-mint-label", text: "text-mint-fg" };
  }
  return { dot: "bg-wait-warm", text: "text-wait-warm" };
}

function TrailRow({
  record,
  last,
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
  /** No spine below the final entry. */
  last: boolean;
}) {
  const when = fmtDay(record.statusAt ?? record.filedAt);
  const tone = statusTone(record.status);
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {/* The spine. These are dated filings on one site over several years, so
          a timeline is what they actually are — and it buys back the width the
          old layout spent on a "Environmental permit" badge repeated down every
          row. The kind moved to the meta line, where saying it six times costs
          nothing. */}
      <span aria-hidden className="relative flex w-2.5 shrink-0 justify-center">
        <span className={cn("absolute top-1 size-2.5 rounded-full", tone.dot)} />
        {!last && <span className="absolute top-4.5 bottom-0 w-px bg-card-edge" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {when && (
            <span className="text-[11.5px] font-bold tracking-[0.04em] text-muted-foreground uppercase tabular-nums">
              {when}
            </span>
          )}
          {record.status && (
            <span className={cn("text-[11.5px] font-bold", tone.text)}>{record.status}</span>
          )}
        </div>
        <Link
          to="/filings/$id"
          params={{ id: String(record.id) }}
          className="text-[13.5px] leading-snug font-bold text-balance hover:underline"
        >
          {record.title}
        </Link>
        <div className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted-foreground">
          <span>{KIND_LABELS[record.kind] ?? record.kind}</span>
          <span aria-hidden>·</span>
          <a
            href={record.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1 font-semibold text-wash-fg hover:underline"
          >
            {record.agency}
            <ExternalLinkIcon className="size-3" aria-hidden />
          </a>
          {record.jobKey && record.jobSize > 1 && (
            <>
              <span aria-hidden>·</span>
              <Link
                to="/filings/job/$key"
                params={{ key: record.jobKey }}
                className="hover:underline"
              >
                part of a {record.jobSize}-ticket job
              </Link>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * FDACS incidents, as a count only (plan §9): the state's report names the
 * ride, the day and the guest's age and sex; we surface none of that per
 * incident — a total, the span, and the Department's own caveat.
 */
function IncidentSummary({
  incidents,
}: {
  incidents: {
    count: number;
    firstOn: string | null;
    lastOn: string | null;
    reportUpdatedOn: string | null;
    years: number;
  };
}) {
  const year = (d: string | null) => (d ? d.slice(0, 4) : null);
  const span =
    year(incidents.firstOn) &&
    year(incidents.lastOn) &&
    year(incidents.firstOn) !== year(incidents.lastOn)
      ? `${year(incidents.firstOn)}–${year(incidents.lastOn)}`
      : (year(incidents.lastOn) ?? "");
  return (
    // Peach, and inside the card rather than beside it: it is a caution about
    // the same place the filings describe, not a second subject. The copy is
    // unchanged — §9 of the records plan fixes exactly what this may claim.
    <div className="flex gap-3 rounded-2xl border border-peach-edge bg-peach p-3.5">
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-peach-fg" aria-hidden />
      <div className="min-w-0">
        <p className="text-[13px] leading-snug">
          <span className="font-bold text-peach-fg">
            {incidents.count} reported incident{incidents.count === 1 ? "" : "s"}
          </span>{" "}
          <span className="text-peach-sub">
            in the last {incidents.years} years{span ? ` (${span})` : ""}, per the operator's
            quarterly reports to the Florida Department of Agriculture and Consumer Services
          </span>
        </p>
        <p className="mt-1.5 text-[11.5px] leading-snug text-peach-sub">
          Covers guests taken to a hospital for at least 24 hours. The state records only what was
          reported at the time and receives no follow-up on a guest's condition; a report says
          nothing about cause.
          {incidents.reportUpdatedOn
            ? ` Report last updated ${fmtDay(incidents.reportUpdatedOn)}.`
            : ""}
        </p>
      </div>
    </div>
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
  // `!q.data` rather than `isPending`, so the box is held from the very first
  // render — see the same note in `ParkAnalytics`.
  if (!q.data) {
    return <Skeleton className={cn("h-[420px] w-full rounded-[22px]", className)} />;
  }
  const data = q.data;
  if (data.total === 0 && !data.incidents) return null;

  const canWatch = watch && entityKind !== "park";
  const hasMore = data.total > data.items.length;
  const mix = kindMix(data.byKind, 365);
  const allFilings = (
    <Link
      to="/filings"
      search={parkId ? { park: parkId, days: "all" } : { days: "all" }}
      className="group flex shrink-0 items-center gap-1 text-xs font-bold text-wash-fg hover:underline"
    >
      All filings
      <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );

  return (
    // A card, like everything either side of it (2026-09-16, Josh). This used
    // to be a bare heading over one bordered list over another bordered box
    // over a footnote — four stacked objects that read as a section of the page
    // rather than as one more card in a column of them.
    <section
      className={cn(
        "flex flex-col gap-3.5 rounded-[22px] border border-card-edge bg-card p-4 md:p-5",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex min-w-0 items-center gap-2 text-[19px] font-extrabold tracking-[-0.01em]">
            <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            Paper trail
          </h2>
          {canWatch ? (
            <WatchFilingsButton
              entityKind={entityKind}
              entityId={String(entityId)}
              entityName={entityName}
              className="shrink-0"
            />
          ) : (
            hasMore && allFilings
          )}
        </div>
        {/* One meta line, not two: the totals and the year's mix were a
            sentence apart saying the same kind of thing. */}
        <p className="text-xs text-muted-foreground">
          {data.total} public record{data.total === 1 ? "" : "s"}
          {data.activePermits > 0 &&
            ` · ${data.activePermits} open permit${data.activePermits === 1 ? "" : "s"}`}
          {data.cranes > 0 && ` · ${data.cranes} FAA determination${data.cranes === 1 ? "" : "s"}`}
          {mix && ` · ${mix}`}
        </p>
      </div>

      {data.items.length > 0 && (
        <ol className="flex flex-col">
          {data.items.map((r, i) => (
            <TrailRow key={r.id} record={r} last={i === data.items.length - 1} />
          ))}
        </ol>
      )}

      {data.incidents && <IncidentSummary incidents={data.incidents} />}

      <p className="text-[11.5px] leading-snug text-muted-foreground">
        {data.total > 0 &&
          "Records as filed with the agency named on each row; a permit is a request, not an announcement."}
        {canWatch && hasMore && (
          <>
            {" "}
            <Link
              to="/filings"
              search={parkId ? { park: parkId, days: "all" } : { days: "all" }}
              className="font-semibold text-wash-fg hover:underline"
            >
              See all {parkId ? "park " : ""}filings
            </Link>
          </>
        )}
      </p>
    </section>
  );
}
