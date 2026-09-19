import * as React from "react";
import { Link } from "@tanstack/react-router";
import posthog from "posthog-js";

import { PAGE_WIDTH } from "#/components/page-container.tsx";
import { Delta, ParkStrip } from "#/components/rides/park-strip.tsx";
import { WaitBadge } from "#/components/rides/wait-badge.tsx";
import { Image } from "#/components/ui/image.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { formatParkName } from "#/lib/parks.ts";
import { cn } from "#/lib/utils.ts";

import type { MoverRow, ParkPulse, Pick, Ride } from "./waits-data.ts";

/**
 * The poster box CF is asked for, in the proportion the desktop grid renders it
 * — the widest the poster ever gets, so the phone's narrower cell crops from a
 * large enough source rather than upscaling a small one.
 */
const LEAD_BOX = { w: 480, h: 228 };
const POSTER_BOX = { w: 260, h: 228 };
/**
 * The lead poster's share of the rail. Wide enough that the top pick reads as
 * the panel's subject rather than the first of five equal things, narrow enough
 * that four runners-up still hold a two-line ride name beside it.
 */
const LEAD_FR = 1.85;
/** The lead's width on a phone, where the rail scrolls instead of dividing. */
const LEAD_W = 236;
const POSTER_W = 132;

/**
 * One pick, as a poster: the ride's own photograph full-bleed under a scrim,
 * with the park, the name, the reason it was picked and the live wait set on
 * top of it. `lead` is the top pick — the double-wide cell that gives the panel
 * a subject.
 *
 * The whole poster is the link and wears the 3D key chrome, the same as the
 * park cards above it; the flat list rows below deliberately don't.
 */
function PickPoster({ pick, rank, lead }: { pick: Pick; rank: number; lead?: boolean }) {
  const { ride, reason } = pick;
  return (
    <Link
      to="/park/$slug/ride/$rideSlug"
      params={{ slug: ride.parkSlug, rideSlug: ride.slug }}
      onClick={() =>
        posthog.capture("waits_pick_clicked", {
          rideSlug: ride.slug,
          parkSlug: ride.parkSlug,
          rule: pick.rule,
          rank,
          waitMin: ride.standbyWait,
        })
      }
      style={{ "--poster-w": `${lead ? LEAD_W : POSTER_W}px` } as React.CSSProperties}
      className={cn(
        // The chrome's ghost key, same as the park strip's cards: a faint light
        // rim and the shallow shelf under it, both out of `btn-3d-ghost`'s one
        // variable. A *dark* shelf below a dark poster on a dark field was
        // three darks arguing; this one lifts the photograph off the band
        // instead of burying it.
        "btn-3d-ghost border-3d shadow-3d hover:shadow-3d-hover active:shadow-3d-active",
        "relative block h-full w-[var(--poster-w)] shrink-0 overflow-hidden bg-neutral-800 text-white transition",
        // The rail is a scroller on a phone and a grid from `lg`, so the poster
        // is sized by that width in one and by its track in the other. The width
        // rides on a custom property because an inline `width` would outrank
        // `lg:w-auto` and pin the poster to its phone size on desktop.
        "lg:w-auto",
        lead ? "rounded-[20px]" : "rounded-[16px]",
      )}
    >
      <PosterArt ride={ride} lead={lead} />
      <span
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/5"
      />
      {lead && (
        <span className="absolute top-2.5 left-2.5 rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-extrabold tracking-[0.1em] uppercase backdrop-blur-sm">
          Top pick
        </span>
      )}
      <WaitBadge
        ride={ride}
        className={cn("absolute top-2.5 right-2.5", lead && "px-2.5 py-1 text-[13px] font-bold")}
      />
      <span
        className={cn(
          "absolute right-2.5 bottom-2.5 left-2.5 flex flex-col gap-0.5",
          lead && "right-3 bottom-3 left-3",
        )}
      >
        <span className="truncate text-[9.5px] font-extrabold tracking-[0.05em] text-white/78 uppercase">
          {formatParkName(ride.parkName)}
        </span>
        <span
          className={cn(
            "line-clamp-2 font-extrabold tracking-[-0.012em] [text-shadow:0_1px_6px_rgb(0_0_0_/_0.65)]",
            lead ? "text-[19px] leading-[1.12] lg:text-[21px]" : "text-[13.5px] leading-[1.14]",
          )}
        >
          {ride.name}
        </span>
        {/* The reason is the whole point of a pick — it survives at every size,
            clipped to one line rather than dropped. */}
        <span className="truncate text-[11px] font-semibold text-white/86">{reason}</span>
      </span>
    </Link>
  );
}

/**
 * A poster's art. The card-sized (600px) variant, not the 56px thumb the old
 * rows used — a thumb stretched over a 280px poster is worse than no photo.
 */
function PosterArt({ ride, lead }: { ride: Ride; lead?: boolean }) {
  const src = ride.imageCardUrl ?? ride.imageThumbUrl;
  if (!src) return null;
  const box = lead ? LEAD_BOX : POSTER_BOX;
  return (
    <Image
      src={src}
      alt=""
      boxWidth={box.w}
      aspect={box.w / box.h}
      placeholder={ride.imageThumbhash}
      className="absolute inset-0 size-full object-cover"
    />
  );
}

/**
 * The picks rail: the lead poster and its runners-up. A phone scrolls it,
 * bleeding to the panel's edge so a partial poster advertises the scroll; from
 * `lg` it divides the panel's width, the lead taking `LEAD_FR` of it.
 */
function PicksRail({ picks }: { picks: ReadonlyArray<Pick> }) {
  const rest = picks.length - 1;
  return (
    <div
      style={{
        gridTemplateColumns: rest > 0 ? `${LEAD_FR}fr repeat(${rest}, minmax(0, 1fr))` : "1fr",
      }}
      className={railClass}
    >
      {picks.map((p, i) => (
        <PickPoster key={p.ride.id} pick={p} rank={i + 1} lead={i === 0} />
      ))}
    </div>
  );
}

/**
 * The rail's shell, shared with its skeleton so the blanks occupy the exact
 * footprint the posters will. The `-my-1 py-1` gives the posters' 3D shelf room
 * inside the scroll box — vertical overflow is clipped in a horizontal
 * scroller, and a sliced shelf reads as a rendering bug.
 */
const railClass = cn(
  "-mx-4 -my-1 flex h-[214px] gap-2.5 overflow-x-auto px-4 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  // 206px of poster on a phone, 228 from `lg`, plus the 8px the shelf needs.
  "lg:mx-0 lg:grid lg:h-[236px] lg:overflow-x-visible lg:px-0",
);

function RailSkeleton() {
  return (
    <div
      aria-hidden
      style={{ gridTemplateColumns: `${LEAD_FR}fr repeat(4, minmax(0, 1fr))` }}
      className={railClass}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton
          key={i}
          style={{ "--poster-w": `${i === 0 ? LEAD_W : POSTER_W}px` } as React.CSSProperties}
          className={cn(
            "h-full w-[var(--poster-w)] shrink-0 bg-white/10 lg:w-auto",
            i === 0 ? "rounded-[20px]" : "rounded-[16px]",
          )}
        />
      ))}
    </div>
  );
}

/** One row on the Dropping / Climbing halves. */
function MoverLine({ row, tone }: { row: MoverRow; tone: "mint" | "peach" }) {
  const src = row.ride?.imageThumbUrl;
  return (
    <Link
      to="/park/$slug/ride/$rideSlug"
      params={{ slug: row.parkSlug, rideSlug: row.rideSlug }}
      onClick={() =>
        posthog.capture("waits_mover_clicked", {
          rideSlug: row.rideSlug,
          direction: row.delta < 0 ? "down" : "up",
          delta: row.delta,
        })
      }
      className={cn(
        "-mx-1.5 grid grid-cols-subgrid items-center rounded-xl px-1.5 py-1 transition hover:bg-white/10",
        MOVER_SPAN,
      )}
    >
      {src ? (
        <Image
          src={src}
          alt=""
          boxWidth={52}
          aspect={1}
          placeholder={row.ride?.imageThumbhash}
          className="size-[26px] rounded-full object-cover"
        />
      ) : (
        <span aria-hidden className="size-[26px] rounded-full bg-white/15" />
      )}
      <span className="min-w-0 truncate text-[12.5px] font-bold text-white/92">{row.rideName}</span>
      <span
        className={cn(
          // No width cap: the park sits in an `auto` track, so it sizes to the
          // longest name in the column ("Islands of Adventure") and the ride
          // name — the flexible track — gives up the difference. A 120px cap
          // clipped every Universal park to "ISLANDS OF ADVEN…" while the row
          // still had room to spare.
          "hidden truncate justify-self-end text-[10px] font-extrabold tracking-[0.05em] uppercase xl:block",
          tone === "mint" ? "text-mint-label" : "text-peach-sub",
        )}
      >
        {formatParkName(row.parkName)}
      </span>
      <Delta value={row.delta} onArt verbose className="justify-self-end text-xs" />
      <WaitBadge
        ride={row.ride ?? { status: "OPERATING", standbyWait: row.waitMin }}
        className="justify-self-end"
      />
    </Link>
  );
}

/**
 * The half's rows are a table with its headings left unwritten: one set of
 * column tracks, shared by every row through `grid-cols-subgrid`, so the park,
 * the delta and the wait pill line up down the column instead of each row
 * packing them wherever its own name happened to end. The name track is the
 * only flexible one — everything else is sized to the widest value in it.
 *
 * The park column only exists from `xl`, where a half is wide enough to spend a
 * track on it, so the track list changes with it rather than leaving an empty
 * column and its gap behind.
 */
const MOVER_TABLE =
  "grid grid-cols-[26px_minmax(0,1fr)_auto_auto] items-center gap-x-2 xl:grid-cols-[26px_minmax(0,1fr)_auto_auto_auto]";
const MOVER_SPAN = "col-span-4 xl:col-span-5";

/**
 * One side of the movers card. The tint lives on the heading and the park
 * kicker only: on a shared surface, two filled tint fields butted together read
 * as two competing panels, which is the thing this layout set out to stop.
 */
function MoverHalf({
  tone,
  title,
  rows,
  loading,
  empty,
  divided,
}: {
  tone: "mint" | "peach";
  title: string;
  rows: ReadonlyArray<MoverRow>;
  loading: boolean;
  empty: string;
  /** The right-hand half, which carries the rule between the two. */
  divided?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 p-3.5 md:p-4",
        divided && "border-t border-white/12 md:border-t-0 md:border-l",
      )}
    >
      <div className="mb-0.5 flex items-baseline justify-between gap-3">
        <h2
          className={cn(
            "text-[15px] font-extrabold tracking-[-0.01em]",
            tone === "mint" ? "text-mint-fg" : "text-peach-fg",
          )}
        >
          {title}
        </h2>
        <span
          className={cn(
            "shrink-0 text-[10px] font-extrabold tracking-[0.06em] uppercase",
            tone === "mint" ? "text-mint-label" : "text-peach-sub",
          )}
        >
          {/* The server compares against a reading at least 30 minutes old
              (`parks.movers`), and every reason line on the panel already says
              "since 3 PM" off that same half hour — "last hour" was the one
              place on the page claiming a window nothing actually used. */}
          last 30 min
        </span>
      </div>
      {loading ? (
        <div className="flex flex-col gap-1" aria-hidden>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[34px] rounded-xl bg-white/10" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-1.5 text-sm text-white/65">{empty}</p>
      ) : (
        <div className={MOVER_TABLE}>
          {rows.map((r) => (
            <MoverLine key={r.rideId} row={r} tone={tone} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The band: a full-bleed dark field carrying the picks and, under them, both
 * mover shelves.
 *
 * The field is the masthead's own gradient run tall on desktop, and a radial lit
 * from the top centre on the phone (`band-waits`, which explains why the two
 * differ). The picks panel *dissolves into it* — no pale wash, no border, the
 * posters sitting straight on the dark. The posters are dark-edged photographs, so on a
 * pale field they were five bright rectangles inside a sixth; on this one they
 * are the only lit thing on the row, which is the whole argument for making the
 * band media-forward in the first place.
 *
 * The movers keep a card, but a translucent one — glass over the same field
 * rather than a second surface on top of it. Their mint and peach are pinned to
 * the dark-theme pair by `band-tints`, because this field is dark in *both*
 * themes and the light mint is invisible on navy.
 *
 * The park strip leads the band rather than sitting above it on the page
 * background. The cards choose what the panel underneath is about, so the
 * question and its answer belong on one surface; split across two, the parks
 * read as page furniture and the band as an advert that wandered in.
 *
 * The strip is unconditional; the panels below it are not. With nothing open in
 * the parks you're looking at — the whole resort at 3am, or just EPCOT once it
 * has shut for the night — "Worth walking to in EPCOT" over an empty rail is a
 * broken promise, so the picks and both mover shelves go and the band closes up
 * to the row of cards. The cards stay because they are the *control*: they say
 * which parks are shut and they are how you ask about a different one, and a
 * page that answers "nothing" by removing the question is a dead end.
 *
 * "Open" here is each park's calendar, not its ride count — see `parkPulses`.
 * A park on its event hours with no queue posting yet is open, and the band
 * stays with it.
 *
 * The gate waits for the parks to actually arrive (`parks` is empty in flight),
 * so the band skeletons whole rather than flashing a strip on its own. It does
 * *not* wait on the slower movers query: a park is shut whether or not we yet
 * know what moved inside it, so there's no sense skeletoning a panel that is
 * about to be hidden anyway.
 *
 * Both blocks reserve their height while `parks.movers` is in flight so the band
 * never shoves the results down when it lands.
 */
export function WaitsBlurbs({
  parks,
  selected,
  onTogglePark,
  parksLoading,
  picks,
  dropping,
  climbing,
  parkName,
  loading,
}: {
  parks: ReadonlyArray<ParkPulse>;
  selected: ReadonlySet<string>;
  onTogglePark: (slug: string) => void;
  /** `allRides` still in flight — the strip shows its ghost cards. */
  parksLoading?: boolean;
  picks: ReadonlyArray<Pick>;
  dropping: ReadonlyArray<MoverRow>;
  climbing: ReadonlyArray<MoverRow>;
  /** Named when exactly one park is selected — the panel re-points at it (§2.2). */
  parkName?: string;
  loading: boolean;
}) {
  // An empty selection means "any park", so it scopes to the whole resort —
  // the same reading `scopedRides` upstream gives it. An empty `parks` means
  // the ride feed hasn't landed: nothing is decided, so the panels skeleton.
  const showPanels =
    parks.length === 0 ||
    (selected.size === 0
      ? parks.some((p) => !p.closed)
      : parks.some((p) => selected.has(p.slug) && !p.closed));

  return (
    <section
      className={cn(
        "band-waits band-tints pb-5 text-white md:pb-7",
        // Phone: the same move, against the other header. The floating search
        // pill and the account key ride on nothing — `SiteHeader` is
        // deliberately transparent so the page shows through it — and what
        // showed through here was the app shell's own `--background`, which put
        // a theme-coloured slab above a navy board and a hard seam between
        // them. Pulling the band up by the header's locked height
        // (`--safe-top + --app-header-h`, the same figure every full-bleed hero
        // uses) runs the field to y=0 and the chrome floats on the navy, the
        // way it does over a hero photo. The padding gives the pull back, so
        // nothing inside the band moves.
        "mt-[calc((var(--safe-top)+var(--app-header-h))*-1)]",
        "pt-[calc(var(--safe-top)+var(--app-header-h)+1.25rem)]",
        // Desktop only: run the field up behind the floating nav so the glass
        // capsule sits *on* the navy rather than on the page background above
        // it — the board opens on one continuous dark field. The top padding
        // gives the pull straight back, so nothing inside the band moves.
        //
        // The pull clears the capsule's slab *and* the pinned stripe, taking
        // the field all the way to y=0 rather than stopping under the stripe.
        // Visually it's the same picture — the stripe is opaque and covers what
        // it covers — but stopping at its lower edge meant trusting two
        // independently rounded measurements to meet on a subpixel, and when
        // they missed, the page background showed through the miss as a white
        // hairline across the top of the board. An overlap cannot miss.
        //
        // Both vars are `0px` wherever this chrome isn't (mobile, any non-app
        // route), which makes the whole thing a no-op rather than a special case.
        "md:mt-[calc((var(--floating-nav-height)+var(--site-header-height))*-1)]",
        "md:pt-[calc(var(--floating-nav-height)+var(--site-header-height)+1.75rem)]",
      )}
    >
      <div className={cn(PAGE_WIDTH, "flex flex-col gap-4 max-w-480!")}>
        <ParkStrip
          parks={parks}
          selected={selected}
          onToggle={onTogglePark}
          loading={parksLoading}
        />

        {showPanels && (
          <>
            <div className="flex flex-col gap-3.5 md:gap-4.5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="min-w-0 text-[22px] font-extrabold tracking-[-0.01em] [text-shadow:0_1px_8px_rgb(0_0_0_/_0.4)] md:text-[26px] md:tracking-[-0.015em]">
                  {parkName ? `Worth walking to in ${parkName}` : "Worth walking to right now"}
                </h2>
                <span className="hidden shrink-0 text-[13px] font-semibold text-white/72 sm:inline">
                  {parkName ? "this park" : "any park"}
                </span>
              </div>

              {loading ? (
                <RailSkeleton />
              ) : picks.length === 0 ? (
                <p className="py-2 text-sm text-white/72">
                  Nothing stands out right now — every queue is sitting about where it should be.
                </p>
              ) : (
                <PicksRail picks={picks} />
              )}

              <span className="text-[13px] text-white/72 max-w-400 mx-auto w-full">
                Picked from live waits, the last half hour&rsquo;s movement, and what each queue is
                normally doing at this time of day.
              </span>
            </div>

            <div className="grid rounded-[26px] max-w-7xl w-full mx-auto border border-white/12 bg-white/6 md:grid-cols-2">
              <MoverHalf
                tone="mint"
                title="Dropping"
                rows={dropping}
                loading={loading}
                empty="No queue has fallen much in the last half hour."
              />
              <MoverHalf
                tone="peach"
                title="Climbing"
                rows={climbing}
                loading={loading}
                empty="Nothing is filling up right now."
                divided
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
