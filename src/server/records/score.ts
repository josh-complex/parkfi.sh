/**
 * Newsworthiness scoring (plan §4.4). Comparable WITHIN a kind, like
 * `report_event.score`: the feed sorts by recency, the blog detector and the
 * admin triage sort by score, and the thresholds are env knobs tuned from the
 * per-run score distribution the cron logs.
 *
 * Pure functions — every input is on the normalized record or its links.
 */
import type { LinkResult } from "./link.ts";
import type { PublicRecordInput } from "./types.ts";

export interface ScoreContext {
  /** The filer matched an operator alias (vs. a tenant / contractor). */
  operatorFiler: boolean;
  links: LinkResult;
  /** Set when this is a re-observation whose status changed. */
  statusTransition?: { from: string | null; to: string | null } | null;
}

/** Work types that are maintenance noise, never a story. Matched on `payload.worktype`. */
const LOW_VALUE_WORKTYPES =
  /fence|sign|temp|asbuilt|as-built|repair|reroof|re-roof|demo|pool|irrigation/i;
/** Annual blanket permits ("ANNUAL FACILITY PERMIT …") re-file every year. */
const ANNUAL_RE = /\bannual\b/i;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Permits (Orlando SODA, CFTOD ACA, Fast Track, Anaheim). Big new construction
 * on operator land with a named project scores highest; blanket, fence, sign
 * and repair permits sink to the floor.
 */
export function scorePermit(input: PublicRecordInput, ctx: ScoreContext): number {
  const p = input.payload;
  let score = 10;

  if (ctx.operatorFiler) score += 30;
  if (ctx.links.polygonParkId != null) score += 20;
  else if (ctx.links.parkId != null) score += 8;
  if (ctx.links.links.some((l) => l.entityKind === "attraction")) score += 25;

  const applicationType = str(p.applicationType);
  if (/building/i.test(applicationType)) score += 15;
  else if (/engineering|site|civil/i.test(applicationType)) score += 10;
  else if (/electrical|plumbing|mechanical|gas|fire/i.test(applicationType)) score -= 5;

  if (typeof p.projectName === "string" && p.projectName.trim().length > 0) score += 10;

  const cost = typeof p.estimatedCost === "number" ? p.estimatedCost : 0;
  if (cost > 0) score += Math.min(30, Math.log10(cost + 1) * 5);
  const sqft = typeof p.squareFootage === "number" ? p.squareFootage : 0;
  if (sqft > 1000) score += Math.min(15, Math.log10(sqft) * 3);

  // "It can open now" moments — a CO on operator land is the end of a timeline.
  if (p.cooDate || p.tempCooDate) score += 20;

  if (ctx.statusTransition && ctx.statusTransition.to !== ctx.statusTransition.from) {
    const to = str(ctx.statusTransition.to);
    if (/issued/i.test(to)) score += 10;
    if (/finaled|closed|complete/i.test(to)) score += 5;
  }

  const worktype = str(p.worktype);
  if (LOW_VALUE_WORKTYPES.test(worktype)) score *= 0.3;
  if (ANNUAL_RE.test(input.title) || ANNUAL_RE.test(str(p.projectName))) score *= 0.2;

  return Math.round(score * 10) / 10;
}

/** Dispatch by kind. Kinds without a formula yet get a flat baseline. */
export function scoreRecord(input: PublicRecordInput, ctx: ScoreContext): number {
  switch (input.kind) {
    case "permit":
      return scorePermit(input, ctx);
    default:
      return ctx.operatorFiler ? 40 : 10;
  }
}
