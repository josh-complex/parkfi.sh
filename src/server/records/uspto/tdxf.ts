/**
 * Trademark Daily XML File (TDXF) applications — pure extraction of
 * `<case-file>` records from the daily XML (product TRTDXFAP). The schema is
 * flat and regular (Trademark Applications DTD v2), so a tag-path extractor
 * over each case-file block is exact and dependency-free; it's also the part
 * that's unit-tested against a hand-built sample.
 *
 * Element names (verified against an independent parser of the same files):
 *   case-file/serial-number, registration-number, transaction-date
 *   case-file/case-file-header/{filing-date,status-code,status-date,
 *     registration-date,abandonment-date,published-for-opposition-date,
 *     mark-identification,mark-drawing-code,
 *     intent-to-use-currently-in,use-application-currently-in}
 *   case-file/case-file-statements/case-file-statement/{type-code,text}
 *   case-file/classifications/classification/international-code
 *   case-file/case-file-owners/case-file-owner/{party-type,party-name,city,state,country}
 */

export interface TdxfOwner {
  name: string;
  partyType: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}

export interface TdxfCaseFile {
  serial: string;
  registrationNumber: string | null;
  /** `YYYYMMDD` as filed; converted downstream. */
  transactionDate: string | null;
  filingDate: string | null;
  statusCode: string | null;
  statusDate: string | null;
  registrationDate: string | null;
  abandonmentDate: string | null;
  publishedForOppositionDate: string | null;
  /** Word mark; null for pure design marks. */
  markText: string | null;
  markDrawingCode: string | null;
  intentToUse: boolean | null;
  useBased: boolean | null;
  /** Nice classes as three-digit strings ("041"). */
  classes: string[];
  goodsServices: Array<{ class: string | null; text: string }>;
  owners: TdxfOwner[];
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

export function decodeXml(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)));
}

/** Text of the first `<name>…</name>` in `block`, decoded and trimmed; null if absent/empty. */
export function tagText(block: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(block);
  if (!m) return null;
  const t = decodeXml(m[1]!).replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : null;
}

/** Every `<name>…</name>` block's inner XML, in document order. */
export function tagBlocks(block: string, name: string): string[] {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "g");
  const out: string[] = [];
  for (let m = re.exec(block); m; m = re.exec(block)) out.push(m[1]!);
  return out;
}

function flag(value: string | null): boolean | null {
  if (value === "T") return true;
  if (value === "F") return false;
  return null;
}

function parseCaseFile(inner: string): TdxfCaseFile | null {
  const serial = tagText(inner, "serial-number");
  if (!serial) return null;
  const header = tagBlocks(inner, "case-file-header")[0] ?? "";

  const classes = new Set<string>();
  for (const c of tagBlocks(tagBlocks(inner, "classifications")[0] ?? "", "classification")) {
    for (const code of tagBlocks(c, "international-code")) {
      const t = decodeXml(code).trim();
      if (/^\d{3}$/.test(t)) classes.add(t);
    }
  }

  const goodsServices: TdxfCaseFile["goodsServices"] = [];
  for (const s of tagBlocks(
    tagBlocks(inner, "case-file-statements")[0] ?? "",
    "case-file-statement",
  )) {
    const type = tagText(s, "type-code") ?? "";
    const text = tagText(s, "text");
    // GS<class><seq> = goods & services statement for one class ("GS0411").
    if (!text || !type.startsWith("GS")) continue;
    const cls = /^GS(\d{3})/.exec(type)?.[1] ?? null;
    goodsServices.push({ class: cls, text });
  }

  const owners: TdxfOwner[] = [];
  for (const o of tagBlocks(tagBlocks(inner, "case-file-owners")[0] ?? "", "case-file-owner")) {
    const name = tagText(o, "party-name");
    if (!name) continue;
    owners.push({
      name,
      partyType: tagText(o, "party-type"),
      city: tagText(o, "city"),
      state: tagText(o, "state"),
      country: tagText(o, "country"),
    });
  }

  return {
    serial,
    registrationNumber: tagText(inner, "registration-number"),
    transactionDate: tagText(inner, "transaction-date"),
    filingDate: tagText(header, "filing-date"),
    statusCode: tagText(header, "status-code"),
    statusDate: tagText(header, "status-date"),
    registrationDate: tagText(header, "registration-date"),
    abandonmentDate: tagText(header, "abandonment-date"),
    publishedForOppositionDate: tagText(header, "published-for-opposition-date"),
    markText: tagText(header, "mark-identification"),
    markDrawingCode: tagText(header, "mark-drawing-code"),
    intentToUse: flag(tagText(header, "intent-to-use-currently-in")),
    useBased: flag(tagText(header, "use-application-currently-in")),
    classes: [...classes].sort(),
    goodsServices,
    owners,
  };
}

/** Lazily walk every `<case-file>` in a TDXF document. */
export function* iterateCaseFiles(xml: string): Generator<TdxfCaseFile> {
  const re = /<case-file>([\s\S]*?)<\/case-file>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const parsed = parseCaseFile(m[1]!);
    if (parsed) yield parsed;
  }
}

/** `YYYYMMDD` → `YYYY-MM-DD`, or null. */
export function tdxfDate(value: string | null): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Coarse, human status for a TSDR status code. Exact labels for the codes
 * that matter to the feed (new / published / allowed / registered / dead);
 * range-based families for the rest. The raw code is always kept in payload.
 */
export function tdxfStatusLabel(code: string | null): string | null {
  if (!code) return null;
  const n = Number(code);
  if (!Number.isFinite(n)) return code;
  const exact: Record<number, string> = {
    606: "Abandoned - no statement of use filed",
    602: "Abandoned - failure to respond",
    630: "New application",
    638: "New application - assigned to examiner",
    640: "Non-final action mailed",
    641: "Non-final action mailed",
    644: "Final refusal mailed",
    645: "Final refusal mailed",
    648: "Suspended",
    649: "Suspended",
    680: "Approved for publication",
    681: "Publication review complete",
    686: "Published for opposition",
    688: "Notice of allowance issued",
    700: "Registered",
    702: "Registered - Section 8 accepted",
    800: "Registered and renewed",
  };
  if (exact[n]) return exact[n];
  if (n >= 600 && n < 630) return "Abandoned";
  if (n >= 630 && n < 640) return "New application";
  if (n >= 640 && n < 660) return "Under examination";
  if (n >= 660 && n < 688) return "Approved / published";
  if (n >= 688 && n < 700) return "Allowed";
  if (n >= 700 && n < 720) return "Registered";
  if (n >= 720 && n < 800) return "Registered (post-registration)";
  if (n >= 800) return "Registered and renewed";
  return `Status ${code}`;
}
