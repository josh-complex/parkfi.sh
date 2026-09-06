/**
 * USPTO trademarks — Trademark Daily XML File, applications (product
 * `TRTDXFAP`; plan §5.9, C1). Every new US application and every status
 * change lands in one zipped XML per business day. We list the product's
 * files through the Open Data Portal, download the days we haven't
 * processed, and keep the case files whose owner matches an operator alias
 * (Disney Enterprises, Universal City Studios, SeaWorld, …).
 *
 * Needs `USPTO_ODP_API_KEY` (free; see uspto/odp.ts). Budgeted: at most
 * `RECORDS_TM_MAX_FILES` days per run, cursor = last fully processed file
 * date, first run starts `RECORDS_TM_BACKFILL_DAYS` back (the daily files
 * are tens of MB each, so the plan's 24-month backfill is a separate,
 * throttled catch-up — the cron walks forward a few days per run until
 * current, then stays current at one file per day).
 */
import { matchAlias, normalizeFiler } from "../normalize.ts";
import {
  downloadProductFile,
  isoDaysAgo,
  listProductFiles,
  ODP_API_KEY_ENV,
} from "../uspto/odp.ts";
import { iterateCaseFiles, tdxfDate, tdxfStatusLabel, type TdxfCaseFile } from "../uspto/tdxf.ts";
import { readZipEntries } from "../uspto/zip.ts";

import type {
  Adapter,
  AdapterContext,
  FetchResult,
  PublicRecordInput,
  RawRecord,
} from "../types.ts";

export const USPTO_TM_SOURCE = "uspto_tm";
const PRODUCT = "TRTDXFAP";
const BACKFILL_DAYS = Number(process.env.RECORDS_TM_BACKFILL_DAYS ?? 30);
const MAX_FILES = Number(process.env.RECORDS_TM_MAX_FILES ?? 7);

/** Nice class → short label, for descriptions. Only the classes that matter here. */
const CLASS_LABELS: Record<string, string> = {
  "009": "software & media",
  "016": "printed matter",
  "025": "apparel",
  "028": "toys & games",
  "035": "retail & advertising",
  "038": "telecom",
  "039": "transport & travel",
  "041": "entertainment & amusement park services",
  "043": "restaurant, hotel & lodging",
};

export function tsdrUrl(serial: string): string {
  return `https://tsdr.uspto.gov/#caseNumber=${encodeURIComponent(serial)}&caseType=SERIAL_NO&searchType=statusSearch`;
}

function ownerMatches(cf: TdxfCaseFile, ctx: Pick<AdapterContext, "aliases">): boolean {
  return cf.owners.some((o) => matchAlias(normalizeFiler(o.name), ctx.aliases) != null);
}

/** Next day after an ISO date. */
function nextDay(iso: string): string {
  return new Date(new Date(`${iso}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
}

export const usptoTmAdapter: Adapter = {
  source: USPTO_TM_SOURCE,
  agency: "USPTO",
  cadence: "daily",
  requiredEnv: [ODP_API_KEY_ENV],

  async fetchSince(cursor, ctx): Promise<FetchResult> {
    const last = typeof cursor?.lastFileDate === "string" ? cursor.lastFileDate : null;
    const today = new Date().toISOString().slice(0, 10);
    const from = last ? nextDay(last) : isoDaysAgo(BACKFILL_DAYS);
    if (from > today) return { records: [], cursor: { lastFileDate: last } };

    const files = (await listProductFiles(ctx.fetch, PRODUCT, from, today, ctx.signal)).slice(
      0,
      MAX_FILES,
    );
    ctx.log(`${files.length} daily file(s) from ${from} (cursor ${last ?? "none"})`);

    const records: RawRecord[] = [];
    let lastFileDate = last;
    for (const file of files) {
      if (ctx.signal.aborted) {
        ctx.log(`budget exhausted before ${file.fileName}; cursor held at ${lastFileDate}`);
        break;
      }
      const zip = await downloadProductFile(ctx.fetch, file.fileDownloadURI, ctx.signal);
      const xmlEntry = readZipEntries(zip).find((e) => /\.xml$/i.test(e.name));
      if (!xmlEntry) throw new Error(`${file.fileName}: no XML entry in zip`);
      const xml = xmlEntry.read().toString("utf8");
      const fetchedAt = new Date();
      let seen = 0;
      let kept = 0;
      for (const cf of iterateCaseFiles(xml)) {
        seen++;
        if (!ownerMatches(cf, ctx)) continue;
        kept++;
        records.push({ externalId: cf.serial, url: tsdrUrl(cf.serial), fetchedAt, body: cf });
      }
      ctx.log(`${file.fileName}: ${seen} case files, ${kept} operator-owned`);
      lastFileDate = file.fileDataFromDate;
    }
    return { records, cursor: { lastFileDate } };
  },

  normalize(raw: RawRecord): PublicRecordInput | null {
    const cf = raw.body as TdxfCaseFile;
    if (!cf || typeof cf !== "object" || typeof cf.serial !== "string") {
      throw new Error("uspto_tm: body is not a case file");
    }
    const owner = cf.owners[0] ?? null;
    const status = tdxfStatusLabel(cf.statusCode);
    const filed = tdxfDate(cf.filingDate);
    const statusAt = tdxfDate(cf.statusDate) ?? filed;
    const title = cf.markText ?? `Design mark (serial ${cf.serial})`;
    const classLine = cf.classes
      .map((c) => `Class ${c}${CLASS_LABELS[c] ? ` (${CLASS_LABELS[c]})` : ""}`)
      .join(", ");
    const gs = cf.goodsServices.map((g) => g.text).join(" · ");
    const description = [classLine || null, gs ? gs.slice(0, 1500) : null]
      .filter(Boolean)
      .join(". ");

    return {
      kind: "trademark",
      externalId: cf.serial,
      url: raw.url,
      title,
      description: description || null,
      filer: owner?.name ?? null,
      filedAt: filed ? new Date(`${filed}T12:00:00Z`) : null,
      status,
      statusAt: statusAt ? new Date(`${statusAt}T12:00:00Z`) : null,
      payload: {
        serial: cf.serial,
        registrationNumber: cf.registrationNumber,
        markText: cf.markText,
        markDrawingCode: cf.markDrawingCode,
        filingDate: filed,
        statusCode: cf.statusCode,
        statusDate: tdxfDate(cf.statusDate),
        registrationDate: tdxfDate(cf.registrationDate),
        abandonmentDate: tdxfDate(cf.abandonmentDate),
        publishedForOppositionDate: tdxfDate(cf.publishedForOppositionDate),
        intentToUse: cf.intentToUse,
        useBased: cf.useBased,
        classes: cf.classes,
        goodsServices: cf.goodsServices,
        // Owner names + locality only; street addresses are never carried (§9).
        owners: cf.owners.map((o) => ({
          name: o.name,
          city: o.city,
          state: o.state,
          country: o.country,
        })),
        transactionDate: tdxfDate(cf.transactionDate),
      },
      // Mark text is what may later match a new attraction/venue name (§4.3).
      linkText: [cf.markText, ...cf.owners.map((o) => o.name)].filter(
        (s): s is string => s != null,
      ),
    };
  },

  resortFor() {
    // Marks name IP, not property — resort-level attribution only via alias.
    return null;
  },
};
