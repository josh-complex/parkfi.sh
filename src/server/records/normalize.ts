/**
 * Pure helpers shared by every adapter and the ingest loop: filer-name
 * normalization (the alias join key), content hashing (drives revisions),
 * payload diffing, and LIKE-pattern alias matching. No I/O — all unit-tested.
 */
import { createHash } from "node:crypto";

import type { FilerAlias, PublicRecordInput } from "./types.ts";

/**
 * Legal-form suffixes dropped from the END of a filer name so "Disney
 * Enterprises, Inc." and "DISNEY ENTERPRISES INC" normalize identically.
 * Applied repeatedly ("… CO INC" → "…"). "PARTNERS" is deliberately kept: the
 * Socrata truncation "UNIVERSAL CITY DEVELOPMENT PAR" must still prefix-match.
 */
const LEGAL_SUFFIXES = new Set([
  "INC",
  "INCORPORATED",
  "LLC",
  "LLLP",
  "LLP",
  "LP",
  "LTD",
  "LIMITED",
  "CORP",
  "CORPORATION",
  "CO",
  "COMPANY",
  "PLC",
]);

/**
 * Uppercase, punctuation → space, whitespace collapsed, trailing legal
 * suffixes removed. Null/blank in → null out.
 */
export function normalizeFiler(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const tokens = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!)) tokens.pop();
  const out = tokens.join(" ");
  return out.length > 0 ? out : null;
}

/** JSON with object keys sorted recursively, so equal content hashes equal. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * sha256 over the fields whose change is "news": as-filed text, status,
 * dates, location, and the normalized payload. Deliberately excludes our own
 * derived columns (score, links) so re-scoring never fakes a revision.
 */
export function contentHash(input: PublicRecordInput): string {
  const subject = {
    title: input.title,
    description: input.description ?? null,
    status: input.status ?? null,
    statusAt: input.statusAt ?? null,
    filedAt: input.filedAt ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    address: input.address ?? null,
    parcelId: input.parcelId ?? null,
    payload: input.payload,
  };
  return createHash("sha256").update(stableStringify(subject)).digest("hex");
}

/** `{field: [before, after]}` for every key whose value differs. */
export function diffPayload(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const a = prev[key] ?? null;
    const b = next[key] ?? null;
    if (stableStringify(a) !== stableStringify(b)) out[key] = [a, b];
  }
  return out;
}

/** SQL LIKE pattern (`%`, `_`) → anchored RegExp over the whole string. */
export function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${escaped}$`);
}

/** First alias whose LIKE pattern matches the normalized filer, else null. */
export function matchAlias(filerNorm: string | null, aliases: FilerAlias[]): FilerAlias | null {
  if (!filerNorm) return null;
  for (const alias of aliases) {
    if (likeToRegExp(alias.pattern).test(filerNorm)) return alias;
  }
  return null;
}

/**
 * Socrata-style floating timestamps ("2018-01-12T00:00:00.000") and bare dates
 * are calendar days in the agency's local zone with no real time-of-day. Parse
 * the date part at UTC noon so DST/zone math can't shift the day.
 */
export function parseFloatingDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Latest of several optional dates, or null when none are set. */
export function latestDate(...dates: Array<Date | null | undefined>): Date | null {
  let best: Date | null = null;
  for (const d of dates) if (d && (!best || d > best)) best = d;
  return best;
}

/** Trim + collapse whitespace; empty → null. */
export function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.replace(/\s+/g, " ").trim();
  return s.length > 0 ? s : null;
}

/** Socrata numbers arrive as strings ("2000", "0"); non-numeric → null. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}
