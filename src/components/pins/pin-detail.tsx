"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, RepeatIcon } from "lucide-react";

import { ACTION_BAR_PAGE_PAD, DetailActionBar } from "#/components/detail/action-bar.tsx";
import { FactTile, TintPanel, WashPanel } from "#/components/detail/panels.tsx";
import {
  TICKET_DEFAULT_CREASE,
  Ticket,
  TicketChip,
  type TicketFact,
} from "#/components/detail/ticket.tsx";
import { DetailHero, HERO_PAGE_PADDING } from "#/components/detail-hero.tsx";
import { PAGE_WIDTH } from "#/components/page-container.tsx";
import { formatCents } from "#/components/pins/format.ts";
import { PinCollectionButtons } from "#/components/pins/pin-collection-buttons.tsx";
import { PinImage } from "#/components/pins/pin-card.tsx";
import { Button } from "#/components/ui/button.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

import type { inferRouterOutputs } from "@trpc/server";
import type { TRPCRouter } from "#/integrations/trpc/router.ts";

type PinDetailData = NonNullable<inferRouterOutputs<TRPCRouter>["pinCatalog"]["detail"]>;

/** How many of the series' other pins the wide column shows. Two rows of four. */
const SERIES_TILES = 8;

/**
 * `pin.edition_type` as PinPics codes it. Two thirds of the catalog records no
 * edition at all, and of the 16k rows marked "LE" only ~600 carry the run size
 * — so this reads the code first and adds the number only when we have one.
 * An unmapped code passes through verbatim rather than being dropped: it is
 * still something PinPics recorded about the pin.
 */
const EDITION_LABEL: Record<string, string> = {
  LE: "Limited Edition",
  LR: "Limited Release",
  open: "Open Edition",
  cast: "Cast Exclusive",
  mystery: "Mystery Pin",
};

/** "LE 1,000" when we know the run, the edition's own name when we only know that. */
function editionLabel(editionType: string | null, leCount: number | null): string | null {
  if (leCount != null) return `LE ${leCount.toLocaleString()}`;
  if (!editionType) return null;
  return EDITION_LABEL[editionType] ?? editionType;
}

/**
 * The reference gallery. Every photo we hold of this pin, the active one large
 * and the rest as a strip under it — the same picker the old page had, moved
 * onto the mint field and given the panel's own chrome.
 */
function Gallery({
  images,
  active,
  onSelect,
  name,
}: {
  images: PinDetailData["images"];
  active: string | null;
  onSelect: (url: string) => void;
  name: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 @lg/pin:grid-cols-4">
      {images.map((img) => (
        <button
          key={img.id}
          type="button"
          aria-pressed={active === img.url}
          aria-label={`Show reference photo of ${name}`}
          onClick={() => onSelect(img.url)}
          className={cn(
            "aspect-square overflow-hidden rounded-2xl bg-background/70 p-1.5 transition-shadow",
            active === img.url ? "ring-2 ring-mint-fg" : "hover:ring-2 hover:ring-mint-fg/40",
          )}
        >
          <PinImage src={img.url} alt="" className="size-full rounded-xl bg-transparent" />
        </button>
      ))}
    </div>
  );
}

/**
 * The `/pins/$pinId` page, on the ticket-stub system (docs/plans/dining-redesign
 * §4.7).
 *
 * A pin has no landscape photograph — it has a square product shot on a
 * transparent ground — so the hero is the system's photoless variant: a
 * `--wash` field with the pin's own art blurred across it and the sharp pin set
 * on a plate in the middle, which is the closest thing this page has to a
 * headline number.
 *
 * Pin data and imagery come from PinPics; the attribution chip stays on the
 * stub, and nothing here may appear in ad creative (memory
 * `pins-excluded-from-ads`).
 */
export function PinDetail({ pin }: { pin: PinDetailData }) {
  const trpc = useTRPC();

  const images =
    pin.images.length > 0
      ? pin.images
      : pin.imageUrl
        ? [{ id: "primary", url: pin.imageUrl, isPrimary: true }]
        : [];
  const initial = images.find((i) => i.isPrimary)?.url ?? images[0]?.url ?? null;
  const [active, setActive] = React.useState<string | null>(initial);
  React.useEffect(() => setActive(initial), [initial]);

  const [crease, setCrease] = React.useState(TICKET_DEFAULT_CREASE);

  // The rest of this pin's series — the wide column. A pin with no series has
  // no neighbourhood to show, and the column goes with it.
  const seriesQ = useQuery({
    ...trpc.pinCatalog.browse.queryOptions({
      series: pin.series ?? "",
      sort: "name",
      limit: SERIES_TILES + 1,
      cursor: 0,
    }),
    enabled: !!pin.series,
  });
  const siblings = (seriesQ.data?.pins ?? []).filter((p) => p.id !== pin.id).slice(0, SERIES_TILES);
  const hasGallery = images.length > 1;
  // Held open while the series query is out, so the page can't open one-column
  // and snap to two under the reader (the resort page's guard).
  const hasWide = hasGallery || (!!pin.series && (!seriesQ.data || siblings.length > 0));

  const edition = editionLabel(pin.editionType, pin.leCount);
  const placeLine = [pin.series, pin.park].filter(Boolean).join(" · ") || null;

  // ── Ticket contents ────────────────────────────────────────────────────────
  // Up to three, and often fewer — the pin catalog is thin on purpose-built
  // metadata. Two thirds of rows record no edition, three quarters no year, and
  // **`est_value_cents` is null for every pin we hold**, so the estimated value
  // §4.7 wanted to lead with does not exist and is not printed as an em dash
  // pretending to be a figure. What is left is the catalog's own identity data,
  // in the order it tells you something: what kind of pin, from when, from what
  // line, sold where, with whom on it. The stub carries whatever that yields
  // and drops the row when it yields nothing (see `Ticket`).
  const facts: Array<TicketFact> = [];
  const candidates: Array<TicketFact | null> = [
    pin.estValueCents != null
      ? { label: "Est. value", value: formatCents(pin.estValueCents) }
      : null,
    edition ? { label: "Edition", value: edition } : null,
    pin.year != null ? { label: "Year", value: String(pin.year) } : null,
    pin.series ? { label: "Series", value: pin.series } : null,
    pin.park ? { label: "Park", value: pin.park } : null,
    pin.characters[0] ? { label: "Character", value: pin.characters[0] } : null,
  ];
  for (const f of candidates) {
    if (facts.length >= 3) break;
    if (f) facts.push(f);
  }

  // Characters, capped, plus the attribution the licence requires — minus
  // whichever character the facts above had to borrow to reach three, since a
  // stub that says "Character · Stitch" and then chips "Stitch" is repeating
  // itself to fill space. The PinPics chip is a chip rather than a line of
  // small print because the stub is where this page says where its material
  // came from.
  const named = new Set(facts.map((f) => f.value));
  const remaining = pin.characters.filter((c) => !named.has(c));
  const chars = remaining.slice(0, 4);
  const foldedChars = remaining.slice(4);

  return (
    <div
      style={{ "--crease": `${crease}px` } as React.CSSProperties}
      className={cn(PAGE_WIDTH, "flex flex-col", HERO_PAGE_PADDING, ACTION_BAR_PAGE_PAD)}
    >
      {/* The field, with the pin's own art blurred across it for colour and the
          sharp pin on a plate in the middle. Not `underNav` — see the note on
          the menu-item page: the masthead turns its links white over artwork,
          and this ground is a pale blue. */}
      <DetailHero
        heroKey={`pin-${pin.id}`}
        name={pin.name}
        subtitle={placeLine}
        image={active}
        flying={false}
        entrance={false}
        tear
        crease="always"
        titleless
        field={{
          subject: (
            <div className="rounded-[26px] bg-background/90 p-3 shadow-lg backdrop-blur-sm">
              <PinImage
                src={active}
                alt={pin.name}
                className="size-32 rounded-2xl bg-transparent sm:size-36 md:size-40"
              />
            </div>
          ),
        }}
      />

      <div
        className={cn(
          "flex flex-col gap-5",
          hasWide
            ? "wide:grid wide:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] wide:grid-rows-[auto_1fr] wide:items-start wide:gap-x-6 wide:gap-y-5 xl:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]"
            : "md:max-w-[34rem]",
        )}
      >
        <Ticket
          onCreaseHeight={setCrease}
          className="mt-[calc(var(--crease)*-1)] md:mx-auto md:w-full md:max-w-[34rem] wide:col-start-1 wide:row-start-1 wide:-mx-4.5 wide:w-auto wide:max-w-none"
          title={pin.name}
          subtitle={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {placeLine && <span>{placeLine}</span>}
              {edition && <TicketChip accent>{edition}</TicketChip>}
            </span>
          }
          facts={facts}
          chips={
            <>
              {chars.map((c) => (
                <TicketChip key={c}>{c}</TicketChip>
              ))}
              {foldedChars.length > 0 && (
                <TicketChip title={foldedChars.join(" · ")}>+{foldedChars.length}</TicketChip>
              )}
              <TicketChip>Photos: PinPics</TicketChip>
            </>
          }
        />

        {/* The neighbourhood: every reference photo we hold, then the rest of
            the series. Spans both grid rows so it runs up beside the ticket;
            last on a phone. */}
        {hasWide && (
          <div className="order-3 flex flex-col gap-5 @container/pin wide:col-start-2 wide:row-span-2 wide:row-start-1 wide:pt-4">
            {hasGallery && (
              <TintPanel
                tone="mint"
                size="lg"
                title="Reference photos"
                meta={
                  <span className="text-[13px] font-semibold text-mint-label">
                    {images.length} shots
                  </span>
                }
              >
                <Gallery images={images} active={active} onSelect={setActive} name={pin.name} />
              </TintPanel>
            )}
            {siblings.length > 0 && pin.series && (
              <section className="flex flex-col overflow-hidden rounded-[22px] border border-card-edge bg-card">
                <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-1 @md/pin:px-5 @md/pin:pt-5">
                  <h2 className="min-w-0 truncate text-[19px] font-extrabold tracking-[-0.01em]">
                    More from {pin.series}
                  </h2>
                  {/* The catalog's own series filter is local state, not a
                      search param, so this can only open the catalog — not the
                      catalog already filtered. Worth a link anyway; worth
                      inventing a URL contract for, not yet. */}
                  <Link
                    to="/pins"
                    className="group flex shrink-0 items-center gap-1 text-xs font-bold text-wash-fg hover:underline"
                  >
                    All pins
                    <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </div>
                <div className="grid grid-cols-3 gap-2 p-2 @md/pin:gap-3 @md/pin:p-4 @2xl/pin:grid-cols-4">
                  {siblings.map((p) => (
                    <Link
                      key={p.id}
                      to="/pins/$pinId"
                      params={{ pinId: p.id }}
                      className="group flex flex-col gap-1.5"
                    >
                      <PinImage
                        src={p.imageUrl}
                        alt={p.name}
                        className="aspect-square w-full rounded-2xl bg-muted transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                      <span className="line-clamp-2 px-0.5 text-[12px] leading-tight font-semibold">
                        {p.name}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* The rest of the narrow column, under the ticket. */}
        <div className="contents wide:col-start-1 wide:row-start-2 wide:flex wide:flex-col wide:gap-5">
          {/* The page's job: put this pin on one of your two lists, and find
              somebody holding the other one. */}
          <WashPanel
            title="Trade it"
            meta={pin.availableForTrade > 0 ? "Somebody's holding one" : "Nobody's offering yet"}
          >
            <div className="grid grid-cols-2 gap-2">
              <FactTile
                label="Available to trade"
                value={pin.availableForTrade.toLocaleString()}
                className="bg-background/70"
              />
              <FactTile
                label="Collectors want it"
                value={pin.wantedBy.toLocaleString()}
                className="bg-background/70"
              />
            </div>

            {/* Desktop's keys. The phone's live in the floating action bar, so
                the page carries exactly one set at any width. */}
            <PinCollectionButtons pinId={pin.id} variant="key" className="hidden md:flex" />
            <Button
              variant="outline"
              size="lg"
              className="hidden font-bold md:inline-flex md:w-fit"
              render={<Link to="/pins/trades" />}
            >
              <RepeatIcon />
              Find a trade
            </Button>
          </WashPanel>

          <div className="order-2 flex flex-wrap items-center gap-2 wide:contents">
            <Button variant="outline" className="font-bold" render={<Link to="/pins" />}>
              Back to the catalog
            </Button>
          </div>
        </div>
      </div>

      {/* The phone's one-line answer. */}
      <DetailActionBar>
        <PinCollectionButtons
          pinId={pin.id}
          variant="key"
          compact
          className="min-w-0 flex-1 flex-nowrap [&>button]:h-12 [&>button]:min-w-0 [&>button]:flex-1 [&>button]:text-[15px]"
        />
      </DetailActionBar>
    </div>
  );
}
