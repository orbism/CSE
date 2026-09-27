/**
 * Recompute provenance.json from a collection that already exists.
 *
 *   pnpm --filter @cse/generator provenance
 *   pnpm --filter @cse/generator provenance -- --out ../../out/other
 *
 * The commitment is a pure function of the token table, so it never needs a
 * re-render to produce — which matters both for a collection generated before
 * this file existed, and for anyone verifying the published hash against the
 * published `tokens.json` without trusting the generator at all.
 */

// side effect: loads the repo-root .env before any config is read
import "./env.js";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { COLLECTION } from "@cse/core";
import { PROVENANCE_ALGORITHM, provenanceHash } from "./provenance.js";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const outDir = resolve(process.cwd(), flag("out") ?? "../../out/collection");
const masterSeed = process.env.CSE_MASTER_SEED ?? "CUBIC-SYMMETRY-ENGINE";

let rows: { tokenId: number; seed: string }[];
try {
  rows = JSON.parse(await readFile(join(outDir, "tokens.json"), "utf8"));
} catch (e) {
  console.error(`no tokens.json in ${outDir} — run \`pnpm generate\` first.`);
  console.error(String(e));
  process.exit(1);
}

const hash = provenanceHash(rows);
const complete = rows.length === COLLECTION.supply;

await writeFile(
  join(outDir, "provenance.json"),
  JSON.stringify(
    { masterSeed, supply: rows.length, hash, algorithm: PROVENANCE_ALGORITHM, complete },
    null,
    2,
  ),
);

console.log(`provenance ${hash}`);
console.log(`  ${rows.length} tokens${complete ? "" : ` — PARTIAL of ${COLLECTION.supply}, not deployable`}`);
console.log(`  wrote ${join(outDir, "provenance.json")}`);
