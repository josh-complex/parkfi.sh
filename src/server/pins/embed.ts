/**
 * Client for the self-hosted CLIP embedding service (`services/pin-embed`,
 * Python + open_clip). One forward pass per image, no per-call API fee — this is
 * the cheap Stage-1 backbone of the identification cascade.
 *
 * The service exposes `POST /embed { urls?: string[], images?: string[] }` and
 * returns `{ model: string, embeddings: number[][] }` (768-dim, ViT-L/14, L2-
 * normalized so cosine distance is meaningful). `images` are base64 (no data-URI
 * prefix); `urls` are fetched server-side. Prefer `urls` for reference images
 * already in R2; use `images` for a freshly-uploaded scan photo.
 */

/**
 * Base URL of the embed service (Railway private network at runtime).
 *
 * Railway exposes internal services as a bare `host:port` with no scheme
 * (e.g. `pin-embed.railway.internal:8000`); `fetch` rejects that with
 * `ERR_INVALID_URL`. Normalize by prepending `http://` when no scheme is
 * present, and strip any trailing slash so `${PIN_EMBED_URL}/embed` is clean.
 */
export const PIN_EMBED_URL = normalizeBaseUrl(process.env.PIN_EMBED_URL ?? "http://localhost:8000");

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

/** Identifier stored on every `pin_embedding.model` — bump on a re-embed. */
export const EMBED_MODEL = process.env.PIN_EMBED_MODEL ?? "open_clip:ViT-L-14:v1";

/** Embedding dimensionality (must match the `vector(N)` column in the schema). */
export const EMBED_DIM = 768;

export interface EmbedResult {
  model: string;
  embeddings: number[][];
}

interface EmbedRequest {
  urls?: string[];
  images?: string[];
}

const TIMEOUT_MS = Number(process.env.PIN_EMBED_TIMEOUT_MS ?? 30_000);

async function callEmbed(body: EmbedRequest): Promise<EmbedResult> {
  const res = await fetch(`${PIN_EMBED_URL}/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`pin-embed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as EmbedResult;
  if (!Array.isArray(json.embeddings)) {
    throw new Error("pin-embed: malformed response (no embeddings)");
  }
  for (const e of json.embeddings) {
    if (!Array.isArray(e) || e.length !== EMBED_DIM) {
      throw new Error(`pin-embed: expected ${EMBED_DIM}-dim vectors, got ${e?.length}`);
    }
  }
  return json;
}

/** Embed images already hosted at public URLs (e.g. R2 reference images). */
export async function embedUrls(urls: string[]): Promise<EmbedResult> {
  if (urls.length === 0) return { model: EMBED_MODEL, embeddings: [] };
  return callEmbed({ urls });
}

/** Embed raw image bytes (a scan photo) — `image` is a Buffer or base64 string. */
export async function embedImage(image: Buffer | string): Promise<number[]> {
  const b64 = typeof image === "string" ? image : image.toString("base64");
  const { embeddings } = await callEmbed({ images: [b64] });
  const vec = embeddings[0];
  if (!vec) throw new Error("pin-embed: no embedding returned for scan photo");
  return vec;
}

/** Format a JS number[] as the `[1,2,3]` literal pgvector accepts on the wire. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
