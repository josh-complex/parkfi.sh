/**
 * Identification cascade. Runs in the `pin-identify` worker, one call per scan:
 *
 *   ① CLIP embedding search  (self-host, ~free)  — nearest-N in pin_embedding
 *   ② Google Vision Web Detection  (gated, OFF in Phase 1 — scaffolded)
 *   ③ LLM vision re-rank  (Gemini, gated on low confidence)
 *   ④ human confirm  (the client shows top-3 and writes the label)
 *
 * Confidence gates spend money only on the long tail. Stage 1 is always run;
 * Stage 3 fires only when Stage 1's best match is below STAGE3_TRIGGER. The
 * result is written back to `pin_scan` (candidates + status), and the user's
 * confirmed pick later mints a labeled pair — the flywheel.
 *
 * Everything here is a pure-ish shell over the DB + the embed service so the
 * decision math (`scoreFromDistance`, gate thresholds) stays easy to reason about.
 */
import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { embedImage, EMBED_MODEL, toVectorLiteral } from "#/server/pins/embed.ts";
import { pinPublicUrl } from "#/server/pins/storage.ts";

/** Below this Stage-1 cosine similarity, escalate to the Stage-3 LLM re-rank. */
const STAGE3_TRIGGER = Number(process.env.PIN_STAGE3_TRIGGER ?? 0.9);

/**
 * Calibration anchors that map raw cosine distance → the 0–1 display/ranking
 * score. pgvector `<=>` returns cosine distance in [0,2], but L2-normalized
 * CLIP image embeddings of real photos never reach the far end: any two pin
 * photos are positively correlated, so even unrelated pins sit around distance
 * ~0.3–0.5. The old `1 - distance/2` mapping read those as ~75–85% "match"
 * (why a wrong pin showed "84%"). Instead we rescale the band that actually
 * carries signal: at/below MATCH_FLOOR is a confident match (→1.0), at/above
 * MATCH_CEIL there is no meaningful similarity (→0.0), linear in between. These
 * defaults are heuristic — tune against confirmed scans. Ordering is unaffected
 * (the mapping is monotonic in distance), and STAGE3_TRIGGER still lives in this
 * score space so the escalation gate tracks the calibration automatically.
 */
const MATCH_FLOOR = Number(process.env.PIN_MATCH_FLOOR ?? 0.15);
const MATCH_CEIL = Number(process.env.PIN_MATCH_CEIL ?? 0.45);
/** How many neighbours Stage 1 pulls (and the max we ever show the user). */
const TOP_N = Number(process.env.PIN_TOP_N ?? 10);
/** Gemini model for the Stage-3 re-rank (cheap Flash-class vision). */
const RERANK_MODEL = process.env.PIN_RERANK_MODEL ?? "gemini-3.1-flash-lite";

export interface Candidate {
  pinId: string;
  /** 0–1 confidence (cosine similarity at Stage 1; LLM-adjusted at Stage 3). */
  score: number;
  /** Which stage produced/ranked this candidate. */
  stage: number;
}

export interface CascadeResult {
  candidates: Candidate[];
  topConfidence: number;
  /** 1..4 — the stage that produced the final ranking (4 = handed to human). */
  stageResolved: number;
}

/** Cosine distance (pgvector `<=>`) → a calibrated 0–1 similarity score. */
export function scoreFromDistance(distance: number): number {
  const span = Math.max(1e-6, MATCH_CEIL - MATCH_FLOOR);
  return Math.max(0, Math.min(1, (MATCH_CEIL - distance) / span));
}

type NeighborRow = {
  pin_id: string;
  distance: number;
};

/** Stage 1 — ANN search of the query embedding against the reference set. */
async function stage1(embedding: number[]): Promise<Candidate[]> {
  const literal = toVectorLiteral(embedding);
  // DISTINCT ON (pin_id) keeps the closest image per pin (a pin can have several
  // reference images). Ordered by cosine distance via the HNSW index.
  const { rows } = await db.execute<NeighborRow>(sql`
    SELECT pin_id, distance FROM (
      SELECT DISTINCT ON (pin_id)
             pin_id,
             embedding <=> ${literal}::vector AS distance
      FROM pin_embedding
      WHERE model = ${EMBED_MODEL}
      ORDER BY pin_id, embedding <=> ${literal}::vector
    ) per_pin
    ORDER BY distance
    LIMIT ${TOP_N}
  `);
  return rows.map((r) => ({
    pinId: r.pin_id,
    score: scoreFromDistance(Number(r.distance)),
    stage: 1,
  }));
}

/** Fetch an image URL and return base64 bytes (for the LLM vision call). */
async function fetchBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  } catch {
    return null;
  }
}

interface CandidateImage {
  pinId: string;
  name: string;
  series: string | null;
  year: number | null;
  r2Key: string;
}

/** Pull display metadata + a primary reference image key for a set of pins. */
async function candidateImages(pinIds: string[]): Promise<CandidateImage[]> {
  if (pinIds.length === 0) return [];
  const { rows } = await db.execute<{
    pin_id: string;
    name: string;
    series: string | null;
    year: number | null;
    r2_key: string | null;
  }>(sql`
    SELECT p.id AS pin_id, p.name, p.series, p.year,
           COALESCE(
             (SELECT r2_key FROM pin_image WHERE pin_id = p.id ORDER BY is_primary DESC LIMIT 1),
             NULL
           ) AS r2_key
    FROM pin p
    WHERE p.id = ANY(${sql`ARRAY[${sql.join(
      pinIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}]`})
  `);
  const byId = new Map(rows.map((r) => [r.pin_id, r]));
  return pinIds.flatMap((id) => {
    const r = byId.get(id);
    if (!r?.r2_key) return [];
    return [{ pinId: id, name: r.name, series: r.series, year: r.year, r2Key: r.r2_key }];
  });
}

/**
 * Stage 3 — LLM vision re-rank. Shows the model the query photo + the top
 * candidate reference images and asks which one matches, reading pin text /
 * characters / LE stamps the way a human disambiguates near-identical variants.
 * Returns a re-ordered candidate list, or null if the stage is unavailable
 * (no API key) or fails — the caller falls back to the Stage-1 order.
 */
async function stage3(
  scanPhotoB64: string,
  stage1Candidates: Candidate[],
): Promise<Candidate[] | null> {
  if (!process.env.GEMINI_API_KEY) return null;

  const images = await candidateImages(stage1Candidates.map((c) => c.pinId));
  if (images.length === 0) return null;

  const refB64 = await Promise.all(images.map((i) => fetchBase64(pinPublicUrl(i.r2Key))));
  const usable = images.filter((_, i) => refB64[i] != null);
  if (usable.length === 0) return null;

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const listing = usable
    .map(
      (img, i) =>
        `Candidate ${i}: "${img.name}"${img.series ? ` — series: ${img.series}` : ""}${
          img.year ? ` (${img.year})` : ""
        }`,
    )
    .join("\n");

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    {
      text: `You are identifying a Disney trading pin from a user's photo. The FIRST image is the user's photo of the unknown pin. The remaining images are catalog candidates, in order.\n\n${listing}\n\nCompare pin shape, characters, text, edition stamps and colors. Respond with ONLY a JSON object: {"bestIndex": <candidate number or -1 if none match>, "confidence": <0..1>, "ranking": [<candidate numbers best-first>]}.`,
    },
    { inlineData: { mimeType: "image/webp", data: scanPhotoB64 } },
  ];
  for (let i = 0; i < usable.length; i++) {
    const b64 = refB64[images.indexOf(usable[i])];
    if (b64) parts.push({ inlineData: { mimeType: "image/webp", data: b64 } });
  }

  try {
    const res = await ai.models.generateContent({
      model: RERANK_MODEL,
      contents: [{ role: "user", parts }],
      config: { maxOutputTokens: 500, httpOptions: { timeout: 60_000 } },
    });
    const text = res.text ?? "";
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as {
      bestIndex?: number;
      confidence?: number;
      ranking?: number[];
    };
    const order =
      Array.isArray(parsed.ranking) && parsed.ranking.length > 0
        ? parsed.ranking
        : typeof parsed.bestIndex === "number" && parsed.bestIndex >= 0
          ? [parsed.bestIndex]
          : [];
    if (order.length === 0) return null;

    const conf = Math.max(0, Math.min(1, parsed.confidence ?? 0.7));
    const seen = new Set<number>();
    const reranked: Candidate[] = [];
    for (const idx of order) {
      const img = usable[idx];
      if (!img || seen.has(idx)) continue;
      seen.add(idx);
      reranked.push({
        pinId: img.pinId,
        // Top of the LLM ranking gets its confidence; the rest decay below it.
        score: reranked.length === 0 ? conf : Math.max(0.1, conf - 0.1 * reranked.length),
        stage: 3,
      });
    }
    // Append any Stage-1 candidates the model didn't rank, preserving them.
    for (const c of stage1Candidates) {
      if (!reranked.some((r) => r.pinId === c.pinId)) reranked.push(c);
    }
    return reranked;
  } catch (err) {
    console.error("[pin-identify] stage 3 re-rank failed:", (err as Error)?.message ?? err);
    return null;
  }
}

/**
 * Run the full cascade for a scan photo (raw bytes). Returns ranked candidates
 * and the resolving stage. The worker persists the result to `pin_scan`.
 */
export async function runCascade(photo: Buffer): Promise<CascadeResult> {
  const embedding = await embedImage(photo);
  let candidates = await stage1(embedding);
  let stageResolved = 1;

  const top = candidates[0]?.score ?? 0;

  // Stage 2 (Web Detection) is OFF in Phase 1 by design — measure Stage-1 recall
  // first (see plan). When enabled, it would slot in here, gated on `top < 0.85`.

  // Stage 3: escalate to the LLM re-rank when Stage 1 isn't confident.
  if (top < STAGE3_TRIGGER && candidates.length > 1) {
    const photoB64 = photo.toString("base64");
    const reranked = await stage3(photoB64, candidates);
    if (reranked) {
      candidates = reranked;
      stageResolved = 3;
    }
  }

  // Always hand to human confirm on low confidence (Stage 4 is the client UX).
  const topConfidence = candidates[0]?.score ?? 0;
  if (topConfidence < STAGE3_TRIGGER) stageResolved = Math.max(stageResolved, 4);

  return { candidates: candidates.slice(0, TOP_N), topConfidence, stageResolved };
}
