/**
 * Renders a schema.org JSON-LD block as a `<script type="application/ld+json">`.
 *
 * Google (and other crawlers) read JSON-LD from anywhere in the document, so we
 * render this inline in the component tree rather than fighting the head API.
 * It's SSR-safe: the serialized graph ships in the initial HTML, which is the
 * whole point — structured data has to be present before any JS runs.
 */
export function JsonLd({
  data,
}: {
  data: Record<string, unknown> | Array<Record<string, unknown>>;
}) {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is safe to inline; we only guard the `<` that could
      // prematurely close the script tag inside a string value.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
