/**
 * Within-archetype variation check.
 *
 * Renders the first N tokens of one archetype side by side. The collection rule
 * is that every token stays identifiable at thumbnail size, and the risk is not
 * that two archetypes look alike — it is that one archetype's own instances do.
 * Run this after changing any builder.
 *
 *   pnpm --filter @cse/generator variety Exploded
 *   pnpm --filter @cse/generator variety Knot 12
 */

// side effect: loads the repo-root .env before any config is read
import "./env.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deriveToken } from "@cse/core";
import { capture, capturePose, openRenderer, selectToken } from "./render.js";

const MASTER = process.env.CSE_MASTER_SEED ?? "CUBIC-SYMMETRY-ENGINE";
const target = process.argv[2] ?? "Exploded";
const limit = Number(process.argv[3] ?? 8);
const SIZE = Number(process.env.CSE_VARIETY_SIZE ?? 560);
const OUT = resolve(process.cwd(), "../../out/variety");

await mkdir(OUT, { recursive: true });

// prefer the generated index (it carries the resolved nonces); fall back to
// deriving straight from the master seed when no run exists yet
let ids: { tokenId: number; nonce: number }[] = [];
try {
  const rows = JSON.parse(
    await readFile(resolve(process.cwd(), "../../out/collection/tokens.json"), "utf8"),
  ) as { tokenId: number; nonce?: number; traits: { structure: string } }[];
  ids = rows
    .filter((r) => r.traits.structure === target)
    .slice(0, limit)
    .map((r) => ({ tokenId: r.tokenId, nonce: r.nonce ?? 0 }));
} catch {
  // no run on disk yet
}
// Also fall back when the index exists but predates the archetype being asked
// about — a stale run reported "no tokens" for a form that derives perfectly
// well, which reads as a broken builder rather than a stale file.
if (ids.length === 0) {
  for (let id = 1; id <= 2000 && ids.length < limit; id++) {
    if (deriveToken(MASTER, id).traits.structure === target) ids.push({ tokenId: id, nonce: 0 });
  }
}

if (ids.length === 0) {
  console.error(`no tokens with structure "${target}"`);
  process.exit(1);
}

const r = await openRenderer(MASTER);
console.log(`${target}: ${ids.length} tokens -> ${ids.map((i) => i.tokenId).join(", ")}`);

for (const { tokenId, nonce } of ids) {
  const token = deriveToken(MASTER, tokenId, nonce);
  await selectToken(r.page, MASTER, tokenId, nonce);
  const cap = await capture(r.page, SIZE, capturePose(token.solution.phaseAngle, tokenId));
  await writeFile(
    resolve(OUT, `${target.toLowerCase()}-${String(tokenId).padStart(4, "0")}.png`),
    cap.png,
  );
  const ink = cap.text.replace(/\s/g, "").length;
  const cells = token.drivers.density * Math.round(token.drivers.density / 0.6);
  console.log(
    `  #${String(tokenId).padStart(4, "0")}  ${token.traits.palette.name.padEnd(13)}` +
      ` fill ${((ink / cells) * 100).toFixed(1).padStart(5)}%` +
      `  pq ${token.drivers.pqRatio.toFixed(2)}  curv ${token.drivers.curvature.toFixed(2)}` +
      `  discE ${token.drivers.discEnergy.toFixed(2)}  ω${token.traits.phase}`,
  );
}

await r.close();
console.log(`wrote ${OUT}`);
