"use client";

import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";

/**
 * Markdown editor with live preview + toolbar for the blog review queue.
 *
 * `@uiw/react-md-editor` is browser-only (touches `document`/`navigator` and
 * ships CSS), so this module must only ever be loaded client-side — the admin
 * route lazy-loads it behind a mounted guard. Keeping the import here (rather
 * than in the route) confines the editor + its CSS to a client-only chunk.
 */
export default function MarkdownEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div data-color-mode="light">
      <MDEditor value={value} onChange={(v) => onChange(v ?? "")} height={440} />
    </div>
  );
}
