/**
 * Client-safe vocabulary for the public-records ledger — shared by the tRPC
 * router's input schema, the server types, and the `/filings` UI.
 */
export const RECORD_KINDS = [
  "permit",
  "noc",
  "deed",
  "airspace",
  "erp",
  "planning_case",
  "board_item",
  "trademark",
  "patent_app",
  "patent_grant",
  "assignment",
  "lawsuit",
  "sec_filing",
  "corp_filing",
  "incident",
  "license",
  "tls_cert",
] as const;

export type PublicRecordKind = (typeof RECORD_KINDS)[number];

export const OPERATORS = ["disney", "universal", "seaworld"] as const;
export type Operator = (typeof OPERATORS)[number];
