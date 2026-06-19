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

/** Small status pill in the top-right (e.g. "OPEN", "DOWN", "SOLD OUT"). */
export interface OgBadge {
  label: string;
  /** Drives the pill color; defaults to a neutral glass pill. */
  tone?: "open" | "down" | "neutral";
}

export interface OgCardConfig {
  /** Big headline (entity name). */
  title: string;
  /** Secondary line under the title (e.g. park, cuisine, resort area). */
  subtitle?: string | null;
  /** Up to three stat pills along the bottom. */
  chips?: Array<OgChip>;
  /** Status pill in the top-right corner. */
  badge?: OgBadge | null;
  /**
   * Hero image URL (park photo / ride art). Fetched and embedded as the
   * full-bleed background, dimmed under a scrim so text stays legible. Falls
   * back to the brand gradient when absent or unfetchable.
   */
  imageUrl?: string | null;
}

const BADGE_TONES: Record<NonNullable<OgBadge["tone"]>, { bg: string; fg: string }> = {
  open: { bg: "rgba(52,211,153,0.22)", fg: "#6ee7b7" },
  down: { bg: "rgba(248,113,113,0.22)", fg: "#fca5a5" },
  neutral: { bg: "rgba(255,255,255,0.12)", fg: "rgba(255,255,255,0.85)" },
};

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

function Card({
  title,
  subtitle,
  chips,
  badge,
  imageDataUri,
}: OgCardConfig & {
  imageDataUri?: string | null;
}) {
  const tone = BADGE_TONES[badge?.tone ?? "neutral"];
  return (
    <div
      style={{
        position: "relative",
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
      {imageDataUri ? (
        <img
          src={imageDataUri}
          width={OG_WIDTH}
          height={OG_HEIGHT}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: OG_WIDTH,
            height: OG_HEIGHT,
            objectFit: "cover",
          }}
        />
      ) : null}
      {/* Scrim: darken the whole frame, then deepen the bottom so the title and
          chips keep contrast over a bright photo. */}
      {imageDataUri ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: OG_WIDTH,
            height: OG_HEIGHT,
            background:
              "linear-gradient(180deg, rgba(7,15,30,0.55) 0%, rgba(7,15,30,0.35) 38%, rgba(7,15,30,0.92) 100%)",
          }}
        />
      ) : null}

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 18, height: 18, borderRadius: 6, background: "#5b9dff" }} />
          <span style={{ fontSize: 30, color: "#ffffff", letterSpacing: 4 }}>
            {SITE_NAME.toUpperCase()}
          </span>
        </div>
        {badge ? (
          <div
            style={{
              display: "flex",
              padding: "12px 24px",
              borderRadius: 999,
              background: tone.bg,
              border: "1px solid rgba(255,255,255,0.18)",
            }}
          >
            <span style={{ fontSize: 26, color: tone.fg, letterSpacing: 2 }}>
              {badge.label.toUpperCase()}
            </span>
          </div>
        ) : null}
      </div>

      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 88, color: "#ffffff", letterSpacing: -3, lineHeight: 1.05 }}>
          {title}
        </span>
        {subtitle ? (
          <span style={{ fontSize: 36, color: "rgba(255,255,255,0.8)" }}>{subtitle}</span>
        ) : null}
      </div>

      <div style={{ position: "relative", display: "flex", gap: 24 }}>
        {(chips ?? []).map((c, i) => (
          <Chip key={i} value={c.value} label={c.label} />
        ))}
        <Chip value="parkfi.sh" label="Plan your day" />
      </div>
    </div>
  );
}

/**
 * Fetch a remote hero image and inline it as a data URI so satori can embed it
 * deterministically (it can't fetch URLs itself in this runtime). Best-effort:
 * a slow/missing/non-image response just yields the gradient fallback.
 */
async function fetchImageDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Render a 1200×630 share card to PNG. Shared by every per-entity OG route. */
export async function renderOgCard(config: OgCardConfig): Promise<Buffer> {
  const imageDataUri = await fetchImageDataUri(config.imageUrl);
  const svg = await satori(<Card {...config} imageDataUri={imageDataUri} />, {
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
