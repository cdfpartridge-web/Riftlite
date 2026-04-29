// Pre-bake WebP versions of every PNG/JPG under public/ alongside the
// originals. Pages reference the .webp variants directly so we never
// hit Vercel's image optimiser (5k transformations/mo on the free
// tier). Run on demand or in CI before deploy.
//
// Usage:  node scripts/optimize-images.mjs
//
// What it does:
//   - walks public/screenshots and public/brand for .png / .jpg
//   - skips files whose .webp sibling already exists AND is newer than
//     the source (so re-runs are cheap)
//   - writes <name>.webp next to the original
//   - prints before/after byte counts so you can see the savings
//
// Why we don't go through Vercel's optimiser instead: each (source ×
// width × format × quality) variant counts as a transformation, and
// the homepage alone fans out hundreds of LegendChip variants per
// render. Pre-baking once at build time is free forever.

import { readdir, stat, mkdir } from "node:fs/promises";
import { join, extname, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);
const PUBLIC_DIR = join(repoRoot, "public");

// Scan these subdirectories. Add more as we drop new asset folders.
const SUBDIRS = ["screenshots", "brand"];

// Quality 82 is the sweet spot in our spot-checks: indistinguishable
// from quality 95 on the dashboard screenshots, ~30% smaller.
const WEBP_QUALITY = 82;

async function listImages(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const out = [];
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg") continue;
    out.push(join(dir, entry.name));
  }
  return out;
}

async function shouldRebuild(src, dst) {
  try {
    const [srcStat, dstStat] = await Promise.all([stat(src), stat(dst)]);
    return srcStat.mtimeMs > dstStat.mtimeMs;
  } catch (err) {
    if (err.code === "ENOENT") return true;
    throw err;
  }
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

async function optimize(src) {
  const dir = dirname(src);
  const name = basename(src, extname(src));
  const dst = join(dir, `${name}.webp`);

  if (!(await shouldRebuild(src, dst))) {
    return { src, dst, skipped: true };
  }

  await ensureDir(dir);
  const beforeBytes = (await stat(src)).size;
  await sharp(src).webp({ quality: WEBP_QUALITY, effort: 6 }).toFile(dst);
  const afterBytes = (await stat(dst)).size;
  return { src, dst, skipped: false, beforeBytes, afterBytes };
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function main() {
  let totalBefore = 0;
  let totalAfter = 0;
  let built = 0;
  let skipped = 0;

  for (const sub of SUBDIRS) {
    const dir = join(PUBLIC_DIR, sub);
    const images = await listImages(dir);
    for (const src of images) {
      const result = await optimize(src);
      const rel = src.slice(repoRoot.length + 1).replaceAll("\\", "/");
      if (result.skipped) {
        skipped += 1;
        console.log(`skip   ${rel} (webp up to date)`);
        continue;
      }
      built += 1;
      totalBefore += result.beforeBytes;
      totalAfter += result.afterBytes;
      const pct = Math.round((1 - result.afterBytes / result.beforeBytes) * 100);
      console.log(
        `build  ${rel}  ${fmtBytes(result.beforeBytes)} -> ${fmtBytes(
          result.afterBytes,
        )}  (${pct}% smaller)`,
      );
    }
  }

  console.log("");
  console.log(
    `Done. ${built} rebuilt, ${skipped} up to date.${
      built > 0
        ? `  Total: ${fmtBytes(totalBefore)} -> ${fmtBytes(totalAfter)}`
        : ""
    }`,
  );
}

await main();
