/** Formats a cents value as "$12.34"; null/undefined renders an em dash. */
export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/** Human labels for the collection condition enum. */
export const CONDITION_LABEL: Record<string, string> = {
  mint: "Mint",
  near_mint: "Near mint",
  good: "Good",
  worn: "Worn",
};
