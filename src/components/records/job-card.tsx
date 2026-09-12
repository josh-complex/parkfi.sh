import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";

import {
  EntityChips,
  KIND_LABELS,
  RecordCard,
  StatusBadge,
  fmtDay,
  type CardLink,
  type RecordCardData,
} from "#/components/records/record-card.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#/components/ui/collapsible.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

/**
 * One JOB in the `/filings` feed (plan §6.1a): the trade permits of a project,
 * the classes of a mark, the crane studies of a site — rolled up into one card
 * with its trade mix, status roll-up and date span. A single-ticket job renders
 * as the plain record card, so the feed reads uniformly.
 */

/** City of Orlando permit families (the prefix of the permit number). */
export const FAMILY_LABELS: Record<string, string> = {
  BLD: "Building",
  ELE: "Electrical",
  MEC: "Mechanical",
  PLM: "Plumbing",
  FIR: "Fire",
  ENG: "Engineering",
  DEM: "Demolition",
  GAS: "Gas",
  SBF: "Sewer fees",
  FLO: "Floodplain",
  ABL: "Alcohol license",
  TIF: "Impact fees",
  CNC: "Concurrency",
};

export function familyLabel(family: string): string {
  return FAMILY_LABELS[family] ?? KIND_LABELS[family] ?? family;
}

export interface JobCardData {
  jobKey: string;
  title: string;
  source: string;
  agency: string;
  kind: string;
  operator: string | null;
  resortSlug: string | null;
  park: { id: number; slug: string; name: string } | null;
  address: string | null;
  filer: string | null;
  ticketCount: number;
  /** Permit family (BLD/ELE/…) or kind → count. */
  families: Record<string, number>;
  /** open / issued / closed / unknown → count. */
  statuses: Record<string, number>;
  firstFiledAt: Date;
  latestAt: Date;
  maxScore: number;
  routine: boolean;
  topIds: number[];
  links: CardLink[];
  /** The highest-scoring ticket, presented as a record card. */
  lead: RecordCardData | null;
}

/** "BLD 2 · ELE 3 · MEC 1", biggest family first, capped so a card stays one line. */
export function FamilyMix({
  families,
  max = 5,
  className,
}: {
  families: Record<string, number>;
  max?: number;
  className?: string;
}) {
  const entries = Object.entries(families).sort((a, b) => b[1] - a[1]);
  const shown = entries.slice(0, max);
  const rest = entries.length - shown.length;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {shown.map(([f, n]) => (
        <span
          key={f}
          title={familyLabel(f)}
          className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground/80"
        >
          {FAMILY_LABELS[f] ? f : familyLabel(f)}
          {n > 1 && <span className="ml-1 opacity-70">{n}</span>}
        </span>
      ))}
      {rest > 0 && <span className="text-[11px] text-muted-foreground">+{rest}</span>}
    </span>
  );
}

/** "7 open · 3 closed" — only the buckets that are non-zero. */
export function StatusRollup({ statuses }: { statuses: Record<string, number> }) {
  const parts = (["open", "issued", "closed"] as const)
    .filter((k) => (statuses[k] ?? 0) > 0)
    .map((k) => `${statuses[k]} ${k}`);
  if (parts.length === 0) return null;
  const open = statuses.open ?? 0;
  return (
    <Badge variant={open > 0 ? "secondary" : "outline"} className="font-normal">
      {parts.join(" · ")}
    </Badge>
  );
}

const MONTH_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "America/New_York",
});

/** "Jun 2025 → Sep 2026 · 15 months" (or a single month for a one-month job). */
export function spanLabel(first: Date, latest: Date): string {
  const a = MONTH_FMT.format(first);
  const b = MONTH_FMT.format(latest);
  const months = Math.max(
    0,
    (latest.getUTCFullYear() - first.getUTCFullYear()) * 12 +
      (latest.getUTCMonth() - first.getUTCMonth()),
  );
  if (a === b) return a;
  return `${a} → ${b} · ${months} month${months === 1 ? "" : "s"}`;
}

/** Thin bar with the first-filed and latest-activity ends, so a long-running job reads as one. */
function SpanStrip({ first, latest }: { first: Date; latest: Date }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span className="shrink-0">Filed {fmtDay(first)}</span>
      <span className="relative h-px flex-1 bg-border">
        <span className="absolute top-1/2 left-0 size-1.5 -translate-y-1/2 rounded-full bg-muted-foreground/60" />
        <span className="absolute top-1/2 right-0 size-1.5 -translate-y-1/2 rounded-full bg-primary" />
      </span>
      <span className="shrink-0">Latest {fmtDay(latest)}</span>
    </div>
  );
}

/** The tickets of one job, loaded on expand (edge-cached, so cheap to open twice). */
function JobTickets({ jobKey }: { jobKey: string }) {
  const trpc = useTRPC();
  const q = useQuery(trpc.records.job.queryOptions({ jobKey }));
  if (q.isPending) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (q.isError || !q.data) {
    return <p className="text-xs text-destructive">Couldn’t load the tickets.</p>;
  }
  return (
    <ol className="divide-y rounded-xl border">
      {q.data.tickets.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
          <span className="font-mono text-[11px] text-muted-foreground">{t.externalId}</span>
          <Link
            to="/filings/$id"
            params={{ id: String(t.id) }}
            className="min-w-0 flex-1 truncate hover:underline"
          >
            {t.title}
          </Link>
          <StatusBadge status={t.status} />
          <span className="text-xs text-muted-foreground">{fmtDay(t.activityAt)}</span>
        </li>
      ))}
    </ol>
  );
}

export function JobCard({ job }: { job: JobCardData }) {
  const [open, setOpen] = React.useState(false);
  if (job.ticketCount <= 1 && job.lead) return <RecordCard record={job.lead} />;

  return (
    <article className="rounded-2xl border bg-card p-4 text-card-foreground">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{KIND_LABELS[job.kind] ?? job.kind}</Badge>
        <StatusRollup statuses={job.statuses} />
        <span className="ml-auto text-xs text-muted-foreground">{job.agency}</span>
      </div>
      <h3 className="mt-2 font-rounded text-base font-semibold leading-snug">
        <Link to="/filings/job/$key" params={{ key: job.jobKey }} className="hover:underline">
          {job.title}
        </Link>
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {job.filer && <span>Filed by {job.filer}</span>}
        {job.filer && job.address && <span> · </span>}
        {job.address && <span>{job.address}</span>}
      </p>
      <FamilyMix families={job.families} className="mt-2" />
      <div className="mt-3">
        <SpanStrip first={job.firstFiledAt} latest={job.latestAt} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <EntityChips links={job.links} />
        {job.lead && (
          <a
            href={job.lead.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View on {job.agency}
            <ExternalLinkIcon className="size-3" aria-hidden />
          </a>
        )}
      </div>
      <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
        <CollapsibleTrigger className="inline-flex items-center gap-1 text-xs font-medium text-foreground/80 hover:text-foreground">
          <ChevronDownIcon
            className={cn("size-3.5 transition-transform", open && "rotate-180")}
            aria-hidden
          />
          {job.ticketCount} tickets
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          {open && <JobTickets jobKey={job.jobKey} />}
        </CollapsibleContent>
      </Collapsible>
    </article>
  );
}
