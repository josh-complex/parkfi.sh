/**
 * Lenient RFC 4180-style CSV parser: quoted fields, doubled quotes, embedded
 * newlines, CRLF or LF — plus two concessions the FAA archives need:
 *
 *   1. Inside a quoted field a `"` only CLOSES the field when the next char
 *      is a delimiter, a newline or the end of input; any other `"` is kept
 *      literally. Proposal texts contain unescaped inch marks (`10' x 20"`)
 *      that a strict parser turns into a runaway field.
 *   2. `recordStart` (optional) splits the text into one chunk per record at
 *      lines matching the pattern (e.g. an aeronautical study number), so a
 *      still-unbalanced quote can only damage its own record, never the rest
 *      of a 20 MB file. Chunks that don't parse to the header width are
 *      dropped and counted in `dropped`.
 *
 * Dependency-free like the zip/XML helpers.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i++;
        } else if (next === undefined || next === "," || next === "\n" || next === "\r") {
          quoted = false;
        } else field += '"';
      } else field += c;
      continue;
    }
    if (c === '"' && field.length === 0) quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface ParsedCsv {
  header: string[];
  rows: Array<Record<string, string>>;
  /** Records that did not parse to the header's width (malformed quoting). */
  dropped: number;
}

/**
 * Parse to objects keyed by the (trimmed) header. With `recordStart`, the
 * body is split into per-record chunks at lines matching it (multiline
 * flag applied), and each chunk is parsed on its own.
 */
export function parseCsvRecords(text: string, recordStart?: RegExp): ParsedCsv {
  const firstBreak = text.search(/\r?\n/);
  const headerLine = firstBreak < 0 ? text : text.slice(0, firstBreak);
  const header = (parseCsv(headerLine)[0] ?? []).map((h) => h.trim());
  const body = firstBreak < 0 ? "" : text.slice(firstBreak + 1);
  const rows: Array<Record<string, string>> = [];
  let dropped = 0;
  const toObject = (r: string[]) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => {
      o[h] = r[i] ?? "";
    });
    return o;
  };

  if (!recordStart) {
    for (const r of parseCsv(body)) {
      if (r.length === 1 && r[0] === "") continue;
      if (r.length === header.length) rows.push(toObject(r));
      else dropped++;
    }
    return { header, rows, dropped };
  }

  const starts: number[] = [];
  const re = new RegExp(
    recordStart.source,
    recordStart.flags.includes("g") ? recordStart.flags : `${recordStart.flags}g`,
  );
  for (let m = re.exec(body); m; m = re.exec(body)) {
    starts.push(m.index);
    if (m[0].length === 0) re.lastIndex++;
  }
  for (let i = 0; i < starts.length; i++) {
    const chunk = body.slice(starts[i], starts[i + 1] ?? body.length).replace(/\r?\n$/, "");
    const parsed = parseCsv(chunk);
    let r = parsed[0];
    // Overflow always comes from a broken final column (the FAA files end each
    // row with a JSON blob whose `\",\"` sequences look like field breaks);
    // folding the extra fields back into it keeps every earlier column exact.
    if (parsed.length === 1 && r && r.length > header.length) {
      r = [...r.slice(0, header.length - 1), r.slice(header.length - 1).join(",")];
    }
    if (parsed.length === 1 && r && r.length === header.length) rows.push(toObject(r));
    else dropped++;
  }
  return { header, rows, dropped };
}

/** Convenience for well-formed files. */
export function parseCsvObjects(text: string): Array<Record<string, string>> {
  return parseCsvRecords(text).rows;
}
