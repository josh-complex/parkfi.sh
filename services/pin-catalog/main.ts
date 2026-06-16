/**
 * pin-catalog — reference-dataset seed + refresh (Railway cron / one-off).
 *
 * The reference catalog is the moat (see docs/plans/pin-traders.md). This service
 * sweeps a licensed source (eBay Browse API) in SEGMENTED, rate-limited buckets,
 * asks a cheap LLM (Gemini Flash, the `cron-park-news` pattern) to normalize the
 * messy listing titles into structured fields, upserts `pin` + a canonical
 * `pin_image` (downloaded to R2), and enqueues a `pin-embed` job per new image so
 * the vector index fills in behind it.
 *
 * Provenance (`source`/`source_ref`) is stored on every row so a source can be
 * purged wholesale if a license/takedown ever requires it.
 *
 * Commands:
 *   bun run cron:pin-catalog            # sweep eBay buckets → upsert + enqueue
 *   bun run cron:pin-catalog pinpics       # crawl PinPics (PID range) → same pipeline
 *   bun run cron:pin-catalog pinpics-discover     # print real pin-link URLs from the index
 *   bun run cron:pin-catalog pinpics-probe <pid>  # load one pin, print extracted fields
 *   bun run cron:pin-catalog backfill      # enqueue embeds for any unembedded image
 *
 * Env: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET (sweep), PINPICS_* (pinpics — see
 *      pinpics.ts), GEMINI_API_KEY (normalize), R2_* (image storage),
 *      REDIS_URL (embed queue), DATABASE_URL.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { randomUUID } from "node:crypto";

import { GoogleGenAI } from "@google/genai";
import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { pin, pinImage } from "#/db/schema.ts";
import { getPinEmbedQueue } from "#/server/notifications/queue.ts";
import { putReferenceImage } from "#/server/pins/storage.ts";

import { crawlPinPics, discoverPinPics, probePinPics, type RawListing } from "./pinpics.ts";

const NORMALIZE_MODEL = process.env.PIN_NORMALIZE_MODEL ?? "gemini-3.5-flash";
const MARKETPLACE = process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US";
/**
 * eBay leaf category for Disney pins. 38004 = "Contemporary Disney Pins, Patches
 * & Buttons (1968-Now)" (verified from eBay's browse-node URL `/b/.../38004/`) —
 * the broadest current-era pin bucket. Siblings worth adding: 38005 (cast-member
 * exclusive), 38014 (WDW patches & pins). Comma-separate to sweep several.
 */
const EBAY_CATEGORY = process.env.EBAY_CATEGORY_ID ?? "38004";
/** Per-bucket result cap (eBay: 10k-per-query window; segment to stay well under). */
const PER_BUCKET = Number(process.env.PIN_PER_BUCKET ?? 100);
/** Safety ceiling on new pins minted per run. */
const MAX_NEW_PER_RUN = Number(process.env.PIN_MAX_NEW_PER_RUN ?? 500);

/**
 * Segmented query buckets — eBay caps a single query window at 10k results, so we
 * sweep by character/series slices rather than one giant "disney pin" query.
 * Extend freely; the upsert on (source, source_ref) makes overlap harmless.
 */
const DEFAULT_BUCKETS = [
  "mickey mouse",
  "minnie mouse",
  "donald duck",
  "goofy",
  "stitch",
  "winnie the pooh",
  "tinker bell",
  "mickey ears",
  "haunted mansion",
  "star wars",
  "marvel",
  "pixar",
  "princess",
  "villains",
  "limited edition",
  "cast member",
  "annual passholder",
];

function buckets(): string[] {
  const env = process.env.PIN_BUCKETS;
  if (!env) return DEFAULT_BUCKETS;
  return env
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// --- eBay Browse API -------------------------------------------------------

let _token: { value: string; expiresAt: number } | null = null;

async function ebayToken(): Promise<string> {
  if (_token && Date.now() < _token.expiresAt - 60_000) return _token.value;
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET unset");

  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
  });
  if (!res.ok) throw new Error(`eBay token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  _token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return _token.value;
}

interface EbayItem {
  itemId: string;
  title: string;
  imageUrl: string | null;
  priceCents: number | null;
}

async function ebaySearch(bucket: string, limit: number): Promise<EbayItem[]> {
  const token = await ebayToken();
  const items: EbayItem[] = [];
  const pageSize = 50; // eBay max per page
  for (let offset = 0; offset < limit; offset += pageSize) {
    const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    url.searchParams.set("q", `disney pin ${bucket}`);
    url.searchParams.set("category_ids", EBAY_CATEGORY);
    url.searchParams.set("limit", String(Math.min(pageSize, limit - offset)));
    url.searchParams.set("offset", String(offset));
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.error(`[pin-catalog] eBay search "${bucket}" ${res.status}`);
      break;
    }
    const json = (await res.json()) as {
      itemSummaries?: Array<{
        itemId: string;
        title: string;
        image?: { imageUrl?: string };
        price?: { value?: string };
      }>;
    };
    const page = json.itemSummaries ?? [];
    for (const it of page) {
      const cents = it.price?.value ? Math.round(Number(it.price.value) * 100) : null;
      items.push({
        itemId: it.itemId,
        title: it.title,
        imageUrl: it.image?.imageUrl ?? null,
        priceCents: Number.isFinite(cents) ? cents : null,
      });
    }
    if (page.length < pageSize) break; // last page
  }
  return items;
}

// --- LLM normalization -----------------------------------------------------

interface NormalizedPin {
  name: string;
  series: string | null;
  characters: string[];
  year: number | null;
  editionType: string | null;
  leCount: number | null;
  park: string | null;
}

const NORMALIZE_SYSTEM = `You normalize messy eBay listing titles for Disney trading pins into structured catalog fields. Strip seller noise ("NEW", "RARE", "HTF", "Lot of 3", shipping notes, condition). Extract the pin's real subject. Respond with ONLY a JSON array, one object per input listing IN ORDER, shape:
{"name": "<clean pin name>", "series": "<series/collection or null>", "characters": ["<character>", ...], "year": <4-digit year or null>, "editionType": "<'open'|'LE'|'LR'|'cast'|'mystery' or null>", "leCount": <limited-edition size integer or null>, "park": "<'WDW'|'DLR'|'DLP'|'TDR'|'HKDL'|'SHDR' or null>"}
If a listing is clearly NOT a single identifiable Disney pin (a lot, a lanyard, a fake/scrapper bundle), set "name" to "" so it can be skipped.`;

async function normalizeBatch(ai: GoogleGenAI, titles: string[]): Promise<NormalizedPin[]> {
  const res = await ai.models.generateContent({
    model: NORMALIZE_MODEL,
    contents: `Normalize these ${titles.length} listing titles:\n${titles
      .map((t, i) => `${i + 1}. ${t}`)
      .join("\n")}`,
    config: { systemInstruction: NORMALIZE_SYSTEM, maxOutputTokens: 8_000 },
  });
  const text = res.text ?? "";
  const json = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  try {
    const arr = JSON.parse(json) as Partial<NormalizedPin>[];
    return arr.map((o) => ({
      name: typeof o.name === "string" ? o.name.trim() : "",
      series: o.series ?? null,
      characters: Array.isArray(o.characters)
        ? o.characters.filter((c) => typeof c === "string")
        : [],
      year: typeof o.year === "number" ? o.year : null,
      editionType: o.editionType ?? null,
      leCount: typeof o.leCount === "number" ? o.leCount : null,
      park: o.park ?? null,
    }));
  } catch {
    console.error("[pin-catalog] normalize parse failed; skipping batch");
    return titles.map(() => ({
      name: "",
      series: null,
      characters: [],
      year: null,
      editionType: null,
      leCount: null,
      park: null,
    }));
  }
}

// --- upsert + image + embed ------------------------------------------------

async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** Upsert one pin; download + store its image and enqueue an embed if new. */
async function ingestPin(
  raw: RawListing,
  norm: NormalizedPin,
): Promise<"new" | "updated" | "skipped"> {
  if (!norm.name) return "skipped";

  const [row] = await db
    .insert(pin)
    .values({
      name: norm.name,
      series: norm.series,
      characters: norm.characters,
      year: norm.year,
      editionType: norm.editionType,
      leCount: norm.leCount,
      park: norm.park,
      estValueCents: raw.priceCents,
      source: raw.source,
      sourceRef: raw.sourceRef,
    })
    .onConflictDoUpdate({
      target: [pin.source, pin.sourceRef],
      // The unique index is PARTIAL (WHERE source_ref IS NOT NULL); the conflict
      // target must carry the same predicate to match it (see migration).
      targetWhere: sql`source_ref IS NOT NULL`,
      set: {
        // Refresh the price comp + any fields that improved; keep identity stable.
        // COALESCE keeps an existing price when a source (e.g. PinPics) has none.
        estValueCents: sql`COALESCE(${raw.priceCents}, ${pin.estValueCents})`,
        name: norm.name,
        series: norm.series,
        characters: norm.characters,
        year: norm.year,
        editionType: norm.editionType,
        leCount: norm.leCount,
        park: norm.park,
        updatedAt: new Date(),
      },
    })
    .returning({ id: pin.id });
  if (!row) return "skipped";

  // Does this pin already have a reference image? (idempotent re-runs.)
  const { rows: existing } = await db.execute<{ n: number }>(sql`
    SELECT count(*) AS n FROM pin_image WHERE pin_id = ${row.id}::uuid
  `);
  if (Number(existing[0]?.n ?? 0) > 0) return "updated";

  if (!raw.imageUrl) return "updated";
  const bytes = await downloadImage(raw.imageUrl);
  if (!bytes) return "updated";

  const imageId = randomUUID();
  const r2Key = await putReferenceImage(imageId, bytes);
  // DO NOTHING on conflict so a re-run / race can't throw on the one-primary-per-
  // pin unique index — if a primary already landed, skip silently.
  const inserted = await db
    .insert(pinImage)
    .values({ id: imageId, pinId: row.id, r2Key, isPrimary: true, source: raw.source })
    .onConflictDoNothing()
    .returning({ id: pinImage.id });
  if (inserted.length === 0) return "updated";
  await getPinEmbedQueue().add("embed", { pinImageId: imageId });
  return "new";
}

interface IngestTotals {
  newCount: number;
  updated: number;
  skipped: number;
}

/** Normalize a batch of listings (≤20 at a time) and ingest each. Shared by all sources. */
async function ingestListings(
  ai: GoogleGenAI,
  listings: RawListing[],
  totals: IngestTotals,
): Promise<void> {
  for (let i = 0; i < listings.length; i += 20) {
    const slice = listings.slice(i, i + 20);
    const norms = await normalizeBatch(
      ai,
      slice.map((l) => l.title),
    );
    for (let j = 0; j < slice.length; j++) {
      try {
        const r = await ingestPin(slice[j], norms[j] ?? ({} as NormalizedPin));
        if (r === "new") totals.newCount++;
        else if (r === "updated") totals.updated++;
        else totals.skipped++;
      } catch (err) {
        console.error("[pin-catalog] ingest failed:", (err as Error)?.message ?? err);
      }
    }
  }
}

async function sweep(): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    console.warn("[pin-catalog] GEMINI_API_KEY unset — cannot normalize; aborting");
    return;
  }
  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    console.warn(
      "[pin-catalog] EBAY_CLIENT_ID / EBAY_CLIENT_SECRET unset — skipping eBay sweep " +
        "(set them, or use `pinpics` to seed from PinPics instead)",
    );
    return;
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const totals: IngestTotals = { newCount: 0, updated: 0, skipped: 0 };

  for (const bucket of buckets()) {
    if (totals.newCount >= MAX_NEW_PER_RUN) {
      console.log(`[pin-catalog] hit MAX_NEW_PER_RUN (${MAX_NEW_PER_RUN}) — stopping`);
      break;
    }
    let items: EbayItem[];
    try {
      items = await ebaySearch(bucket, PER_BUCKET);
    } catch (err) {
      console.error(`[pin-catalog] bucket "${bucket}" failed:`, (err as Error)?.message ?? err);
      continue;
    }
    if (items.length === 0) continue;

    // Map eBay items to the shared listing shape, then normalize + ingest.
    const listings: RawListing[] = items.map((it) => ({
      source: "ebay",
      sourceRef: it.itemId,
      title: it.title,
      imageUrl: it.imageUrl,
      priceCents: it.priceCents,
    }));
    await ingestListings(ai, listings, totals);
    console.log(`[pin-catalog] bucket "${bucket}" done — running totals: +${totals.newCount} new`);
  }

  console.log(
    `[pin-catalog] sweep complete — ${totals.newCount} new, ${totals.updated} updated, ${totals.skipped} skipped`,
  );
}

/**
 * Crawl PinPics (the broadest clean reference catalog) through the same
 * normalize → upsert → image → embed pipeline. Flushes every 20 pins so a long
 * crawl persists progress incrementally rather than only at the end.
 */
async function pinpics(): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    console.warn("[pin-catalog] GEMINI_API_KEY unset — cannot normalize; aborting");
    return;
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const totals: IngestTotals = { newCount: 0, updated: 0, skipped: 0 };

  // Pins we already hold from PinPics — skip re-fetching them (politeness + speed
  // on re-runs). PinPics PIDs are numeric, stored as text in source_ref.
  // "Known" = fully ingested, i.e. the pin exists AND has a reference image. A pin
  // saved without an image (e.g. a prior failed run) is NOT known, so a re-run
  // re-fetches it and fills in the missing image + embed — self-healing.
  const knownRows = await db.execute<{ source_ref: string }>(sql`
    SELECT p.source_ref FROM pin p
    WHERE p.source = 'pinpics' AND p.source_ref IS NOT NULL
      AND EXISTS (SELECT 1 FROM pin_image i WHERE i.pin_id = p.id)
  `);
  const known = new Set(knownRows.rows.map((r) => r.source_ref));

  // Auto-resume: when no explicit start is set, begin just past the highest PID we
  // already have so a plain repeating cron marches forward on its own (no manual
  // range bumping). Empty catalog → start at 1.
  const knownNums = [...known].map(Number).filter((n) => Number.isFinite(n));
  const resumeStart = knownNums.length ? Math.max(...knownNums) + 1 : 1;
  if (!process.env.PINPICS_START_ID) {
    console.log(`[pin-catalog] pinpics auto-resume from PID ${resumeStart}`);
  }

  // Buffer crawl output and normalize+ingest in batches of 20 so a long crawl
  // persists progress incrementally rather than only at the end.
  let buffer: RawListing[] = [];
  const flush = async () => {
    if (buffer.length === 0) return;
    // Swap the batch out SYNCHRONOUSLY (no await between read and reset) so two
    // concurrent crawl workers can't both ingest the same buffer — that double-
    // processing was inserting a second primary pin_image per pin (unique violation).
    const batch = buffer;
    buffer = [];
    await ingestListings(ai, batch, totals);
    console.log(`[pin-catalog] pinpics running totals: +${totals.newCount} new`);
  };

  await crawlPinPics(
    async (listing) => {
      buffer.push(listing);
      if (buffer.length >= 20) await flush();
    },
    { isKnown: (pid) => known.has(String(pid)), startId: resumeStart },
  );
  await flush();

  console.log(
    `[pin-catalog] pinpics complete — ${totals.newCount} new, ${totals.updated} updated, ${totals.skipped} skipped`,
  );
}

/** Enqueue embed jobs for every reference image lacking an embedding. */
async function backfill(): Promise<void> {
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT i.id FROM pin_image i
    LEFT JOIN pin_embedding e ON e.pin_image_id = i.id
    WHERE e.pin_image_id IS NULL
  `);
  const queue = getPinEmbedQueue();
  for (const r of rows) await queue.add("embed", { pinImageId: r.id });
  console.log(`[pin-catalog] backfill — enqueued ${rows.length} embed job(s)`);
}

async function main() {
  const cmd = process.argv[2] ?? "sweep";
  if (cmd === "backfill") await backfill();
  else if (cmd === "pinpics") await pinpics();
  else if (cmd === "pinpics-discover") await discoverPinPics();
  else if (cmd === "pinpics-probe") await probePinPics(Number(process.argv[3] ?? 1));
  else await sweep();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
