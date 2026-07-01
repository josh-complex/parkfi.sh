import { useCallback, useEffect, useRef } from "react";

import { cn } from "#/lib/utils.ts";

const useMorphingText = (texts: string[], morphTime: number, cooldownTime: number) => {
  const textIndexRef = useRef(0);
  const morphRef = useRef(0);
  const cooldownRef = useRef(0);
  const timeRef = useRef(new Date());

  const text1Ref = useRef<HTMLSpanElement>(null);
  const text2Ref = useRef<HTMLSpanElement>(null);

  const setStyles = useCallback(
    (fraction: number) => {
      const [current1, current2] = [text1Ref.current, text2Ref.current];
      if (!current1 || !current2) return;

      current2.style.filter = `blur(${Math.min(8 / fraction - 8, 100)}px)`;
      current2.style.opacity = `${Math.pow(fraction, 0.4) * 100}%`;

      const invertedFraction = 1 - fraction;
      current1.style.filter = `blur(${Math.min(8 / invertedFraction - 8, 100)}px)`;
      current1.style.opacity = `${Math.pow(invertedFraction, 0.4) * 100}%`;

      current1.textContent = texts[textIndexRef.current % texts.length];
      current2.textContent = texts[(textIndexRef.current + 1) % texts.length];
    },
    [texts],
  );

  const doMorph = useCallback(() => {
    morphRef.current -= cooldownRef.current;
    cooldownRef.current = 0;

    let fraction = morphRef.current / morphTime;

    if (fraction > 1) {
      cooldownRef.current = cooldownTime;
      fraction = 1;
    }

    setStyles(fraction);

    if (fraction === 1) {
      textIndexRef.current++;
    }
  }, [setStyles, morphTime, cooldownTime]);

  const doCooldown = useCallback(() => {
    morphRef.current = 0;
    const [current1, current2] = [text1Ref.current, text2Ref.current];
    if (current1 && current2) {
      current2.style.filter = "none";
      current2.style.opacity = "100%";
      current1.style.filter = "none";
      current1.style.opacity = "0%";
    }
  }, []);

  useEffect(() => {
    let animationFrameId: number;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const newTime = new Date();
      const dt = (newTime.getTime() - timeRef.current.getTime()) / 1000;
      timeRef.current = newTime;

      cooldownRef.current -= dt;

      if (cooldownRef.current <= 0) doMorph();
      else doCooldown();
    };

    animate();
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [doMorph, doCooldown]);

  return { text1Ref, text2Ref };
};

interface MorphingTextProps {
  className?: string;
  texts: string[];
  /**
   * Drop the gooey SVG threshold filter. The threshold is tuned for big, bold
   * hero text — at small sizes (e.g. a search placeholder) it erases the thin,
   * partially-opaque glyphs mid-morph, which reads as a fade-out-then-in. Without
   * it the two words simply blur-crossfade into each other, smoothly.
   */
  smooth?: boolean;
  /** Seconds the blur-crossfade between words takes (default 1.5). Smaller = snappier. */
  morphDuration?: number;
  /** Seconds a word holds still before the next morph (default 0.5). Larger = lingers. */
  pauseDuration?: number;
  /**
   * Size the box to the word's content (inline-grid) instead of stretching full
   * width. Lets the morph sit inline and stay truly centered as a unit (e.g. after
   * a "Search for" prefix) rather than left-aligned in a fixed-width box.
   */
  fit?: boolean;
}

const Texts: React.FC<{
  texts: string[];
  morphTime: number;
  cooldownTime: number;
  fit?: boolean;
}> = ({ texts, morphTime, cooldownTime, fit }) => {
  const { text1Ref, text2Ref } = useMorphingText(texts, morphTime, cooldownTime);
  // `fit`: overlap both words in one grid cell so the box hugs the content and
  // centers each. Otherwise absolute-stack across the full (hero) width.
  const spanCls = fit
    ? "col-start-1 col-end-1 row-start-1 row-end-1 whitespace-nowrap"
    : "absolute inset-x-0 top-1/2 inline-block w-full -translate-y-1/2";
  return (
    <>
      <span className={spanCls} ref={text1Ref} />
      <span className={spanCls} ref={text2Ref} />
    </>
  );
};

const SvgFilters: React.FC = () => (
  <svg id="filters" className="fixed h-0 w-0" preserveAspectRatio="xMidYMid slice">
    <defs>
      <filter id="threshold">
        <feColorMatrix
          in="SourceGraphic"
          type="matrix"
          values="1 0 0 0 0
                  0 1 0 0 0
                  0 0 1 0 0
                  0 0 0 255 -140"
        />
      </filter>
    </defs>
  </svg>
);

export const MorphingText: React.FC<MorphingTextProps> = ({
  texts,
  className,
  smooth,
  morphDuration = 1.5,
  pauseDuration = 0.5,
  fit,
}) => (
  <div
    className={cn(
      fit
        ? "relative inline-grid place-items-center font-sans leading-none"
        : "relative mx-auto h-16 w-full max-w-3xl text-center font-sans text-[40pt] leading-none font-bold md:h-24 lg:text-[6rem]",
      smooth ? "filter-none" : "filter-[url(#threshold)_blur(0.6px)]",
      className,
    )}
  >
    <Texts texts={texts} morphTime={morphDuration} cooldownTime={pauseDuration} fit={fit} />
    {!smooth && <SvgFilters />}
  </div>
);
