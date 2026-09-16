import { Badge } from "#/components/ui/badge.tsx";
import { cn } from "#/lib/utils.ts";

/** What a non-OPERATING status reads as on a pill. */
export function statusLabel(status: string | null): string {
  switch (status) {
    case "DOWN":
      return "Down";
    case "REFURBISHMENT":
      return "Refurb";
    default:
      return "Closed";
  }
}

/**
 * Solid, image-legible wait badge (mirrors the Eats status-badge treatment).
 * The colour ladder is 20 / 45 / 75 minutes — green, amber, orange, red.
 */
export function waitBadgeClass(ride: {
  status: string | null;
  standbyWait: number | null;
}): string {
  if (ride.status !== "OPERATING") return "bg-black/60 text-white backdrop-blur-sm";
  const w = ride.standbyWait;
  if (w == null) return "bg-sky-500 text-white";
  if (w < 20) return "bg-emerald-500 text-white";
  if (w < 45) return "bg-amber-500 text-white";
  if (w < 75) return "bg-orange-500 text-white";
  return "bg-red-500 text-white";
}

/**
 * The one wait pill the whole Waits surface uses — the list rows, the tiles,
 * the picks panel and the mover rows. Colour is never the only signal (§9): the
 * pill always carries the number or the status word.
 */
export function WaitBadge({
  ride,
  className,
}: {
  ride: { status: string | null; standbyWait: number | null };
  className?: string;
}) {
  const label =
    ride.status === "OPERATING"
      ? ride.standbyWait != null
        ? `${ride.standbyWait} min`
        : "Open"
      : statusLabel(ride.status);
  return (
    <Badge
      className={cn(
        "border-0 text-xs font-normal tabular-nums shadow",
        waitBadgeClass(ride),
        className,
      )}
    >
      {label}
    </Badge>
  );
}
