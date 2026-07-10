import sharp from "sharp";
import path from "node:path";

const BG = "#1c468e";
const SIZE = 2732;
const MARK_WIDTH = Math.round(SIZE * 0.42);

const root = path.resolve(import.meta.dirname, "..");
const markPath = path.join(root, "public/img/brand/white.png");
const outPath = path.join(root, "resources/splash.png");

const mark = await sharp(markPath)
  .resize({ width: MARK_WIDTH })
  .toBuffer({ resolveWithObject: true });

await sharp({
  create: {
    width: SIZE,
    height: SIZE,
    channels: 4,
    background: BG,
  },
})
  .composite([
    {
      input: mark.data,
      left: Math.round((SIZE - mark.info.width) / 2),
      top: Math.round((SIZE - mark.info.height) / 2),
    },
  ])
  .png()
  .toFile(outPath);

console.log("wrote", outPath);
