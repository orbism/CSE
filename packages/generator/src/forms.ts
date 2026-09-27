/**
 * Render one documentation still per archetype for the art page.
 *
 *   pnpm --filter @cse/generator forms
 *
 * One representative Form per archetype, all in the same palette and at the same
 * pose, written to apps/web/public/forms/<slug>.png. Shown side by side the
 * difference between them then reads as shape rather than colour, which is the
 * whole point of the page.
 *
 * These are committed static assets. Re-run after changing any builder.
 */

// side effect: loads the repo-root .env before any config is read
import "./env.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHETYPES, type Palette, deriveToken } from "@cse/core";
import { openRenderer } from "./render.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = resolve(ROOT, "apps/web/public/forms");
const MASTER = process.env.CSE_MASTER_SEED ?? "CUBIC-SYMMETRY-ENGINE";
const SIZE = Number(process.env.CSE_FORM_SIZE ?? 420);

/**
 * Bright CRT phosphor green on dark grey.
 *
 * Deliberately not added to `PALETTES`: `paletteOf` indexes that array modulo
 * its length, so appending an entry would recolour every token in the
 * collection. This exists only for the stills.
 */
const CRT: Palette = {
  name: "CRT",
  bg: "#1a1d1c",
  ink: ["#1f6b39", "#2fa254", "#44d872", "#6bf894", "#a6ffc2"],
  // Green, not white. A near-neutral accent dominated the sparse forms — the
  // wireframe Shell came out reading grey because its brightest cells were all
  // accent and almost none were ink.
  accent: "#d8ffe6",
};

/**
 * A fixed fraction of a revolution, identical for every archetype.
 *
 * Uses `captureLoopFrame`, which sets the rotation directly. `capture` takes a
 * time in seconds and multiplies it by the token's own spin rate, so the same
 * argument would give each Form a different angle — the opposite of what a
 * comparison set needs.
 */
const POSE = 0.12;

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

async function main() {
  await mkdir(OUT, { recursive: true });

  // first Form matching each archetype, scanning past the real supply so a form
  // that is scarce inside 512 ids still has a still on the art page
  const pick = new Map<string, { id: number; nonce: number }>();
  for (let id = 1; id <= 4000 && pick.size < ARCHETYPES.length; id++) {
    const t = deriveToken(MASTER, id);
    if (!pick.has(t.traits.structure)) pick.set(t.traits.structure, { id, nonce: 0 });
  }

  const missing = ARCHETYPES.filter((a) => !pick.has(a));
  if (missing.length) {
    console.error(`no Form found for: ${missing.join(", ")}`);
    process.exit(1);
  }

  const r = await openRenderer(MASTER);
  let bytes = 0;

  for (const archetype of ARCHETYPES) {
    const { id, nonce } = pick.get(archetype)!;
    const dataUrl = (await r.page.evaluate(
      ([i, master, n, palette, size, pose]) => {
        const api = (window as any).__CSE;
        api.loadWithPalette(i, master, n, palette);
        return api.captureLoopFrame(size, pose) as string;
      },
      [id, MASTER, nonce, CRT, SIZE, POSE] as const,
    )) as string;

    const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
    await writeFile(resolve(OUT, `${slug(archetype)}.png`), png);
    bytes += png.length;
    console.log(
      `  ${archetype.padEnd(14)} #${String(id).padStart(4, "0")}  ${(png.length / 1024).toFixed(0).padStart(4)} KB`,
    );
  }

  await r.close();
  console.log(`\n${ARCHETYPES.length} stills, ${(bytes / 1024).toFixed(0)} KB total`);
  console.log(`wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
