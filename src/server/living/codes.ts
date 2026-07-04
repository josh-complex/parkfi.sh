/**
 * Living Layer — string code constants mirroring the `ref_*` seed rows in
 * drizzle/20260620120000_living_layer. Kept as plain consts (same pattern as
 * src/server/parks/codes.ts) so call sites don't hardcode magic strings.
 */

export const MarkType = {
  DISCOVERY: "discovery",
  DARE: "dare",
  WORLD: "world",
  COLLECTIBLE: "collectible",
  COMPANION: "companion",
  ENCOUNTER: "encounter",
  MEMORY: "memory",
} as const;
export type MarkTypeCode = (typeof MarkType)[keyof typeof MarkType];

export const MarkState = {
  BLOOM: "bloom",
  ACTIVE: "active",
  DECAYING: "decaying",
  FADED: "faded",
  CLAIMED: "claimed",
} as const;
export type MarkStateCode = (typeof MarkState)[keyof typeof MarkState];

export const HeartlessType = {
  SHADE: "shade",
  WISP: "wisp",
  BREAKER: "breaker",
} as const;
export type HeartlessTypeCode = (typeof HeartlessType)[keyof typeof HeartlessType];

/** Reaction kinds on a mark. */
export const MarkReactionKind = {
  FOUND: "found",
  UPVOTE: "upvote",
  REPORT: "report",
} as const;
export type MarkReactionKindCode = (typeof MarkReactionKind)[keyof typeof MarkReactionKind];
