/**
 * USPTO Open Data Portal (ODP) client bits shared by the trademark and patent
 * adapters (plan §5.9–5.10). Every ODP call — bulk-dataset listings, bulk
 * file downloads, the patent search — needs the free `USPTO_ODP_API_KEY`
 * (a USPTO.gov account with MFA; probed 2026-09-05: `/datasets/products/*`
 * and `/patent/applications/search` both answer 401/403 without it, so the
 * plan's "keyless TDXF" assumption no longer holds).
 */
export const ODP_BASE = "https://api.uspto.gov/api/v1";
export const ODP_API_KEY_ENV = "USPTO_ODP_API_KEY";

export function odpApiKey(): string | null {
  const key = process.env[ODP_API_KEY_ENV]?.trim();
  return key ? key : null;
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const key = odpApiKey();
  if (!key) throw new Error(`${ODP_API_KEY_ENV} is not set`);
  return { "x-api-key": key, accept: "application/json", ...extra };
}

export async function odpJson<T>(
  fetchFn: typeof fetch,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${ODP_BASE}${path}`;
  const res = await fetchFn(url, {
    method: init.method ?? "GET",
    headers: headers(init.body !== undefined ? { "content-type": "application/json" } : undefined),
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  if (!res.ok) {
    throw new Error(
      `ODP ${init.method ?? "GET"} ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

/** One file of a bulk-data product (`productFileBag.fileDataBag[]`). */
export interface OdpProductFile {
  fileName: string;
  /** ISO date the file's data covers (daily products: from == to). */
  fileDataFromDate: string;
  fileDataToDate: string;
  fileDownloadURI: string;
  fileSize: number | null;
  fileReleaseDate: string | null;
}

interface ProductResponse {
  bulkDataProductBag?: Array<{
    productIdentifier?: string;
    productFileBag?: { count?: number; fileDataBag?: Array<Partial<OdpProductFile>> };
  }>;
}

/**
 * Files of a bulk product whose data date falls in [from, to], oldest first.
 * The date window is passed to the API and re-applied here, so a product that
 * ignores the params still yields the right slice.
 */
export async function listProductFiles(
  fetchFn: typeof fetch,
  productId: string,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<OdpProductFile[]> {
  const params = new URLSearchParams({
    fileDataFromDate: from,
    fileDataToDate: to,
    includeFiles: "true",
  });
  const body = await odpJson<ProductResponse>(
    fetchFn,
    `/datasets/products/${productId}?${params}`,
    {
      signal,
    },
  );
  const files = body.bulkDataProductBag?.flatMap((p) => p.productFileBag?.fileDataBag ?? []) ?? [];
  return files
    .filter(
      (f): f is OdpProductFile =>
        typeof f.fileName === "string" &&
        typeof f.fileDownloadURI === "string" &&
        typeof f.fileDataFromDate === "string" &&
        f.fileDataFromDate >= from &&
        f.fileDataFromDate <= to,
    )
    .map((f) => ({
      fileName: f.fileName,
      fileDataFromDate: f.fileDataFromDate,
      fileDataToDate: f.fileDataToDate ?? f.fileDataFromDate,
      fileDownloadURI: f.fileDownloadURI,
      fileSize: typeof f.fileSize === "number" ? f.fileSize : null,
      fileReleaseDate: f.fileReleaseDate ?? null,
    }))
    .sort((a, b) => a.fileDataFromDate.localeCompare(b.fileDataFromDate));
}

/** Download one bulk file (the URI is on the same keyed host). */
export async function downloadProductFile(
  fetchFn: typeof fetch,
  uri: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  const res = await fetchFn(uri, { headers: headers({ accept: "*/*" }), signal });
  if (!res.ok) throw new Error(`ODP download ${uri} HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** `YYYY-MM-DD` in UTC for `days` days before `now`. */
export function isoDaysAgo(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}
