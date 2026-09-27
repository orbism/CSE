/**
 * Generator CLI.
 *
 *   pnpm generate                      full-supply run
 *   pnpm generate --limit 25           smoke run
 *   pnpm generate --size 1200          smaller renders
 *   pnpm generate --ids 1,17,40        build exactly these ids
 *   pnpm generate --floor 0            disable the archetype coverage gate
 *   pnpm generate --fingerprint-only   uniqueness + metadata, no images
 *
 * Placeholder CIDs are written into the metadata and rewritten by
 * `pnpm --filter @cse/generator upload`, which knows the real ones only after
 * the art bundle and the images have been pinned.
 */

// side effect: loads the repo-root .env before any config is read
import "./env.js";
import { resolve } from "node:path";
import { COLLECTION } from "@cse/core";
import { run } from "./pipeline.js";
import { PHASH_BITS } from "./uniqueness.js";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const masterSeed = process.env.CSE_MASTER_SEED ?? "CUBIC-SYMMETRY-ENGINE";
const ids = flag("ids")
  ?.split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);
const supply = ids?.length ?? Number(flag("limit") ?? COLLECTION.supply);
/**
 * Still size in pixels.
 *
 * The art is a glyph grid, so the floor is set by the glyph, not by the canvas:
 * a row needs about 10px before the characters stop being characters. Rows run
 * to `density` = 200 at the top end, which puts the floor at 2000px exactly.
 *
 * Measured over the coefficient distribution, `size / rows` falls under 10 for
 * 45% of tokens at 1200px and 13% at 1600px — at 1200 the densest pieces lose
 * the ramp entirely and read as smooth silhouettes with dithered edges, which
 * is a different artwork rather than a smaller one. 2000 is the smallest size
 * at which no token in the supply degrades, and still roughly halves the pinned
 * payload against 3000.
 */
const size = Number(flag("size") ?? 2000);
const outDir = resolve(process.cwd(), flag("out") ?? "../../out/collection");

const report = await run({
  masterSeed,
  outDir,
  supply,
  ids,
  size,
  // Attempts are cheap: pass 1 gates on the 16x16 fingerprint and only the
  // accepted set reaches the 3000px render. 64 is what the tighter same-form
  // threshold needs to keep the tail of the supply satisfiable.
  maxAttempts: Number(flag("max-attempts") ?? 64),
  coverageFloor: Number(flag("floor") ?? 4),
  fingerprintOnly: has("fingerprint-only"),
  uri: {
    imagesCID: process.env.CSE_IMAGES_CID ?? "PENDING_IMAGES_CID",
    artCID: process.env.CSE_ART_CID ?? "PENDING_ART_CID",
    masterSeed,
    externalUrl: process.env.CSE_SITE_URL,
    scheme: process.env.CSE_URI_SCHEME,
  },
});

const pct = (n: number) => ((n / report.attempts) * 100).toFixed(1);
console.log("\n─── run report ───");
console.log(`accepted        ${report.accepted}/${report.supply}`);
console.log(`attempts        ${report.attempts}`);
console.log(
  `rejected        ${report.rejections.structural} structural (${pct(report.rejections.structural)}%), ` +
    `${report.rejections.perceptual} perceptual (${pct(report.rejections.perceptual)}%)`,
);
// Three minima, not one. The tightest maths and the tightest look are almost
// never the same pair, and it is the second that decides whether the collection
// reads as having duplicates.
const { structural, sameForm, perceptual } = report.closestPairs;
if (structural) {
  console.log(
    `closest maths   #${structural.a} / #${structural.b}  structural ${structural.structural.toFixed(3)}`,
  );
}
if (sameForm) {
  console.log(
    `  same form     #${sameForm.a} / #${sameForm.b}  ${sameForm.form}  ` +
      `structural ${sameForm.structural.toFixed(3)}  hamming ${sameForm.perceptual}`,
  );
}
if (perceptual) {
  console.log(
    `closest look    #${perceptual.a} / #${perceptual.b}  hamming ${perceptual.perceptual}/${PHASH_BITS}  ` +
      `structural ${perceptual.structural.toFixed(3)}` +
      (perceptual.form ? `  (both ${perceptual.form})` : ""),
  );
}
console.log(`duration        ${(report.durationMs / 1000).toFixed(1)}s`);

if (report.forced.length) {
  console.log(
    `\nforced          ${report.forced.length} token(s) re-derived to fill a starved archetype`,
  );
  for (const f of report.forced) {
    console.log(`    #${String(f.tokenId).padStart(4)}  ${f.wasArchetype} -> ${f.archetype}  nonce ${f.nonce}`);
  }
}

if (report.exhausted.length) {
  console.error(
    `\nFAILED: ${report.exhausted.length} token(s) exhausted every attempt: ` +
      `${report.exhausted.slice(0, 20).join(", ")}${report.exhausted.length > 20 ? "…" : ""}`,
  );
  console.error("The supply is incomplete. Loosen the thresholds or raise --max-attempts.");
  process.exit(1);
}

if (report.accepted !== COLLECTION.supply) {
  console.warn(
    `\nNOTE: this run holds ${report.accepted} tokens, not the full ${COLLECTION.supply}. ` +
      `provenance.json is marked incomplete and pnpm deploy will refuse it on a live network.`,
  );
}

if (report.starved.length) {
  console.error(
    `\nFAILED: ${report.starved.length} archetype(s) below the coverage floor of ` +
      `${report.coverageFloor}: ${report.starved.map((a) => `${a} (${report.coverage[a]})`).join(", ")}`,
  );
  console.error("Every form has to exist in the collection. Raise --max-attempts or lower --floor.");
  process.exit(1);
}

console.log("\ntrait distribution");
for (const [axis, values] of Object.entries(report.traitCounts)) {
  const rows = Object.entries(values).sort((a, b) => b[1] - a[1]);
  console.log(`  ${axis}`);
  for (const [value, n] of rows) {
    const share = ((n / report.accepted) * 100).toFixed(1);
    console.log(`    ${value.padEnd(18)} ${String(n).padStart(5)}  ${share.padStart(5)}%`);
  }
}
console.log(`\nwrote ${outDir}`);
