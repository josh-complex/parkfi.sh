/**
 * Display number formatting for stat readouts. Pure, client-safe.
 */

/**
 * A headline stat value: compact ("3.82M") once it hits the millions, plain
 * grouped ("1,204", "147") below that — matching the /activity lifetime totals,
 * where big lifetime steps compact but ride/day counts read in full.
 */
export function formatBigStat(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) >= 1_000_000) {
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(v);
  }
  return v.toLocaleString("en-US");
}
