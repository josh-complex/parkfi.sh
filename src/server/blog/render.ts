/**
 * Markdown → HTML for blog post bodies. Rendered server-side so the HTML ships
 * in the SSR response (and the client bundle stays free of `marked`).
 *
 * Content is LLM-generated and passes a human approval gate, but we still strip
 * the obvious script/style/iframe/event-handler vectors as defense in depth —
 * cheap regex rather than pulling a full DOM sanitizer into the server bundle.
 */
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false });
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"');
}
