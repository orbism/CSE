/**
 * Print the smallest set of token ids that shows every archetype — one id per
 * form, lowest first, comma separated on a single line.
 *
 *   pnpm --silent --filter @cse/generator cover
 *
 * The local demo generates and mints exactly this set, so every form is on
 * screen without generating the whole supply to find the scarce ones. It is
 * pure maths and takes milliseconds; nothing is rendered.
 *
 * `generate` writes the same mapping to out/collection/coverage.json after a
 * run, but that only exists once a run has happened, and the demo needs the ids
 * before it decides what to build.
 */

// side effect: loads the repo-root .env before any config is read
import "./env.js";
import { ARCHETYPES, COLLECTION, deriveToken } from "@cse/core";

const MASTER = process.env.CSE_MASTER_SEED ?? "CUBIC-SYMMETRY-ENGINE";

const pick = new Map<string, number>();
for (let id = 1; id <= COLLECTION.supply && pick.size < ARCHETYPES.length; id++) {
  const structure = deriveToken(MASTER, id).traits.structure;
  if (!pick.has(structure)) pick.set(structure, id);
}

const missing = ARCHETYPES.filter((a) => !pick.has(a));
if (missing.length) {
  // The generator's coverage gate can force a starved archetype into existence
  // at a bumped nonce, but that runs over the whole supply. If a form cannot be
  // reached at nonce 0 anywhere in 1..supply, the selector or the family layout
  // is wrong and no amount of demo wiring will paper over it.
  console.error(`no token in 1..${COLLECTION.supply} lands on: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(
  [...pick.values()].sort((a, b) => a - b).join(","),
);
