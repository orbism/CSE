/**
 * Visual smoke test: render one token per archetype at low resolution and dump
 * both the PNGs and a text contact sheet, so composition problems show up
 * before committing to a full-supply run.
 */

// side effect: loads the repo-root .env before any config is read
import "./env.js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ARCHETYPES, COLLECTION, deriveToken } from "@cse/core";
import { capture, capturePose, openRenderer, selectToken } from "./render.js";

const MASTER = process.env.CSE_MASTER_SEED ?? "CUBIC-SYMMETRY-ENGINE";
const OUT = resolve(process.cwd(), "../../out/smoke");
const SIZE = Number(process.env.CSE_SMOKE_SIZE ?? 900);

async function main() {
  await mkdir(OUT, { recursive: true });

  // find the first token id that lands on each archetype
  const wanted = new Map<string, number>();
  for (let id = 1; id <= COLLECTION.supply && wanted.size < ARCHETYPES.length; id++) {
    const t = deriveToken(MASTER, id);
    if (!wanted.has(t.traits.structure)) wanted.set(t.traits.structure, id);
  }

  const r = await openRenderer(MASTER);
  const report: string[] = [];

  for (const arch of ARCHETYPES) {
    const id = wanted.get(arch);
    if (id === undefined) {
      report.push(`${arch.padEnd(14)} MISSING`);
      continue;
    }
    const token = deriveToken(MASTER, id);
    const pose = capturePose(token.solution.phaseAngle, id);
    await selectToken(r.page, MASTER, id, 0);
    const t0 = Date.now();
    const cap = await capture(r.page, SIZE, pose);
    const ms = Date.now() - t0;

    const name = `${arch.toLowerCase()}-${String(id).padStart(4, "0")}`;
    await writeFile(resolve(OUT, `${name}.png`), cap.png);
    await writeFile(resolve(OUT, `${name}.svg`), cap.svg);
    await writeFile(resolve(OUT, `${name}.txt`), cap.text);

    const ink = cap.text.replace(/[\s]/g, "").length;
    const total = token.drivers.density * Math.round(token.drivers.density / 0.6);
    const fr = (await r.page.evaluate(() => (window as any).__CSE.framing())) as {
      radius: number;
      dist: number;
      margin: number;
      extent: number[];
    } | null;
    report.push(
      `${arch.padEnd(14)} #${String(id).padStart(4, "0")}  ` +
        `${token.traits.palette.name.padEnd(13)} ${token.traits.discriminantClass.padEnd(10)} ` +
        `ω${token.traits.phase}  fill ${((ink / total) * 100).toFixed(1).padStart(5)}%  ` +
        `r ${(fr?.radius ?? 0).toFixed(1).padStart(5)} d ${(fr?.dist ?? 0).toFixed(1).padStart(6)} ` +
        `m ${(fr?.margin ?? 0).toFixed(2)} ext ${(fr?.extent ?? []).map((v) => v.toFixed(1)).join("/")}  ` +
        `${(cap.png.length / 1024).toFixed(0).padStart(4)}KB  ${String(ms).padStart(5)}ms`,
    );
    console.log(report[report.length - 1]);
  }

  await writeFile(resolve(OUT, "report.txt"), report.join("\n"));
  await r.close();
  console.log(`\nwrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
