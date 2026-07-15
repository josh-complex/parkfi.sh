/**
 * Network Information API access, shared by `useDataSaver` (image quality
 * scaling) and the image-preload gate (skip speculative warms on a constrained
 * pipe). The API is non-standard: present on Chrome/Android and Android
 * WebViews, absent on iOS Safari — absence simply reads as "not constrained".
 */

interface NetworkInformation extends EventTarget {
  saveData?: boolean;
  effectiveType?: string;
}

function connection(): NetworkInformation | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as { connection?: NetworkInformation }).connection;
}

/** Subscribe to connection changes (wifi → cell). No-op unsubscribe when the
 *  API is unavailable. */
export function subscribeConnection(cb: () => void): () => void {
  const c = connection();
  if (!c) return () => {};
  c.addEventListener("change", cb);
  return () => c.removeEventListener("change", cb);
}

/** True on a constrained connection: the user opted into data saving
 *  (Save-Data), or the effective type is 2g/3g — the congested in-park LTE
 *  case. False on the server and wherever the API doesn't exist. */
export function readDataSaver(): boolean {
  const c = connection();
  return Boolean(
    c &&
    (c.saveData ||
      c.effectiveType === "slow-2g" ||
      c.effectiveType === "2g" ||
      c.effectiveType === "3g"),
  );
}
