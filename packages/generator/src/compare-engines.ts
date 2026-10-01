/**
 * Render the same tokens through two art bundles and compare them.
 *
 *   pnpm --filter @cse/generator compare <baselineDir> <candidateDir> [outDir] [--extra N] [--size PX]
 *
 * Each dir holds a built `index.html` (packages/art/dist). Built for swapping
 * the renderer under the collection: the baseline is the three.js build, the
 * candidate the CSE engine. Every archetype is covered (lowest id per form)
 * plus the first N other ids, each at the generator's own capture pose.
 *
 * Three measures per token:
 *   glyphs   share of cells whose character is identical
 *   near     share within one step of the twelve-glyph ramp
 *   pixels   share of pixels that differ visibly in the final PNG, which
 *            includes the ink, not just the character
 * Writes report.json and an index.html of side-by-sides to eyeball.
 */

import "./env.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ARCHETYPES, COLLECTION, deriveToken } from "@cse/core";
import { type Page, chromium } from "playwright";
import { capturePose, serve } from "./render.js";

const MASTER = process.env.CSE_MASTER_SEED ?? "CUBIC-SYMMETRY-ENGINE";
const RAMP = " .:-=+*#%▒▓█";
const args = process.argv.slice(2);
/** Pull `--name value` out of the positional args. */
const option = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args.splice(i, 2)[1]) : fallback;
};
const extra = option("extra", 40);
/** PNG edge. Glyph rasterisation varies with size, so test the size you ship. */
const SIZE = option("size", 900);
const [baseDir, candDir, outArg] = args;
if (!baseDir || !candDir) {
  console.error("usage: compare <baselineDir> <candidateDir> [outDir] [--extra N]");
  process.exit(1);
}
const outDir = resolve(outArg ?? "out/engine-compare");

// one id per archetype, then the first `extra` others
const ids = new Map<number, string>();
const seen = new Set<string>();
for (let id = 1; id <= COLLECTION.supply && seen.size < ARCHETYPES.length; id++) {
  const s = deriveToken(MASTER, id).traits.structure;
  if (!seen.has(s)) {
    seen.add(s);
    ids.set(id, s);
  }
}
for (let id = 1, added = 0; id <= COLLECTION.supply && added < extra; id++) {
  if (ids.has(id)) continue;
  ids.set(id, deriveToken(MASTER, id).traits.structure);
  added++;
}

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-lcd-text"],
});

async function open(dir: string) {
  const { server, url } = await serve(resolve(dir));
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on("pageerror", (e) => console.error(`[${dir}]`, e.message));
  await page.goto(`${url}?master=${encodeURIComponent(MASTER)}&tokenId=1&static=1`);
  await page.waitForFunction(() => (window as any).__CSE_READY === true, null, { timeout: 60_000 });
  await page.evaluate(() => (window as any).__CSE.stop());
  return { page, server };
}

async function render(page: Page, id: number, pose: number) {
  return page.evaluate(
    ([m, i, p, s]) => {
      const api = (window as any).__CSE;
      api.loadById(i, m, 0);
      return { text: api.captureText(p) as string, png: api.capture(s, p) as string };
    },
    [MASTER, id, pose, SIZE] as [string, number, number, number],
  );
}

/** Share of pixels where any channel differs by more than `tol`. */
function pixelDiff(page: Page, a: string, b: string) {
  return page.evaluate(
    // No named helpers in here: tsx wraps them in a __name() the page lacks.
    async ([a, b]) => {
      const px: Uint8ClampedArray[] = [];
      for (const src of [a, b]) {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        px.push(ctx.getImageData(0, 0, c.width, c.height).data);
      }
      const [pa, pb] = px;
      let diff = 0;
      for (let i = 0; i < pa.length; i += 4) {
        if (Math.abs(pa[i] - pb[i]) > 24 || Math.abs(pa[i + 1] - pb[i + 1]) > 24 || Math.abs(pa[i + 2] - pb[i + 2]) > 24) diff++;
      }
      return diff / (pa.length / 4);
    },
    [a, b] as [string, string],
  );
}

function compareText(a: string, b: string) {
  const la = a.split("\n"),
    lb = b.split("\n");
  const rows = Math.max(la.length, lb.length);
  const cols = Math.max(...la.map((l) => l.length), ...lb.map((l) => l.length));
  let same = 0,
    near = 0;
  for (let y = 0; y < rows; y++) {
    const ra = (la[y] ?? "").padEnd(cols),
      rb = (lb[y] ?? "").padEnd(cols);
    for (let x = 0; x < cols; x++) {
      const ga = RAMP.indexOf(ra[x]),
        gb = RAMP.indexOf(rb[x]);
      if (ga === gb) same++;
      if (Math.abs(ga - gb) <= 1) near++;
    }
  }
  const total = rows * cols || 1;
  return { glyphs: same / total, near: near / total, rows, cols };
}

await mkdir(join(outDir, "png"), { recursive: true });
const base = await open(baseDir);
const cand = await open(candDir);

const results: {
  id: number;
  structure: string;
  glyphs: number;
  near: number;
  pixels: number;
  grid: string;
}[] = [];

for (const [id, structure] of [...ids].sort((a, b) => a[0] - b[0])) {
  const pose = capturePose(deriveToken(MASTER, id).solution.phaseAngle, id);
  const a = await render(base.page, id, pose);
  const b = await render(cand.page, id, pose);
  const t = compareText(a.text, b.text);
  const pixels = await pixelDiff(cand.page, a.png, b.png);
  await writeFile(join(outDir, "png", `${id}-three.png`), Buffer.from(a.png.split(",")[1], "base64"));
  await writeFile(join(outDir, "png", `${id}-cse.png`), Buffer.from(b.png.split(",")[1], "base64"));
  results.push({ id, structure, glyphs: t.glyphs, near: t.near, pixels, grid: `${t.cols}x${t.rows}` });
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`.padStart(8);
  console.log(`#${String(id).padStart(3)} ${structure.padEnd(13)} glyphs ${pct(t.glyphs)}  near ${pct(t.near)}  pixels differ ${pct(pixels)}`);
}

const mean = (k: "glyphs" | "near" | "pixels") => results.reduce((s, r) => s + r[k], 0) / results.length;
const worst = [...results].sort((a, b) => a.glyphs - b.glyphs).slice(0, 5);
const summary = {
  tokens: results.length,
  meanGlyphMatch: mean("glyphs"),
  meanNearMatch: mean("near"),
  meanPixelDiff: mean("pixels"),
  worst: worst.map((r) => ({ id: r.id, structure: r.structure, glyphs: r.glyphs })),
};
await writeFile(join(outDir, "report.json"), JSON.stringify({ summary, results }, null, 2));

const rows = results
  .map(
    (r) => `<figure><div><img src="png/${r.id}-three.png"><img src="png/${r.id}-cse.png"></div>
<figcaption>#${r.id} ${r.structure} · glyphs ${(r.glyphs * 100).toFixed(2)}% · pixels differ ${(r.pixels * 100).toFixed(2)}%</figcaption></figure>`,
  )
  .join("\n");
await writeFile(
  join(outDir, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>three vs CSE engine</title>
<style>body{background:#111;color:#ccc;font:13px monospace;margin:20px}figure{margin:0 0 28px}
div{display:flex;gap:8px}img{width:420px;height:420px}</style>
<h1>three.js (left) vs CSE engine (right)</h1>
<p>${results.length} tokens · mean glyph match ${(summary.meanGlyphMatch * 100).toFixed(2)}% · mean pixels differing ${(summary.meanPixelDiff * 100).toFixed(2)}%</p>
${rows}`,
);

console.log(
  `\n${results.length} tokens · glyphs identical ${(summary.meanGlyphMatch * 100).toFixed(2)}% · within one step ${(summary.meanNearMatch * 100).toFixed(2)}% · pixels differing ${(summary.meanPixelDiff * 100).toFixed(2)}%`,
);
console.log(`report: ${join(outDir, "index.html")}`);

await browser.close();
base.server.close();
cand.server.close();
