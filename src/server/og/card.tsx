import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

import { GEIST_REGULAR_BASE64 } from "#/server/og/geist-font.ts";
import { SITE_NAME } from "#/lib/seo.ts";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
const FONT = Buffer.from(GEIST_REGULAR_BASE64, "base64");

export interface OgChip {
  value: string;
  label: string;
}

export interface OgCardConfig {
  /** Big headline (entity name). */
  title: string;
  /** Secondary line under the title (e.g. park, cuisine, resort area). */
  subtitle?: string | null;
  /** Up to three stat pills along the bottom. */
  chips?: Array<OgChip>;
}

/** A pill stat (label + value) — satori needs explicit flex on multi-child nodes. */
function Chip({ value, label }: OgChip) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "20px 32px",
        borderRadius: 20,
        background: "rgba(255,255,255,0.10)",
        border: "1px solid rgba(255,255,255,0.18)",
      }}
    >
      <span style={{ fontSize: 52, color: "#ffffff", letterSpacing: -1 }}>{value}</span>
      <span style={{ fontSize: 24, color: "rgba(255,255,255,0.65)" }}>{label}</span>
    </div>
  );
}

function Card({ title, subtitle, chips }: OgCardConfig) {
  return (
    <div
      style={{
        width: OG_WIDTH,
        height: OG_HEIGHT,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: "linear-gradient(135deg, #0b1f3a 0%, #1c468e 100%)",
        fontFamily: "Geist",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 18, height: 18, borderRadius: 6, background: "#5b9dff" }} />
        <span style={{ fontSize: 30, color: "#ffffff", letterSpacing: 4 }}>
          {SITE_NAME.toUpperCase()}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 88, color: "#ffffff", letterSpacing: -3, lineHeight: 1.05 }}>
          {title}
        </span>
        {subtitle ? (
          <span style={{ fontSize: 36, color: "rgba(255,255,255,0.75)" }}>{subtitle}</span>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 24 }}>
        {(chips ?? []).map((c, i) => (
          <Chip key={i} value={c.value} label={c.label} />
        ))}
        <Chip value="parkfi.sh" label="Plan your day" />
      </div>
    </div>
  );
}

/** Render a 1200×630 share card to PNG. Shared by every per-entity OG route. */
export async function renderOgCard(config: OgCardConfig): Promise<Buffer> {
  const svg = await satori(<Card {...config} />, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: [{ name: "Geist", data: FONT, weight: 400, style: "normal" }],
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: OG_WIDTH } }).render().asPng();
}

/** "magic-kingdom" -> "Magic Kingdom" fallback when an entity isn't in the DB. */
export function titleizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
