import { isNative } from "#/lib/platform.ts";

export interface ShareContent {
  title?: string;
  /** Body text; the URL is appended by the OS sheet when `url` is set. */
  text?: string;
  url?: string;
  /** iOS/Android share-sheet header. */
  dialogTitle?: string;
}

export type ShareResult = "shared" | "copied" | "dismissed" | "unavailable";

/**
 * Share an achievement / ride recap / personal best through the OS share sheet.
 *
 * Achievements and PBs are inherently social objects and a free acquisition
 * loop, so this works on *both* surfaces: native goes through `@capacitor/share`
 * (dynamically imported, kept out of the web bundle), web uses the Web Share API
 * where present and otherwise copies the link to the clipboard so the affordance
 * never dead-ends. Never throws — returns a discriminant the caller can toast on
 * ("Link copied", etc.).
 */
export async function shareContent(content: ShareContent): Promise<ShareResult> {
  if (isNative()) {
    try {
      const { Share } = await import("@capacitor/share");
      const can = await Share.canShare();
      if (!can.value) return copyFallback(content);
      await Share.share(content);
      return "shared";
    } catch (err) {
      // The user cancelling the sheet rejects on iOS — treat as a dismiss, not
      // a failure, and don't fall through to a surprise clipboard write.
      if (isDismiss(err)) return "dismissed";
      return copyFallback(content);
    }
  }

  if (typeof navigator !== "undefined" && "share" in navigator) {
    try {
      await (navigator as Navigator & { share: (d: ShareContent) => Promise<void> }).share({
        title: content.title,
        text: content.text,
        url: content.url,
      });
      return "shared";
    } catch (err) {
      if (isDismiss(err)) return "dismissed";
      return copyFallback(content);
    }
  }

  return copyFallback(content);
}

function isDismiss(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /cancel|abort|dismiss/i.test(msg) || (err as { name?: string })?.name === "AbortError";
}

async function copyFallback(content: ShareContent): Promise<ShareResult> {
  const link = content.url ?? content.text ?? "";
  if (!link || typeof navigator === "undefined" || !navigator.clipboard) return "unavailable";
  try {
    await navigator.clipboard.writeText(link);
    return "copied";
  } catch {
    return "unavailable";
  }
}
