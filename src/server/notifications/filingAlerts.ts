/**
 * Filing-watch evaluation (public-records plan §6.3). Runs at the end of each
 * public-records cron sweep: every record the run touched is matched against
 * every active watch, and each new (watch, record) pair becomes one durable
 * `public_record_notification` row plus a `filing-alerts` job.
 *
 * Two properties matter here and both are structural, not incidental:
 *
 *  - **Exactly once per pair.** `public_record_watch_fire` is the edge-trigger
 *    ledger: matches are inserted ON CONFLICT DO NOTHING and only the rows the
 *    insert actually created are delivered. A revised permit, an adapter
 *    re-draining an overlapping cursor, or a second run of the cron therefore
 *    can't re-notify — no cooldown heuristic required (the stay/dining alerts
 *    need one because their trigger is a *state*, not a document). The claim
 *    and the notification row commit in one transaction per watch, so a fire
 *    can never exist without the row that says what it was owed.
 *  - **A run's matches are one message.** The cron is daily, so per-watch
 *    grouping is the digest §6.3 asks for; push and email carry the same
 *    grouped payload rather than N notifications for one sweep.
 *
 * `matchesWatch` is a pure function over a record + watch so the rules unit-test
 * without a database; `evaluateFilingWatches` is the DB/queue shell around it.
 * Mirrors stayAlerts.ts / diningAlerts.ts.
 */
import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { publicRecordNotification } from "#/db/schema.ts";
import { getFilingAlertQueue } from "#/server/notifications/queue.ts";
import {
  filingSubject,
  type FilingNotificationPayload,
  type FilingNotificationRecord,
} from "#/server/notifications/filingFormat.ts";

/** An active watch, with the user's domain-wide email opt-out resolved. */
export interface FilingWatchRow {
  id: number;
  userId: string;
  resortSlug: string | null;
  parkId: number | null;
  entityKind: string | null;
  entityId: string | null;
  /** Display name of the scoped entity (attraction / venue), resolved at load. */
  entityName?: string | null;
  kinds: string[];
  keywords: string[];
  /** 'push' | 'email' | 'both' */
  channel: string;
  emailOptOut: boolean;
}

/** A record from the run window, with its entity links flattened to `kind:id`. */
export interface FilingCandidate {
  id: number;
  source: string;
  kind: string;
  resortSlug: string | null;
  parkId: number | null;
  parkName: string | null;
  filer: string | null;
  title: string;
  description: string | null;
  status: string | null;
  url: string;
  filedOn: string | null;
  score: number;
  /** `park:5`, `resort:universal-orlando`, `attraction:1234`, … */
  links: string[];
}

/** Records carried in one notification; the rest are summarized as a count. */
const MAX_RECORDS_PER_NOTIFICATION = 10;

/**
 * Does this record fall inside the watch's scope? The three scope fields narrow
 * cumulatively (a watch on a park inside a resort must satisfy both), and a
 * watch with no scope at all is a firehose the user asked for.
 *
 * Park scope accepts either the record's own `park_id` or a `park:` entity link,
 * because the two are populated by different passes (polygon vs. lexicon).
 */
function inScope(w: FilingWatchRow, r: FilingCandidate): boolean {
  if (w.resortSlug && r.resortSlug !== w.resortSlug) return false;
  if (w.parkId != null && r.parkId !== w.parkId && !r.links.includes(`park:${w.parkId}`)) {
    return false;
  }
  if (w.entityKind && w.entityId && !r.links.includes(`${w.entityKind}:${w.entityId}`)) {
    return false;
  }
  return true;
}

/** Case-insensitive substring over the as-filed text a user would search. */
function matchesKeywords(keywords: string[], r: FilingCandidate): boolean {
  if (keywords.length === 0) return true;
  const haystack = `${r.title}\n${r.description ?? ""}\n${r.filer ?? ""}`.toLowerCase();
  return keywords.some((k) => {
    const needle = k.trim().toLowerCase();
    return needle.length > 0 && haystack.includes(needle);
  });
}

/** Pure rule: scope AND kind AND keyword. Empty kinds/keywords mean "any". */
export function matchesWatch(w: FilingWatchRow, r: FilingCandidate): boolean {
  if (!inScope(w, r)) return false;
  if (w.kinds.length > 0 && !w.kinds.includes(r.kind)) return false;
  return matchesKeywords(w.keywords, r);
}

/** What the subject line calls this watch. Most specific scope wins. */
export function watchLabel(w: FilingWatchRow, sample: FilingCandidate | undefined): string {
  if (w.keywords.length > 0) return `“${w.keywords[0]}” filings`;
  if (w.entityKind && w.entityId) {
    if (w.entityName) return w.entityName;
    if (w.entityKind === "park" && sample?.parkName) return sample.parkName;
    return `${w.entityKind} ${w.entityId}`;
  }
  if (w.parkId != null && sample?.parkName) return sample.parkName;
  if (w.resortSlug) return RESORT_NAMES[w.resortSlug] ?? w.resortSlug;
  return "your filing watch";
}

const RESORT_NAMES: Record<string, string> = {
  "walt-disney-world": "Walt Disney World",
  "universal-orlando": "Universal Orlando",
};

/** The channels a watch should actually be delivered on, after opt-outs. */
export function effectiveChannel(w: FilingWatchRow): "push" | "email" | "both" | null {
  const wantsPush = w.channel === "push" || w.channel === "both";
  const wantsEmail = (w.channel === "email" || w.channel === "both") && !w.emailOptOut;
  if (wantsPush && wantsEmail) return "both";
  if (wantsPush) return "push";
  if (wantsEmail) return "email";
  return null;
}

function toNotificationRecord(r: FilingCandidate): FilingNotificationRecord {
  return {
    id: r.id,
    source: r.source,
    kind: r.kind,
    title: r.title,
    filer: r.filer,
    status: r.status,
    url: r.url,
    park: r.parkName,
    filedOn: r.filedOn,
  };
}

async function loadWatches(): Promise<FilingWatchRow[]> {
  const { rows } = await db.execute<{
    id: string;
    user_id: string;
    resort_slug: string | null;
    park_id: string | null;
    entity_kind: string | null;
    entity_id: string | null;
    entity_name: string | null;
    kinds: string[] | null;
    keywords: string[] | null;
    channel: string;
    email_opt_out: boolean | null;
  }>(sql`
    SELECT w.id, w.user_id, w.resort_slug, w.park_id, w.entity_kind, w.entity_id,
           w.kinds, w.keywords, w.channel,
           coalesce(ao.filing_email_opt_out, false) AS email_opt_out,
           -- The scoped entity's name for the subject line, per kind.
           CASE w.entity_kind
             WHEN 'attraction' THEN (SELECT a.name FROM attractions a WHERE a.id::text = w.entity_id)
             WHEN 'park' THEN (SELECT p.name FROM parks p WHERE p.id::text = w.entity_id)
             WHEN 'facility' THEN (SELECT r.name FROM restaurant_dim r WHERE r.facility_id = w.entity_id)
             WHEN 'shop' THEN (SELECT s.name FROM shop_dim s WHERE s.facility_id = w.entity_id)
             ELSE NULL
           END AS entity_name
    FROM public_record_watch w
    LEFT JOIN alert_optout ao ON ao.user_id = w.user_id
    WHERE w.active = true
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    userId: r.user_id,
    resortSlug: r.resort_slug,
    parkId: r.park_id == null ? null : Number(r.park_id),
    entityKind: r.entity_kind,
    entityId: r.entity_id,
    entityName: r.entity_name,
    kinds: r.kinds ?? [],
    keywords: r.keywords ?? [],
    channel: r.channel,
    emailOptOut: r.email_opt_out ?? false,
  }));
}

/** Records the sweep created or revised, newest first, with their entity links. */
async function loadCandidates(since: Date, minScore: number): Promise<FilingCandidate[]> {
  const { rows } = await db.execute<{
    id: string;
    source: string;
    kind: string;
    resort_slug: string | null;
    park_id: string | null;
    park_name: string | null;
    filer: string | null;
    title: string;
    description: string | null;
    status: string | null;
    url: string;
    filed_on: string | null;
    score: number;
    links: string[] | null;
  }>(sql`
    SELECT r.id, r.source, r.kind, r.resort_slug, r.park_id, p.name AS park_name,
           r.filer, r.title, r.description, r.status, r.url, r.score,
           to_char(r.filed_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS filed_on,
           coalesce(l.links, ARRAY[]::text[]) AS links
    FROM public_record r
    LEFT JOIN parks p ON p.id = r.park_id
    LEFT JOIN LATERAL (
      SELECT array_agg(pl.entity_kind || ':' || pl.entity_id) AS links
      FROM public_record_link pl WHERE pl.record_id = r.id
    ) l ON true
    WHERE r.suppressed = false
      AND r.score >= ${minScore}
      AND coalesce(r.changed_at, r.first_seen_at) >= ${since}
    ORDER BY r.score DESC, r.id DESC
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    source: r.source,
    kind: r.kind,
    resortSlug: r.resort_slug,
    parkId: r.park_id == null ? null : Number(r.park_id),
    parkName: r.park_name,
    filer: r.filer,
    title: r.title,
    description: r.description,
    status: r.status,
    url: r.url,
    filedOn: r.filed_on,
    score: Number(r.score),
    links: r.links ?? [],
  }));
}

/**
 * Claim one watch's (watch, record) pairs in the fire ledger and write its
 * `public_record_notification` row in the SAME transaction. Returns the records
 * that were actually new plus the row id, or `null` when every pair had already
 * fired (the empty transaction commits nothing).
 *
 * The two writes must commit together: a fire without a notification row is a
 * record the user is never told about, and a notification row without its fires
 * would re-notify next sweep. Either write failing rolls both back, so the
 * records simply stay eligible for the next run.
 */
async function claimAndLog(
  watch: FilingWatchRow,
  channel: "push" | "email" | "both",
  records: FilingCandidate[],
): Promise<{ notificationId: number; fresh: FilingCandidate[] } | null> {
  return db.transaction(async (tx) => {
    const recordIds = records.map((r) => r.id);
    const { rows } = await tx.execute<{ record_id: string }>(sql`
      INSERT INTO public_record_watch_fire (watch_id, record_id)
      SELECT ${watch.id}::bigint, r FROM unnest(${recordIds}::bigint[]) AS t(r)
      ON CONFLICT DO NOTHING
      RETURNING record_id
    `);
    if (rows.length === 0) return null;

    const claimed = new Set(rows.map((r) => Number(r.record_id)));
    const fresh = records.filter((r) => claimed.has(r.id));
    const carried = fresh.slice(0, MAX_RECORDS_PER_NOTIFICATION);
    const base = {
      watchLabel: watchLabel(watch, fresh[0]),
      count: fresh.length,
      records: carried.map(toNotificationRecord),
      moreCount: fresh.length - carried.length,
    };
    const payload: FilingNotificationPayload = { ...base, subject: filingSubject(base) };

    const [row] = await tx
      .insert(publicRecordNotification)
      .values({ watchId: watch.id, userId: watch.userId, channel, payload, status: "queued" })
      .returning({ id: publicRecordNotification.id });
    if (!row) throw new Error("public_record_notification insert returned no row");
    return { notificationId: row.id, fresh };
  });
}

export interface FilingAlertRunStats {
  watches: number;
  candidates: number;
  newPairs: number;
  notifications: number;
}

/**
 * Evaluate every active watch against the records touched since `since` and
 * enqueue one grouped notification per watch that matched something new.
 *
 * Returns without writing anything when Redis is unconfigured: BullMQ's
 * `queue.add()` neither throws nor resolves without a connection, so claiming
 * fires first would silently burn the edge trigger and the user would never
 * hear about those records again (see the `bullmq-hangs-without-redis` lesson).
 */
export async function evaluateFilingWatches(opts: {
  since: Date;
  minScore?: number;
}): Promise<FilingAlertRunStats> {
  const stats: FilingAlertRunStats = {
    watches: 0,
    candidates: 0,
    newPairs: 0,
    notifications: 0,
  };
  if (!process.env.REDIS_URL) {
    console.warn("[filing-alerts] REDIS_URL unset — skipping evaluation (nothing consumed)");
    return stats;
  }

  const watches = await loadWatches();
  stats.watches = watches.length;
  if (watches.length === 0) return stats;

  const candidates = await loadCandidates(opts.since, opts.minScore ?? 0);
  stats.candidates = candidates.length;
  if (candidates.length === 0) return stats;

  const fired: number[] = [];
  for (const watch of watches) {
    const channel = effectiveChannel(watch);
    if (channel === null) continue;
    const records = candidates.filter((r) => matchesWatch(watch, r));
    if (records.length === 0) continue;

    // Claim + durable log commit together (status queued); only THEN enqueue,
    // carrying the row id. A queue failure here leaves a committed `queued` row
    // to reconcile — never a claimed fire with no record that it was owed.
    const result = await claimAndLog(watch, channel, records);
    if (!result) continue;
    stats.newPairs += result.fresh.length;
    await getFilingAlertQueue().add("filing-alert", { notificationId: result.notificationId });
    fired.push(watch.id);
    stats.notifications++;
  }

  if (fired.length > 0) {
    await db.execute(sql`
      UPDATE public_record_watch SET last_fired_at = now()
      WHERE id = ANY(${fired}::bigint[])
    `);
  }
  return stats;
}
