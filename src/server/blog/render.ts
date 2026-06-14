/**
 * Markdown → HTML for blog post bodies. Rendered server-side so the HTML ships
 * in the SSR response (and the client bundle stays free of `marked`).
 *
 * Content is LLM-generated and passes a human approval gate, but we still strip
 * the obvious script/style/iframe/event-handler vectors as defense in depth —
 * cheap regex rather than pulling a full DOM sanitizer into the server bundle.
 *
 * Social embeds: a bare post URL on its own line becomes a sandboxed iframe.
 * We swap each to a token BEFORE sanitizing and inject our own iframe (built
 * from a parsed id, never model HTML) AFTER — so the sanitizer can keep
 * blanket-stripping every `<iframe>` it sees.
 */
import { marked } from "marked";

import { embedHtml, parseSocialUrl, type SocialEmbed } from "./embeds.ts";

marked.setOptions({ gfm: true, breaks: false });

const EMBED_TOKEN = (i: number) => `EMBEDPLACEHOLDER${i}X`;

/** Replace standalone social-URL lines with placeholder tokens. */
function extractEmbeds(md: string): { md: string; embeds: SocialEmbed[] } {
  const embeds: SocialEmbed[] = [];
  const out = md
    .split("\n")
    .map((line) => {
      const embed = parseSocialUrl(line.trim());
      if (!embed) return line;
      embeds.push(embed);
      return EMBED_TOKEN(embeds.length - 1);
    })
    .join("\n");
  return { md: out, embeds };
}

export function renderMarkdown(md: string): string {
  const { md: withTokens, embeds } = extractEmbeds(md);
  let html = marked.parse(withTokens, { async: false });

  html = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"')
    // Inline images are hotlinked from external sources: lazy-load them and
    // drop the referrer so hosts that block hotlinking-by-referrer still serve.
    .replace(/<img\b/gi, '<img loading="lazy" referrerpolicy="no-referrer"');

  // Inject embeds last, so our trusted iframes survive the strip above. marked
  // wraps a lone token in <p>…</p>; swap the whole paragraph for the embed.
  embeds.forEach((embed, i) => {
    const token = EMBED_TOKEN(i);
    html = html
      .replace(new RegExp(`<p>\\s*${token}\\s*</p>`, "g"), embedHtml(embed))
      .replace(new RegExp(token, "g"), embedHtml(embed));
  });

  return html;
}
