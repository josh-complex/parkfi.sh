/**
 * Text fixes for operator-supplied prose. Disney's finder and Universal's
 * places feed both hand us HTML-escaped copy ("Disney&apos;s Grand Floridian
 * Resort &amp; Spa") because their own surfaces render it as HTML. We render it
 * as text, so the entities show through verbatim — this un-escapes them without
 * going near `innerHTML`.
 */

/** The entities these feeds actually emit, plus the five XML basics. */
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  reg: "®",
  copy: "©",
  trade: "™",
  deg: "°",
  eacute: "é",
};

/**
 * Decode HTML entities in a plain-text string. Numeric (`&#39;`, `&#x27;`) and
 * the named set above; anything else is left exactly as written, so a literal
 * "&whatever;" in a dish name survives.
 *
 * Runs twice over `&amp;`-escaped entities (`&amp;#39;` — which the WDW feed
 * does emit) by decoding the ampersand last.
 */
export function decodeEntities<T extends string | null | undefined>(text: T): T {
  if (!text) return text;
  let out = text as string;
  for (let pass = 0; pass < 2 && out.includes("&"); pass += 1) {
    const next = out.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
      if (body[0] === "#") {
        const code = Number(
          body[1] === "x" || body[1] === "X" ? `0x${body.slice(2)}` : body.slice(1),
        );
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      }
      return NAMED[body.toLowerCase()] ?? whole;
    });
    if (next === out) break;
    out = next;
  }
  return out as T;
}
