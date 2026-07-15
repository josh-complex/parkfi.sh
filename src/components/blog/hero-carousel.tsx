import * as React from "react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Image } from "#/components/ui/image.tsx";

/** Our own latest published post, rendered as an internal-link hero slide. */
export interface HeroPostSlide {
  kind: "post";
  slug: string;
  title: string;
  dek: string;
  tags: string[];
  heroImageUrl: string;
  imageThumbhash: string | null;
  publishedAt: Date | string | null;
}

/** An outlet's latest article, rendered as an external-link hero slide. */
export interface HeroExternalSlide {
  kind: "external";
  source: string;
  title: string;
  url: string;
  imageUrl: string;
  imageThumbhash: string | null;
  publishedAt: Date | string | null;
}

export type HeroSlideData = HeroPostSlide | HeroExternalSlide;

function slideKey(s: HeroSlideData): string {
  return s.kind === "post" ? `post:${s.slug}` : `external:${s.url}`;
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(d));
}

// Directional crossfade: entering slide slides in from the side the pressed
// arrow points away from, the outgoing one slides out the opposite way —
// both fading, so the two never hard-cut.
const SLIDE_VARIANTS = {
  enter: (dir: number) => ({ opacity: 0, x: dir >= 0 ? 56 : -56 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir >= 0 ? -56 : 56 }),
};
const SLIDE_TRANSITION = { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const };

function SlideBody({ slide }: { slide: HeroSlideData }) {
  const img = slide.kind === "post" ? slide.heroImageUrl : slide.imageUrl;
  return (
    <>
      <Image
        src={img}
        alt=""
        className="absolute inset-0 size-full object-cover"
        loading="eager"
        placeholder={slide.imageThumbhash}
        referrerPolicy="no-referrer"
        sizes="100vw"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/5" />
      <div className="relative max-w-2xl p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/80">
          <time
            dateTime={slide.publishedAt ? new Date(slide.publishedAt).toISOString() : undefined}
          >
            {formatDate(slide.publishedAt)}
          </time>
          {slide.kind === "post" ? (
            slide.tags.slice(0, 3).map((t) => (
              <Badge key={t} className="border-white/30 bg-white/15 font-normal text-white">
                {t}
              </Badge>
            ))
          ) : (
            <span className="font-heading font-semibold tracking-wide text-white/90 uppercase">
              {slide.source}
            </span>
          )}
        </div>
        <h3 className="font-heading mt-2 text-2xl font-bold tracking-tight text-balance sm:text-4xl">
          {slide.title}
        </h3>
        {slide.kind === "post" && (
          <p className="mt-2 line-clamp-2 max-w-xl text-white/85 sm:text-lg">{slide.dek}</p>
        )}
        <span className="mt-3 inline-flex text-sm font-medium text-white">
          {slide.kind === "post" ? "Read more →" : `Read on ${slide.source} ↗`}
        </span>
      </div>
    </>
  );
}

function SlideLink({ slide, children }: { slide: HeroSlideData; children: React.ReactNode }) {
  if (slide.kind === "post") {
    return (
      <Link
        to="/blog/$slug"
        params={{ slug: slide.slug }}
        className="group/post relative flex h-full flex-col justify-end text-white"
      >
        {children}
      </Link>
    );
  }
  return (
    <a
      href={slide.url}
      target="_blank"
      rel="nofollow noopener noreferrer"
      className="group/post relative flex h-full flex-col justify-end text-white"
    >
      {children}
    </a>
  );
}

/**
 * Full-bleed hero carousel spanning our latest post AND each outlet's latest
 * article — one slide per source, newest-lead first. Replaces the old static
 * lead card. Arrow buttons (top-right) step through slides with a directional
 * fade + slide crossfade so consecutive slides never hard-cut.
 */
export function HeroCarousel({ slides }: { slides: HeroSlideData[] }) {
  const [index, setIndex] = React.useState(0);
  const [direction, setDirection] = React.useState(0);

  const n = slides.length;
  const go = React.useCallback(
    (delta: number) => {
      setDirection(delta);
      setIndex((i) => (n === 0 ? 0 : (((i + delta) % n) + n) % n));
    },
    [n],
  );

  if (n === 0) return null;

  const activeIndex = ((index % n) + n) % n;
  const active = slides[activeIndex];

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured park news"
      className="relative min-h-[20rem] overflow-hidden rounded-3xl ring-1 ring-foreground/10 sm:min-h-[26rem]"
    >
      <AnimatePresence initial={false} custom={direction} mode="popLayout">
        <motion.div
          key={slideKey(active)}
          custom={direction}
          variants={SLIDE_VARIANTS}
          initial="enter"
          animate="center"
          exit="exit"
          transition={SLIDE_TRANSITION}
          className="absolute inset-0"
        >
          <SlideLink slide={active}>
            <SlideBody slide={active} />
          </SlideLink>
        </motion.div>
      </AnimatePresence>

      {n > 1 && (
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="rounded-full border-white/30 bg-black/30 text-white hover:bg-black/50 hover:text-white"
            onClick={() => go(-1)}
          >
            <ChevronLeftIcon />
            <span className="sr-only">Previous</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="rounded-full border-white/30 bg-black/30 text-white hover:bg-black/50 hover:text-white"
            onClick={() => go(1)}
          >
            <ChevronRightIcon />
            <span className="sr-only">Next</span>
          </Button>
        </div>
      )}
    </div>
  );
}
