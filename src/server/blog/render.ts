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
    // Also match the embeds' look — rounded corners, centered block. Vertical
    // spacing comes from the surrounding <p>/<figure>, not the <img> itself.
    .replace(
      /<img\b/gi,
      '<img loading="lazy" referrerpolicy="no-referrer" ' +
        'style="display:block;margin:0 auto;border-radius:12px"',
    );

  // Writers put an italic "*Photo: …*" credit right under each inline image, so
  // marked renders them in one paragraph (img + trailing <em>). Re-wrap that as
  // a <figure>/<figcaption> so the credit reads as a caption: muted, italic, and
  // tucked close under the image instead of floating below it in body color.
  html = html.replace(
    /<p>\s*(<img\b[^>]*>)\s*(<em>[\s\S]*?<\/em>)\s*<\/p>/gi,
    (_m, img: string, caption: string) =>
      `<figure style="margin:1.5rem auto;text-align:center">${img}` +
      `<figcaption style="margin-top:0.5rem;font-style:italic;font-size:0.875rem;` +
      `color:var(--muted-foreground)">${caption}</figcaption></figure>`,
  );

  // A data table (the dining-diff roundups run six or seven columns) is far wider
  // than a phone. Without this the table forces the whole article to scroll
  // sideways and the right-hand columns sit under the viewport edge. Wrap each one
  // in its own horizontally scrollable block instead: `min-width:max-content` lets
  // the table take its natural width — Tailwind Typography's `width:100%` still
  // wins whenever that natural width fits — and the wrapper does the scrolling.
  // Inline styles because the rendered body ships without a stylesheet hook of its
  // own. Markdown can't nest tables, so the naive open/close pairing is safe.
  html = html
    .replace(
      /<table\b/gi,
      '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%">' +
        '<table style="min-width:max-content"',
    )
    .replace(/<\/table>/gi, "</table></div>");

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
