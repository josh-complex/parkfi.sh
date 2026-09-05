import { Link } from "@tanstack/react-router";
import { ExternalLinkIcon } from "lucide-react";

import { Badge } from "#/components/ui/badge.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * Presentation for one `public_record` — shared by the `/filings` feed and
 * the detail page. Copy follows the plan's editorial rule (§9): a filing is
 * "filed" / "seeks", never "announced"; every card carries the government
 * link so the reader can check the source.
 */

export const KIND_LABELS: Record<string, string> = {
  permit: "Permit",
  noc: "Notice of commencement",
  deed: "Deed",
  airspace: "FAA filing",
  erp: "Environmental permit",
  planning_case: "Planning case",
  board_item: "Board item",
  trademark: "Trademark",
  patent_app: "Patent application",
  patent_grant: "Patent",
  assignment: "IP assignment",
  lawsuit: "Lawsuit",
  sec_filing: "SEC filing",
  corp_filing: "Corporate filing",
  incident: "Incident report",
  license: "License",
  tls_cert: "TLS certificate",
};

export const RESORT_LABELS: Record<string, string> = {
  "walt-disney-world": "Walt Disney World",
  "universal-orlando": "Universal Orlando",
};

/** Every date on a filing is an agency-local calendar day; render it as one. */
const DAY_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "America/New_York",
});
const DAY_LONG_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "America/New_York",
});

export function fmtDay(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? null : DAY_FMT.format(date);
}

export function fmtDayLong(d: Date | string): string {
  return DAY_LONG_FMT.format(typeof d === "string" ? new Date(d) : d);
}

/** `YYYY-MM-DD` in the agency zone — the feed's day-group key. */
export function dayKey(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/New_York",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const variant = /issued|approved|registered|granted|active/.test(s)
    ? "default"
    : /final|closed|complete|expired|abandoned|void|denied/.test(s)
      ? "outline"
      : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

export interface CardLink {
  entityKind: string;
  entityId: string;
  label: string;
  parkSlug: string | null;
  slug: string | null;
  confidence: number;
}

/** Chips to the ride / park / resort pages a record is linked to. */
export function EntityChips({ links, className }: { links: CardLink[]; className?: string }) {
  const visible = links.filter((l) => l.slug);
  if (visible.length === 0) return null;
  const chip =
    "inline-flex items-center rounded-full border bg-background px-2 py-0.5 text-xs text-foreground/90 hover:bg-accent";
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {visible.map((l) => {
        const key = `${l.entityKind}:${l.entityId}`;
        if (l.entityKind === "attraction" && l.parkSlug && l.slug) {
          return (
            <Link
              key={key}
              to="/park/$slug/ride/$rideSlug"
              params={{ slug: l.parkSlug, rideSlug: l.slug }}
              className={chip}
            >
              {l.label}
            </Link>
          );
        }
        if (l.entityKind === "park" && l.slug) {
          return (
            <Link key={key} to="/park/$slug" params={{ slug: l.slug }} className={chip}>
              {l.label}
            </Link>
          );
        }
        if (l.entityKind === "resort" && l.slug) {
          return (
            <Link key={key} to="/resort/$slug" params={{ slug: l.slug }} className={chip}>
              {l.label}
            </Link>
          );
        }
        return null;
      })}
    </div>
  );
}

export interface RecordCardData {
  id: number;
  kind: string;
  title: string;
  description: string | null;
  filer: string | null;
  status: string | null;
  statusAt: Date | null;
  filedAt: Date | null;
  address: string | null;
  url: string;
  agency: string;
  links: CardLink[];
}

export function RecordCard({ record }: { record: RecordCardData }) {
  const filed = fmtDay(record.filedAt);
  const statusAt = fmtDay(record.statusAt);
  return (
    <article className="rounded-2xl border bg-card p-4 text-card-foreground">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{KIND_LABELS[record.kind] ?? record.kind}</Badge>
        <StatusBadge status={record.status} />
        <span className="ml-auto text-xs text-muted-foreground">{record.agency}</span>
      </div>
      <h3 className="mt-2 font-rounded text-base font-semibold leading-snug">
        <Link to="/filings/$id" params={{ id: String(record.id) }} className="hover:underline">
          {record.title}
        </Link>
      </h3>
      {record.description && (
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{record.description}</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {record.filer && <span>Filed by {record.filer}</span>}
        {record.filer && filed && <span> · </span>}
        {filed && <span>Filed {filed}</span>}
        {statusAt && statusAt !== filed && record.status && (
          <span>
            {" "}
            · {record.status} {statusAt}
          </span>
        )}
        {record.address && <span> · {record.address}</span>}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <EntityChips links={record.links} />
        <a
          href={record.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          View on {record.agency}
          <ExternalLinkIcon className="size-3" aria-hidden />
        </a>
      </div>
    </article>
  );
}
