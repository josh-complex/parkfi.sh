import { Link } from "@tanstack/react-router";
import { ShapesIcon } from "lucide-react";

import { formatCents } from "#/components/pins/format.ts";
import { Image } from "#/components/ui/image.tsx";
import { cn } from "#/lib/utils.ts";

/** Catalog card shape — the subset every list endpoint returns. */
export interface PinCardData {
  id: string;
  name: string;
  series: string | null;
  characters: string[];
  year: number | null;
  editionType: string | null;
  leCount: number | null;
  park: string | null;
  estValueCents: number | null;
  imageUrl: string | null;
}

/**
 * Pin thumbnail that fades in over a muted box and degrades to a placeholder
 * icon when the image is missing or fails to load.
 */
export function PinImage({
  src,
  alt,
  className,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const fallback = (
    <div
      className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}
    >
      <ShapesIcon className="size-1/3 opacity-40" />
    </div>
  );
  return (
    <Image
      src={src}
      alt={alt}
      loading="lazy"
      fallback={fallback}
      className={cn("bg-muted object-contain", className)}
    />
  );
}

/** Grid card for the catalog, linking through to the pin detail page. */
export function PinCard({ pin }: { pin: PinCardData }) {
  const meta = [pin.series, pin.year != null ? String(pin.year) : null].filter(Boolean).join(" · ");
  return (
    <Link
      to="/pins/$pinId"
      params={{ pinId: pin.id }}
      className="group/pin flex flex-col gap-2 rounded-2xl border p-3 transition-colors hover:bg-accent/8"
    >
      <PinImage
        src={pin.imageUrl}
        alt={pin.name}
        className="aspect-square w-full rounded-xl bg-muted"
      />
      <div className="min-w-0 space-y-0.5">
        <p className="truncate text-sm font-medium">{pin.name}</p>
        {meta ? <p className="text-muted-foreground truncate text-xs">{meta}</p> : null}
        <p className="text-sm font-semibold tabular-nums">{formatCents(pin.estValueCents)}</p>
      </div>
    </Link>
  );
}
