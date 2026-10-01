/**
 * Playwright render harness.
 *
 * Serves the built art bundle over loopback and drives it through the `__CSE`
 * handles that `packages/art/src/main.ts` exposes. One browser page renders the
 * whole supply sequentially — reloading per token would dominate the runtime.
 */

import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { type Browser, type Page, chromium } from "playwright";
import { deriveToken } from "@cse/core";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ART_DIST = resolve(HERE, "../../art/dist");

/** Fixed pose per token so a snapshot is stable across regenerations. */
export function capturePose(phaseAngle: number, tokenId: number): number {
  return (phaseAngle * 2.5 + (tokenId % 7) * 0.31) % 12;
}

export async function serve(root: string): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    try {
      const path = (req.url ?? "/").split("?")[0];
      const file = path === "/" ? "index.html" : path.replace(/^\/+/, "");
      const body = await readFile(join(root, file));
      res.writeHead(200, {
        "content-type": file.endsWith(".html") ? "text/html" : "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}/` };
}

export interface RenderHandle {
  page: Page;
  close(): Promise<void>;
}

export async function openRenderer(master: string): Promise<RenderHandle> {
  const { server, url } = await serve(ART_DIST);
  const browser: Browser = await chromium.launch({
    args: [
      // headless chromium needs an explicit GL backend for a real WebGL context
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-lcd-text",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on("pageerror", (e) => console.error("[page]", e.message));
  await page.goto(`${url}?master=${encodeURIComponent(master)}&tokenId=1&static=1`);
  await page.waitForFunction(() => (window as any).__CSE_READY === true, null, { timeout: 60_000 });
  await page.evaluate(() => (window as any).__CSE.stop());

  return {
    page,
    async close() {
      await browser.close();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}

export interface Capture {
  png: Buffer;
  svg: string;
  text: string;
}

/** Point the page at a token. Cheap — no navigation, just a scene rebuild. */
export async function selectToken(page: Page, master: string, id: number, nonce: number) {
  await page.evaluate(
    ([m, i, n]) => (window as any).__CSE.loadById(i, m, n),
    [master, id, nonce] as [string, number, number],
  );
}

export async function fingerprint(page: Page, pose: number): Promise<number[]> {
  return page.evaluate((p) => (window as any).__CSE.fingerprint(p), pose);
}

/**
 * Assert that the art bundle derives the same tokens this process does.
 *
 * The bundle embeds its own copy of @cse/core, so a stale build renders art that
 * silently disagrees with the metadata written alongside it — the images and
 * their traits come from different code. Cheap to check, extremely annoying to
 * discover after a full run, so it runs before every generation.
 */
export async function assertBundleMatchesCore(
  page: Page,
  master: string,
  ids: number[],
): Promise<void> {
  const mismatches: string[] = [];
  for (const id of ids) {
    const local = deriveToken(master, id, 0);
    await selectToken(page, master, id, 0);
    // `current()`, not `token` — the latter is captured at page boot and would
    // report the same token for every id, making this check pass vacuously.
    const remote = (await page.evaluate(() => (window as any).__CSE.current())) as {
      seed: string;
      traits: { structure: string; palette: string };
    } | null;

    if (
      !remote ||
      remote.seed !== local.seed ||
      remote.traits.structure !== local.traits.structure ||
      remote.traits.palette !== local.traits.palette.name
    ) {
      mismatches.push(
        `#${id}: bundle says ${remote?.traits.structure ?? "nothing"}/` +
          `${remote?.traits.palette ?? "-"}, core says ` +
          `${local.traits.structure}/${local.traits.palette.name}`,
      );
    }
  }

  if (mismatches.length) {
    throw new Error(
      `The art bundle disagrees with @cse/core:\n  ${mismatches.join("\n  ")}\n` +
        `Rebuild it with: pnpm --filter @cse/art build`,
    );
  }
}

/**
 * `svgSize` is deliberately independent of the raster size.
 *
 * The PNG size is a legibility budget — glyphs stop being glyphs below about
 * 10px a row — and shrinking it to trim the pinned payload is a real trade. The
 * SVG has no such floor: it is vector, so its coordinate space only sets the
 * units the text nodes are placed in and renders identically at any scale.
 * Tying the two together means every future adjustment to the PNG budget
 * silently rewrites the SVG masters as well, which is not a thing that should
 * happen as a side effect.
 */
export async function capture(
  page: Page,
  size: number,
  pose: number,
  svgSize = 3000,
): Promise<Capture> {
  const [dataUrl, svg, text] = await page.evaluate(
    ([s, p, sv]) => {
      const api = (window as any).__CSE;
      return [api.capture(s, p), api.captureSVG(sv, p), api.captureText(p)] as [
        string,
        string,
        string,
      ];
    },
    [size, pose, svgSize] as [number, number, number],
  );
  return {
    png: Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"),
    svg,
    text,
  };
}
