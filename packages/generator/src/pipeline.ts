/**
 * The one-run pipeline:
 *   seed -> equations -> solve -> map to composition -> enforce uniqueness
 *        -> render PNG/SVG/ANSI -> metadata + rarity
 *
 * Uniqueness has to be settled before any 3000px render happens, so the run is
 * two passes: a cheap fingerprint pass that fixes the final nonce for every
 * token, then an expensive render pass over the accepted set.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ARCHETYPES, type Archetype, COLLECTION, type Token, deriveToken } from "@cse/core";
import {
  type Ranked,
  type UriConfig,
  buildMetadata,
  countTraits,
  rank,
} from "./metadata.js";
import {
  assertBundleMatchesCore,
  capture,
  capturePose,
  fingerprint,
  openRenderer,
  selectToken,
} from "./render.js";
import { buildProvenance } from "./provenance.js";
import { UniquenessIndex, dHash } from "./uniqueness.js";

export interface RunOptions {
  masterSeed: string;
  outDir: string;
  supply: number;
  size: number;
  /** Give up on a token after this many nonce bumps. */
  maxAttempts: number;
  uri: UriConfig;
  /** Skip the render pass; useful when only the trait tables are needed. */
  fingerprintOnly?: boolean;
  /**
   * Build exactly these token ids instead of 1..supply.
   *
   * The local demo uses this to render one token per archetype without
   * generating every id up to the highest one in that cover.
   */
  ids?: number[];
  /** Minimum tokens per archetype the run guarantees. 0 disables the gate. */
  coverageFloor?: number;
}

/** A token whose nonce was chosen to fill a starved archetype rather than taken as drawn. */
export interface ForcedToken {
  tokenId: number;
  nonce: number;
  archetype: Archetype;
  /** What the token would have been at nonce 0. */
  wasArchetype: Archetype;
}

export interface RunReport {
  supply: number;
  accepted: number;
  attempts: number;
  rejections: { structural: number; perceptual: number };
  exhausted: number[];
  closestPairs: ReturnType<UniquenessIndex["closestPairs"]>;
  traitCounts: ReturnType<typeof countTraits>;
  /** Tokens per archetype in the finished run. */
  coverage: Record<string, number>;
  /** Archetypes that finished below the coverage floor — a failed run. */
  starved: string[];
  coverageFloor: number;
  forced: ForcedToken[];
  durationMs: number;
}

const log = (msg: string) => process.stdout.write(`${msg}\n`);

/**
 * Coverage gate, pass 0 — pure maths, no browser.
 *
 * Reachability and presence are different things. Every archetype is reachable
 * by construction (the selector spans a contiguous run of slots, so no family of
 * twelve or fewer has a dead entry), but at 512 tokens the rarest forms sit close
 * enough to zero that an unlucky seed can leave one with nothing. Rather than
 * tune the sampling until that stops happening by chance, the run guarantees it:
 * any archetype below the floor takes ids off the most over-represented
 * archetype and re-derives them at a bumped nonce until they land where they are
 * needed.
 *
 * This reuses the mechanism the uniqueness gate already relies on — a bumped
 * nonce re-derives the whole token — so a forced token is as legitimately
 * derived as any other. Every one is recorded in the run report, because a
 * silent thumb on the scale would be worse than no guarantee at all.
 */
function planCoverage(masterSeed: string, ids: number[], floor: number, maxSearch: number) {
  const counts = new Map<string, number>();
  for (const a of ARCHETYPES) counts.set(a, 0);
  const structureOf = new Map<number, Archetype>();
  for (const id of ids) {
    const s = deriveToken(masterSeed, id, 0).traits.structure;
    structureOf.set(id, s);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }

  const pinned = new Map<number, { nonce: number; structure: Archetype }>();
  const forced: ForcedToken[] = [];
  if (floor <= 0) return { pinned, forced, counts };

  for (const target of ARCHETYPES) {
    while ((counts.get(target) ?? 0) < floor) {
      // Take from whichever archetype has the most to spare, and prefer a high
      // id: the low ids are what the local demo and the art page show, so leave
      // those as the equation drew them.
      let donor = -1;
      let donorCount = -1;
      for (let i = ids.length - 1; i >= 0; i--) {
        const id = ids[i];
        if (pinned.has(id)) continue;
        const c = counts.get(structureOf.get(id) as string) ?? 0;
        if (c > donorCount) {
          donorCount = c;
          donor = id;
        }
      }
      if (donor < 0 || donorCount <= floor) break;

      let found = -1;
      for (let nonce = 1; nonce <= maxSearch; nonce++) {
        if (deriveToken(masterSeed, donor, nonce).traits.structure === target) {
          found = nonce;
          break;
        }
      }
      if (found < 0) break;

      const was = structureOf.get(donor) as Archetype;
      counts.set(was, (counts.get(was) ?? 1) - 1);
      counts.set(target, (counts.get(target) ?? 0) + 1);
      structureOf.set(donor, target);
      pinned.set(donor, { nonce: found, structure: target });
      forced.push({ tokenId: donor, nonce: found, archetype: target, wasArchetype: was });
    }
  }
  return { pinned, forced, counts };
}

export async function run(opts: RunOptions): Promise<RunReport> {
  const started = Date.now();
  const dirs = {
    images: join(opts.outDir, "images"),
    svg: join(opts.outDir, "svg"),
    ansi: join(opts.outDir, "ansi"),
    metadata: join(opts.outDir, "metadata"),
  };
  for (const d of Object.values(dirs)) await mkdir(d, { recursive: true });

  const ids = opts.ids ?? Array.from({ length: opts.supply }, (_, i) => i + 1);
  const idSet = new Set(ids);

  // The floor is a promise about the finished collection, so it only binds on a
  // full-supply run. A `--limit 25` smoke run or a hand-picked `--ids` list
  // cannot give every archetype four Forms, and failing them for that would
  // break the two commands people actually reach for day to day.
  const fullRun = !opts.ids && ids.length >= COLLECTION.supply;
  const coverageFloor = fullRun ? (opts.coverageFloor ?? 0) : 0;

  const { pinned, forced } = planCoverage(opts.masterSeed, ids, coverageFloor, 4000);

  // An explicit id list is a hand-picked composition — the local demo asks for
  // exactly one token per archetype. Pin every one of them to the archetype it
  // derives to, so a uniqueness rejection cannot re-derive a form out of the set
  // it was chosen for and leave a gap.
  if (opts.ids) {
    for (const id of ids) {
      if (pinned.has(id)) continue;
      pinned.set(id, { nonce: 0, structure: deriveToken(opts.masterSeed, id, 0).traits.structure });
    }
  }

  if (forced.length) {
    log(
      `coverage: forced ${forced.length} token(s) to fill starved archetypes — ` +
        forced.map((f) => `#${f.tokenId} ${f.wasArchetype}->${f.archetype}@n${f.nonce}`).join(", "),
    );
  }

  const renderer = await openRenderer(opts.masterSeed);
  const index = new UniquenessIndex();
  const exhausted: number[] = [];
  const finalTokens: Token[] = [];
  let attempts = 0;

  try {
    // ---- the bundle and this process must agree on what a token is
    await assertBundleMatchesCore(
      renderer.page,
      opts.masterSeed,
      [1, 2, 3, 7, 13, 42].filter((id) => idSet.has(id)),
    );

    // ---- pass 1: fix each token's nonce under both uniqueness gates
    log(`resolving ${ids.length} tokens…`);
    let seen = 0;
    for (const id of ids) {
      const pin = pinned.get(id);
      let accepted = false;
      let evaluated = 0;
      // A pinned token searches past any nonce that would move it off the
      // archetype it was chosen to cover, so the uniqueness gate cannot quietly
      // undo the coverage guarantee.
      for (
        let nonce = pin?.nonce ?? 0;
        evaluated < opts.maxAttempts && nonce < (pin?.nonce ?? 0) + 4000;
        nonce++
      ) {
        const token = deriveToken(opts.masterSeed, id, nonce);
        if (pin && token.traits.structure !== pin.structure) continue;
        evaluated++;
        attempts++;
        await selectToken(renderer.page, opts.masterSeed, id, nonce);
        const grid = await fingerprint(
          renderer.page,
          capturePose(token.solution.phaseAngle, id),
        );
        const hash = dHash(grid);
        const rejection = index.check(token, hash);
        if (rejection) {
          index.record(rejection);
          continue;
        }
        index.accept(token, hash);
        finalTokens.push(token);
        accepted = true;
        break;
      }
      if (!accepted) {
        // Recorded rather than silently dropped: the supply must stay exact, so
        // an exhausted id is a real failure that needs the thresholds revisited.
        exhausted.push(id);
      }
      if (++seen % 100 === 0) {
        log(`  ${seen}/${ids.length}  accepted ${index.size}  rejected ${index.rejections.length}`);
      }
    }

    const ranked = rank(finalTokens);
    const byId = new Map<number, Ranked>(ranked.map((r) => [r.token.tokenId, r]));

    // ---- pass 2: render the accepted set
    if (!opts.fingerprintOnly) {
      log(`rendering ${finalTokens.length} tokens at ${opts.size}px…`);
      let done = 0;
      for (const token of finalTokens) {
        const id = token.tokenId;
        await selectToken(renderer.page, opts.masterSeed, id, token.nonce);
        const pose = capturePose(token.solution.phaseAngle, id);
        const cap = await capture(renderer.page, opts.size, pose);

        await writeFile(join(dirs.images, `${id}.png`), cap.png);
        await writeFile(join(dirs.svg, `${id}.svg`), cap.svg);
        await writeFile(join(dirs.ansi, `${id}.txt`), cap.text);
        await writeFile(
          join(dirs.metadata, `${id}.json`),
          JSON.stringify(buildMetadata(byId.get(id)!, opts.uri), null, 2),
        );

        if (++done % 50 === 0) log(`  ${done}/${finalTokens.length}`);
      }
    } else {
      for (const token of finalTokens) {
        await writeFile(
          join(dirs.metadata, `${token.tokenId}.json`),
          JSON.stringify(buildMetadata(byId.get(token.tokenId)!, opts.uri), null, 2),
        );
      }
    }

    // ---- run artefacts
    const traitCounts = countTraits(finalTokens);

    // Coverage is asserted against what the run actually produced, not against
    // what pass 0 planned: the uniqueness gate re-derives tokens after that, and
    // a plan that no longer holds is not a guarantee.
    const coverage: Record<string, number> = {};
    for (const a of ARCHETYPES) coverage[a] = 0;
    const firstId: Record<string, number> = {};
    for (const t of [...finalTokens].sort((a, b) => a.tokenId - b.tokenId)) {
      coverage[t.traits.structure]++;
      if (firstId[t.traits.structure] === undefined) firstId[t.traits.structure] = t.tokenId;
    }
    // A full run owes every archetype the floor. A partial run owes only what it
    // set out to build: anything the id list was chosen to contain has to still
    // be there, and archetypes it never planned to include are not missing.
    const planned: Record<string, number> = {};
    for (const a of ARCHETYPES) planned[a] = 0;
    for (const id of ids) planned[deriveToken(opts.masterSeed, id, 0).traits.structure]++;
    const starved = fullRun
      ? ARCHETYPES.filter((a) => coverage[a] < Math.max(1, coverageFloor))
      : ARCHETYPES.filter((a) => planned[a] > 0 && coverage[a] === 0);

    const report: RunReport = {
      supply: ids.length,
      accepted: finalTokens.length,
      attempts,
      rejections: {
        structural: index.rejections.filter((r) => r.reason === "structural").length,
        perceptual: index.rejections.filter((r) => r.reason === "perceptual").length,
      },
      exhausted,
      closestPairs: index.closestPairs(),
      traitCounts,
      coverage,
      starved,
      coverageFloor,
      forced,
      durationMs: Date.now() - started,
    };

    await writeFile(join(opts.outDir, "report.json"), JSON.stringify(report, null, 2));
    // One id per archetype, lowest first. The local demo mints exactly this set
    // so every form is on screen without hunting for it.
    await writeFile(join(opts.outDir, "coverage.json"), JSON.stringify(firstId, null, 2));

    // The commitment the contract is initialised with. `complete` is false for a
    // partial run (--limit, --ids), which is what stops a smoke run's hash from
    // being deployed as if it covered the collection.
    const provenance = buildProvenance(opts.masterSeed, COLLECTION.supply, finalTokens);
    await writeFile(
      join(opts.outDir, "provenance.json"),
      JSON.stringify(provenance, null, 2),
    );
    log(
      `provenance ${provenance.hash}  (${provenance.supply} tokens` +
        `${provenance.complete ? "" : " — PARTIAL, not deployable"})`,
    );
    await writeFile(
      join(opts.outDir, "rejections.json"),
      JSON.stringify(index.rejections, null, 2),
    );
    await writeFile(
      join(opts.outDir, "rarity.json"),
      JSON.stringify(
        ranked
          .map((r) => ({
            tokenId: r.token.tokenId,
            rank: r.rank,
            score: Number(r.score.toFixed(4)),
          }))
          .sort((a, b) => a.rank - b.rank),
        null,
        2,
      ),
    );
    // flat index the gallery loads once and filters client-side
    await writeFile(
      join(opts.outDir, "tokens.json"),
      JSON.stringify(
        ranked
          .map((r) => ({
            tokenId: r.token.tokenId,
            seed: r.token.seed,
            nonce: r.token.nonce,
            equation: r.token.equation,
            discriminant: r.token.solution.discriminant,
            degenerate: r.token.degenerate,
            rarityRank: r.rank,
            traits: {
              structure: r.token.traits.structure,
              rootState: r.token.traits.rootState,
              symmetry: r.token.traits.symmetry,
              discriminantClass: r.token.traits.discriminantClass,
              discriminantBand: r.token.traits.discriminantBand,
              phase: r.token.traits.phase,
              energyBand: r.token.traits.energyBand,
              feedbackBand: r.token.traits.feedbackBand,
              palette: r.token.traits.palette.name,
            },
          }))
          .sort((a, b) => a.tokenId - b.tokenId),
        null,
        2,
      ),
    );
    await writeFile(
      join(opts.outDir, "collection.json"),
      JSON.stringify(
        {
          ...COLLECTION,
          masterSeed: opts.masterSeed,
          renderSize: opts.size,
          imagesCID: opts.uri.imagesCID,
          artCID: opts.uri.artCID,
        },
        null,
        2,
      ),
    );

    return report;
  } finally {
    await renderer.close();
  }
}
