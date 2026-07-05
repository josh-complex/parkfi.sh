import { FlaskConicalIcon, MapPinIcon, XIcon } from "lucide-react";
import * as React from "react";

import { DEV_SPOTS, type LngLat } from "#/lib/dev-location.ts";
import { cn } from "#/lib/utils.ts";
import { distanceMeters } from "#/server/living/geofence.ts";

type Dest = { name: string; coords: LngLat };

/**
 * Quick-destination picker for QA'ing walking directions. The caller gates it on
 * dev + the `nav-test-tools` PostHog flag, so it's hidden for normal users.
 * Tapping a spot starts walking directions to it from your *real* GPS location —
 * a way to exercise nav locally (around home) without driving to a park. It
 * never mocks or changes your location.
 */
export function DevLocationPanel({
  activeDest,
  onNavigate,
  onEndNav,
}: {
  /** The trip's current destination, for highlighting the active row. */
  activeDest: Dest | null;
  /** Start walking directions to this point (from real GPS). */
  onNavigate: (dest: Dest) => void;
  /** End the trip. */
  onEndNav: () => void;
}) {
  const [open, setOpen] = React.useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Dev destinations"
        className={cn(
          "pointer-events-auto absolute left-3 top-1/2 z-20 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-white shadow-lg ring-1 ring-white/20 transition active:scale-95",
          activeDest ? "bg-fuchsia-600" : "bg-black/60",
        )}
      >
        <FlaskConicalIcon className="size-4" />
      </button>
    );
  }

  return (
    <div className="pointer-events-auto absolute left-3 top-1/2 z-20 w-60 -translate-y-1/2 overflow-hidden rounded-2xl bg-black/80 text-white shadow-xl ring-1 ring-white/20 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <FlaskConicalIcon className="size-4 text-fuchsia-400" />
        <span className="flex-1 text-xs font-semibold">Test routing</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="inline-flex size-6 items-center justify-center rounded-full transition hover:bg-white/10"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      <div className="px-3 pt-2 text-[10px] uppercase tracking-wide text-white/40">
        Navigate here (from your location)
      </div>
      <ul className="max-h-64 overflow-y-auto py-1">
        {DEV_SPOTS.map((spot) => {
          const isActive = activeDest != null && distanceMeters(activeDest.coords, spot.coords) < 1;
          return (
            <li key={spot.id}>
              <button
                type="button"
                onClick={() => onNavigate({ name: spot.label, coords: spot.coords })}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-white/10",
                  isActive && "bg-fuchsia-600/30",
                )}
              >
                <MapPinIcon
                  className={cn(
                    "size-3.5 shrink-0",
                    isActive ? "text-fuchsia-300" : "text-white/50",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{spot.label}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {activeDest && (
        <div className="border-t border-white/10 px-3 py-2">
          <button
            type="button"
            onClick={onEndNav}
            className="inline-flex w-full items-center justify-center rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium transition hover:bg-white/25 active:scale-95"
          >
            End navigation
          </button>
        </div>
      )}
    </div>
  );
}
