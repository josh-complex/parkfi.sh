"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { TrendingDownIcon, TrendingUpIcon, UtensilsCrossedIcon } from "lucide-react";

import { ACTION_BAR_PAGE_PAD, DetailActionBar } from "#/components/detail/action-bar.tsx";
import { Band, BandHeading } from "#/components/detail/band.tsx";
import { DetailCard, FactTile, TintPanel, WashPanel } from "#/components/detail/panels.tsx";
import {
  TICKET_DEFAULT_CREASE,
  Ticket,
  TicketChip,
  TicketStatusChip,
  type TicketFact,
} from "#/components/detail/ticket.tsx";
import { DetailHero, HERO_FIELD, HERO_PAGE_PADDING } from "#/components/detail-hero.tsx";
import { ChartErrorBoundary } from "#/components/chart-error-boundary.tsx";
import { EatHere } from "#/components/dining/eat-here.tsx";
import { MenuItemPriceChart } from "#/components/dining/menu-item-price-chart.tsx";
import { menuItemAnchorId } from "#/components/dining/menu-content.tsx";
import { PAGE_WIDTH } from "#/components/page-container.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Image } from "#/components/ui/image.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { disneyResizeUrl } from "#/lib/image.ts";
import { formatParkName } from "#/lib/parks.ts";
import { cn } from "#/lib/utils.ts";

function formatPrice(price: number | null, currency: string | null): string | null {
  if (price === null) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency ?? "USD",
      minimumFractionDigits: Number.isInteger(price) ? 0 : 2,
    }).format(price);
  } catch {
    return `$${price}`;
  }
}

function isWithinDays(iso: string | null | undefined, days: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t <= days * 86_400_000;
}

const NEW_WINDOW_DAYS = 30;

/**
 * Dietary flags, as the menus themselves publish them: a trailing parenthetical
 * on the description ("herbed butter, peach jam (Vegetarian)"). Universal's
 * normalizer writes them from the feed's own `HealthAttribute` keys
 * (`server/dining/universal-menu.ts`), and Disney's descriptions carry the same
 * shape by convention.
 *
 * Matched against a closed list rather than lifted wholesale, because plenty of
 * descriptions end in a parenthetical that is not a flag at all ("(serves 2)",
 * "(seasonal)") and a chip row is a place for claims we can stand behind. The
 * flags are then cut from the prose: the chips say it, so the sentence needn't.
 */
const DIETARY = /^(vegetarian|vegan|plant-based|.*\bsensitive)$/i;

export function splitDietary(description: string | null): {
  text: string | null;
  flags: Array<string>;
} {
  if (!description) return { text: null, flags: [] };
  const m = /\s*\(([^()]+)\)\s*$/.exec(description);
  if (!m) return { text: description, flags: [] };
  const parts = m[1]
    .split(/\s*,\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0 || !parts.every((p) => DIETARY.test(p))) {
    return { text: description, flags: [] };
  }
  // Title-cased, because the same flag is spelled three ways across the feeds
  // ("Plant-based", "Plant-Based", "plant-based" all appear in `dining_menu_item`)
  // and a chip row that prints two casings of one word looks like two flags.
  return {
    text: description.slice(0, m.index).trim() || null,
    flags: parts.map(titleCaseFlag),
  };
}

/** "plant-based" → "Plant-Based"; "GLUTEN SENSITIVE" → "Gluten Sensitive". */
function titleCaseFlag(flag: string): string {
  return flag
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}

/**
 * The hero field's centrepiece: what this dish costs, on a plate.
 *
 * It is the page's headline number and it lives here rather than in the ticket
 * for the reason the resort page gives for its nightly rate — the stub carries
 * the facts that don't move, and a price is the one thing on this page that
 * does. Having it in both places would be the third printing of the same
 * figure, counting the wash panel.
 */
function PricePlate({
  price,
  label,
  range,
}: {
  price: string;
  label: string;
  range: string | null;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-[26px] bg-background/90 px-7 py-5 shadow-lg backdrop-blur-sm">
      <span className="text-[11px] font-bold tracking-[0.06em] text-wash-muted uppercase">
        {label}
      </span>
      <span className="text-[44px] leading-none font-black tracking-tight text-wash-fg tabular-nums sm:text-[52px]">
        {price}
      </span>
      {range && <span className="text-[13px] font-semibold text-wash-muted">{range}</span>}
    </div>
  );
}

/** One venue that serves a dish by this name, as a row in the mint panel. */
function ElsewhereRow({
  facilityId,
  slug,
  name,
  parkResort,
  imageUrl,
  imageThumbhash,
  price,
}: {
  facilityId: string;
  slug: string;
  name: string;
  parkResort: string | null;
  imageUrl: string | null;
  imageThumbhash: string | null;
  price: string | null;
}) {
  return (
    <Link
      to="/dining/$facilityId/item/$slug"
      params={{ facilityId, slug }}
      className="flex items-center gap-3 rounded-2xl bg-background/70 p-2 transition-colors hover:bg-background"
    >
      <span className="size-12 shrink-0 overflow-hidden rounded-xl bg-muted">
        {imageUrl && (
          <Image
            src={disneyResizeUrl(imageUrl, 120)}
            alt=""
            loading="lazy"
            aspect={1}
            placeholder={imageThumbhash ?? undefined}
            className="size-full object-cover"
          />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] leading-tight font-bold">{name}</span>
        {parkResort && (
          <span className="truncate text-[12px] text-muted-foreground">{parkResort}</span>
        )}
      </span>
      <span className="shrink-0 text-[15px] font-bold tabular-nums">{price ?? "—"}</span>
    </Link>
  );
}

/**
 * The `/dining/$facilityId/item/$slug` page, on the ticket-stub system
 * (docs/plans/dining-redesign §4.6), cut to match the venue, ride and resort
 * pages that came before it.
 *
 * A dish has no photograph of its own — no feed we hold carries one (see the
 * memory note `dining-dish-media-sources`) — so the hero is the system's
 * photoless variant: a `--wash` field with the *venue's* picture blurred out of
 * legibility behind it and the price set on a plate in the middle. Under it the
 * usual skeleton: the stub, the page's job (what the price is doing), the
 * neighbourhood in the wide column, and the tracked history as the "Know" band.
 */
export function MenuItemDetail({ facilityId, slug }: { facilityId: string; slug: string }) {
  const trpc = useTRPC();
  const itemQ = useQuery(trpc.dining.menuItem.queryOptions({ facilityId, slug }));
  const elsewhereQ = useQuery(trpc.dining.menuItemElsewhere.queryOptions({ facilityId, slug }));
  // Prefetched by the route loader alongside the item, so this costs no round
  // trip: it is what names the venue on the stub and what the field blurs.
  const venueQ = useQuery(trpc.dining.venue.queryOptions({ facilityId }));
  const item = itemQ.data;
  const venue = venueQ.data;
  const elsewhere = elsewhereQ.data ?? [];

  const [crease, setCrease] = React.useState(TICKET_DEFAULT_CREASE);

  const currency = item?.current?.currency ?? null;
  const points = React.useMemo(() => item?.priceHistory ?? [], [item?.priceHistory]);
  const stats = React.useMemo(() => {
    if (points.length === 0) return null;
    const prices = points.map((p) => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const first = prices[0]!;
    const current = prices[prices.length - 1]!;
    return { min, max, first, current, delta: current - first };
  }, [points]);

  // The price moves list (consecutive deltas), newest first.
  const moves = React.useMemo(() => {
    const out: Array<{ t: number; from: number; to: number }> = [];
    for (let i = 1; i < points.length; i++) {
      if (points[i].price !== points[i - 1].price) {
        out.push({ t: points[i].t, from: points[i - 1].price, to: points[i].price });
      }
    }
    return out.reverse();
  }, [points]);

  if (itemQ.isLoading) {
    return (
      // The field's own box, so the stub's crease doesn't jump onto it when the
      // query lands (see `HERO_FIELD`).
      <div className={cn(PAGE_WIDTH, "flex flex-col gap-5", HERO_PAGE_PADDING)}>
        <Skeleton
          className={cn("-mx-4 w-[calc(100%+2rem)] rounded-none md:mx-0 md:w-full", HERO_FIELD)}
        />
        <Skeleton className="h-52 w-full rounded-none md:mx-auto md:max-w-[34rem]" />
        <Skeleton className="h-40 w-full rounded-3xl md:mx-auto md:max-w-[34rem]" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className={cn(PAGE_WIDTH, "py-16 text-center")}>
        <p className="text-lg font-semibold">Menu item not found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          We don&apos;t have a record for this item.{" "}
          <Link to="/dining/$facilityId" params={{ facilityId }} hash="menu" className="underline">
            View the full menu
          </Link>
          .
        </p>
      </div>
    );
  }

  const isNew = isWithinDays(item.firstSeenAt, NEW_WINDOW_DAYS);
  const removed = item.status === "removed";
  const price = item.current?.price ?? stats?.current ?? null;
  const priceLabel = formatPrice(price, currency);
  const rangeLabel =
    stats && stats.min !== stats.max
      ? `${formatPrice(stats.min, currency)} – ${formatPrice(stats.max, currency)} tracked`
      : null;
  const { text: prose, flags } = splitDietary(item.current?.description ?? null);
  const menuHref = {
    to: "/dining/$facilityId",
    params: { facilityId },
    hash: menuItemAnchorId(item.title),
  } as const;

  // ── Ticket contents ────────────────────────────────────────────────────────
  // Three that don't move, filled in order and skipping whatever this item has
  // no record of. The price is not among them: it is the hero's plate (see
  // `PricePlate`), and it is also the one number on the page that changes.
  const facts: Array<TicketFact> = [];
  const candidates: Array<TicketFact | null> = [
    item.firstSeenAt
      ? {
          label: "Tracked since",
          value: `${formatDistanceToNowStrict(new Date(item.firstSeenAt))} ago`,
          hint: new Date(item.firstSeenAt).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          }),
        }
      : null,
    moves.length > 0
      ? { label: "Price moves", value: `${moves.length}`, hint: "Changes we've recorded" }
      : null,
    item.lastChangedAt
      ? {
          label: "Last change",
          value: `${formatDistanceToNowStrict(new Date(item.lastChangedAt))} ago`,
        }
      : null,
    item.current?.groupName ? { label: "Course", value: item.current.groupName } : null,
    item.current?.mealPeriod ? { label: "Menu", value: item.current.mealPeriod } : null,
    item.current?.priceType ? { label: "Priced", value: item.current.priceType } : null,
  ];
  for (const f of candidates) {
    if (facts.length >= 3) break;
    if (f && !facts.some((e) => e.label === f.label)) facts.push(f);
  }

  const placeLine = [venue?.name, venue?.parkResort].filter(Boolean).join(" · ") || null;
  // Chips: the menu this dish sits on, its course, and the dietary flags the
  // description carried — minus anything the facts above already state, which
  // is the ride page's rule and keeps the stub from repeating itself.
  const stated = new Set(
    facts.map((f) => f.value).filter((v): v is string => typeof v === "string"),
  );
  const chipLabels = [item.current?.mealPeriod, item.current?.groupName, ...flags].filter(
    (c): c is string => !!c && !stated.has(c),
  );

  // Held open while the venue query is out, so the page can't open one-column
  // and snap to two under the reader (the resort page's guard).
  const hasWide = !venue || elsewhere.length > 0 || !!venue.parkResort;

  return (
    <div
      style={{ "--crease": `${crease}px` } as React.CSSProperties}
      className={cn(
        PAGE_WIDTH,
        "flex flex-col",
        HERO_PAGE_PADDING,
        removed ? "pb-4 lg:pb-6" : ACTION_BAR_PAGE_PAD,
      )}
    >
      {/* The field. Not `underNav` like its photo-bearing siblings: the masthead
          turns its ink white over artwork (`UNDER_NAV_PAGES` in
          site-header-desktop), and this page's ground is a pale blue — white
          links would vanish into it. So the capsule keeps the page's own dark
          ink and the field starts below it. */}
      <DetailHero
        heroKey={`menu-item-${facilityId}-${slug}`}
        name={item.title}
        subtitle={placeLine}
        image={venue?.imageUrl ?? null}
        flying={false}
        entrance={false}
        tear
        crease="always"
        titleless
        field={{
          subject: priceLabel ? (
            <PricePlate
              price={priceLabel}
              label={removed ? "Last known price" : "Current price"}
              range={rangeLabel}
            />
          ) : (
            <p className="rounded-2xl bg-background/80 px-4 py-2 text-sm font-semibold text-wash-muted">
              No price posted for this item
            </p>
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
          title={item.title}
          subtitle={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {placeLine && <span>{placeLine}</span>}
              {removed ? (
                <TicketStatusChip tone="closed">No longer offered</TicketStatusChip>
              ) : (
                isNew && <TicketChip accent>Newly added</TicketChip>
              )}
            </span>
          }
          facts={facts}
          chips={
            chipLabels.length > 0 ? (
              <>
                {chipLabels.slice(0, 5).map((c) => (
                  <TicketChip key={c}>{c}</TicketChip>
                ))}
                {chipLabels.length > 5 && (
                  <TicketChip title={chipLabels.slice(5).join(" · ")}>
                    +{chipLabels.length - 5}
                  </TicketChip>
                )}
              </>
            ) : null
          }
        />

        {/* The neighbourhood: the same dish elsewhere on the property, then the
            rest of this park's kitchens. Spans both grid rows so it runs up
            beside the ticket. Last on a phone — it is about somewhere else. */}
        {hasWide && (
          <div className="order-3 flex flex-col gap-5 wide:col-start-2 wide:row-span-2 wide:row-start-1 wide:pt-4">
            {elsewhere.length > 0 && (
              <TintPanel
                tone="mint"
                size="lg"
                title="Also found at"
                meta={
                  <span className="text-[13px] font-semibold text-mint-label">
                    {elsewhere.length === 1
                      ? "One other kitchen"
                      : `${elsewhere.length} other kitchens`}
                  </span>
                }
              >
                <div className="flex flex-col gap-1.5">
                  {elsewhere.map((e) => (
                    <ElsewhereRow
                      key={e.facilityId}
                      facilityId={e.facilityId}
                      slug={slug}
                      name={e.name}
                      parkResort={e.parkResort}
                      imageUrl={e.imageUrl}
                      imageThumbhash={e.imageThumbhash}
                      price={formatPrice(e.price, e.currency)}
                    />
                  ))}
                </div>
              </TintPanel>
            )}
            {venue?.parkResort && (
              <EatHere
                parkName={venue.parkResort}
                excludeFacilityId={facilityId}
                title={`More to eat at ${formatParkName(venue.parkResort)}`}
              />
            )}
          </div>
        )}

        {/* The rest of the narrow column, under the ticket. */}
        <div className="contents wide:col-start-1 wide:row-start-2 wide:flex wide:flex-col wide:gap-5">
          {/* The page's job: not "what does it cost" — the plate above said that
              — but "what has that price been doing", and the one thing you can
              do about it, which is go and read the menu it sits on. */}
          <WashPanel
            title={removed ? "What it cost" : "The price"}
            meta={
              item.current?.priceType ??
              (stats ? `${points.length} observations` : "One observation")
            }
          >
            {stats && Math.abs(stats.delta) >= 0.01 ? (
              <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-background/70 px-4 py-3">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 text-lg font-extrabold tabular-nums",
                    stats.delta > 0
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-emerald-600 dark:text-emerald-400",
                  )}
                >
                  {stats.delta > 0 ? (
                    <TrendingUpIcon className="size-5" />
                  ) : (
                    <TrendingDownIcon className="size-5" />
                  )}
                  {formatPrice(Math.abs(stats.delta), currency)}
                </span>
                <span className="text-sm text-wash-muted">
                  {stats.delta > 0 ? "up" : "down"} from {formatPrice(stats.first, currency)} when
                  we first saw it
                </span>
              </div>
            ) : (
              <p className="text-sm text-wash-muted">
                {stats
                  ? "The price hasn't moved since we started tracking it."
                  : "We haven't recorded a price for this item yet."}
              </p>
            )}

            {/* The tracked window and the dates, as flat tiles — read, not
                pressed. `bg-background/70` rather than the tile's own `bg-muted`
                so they read as cut out of the wash rather than laid on it. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {stats && stats.min !== stats.max && (
                <>
                  <FactTile
                    label="Lowest tracked"
                    value={formatPrice(stats.min, currency) ?? "—"}
                    className="bg-background/70"
                  />
                  <FactTile
                    label="Highest tracked"
                    value={formatPrice(stats.max, currency) ?? "—"}
                    className="bg-background/70"
                  />
                </>
              )}
              <FactTile
                label="First seen"
                value={
                  item.firstSeenAt
                    ? `${formatDistanceToNowStrict(new Date(item.firstSeenAt))} ago`
                    : "Since we began"
                }
                className="bg-background/70"
              />
            </div>

            {/* Full price-tier table — only when the item is genuinely
                multi-priced ("Per Glass $16 · Per Bottle $64"); the single-price
                case is already the plate on the hero. */}
            {item.current?.prices != null && item.current.prices.length > 1 && (
              <div className="flex flex-col gap-1 rounded-2xl bg-background/70 px-4 py-3">
                {item.current.prices.map((t) => (
                  <div
                    key={t.type ?? "base"}
                    className="flex items-baseline justify-between gap-6 text-sm"
                  >
                    <span className="text-wash-muted">{t.type ?? "Each"}</span>
                    <span className="font-bold tabular-nums">
                      {formatPrice(t.amount, t.currency ?? currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Desktop's key. The phone's is in the floating action bar, so the
                page carries exactly one of them at any width. */}
            {!removed && (
              <div className="hidden md:flex md:flex-wrap md:gap-2">
                <Button
                  variant="yellow"
                  size="lg"
                  className="font-bold"
                  render={<Link {...menuHref} />}
                >
                  <UtensilsCrossedIcon />
                  See it on the full menu
                </Button>
              </div>
            )}
          </WashPanel>

          <div className="order-2 flex flex-col gap-5 wide:contents">
            {/* The dish's own words — the menu's copy, never rewritten. */}
            {prose && (
              <p className="text-[15px] leading-[1.45] text-pretty text-muted-foreground md:text-base md:leading-[1.55]">
                {prose}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="font-bold"
                render={<Link to="/dining/$facilityId" params={{ facilityId }} />}
              >
                {venue?.name ? `All of ${venue.name}` : "Back to the venue"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── KNOW: every price we've seen. Withheld under two observations — a
          two-point line is a straight segment between the only two numbers the
          page has already printed, and a "History" heading over one row of
          changes reads as a log that failed to load. */}
      {points.length >= 2 && (
        <Band className="mt-10 md:mt-14">
          <BandHeading
            kicker="Know"
            title="What it has been costing"
            meta="Every price we've observed for this item"
          />
          <DetailCard title="Price history" description="Each step is a change we recorded">
            <ChartErrorBoundary
              label="Price history"
              fallback={
                <div className="flex h-[212px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  Price history unavailable right now.
                </div>
              }
            >
              <MenuItemPriceChart points={points} currency={currency} />
            </ChartErrorBoundary>
          </DetailCard>

          {moves.length > 0 && (
            <DetailCard
              title="Every move"
              description={`${moves.length} change${moves.length === 1 ? "" : "s"}, newest first`}
            >
              <ul className="flex flex-col divide-y divide-border/50">
                {moves.map((m, i) => {
                  const up = m.to > m.from;
                  return (
                    <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="text-muted-foreground">
                        {new Date(m.t).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                      <span className="inline-flex items-center gap-2 tabular-nums">
                        <span className="text-muted-foreground line-through">
                          {formatPrice(m.from, currency)}
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-0.5 font-medium",
                            up
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-emerald-600 dark:text-emerald-400",
                          )}
                        >
                          {up ? (
                            <TrendingUpIcon className="size-3.5" />
                          ) : (
                            <TrendingDownIcon className="size-3.5" />
                          )}
                          {formatPrice(m.to, currency)}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </DetailCard>
          )}
        </Band>
      )}

      {/* The phone's one-line answer. A pulled item has nowhere to send anyone —
          it is not on the menu any more — so it gets no bar. */}
      {!removed && (
        <DetailActionBar>
          <Button
            variant="yellow"
            size="lg"
            className="h-12 min-w-0 flex-1 text-[15px] font-bold"
            render={<Link {...menuHref} />}
          >
            <UtensilsCrossedIcon />
            See it on the menu
          </Button>
        </DetailActionBar>
      )}
    </div>
  );
}
