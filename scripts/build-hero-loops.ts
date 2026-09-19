/**
 * Publish ride hero loops: transcode Disney's silent cinemagraphs to animated
 * WebP, upload them to R2, and regenerate `src/lib/hero-loops.generated.ts`.
 *
 * Why WebP and not the source mp4: a Discord component embed's Media Gallery
 * accepts video, but "shows a poster frame with play controls and does not
 * autoplay" — a cinemagraph rendered that way is just a still with a play
 * button. Animated WebP is the only format that actually moves in a preview
 * (confirmed by test, 2026-09-19), and it lands ~10x smaller than the source.
 *
 * Classification: `hero_media` can't tell a loop from a trailer, because
 * `disneyEntityHeroSlides` collapses the feed's `cinemagraph` and `video` types
 * into one `kind: "video"`. Duration is the real discriminator — the trailers
 * are all 26-42s narrated pieces, the loops are all under 20s. Audio is NOT a
 * usable signal: three short loops carry an AAC track, and WebP drops audio
 * regardless.
 *
 * Needs `ffmpeg` and `img2webp` (brew install ffmpeg webp) — so this runs from
 * a workstation, not the deploy. Re-running is cheap and idempotent: keys are
 * content-addressed, so an unchanged source republishes the same key.
 *
 * Run:  bun run build:hero-loops           (transcode, upload, write manifest)
 *       bun run build:hero-loops --dry-run (transcode and report only)
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { execFile as execFileCb } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

/** Approved encode: 640 wide, quality 70, 15fps, full source length. */
const WIDTH = 640;
const QUALITY = 70;
const FPS = 15;

/**
 * Anything longer than this is a trailer, not a loop. The four that fail it are
 * all named `walt-disney-world-*-video-*` and run 26.8-41.9s; the longest real
 * loop is Kilimanjaro Safaris at 20.0s.
 */
const MAX_LOOP_SECONDS = 20;

/**
 * Discord measures every asset in a preview inside one 10-second budget, shared
 * with whatever else the embed carries. Motion-heavy clips blow past this at the
 * approved settings (Dumbo lands near 5 MB), so they get re-encoded smaller
 * rather than risking the whole embed falling back to the OG card.
 */
const MAX_BYTES = 2_500_000;
const FALLBACKS = [
  { width: 480, quality: QUALITY },
  { width: 480, quality: 55 },
];

/** A container duration beyond this is a broken header, not a long video. */
const IMPLAUSIBLE_SECONDS = 120;

async function run([bin, ...args]: Array<string>): Promise<string> {
  // `maxBuffer` is generous because ffprobe's frame count on a long source can
  // out-talk the default 1 MB pipe.
  const { stdout } = await execFile(bin, args, { maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim();
}

/**
 * Real playable length. Star Tours' webm reports `duration=757.189` with an
 * `avg_frame_rate` of `1000/1` — both garbage — so an implausible header falls
 * back to counting decoded frames at an assumed 30fps source.
 */
async function probeSeconds(url: string): Promise<{ seconds: number; trustTimestamps: boolean }> {
  const raw = Number(
    await run([
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      url,
    ]),
  );
  if (Number.isFinite(raw) && raw > 0 && raw < IMPLAUSIBLE_SECONDS) {
    return { seconds: raw, trustTimestamps: true };
  }
  const frames = Number(
    await run([
      "ffprobe",
      "-v",
      "error",
      "-count_frames",
      "-select_streams",
      "v",
      "-show_entries",
      "stream=nb_read_frames",
      "-of",
      "csv=p=0",
      url,
    ]),
  );
  return { seconds: frames / 30, trustTimestamps: false };
}

/**
 * Transcode one source to animated WebP and return the bytes. Each attempt gets
 * its own directory: a fallback re-encode at a narrower width must not find the
 * previous attempt's frames sitting beside its own, since img2webp would happily
 * splice two different resolutions into one file.
 */
async function encode(
  url: string,
  root: string,
  opts: { width: number; quality: number; trustTimestamps: boolean },
): Promise<Uint8Array> {
  const dir = await mkdtemp(join(root, `w${opts.width}q${opts.quality}-`));
  const filters = opts.trustTimestamps
    ? ["-vf", `fps=${FPS},scale=${opts.width}:-2`]
    : // Unusable timestamps: decode every frame and keep every other one, which
      // holds real-time for a 30fps source without trusting the container.
      ["-vsync", "0", "-vf", `select=not(mod(n\\,2)),scale=${opts.width}:-2`];
  // `-nostdin` matters: without it ffmpeg drains the caller's stdin.
  await run([
    "ffmpeg",
    "-nostdin",
    "-y",
    "-v",
    "error",
    "-i",
    url,
    ...filters,
    join(dir, "f%04d.png"),
  ]);
  // execFile runs no shell, so the frame list is expanded here rather than
  // handed to img2webp as a glob it would take literally. Sorted, because frame
  // order is the animation.
  const frames = (await readdir(dir))
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => join(dir, f));
  if (frames.length === 0) throw new Error(`no frames decoded from ${url}`);
  const out = join(dir, "loop.webp");
  await run([
    "img2webp",
    "-loop",
    "0",
    "-d",
    String(Math.round(1000 / FPS)),
    "-sharp_yuv",
    "-lossy",
    "-q",
    String(opts.quality),
    "-m",
    "6",
    ...frames,
    "-o",
    out,
  ]);
  return new Uint8Array(await readFile(out));
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const { db } = await import("#/db/index.ts");
  const { sql } = await import("drizzle-orm");
  const { putBytes } = await import("#/server/edge/r2.ts");

  // Every video slide, in stored order, so the first loop per ride wins.
  const { rows } = await db.execute<{ slug: string; url: string }>(sql`
    select a.slug, s.url
    from attraction_meta m
    join attractions a on a.id = m.attraction_id
    cross join lateral (
      select ordinality as ord, value->>'url' as url, value->>'kind' as kind
      from jsonb_array_elements(m.hero_media) with ordinality
    ) s
    where s.kind = 'video'
    order by a.slug, s.ord
  `);

  const manifest: Record<string, string> = {};
  const skipped: Array<string> = [];
  const root = await mkdtemp(join(tmpdir(), "hero-loops-"));

  for (const { slug, url } of rows) {
    if (manifest[slug]) continue; // already have this ride's first loop
    const { seconds, trustTimestamps } = await probeSeconds(url);
    if (seconds > MAX_LOOP_SECONDS) {
      skipped.push(`${slug} (${seconds.toFixed(1)}s trailer)`);
      continue;
    }

    const dir = await mkdtemp(join(root, "asset-"));
    let bytes = await encode(url, dir, { width: WIDTH, quality: QUALITY, trustTimestamps });
    let note = "";
    for (const fallback of FALLBACKS) {
      if (bytes.byteLength <= MAX_BYTES) break;
      bytes = await encode(url, dir, { ...fallback, trustTimestamps });
      note = ` [${fallback.width}w q${fallback.quality}]`;
    }

    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    const key = `hero-loops/${slug}-${hash}.webp`;
    const ok = dryRun || (await putBytes(key, bytes, "image/webp"));
    if (!ok) {
      skipped.push(`${slug} (upload failed)`);
      continue;
    }
    manifest[slug] = `${process.env.R2_PUBLIC_URL}/${key}`;
    const mb = (bytes.byteLength / 1_048_576).toFixed(2);
    console.log(`[hero-loops] ${slug.padEnd(50)} ${seconds.toFixed(1)}s  ${mb} MB${note}`);
  }

  await rm(root, { recursive: true, force: true });

  if (!dryRun) {
    const entries = Object.keys(manifest)
      .sort()
      .map((slug) => `  ${JSON.stringify(slug)}: ${JSON.stringify(manifest[slug])},`)
      .join("\n");
    await writeFile(
      "src/lib/hero-loops.generated.ts",
      [
        "/**",
        " * GENERATED — do not edit by hand. Run `bun run build:hero-loops` to refresh.",
        " *",
        " * Ride slug -> published animated-WebP loop URL. See `src/lib/hero-loops.ts`",
        " * for why this is a baked manifest rather than a runtime lookup.",
        " */",
        "export const HERO_LOOPS: Record<string, string> = {",
        entries,
        "};",
        "",
      ].join("\n"),
    );
  }

  console.log(
    `[hero-loops] ${dryRun ? "dry run — " : ""}${Object.keys(manifest).length} published, ` +
      `${skipped.length} skipped: ${skipped.join(", ")}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
