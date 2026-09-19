/**
 * Discord **component embeds** — a custom link preview built from Components V2.
 *
 * When a parkfi.sh link is pasted into Discord, the crawler fetches the page and
 * builds a card from our Open Graph tags. A component embed replaces that card
 * with a layout we control: an accent-colored container holding markdown, an
 * image, and link buttons. Discord looks for a
 * `<script id="discord:component-embed" type="application/json">` in the HTML.
 *
 * Docs: https://github.com/discord/discord-api-docs/pull/8606 (unmerged as of
 * 2026-09-17 — the feature may not be live yet; verify a page through the Embed
 * Debugger at https://discord.com/developers/embeds before assuming it renders).
 *
 * Three things make this work, and all three are load-bearing:
 *
 * 1. **Server-rendered.** Discord runs no JavaScript. Returning the script from
 *    a route `head()` puts it in the SSR'd `<head>`; a client-injected tag is
 *    never seen. Routes using this must resolve their data in the loader (ride
 *    detail already does) so the payload is populated at render time.
 * 2. **Never executed.** TanStack's head-script renderer treats any `type` that
 *    isn't `text/javascript`/`module` as an inert data script — server-rendered
 *    via `dangerouslySetInnerHTML`, skipped by the client-side inject effect.
 * 3. **OG tags stay.** Everything here is additive. `seo()` still ships the
 *    standard card, which is what renders whenever this payload is rejected.
 *
 * Discord validates all-or-nothing: one unsupported component type or one stray
 * key invalidates the whole payload, with no error surfaced anywhere. So
 * {@link discordComponentEmbed} drops the script entirely rather than emit
 * something it believes is invalid — a missing component embed falls back to the
 * OG card, which is the outcome we want either way.
 */

import { SITE_URL } from "#/lib/seo.ts";

/** The `id`/`rel` Discord's crawler matches on. Must be exact. */
const SCRIPT_ID = "discord:component-embed";

/** Brand navy (`#1c468e`, the sitewide `theme-color`) as the container accent. */
export const DISCORD_ACCENT = 0x1c468e;

/**
 * Byte budget for the serialized payload. Discord documents 3,000 bytes for the
 * linked-JSON variant and states no limit for the inline script — an unstated
 * limit is not an absent one, so hold the inline form to the same number. It
 * also keeps the door open to switching to a `<link>` later without a rewrite.
 */
const MAX_PAYLOAD_BYTES = 3000;

/** Discord's documented ceiling on components in a single embed. */
const MAX_COMPONENTS = 40;

/** Media items accept only `url`; Discord fills in dimensions after it fetches. */
interface UnfurledMedia {
  url: string;
}

export interface TextDisplay {
  type: 10;
  /** Discord markdown: headings, bold, links, lists, spoilers, code. */
  content: string;
}

export interface Thumbnail {
  type: 11;
  media: UnfurledMedia;
  description?: string;
  spoiler?: boolean;
}

/**
 * Only link-style buttons exist in a component embed — it is display-only, so
 * nothing sends an interaction. `custom_id`, `sku_id`, and `id` are rejected.
 */
export interface LinkButton {
  type: 2;
  style: 5;
  url: string;
  label?: string;
  emoji?: { name: string; id?: string; animated?: boolean };
  disabled?: boolean;
}

export interface Section {
  type: 9;
  components: Array<TextDisplay>;
  accessory: Thumbnail | LinkButton;
}

export interface MediaGallery {
  type: 12;
  items: Array<{ media: UnfurledMedia; description?: string; spoiler?: boolean }>;
}

export interface Separator {
  type: 14;
  divider?: boolean;
  /** 1 = small, 2 = large. */
  spacing?: 1 | 2;
}

export interface ActionRow {
  type: 1;
  components: Array<LinkButton>;
}

export type ContainerChild =
  | ActionRow
  | Section
  | TextDisplay
  | MediaGallery
  | Separator
  | Container;

export interface Container {
  type: 17;
  /** 24-bit RGB integer, e.g. {@link DISCORD_ACCENT}. */
  accent_color?: number;
  spoiler?: boolean;
  components: Array<ContainerChild>;
}

/* -------------------------------------------------------------------------- */
/* Builders                                                                    */
/* -------------------------------------------------------------------------- */

export function text(content: string): TextDisplay {
  return { type: 10, content };
}

export function thumbnail(url: string, description?: string): Thumbnail {
  return description ? { type: 11, media: { url }, description } : { type: 11, media: { url } };
}

export function linkButton(label: string, url: string): LinkButton {
  return { type: 2, style: 5, url: absolute(url), label };
}

export function section(body: Array<TextDisplay>, accessory: Thumbnail | LinkButton): Section {
  return { type: 9, components: body, accessory };
}

export function gallery(items: Array<{ url: string; description?: string }>): MediaGallery {
  return {
    type: 12,
    items: items.map((it) =>
      it.description
        ? { media: { url: absolute(it.url) }, description: it.description }
        : { media: { url: absolute(it.url) } },
    ),
  };
}

export function separator(spacing: 1 | 2 = 1, divider = false): Separator {
  return divider ? { type: 14, spacing, divider } : { type: 14, spacing };
}

/** Drops `undefined` entries so callers can inline conditional buttons. */
export function actionRow(...buttons: Array<LinkButton | undefined>): ActionRow {
  return { type: 1, components: buttons.filter((b): b is LinkButton => b !== undefined) };
}

/** Drops `undefined` children so callers can inline conditional blocks. */
export function container(children: Array<ContainerChild | undefined>): Container {
  return {
    type: 17,
    accent_color: DISCORD_ACCENT,
    components: children.filter((c): c is ContainerChild => c !== undefined),
  };
}

/* -------------------------------------------------------------------------- */
/* The house layout                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Cap on the photo grid. Three keeps it to one row, and keeps the whole embed
 * to four images including the lead card — Discord fetches every one of them
 * inside the same 10s budget as the page, and a component embed has no
 * width/height field to skip the measuring fetch the way `og:image` does. Our
 * generated cards render on demand, so the margin is worth more than a 4th pic.
 */
const MAX_GALLERY_ITEMS = 3;

export interface LinkPreviewOptions {
  /** Heading text. Linked to {@link LinkPreviewOptions.url}. */
  title: string;
  /** Root-relative path (or absolute URL) the heading links to. */
  url: string;
  /** Muted metadata line under the heading — "Tomorrowland · Magic Kingdom". */
  subtitle?: string | null;
  /** Optional body paragraph. Discord markdown. */
  body?: string | null;
  /**
   * The lead image, rendered full-bleed on its own row: our generated OG card
   * on the pages that have one, otherwise the page's own hero photo. A gallery
   * rather than a thumbnail on purpose — a thumbnail crops a 1200×630 card into
   * an illegible square, which is what made the first cut look worse than the
   * plain Open Graph preview it replaced.
   */
  card?: string | null;
  /**
   * Extra photos, as a grid *below* the lead image, and only when there are two
   * or more. A single extra renders full-bleed too, reading as a second card
   * rather than a gallery — so one photo is dropped instead.
   */
  photos?: Array<string | null | undefined>;
  /** Link buttons. `undefined` entries are dropped, so inline conditionals. */
  buttons?: Array<LinkButton | undefined>;
}

/**
 * The shape every parkfi.sh link preview uses: heading, subtext, optional body,
 * the full-bleed card, an optional photo grid, then buttons. Keeping it in one
 * place is what makes the cards feel like one product across ride, park, dining,
 * resort, shop, pin, menu-item and blog links.
 */
export function linkPreview(opts: LinkPreviewOptions): Container {
  const href = absolute(opts.url);
  const heading = opts.subtitle
    ? `### [${escapeLinkLabel(opts.title)}](${href})\n-# ${opts.subtitle}`
    : `### [${escapeLinkLabel(opts.title)}](${href})`;

  // Compare absolute forms so a root-relative card and an absolute photo of the
  // same asset still dedupe — never repeat the lead image inside the grid.
  const card = canEmbedMedia(opts.card) ? absolute(opts.card) : null;
  const extras = (opts.photos ?? [])
    .filter(canEmbedMedia)
    .map(absolute)
    .filter((url) => url !== card)
    .slice(0, MAX_GALLERY_ITEMS);

  const buttons = (opts.buttons ?? []).filter((b): b is LinkButton => b !== undefined);

  return container([
    text(heading),
    opts.body ? text(opts.body) : undefined,
    card ? gallery([{ url: card }]) : undefined,
    extras.length >= 2 ? gallery(extras.map((url) => ({ url }))) : undefined,
    buttons.length > 0 ? separator(1, true) : undefined,
    buttons.length > 0 ? actionRow(...buttons) : undefined,
  ]);
}

/**
 * `]` inside a markdown link label closes it early, so a name like "Mickey
 * Waffles [GF]" would break the heading into loose text and a stray URL.
 */
function escapeLinkLabel(s: string): string {
  return s.replace(/([[\]])/g, "\\$1");
}

/* -------------------------------------------------------------------------- */
/* Emit                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Serialize a container into the `scripts` entry a route `head()` returns.
 *
 * Spread alongside {@link seo}'s output:
 *
 * ```ts
 * return {
 *   ...seo({ title, description, path }),
 *   scripts: discordComponentEmbed(container([...])),
 * };
 * ```
 *
 * Returns `[]` — no script, OG card renders — when the payload fails a check
 * Discord would fail it on anyway.
 */
export function discordComponentEmbed(
  root: Container,
): Array<{ id: string; type: string; children: string }> {
  const problem = validate(root);
  if (problem) {
    // Dev-only: in production a dropped embed is a silent, harmless fallback,
    // and this runs on every SSR render of the route.
    if (import.meta.env.DEV) console.warn(`[discord-embed] dropped payload: ${problem}`);
    return [];
  }

  // `<` can only appear inside JSON string values, so escaping it wholesale is
  // safe and stops a description containing `</script>` from closing the tag
  // early. Same guard as the JSON-LD block in `components/seo/json-ld.tsx`.
  const json = JSON.stringify({ component: root }).replace(/</g, "\\u003c");

  if (byteLength(json) > MAX_PAYLOAD_BYTES) {
    if (import.meta.env.DEV) {
      console.warn(
        `[discord-embed] dropped payload: ${byteLength(json)}B over ${MAX_PAYLOAD_BYTES}B`,
      );
    }
    return [];
  }

  return [{ id: SCRIPT_ID, type: "application/json", children: json }];
}

/** Everything that can appear in a payload — container children plus accessories. */
type AnyComponent = ContainerChild | Thumbnail | LinkButton;

/** Returns a reason the payload is invalid, or `undefined` if it looks sound. */
function validate(root: Container): string | undefined {
  let count = 0;
  const walk = (node: AnyComponent): string | undefined => {
    count += 1;
    switch (node.type) {
      case 2:
        // Redundant against the types for TS callers, but these payloads are
        // assembled from live DB values and a bad URL voids the whole embed.
        if (!node.url.startsWith("https://")) return `button url not https: ${node.url}`;
        if (!node.label && !node.emoji) return "button has neither label nor emoji";
        return undefined;
      case 10:
        return node.content.trim() === "" ? "empty text display" : undefined;
      case 11:
        return canEmbedMedia(node.media.url)
          ? undefined
          : `thumbnail url not fetchable: ${node.media.url}`;
      case 12: {
        if (node.items.length === 0) return "empty media gallery";
        const bad = node.items.find((it) => !canEmbedMedia(it.media.url));
        return bad ? `gallery url not fetchable: ${bad.media.url}` : undefined;
      }
      case 14:
        return undefined;
      case 1:
      case 9:
      case 17: {
        if (node.components.length === 0) {
          return node.type === 1
            ? "empty action row"
            : node.type === 9
              ? "empty section"
              : "empty container";
        }
        for (const child of node.components) {
          const problem = walk(child);
          if (problem) return problem;
        }
        // A section's accessory is the one child that isn't in `components`.
        return node.type === 9 ? walk(node.accessory) : undefined;
      }
    }
  };

  const problem = walk(root);
  if (problem) return problem;
  if (count > MAX_COMPONENTS) return `${count} components over the ${MAX_COMPONENTS} limit`;
  return undefined;
}

/**
 * Discord fetches every image in the payload inside the same 10s budget as the
 * page, and — unlike `og:image` — there is no width/height field to skip the
 * measuring fetch. So the URL has to be public, absolute, and a format Discord
 * decodes; anything else quietly voids the embed.
 *
 * Exported because a source image failing this test should cost you the
 * thumbnail, not the card — callers gate the media component on it rather than
 * letting {@link validate} drop the whole payload.
 */
export function canEmbedMedia(url: string | null | undefined): url is string {
  if (!url) return false;
  // Root-relative is fine: every emit path runs {@link absolute} over it, so
  // `/og/ride/…/card.jpg` reaches Discord as an absolute URL on our own origin.
  // Rejecting it here is what silently emptied the galleries on the first pass.
  if (!/^(https?:\/\/|\/[^/])/.test(url)) return false;
  if (url.length > 2048) return false;
  // A denylist, not an allowlist. Discord sniffs the response's content type, so
  // an extensionless URL is fine — and plenty of ours are, between R2 keys and
  // Disney's `/resize/mwImage/...` segments. Only reject what we can see won't
  // decode: video (unsupported anywhere in a component embed) and SVG.
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  return !/\.(svg|mp4|webm|mov|m3u8|pdf)$/.test(path);
}

/** Root-relative paths are ours; anything else is passed through untouched. */
function absolute(url: string): string {
  return url.startsWith("/") ? `${SITE_URL}${url}` : url;
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}
