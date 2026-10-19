/**
 * Standalone entry for the pinned art bundle.
 *
 * Served as `animation_url`, so it takes its subject from the page itself and
 * never touches the network. Three ways in:
 *   window.CSE = { id, seed }                        the on-chain page (a data:
 *                                                    URL, which has no query string)
 *   index.html?seed=<32 bytes hex>&id=417            the same, by URL
 *   index.html?tokenId=417&master=…&nonce=0          the legacy derivation
 */

import { type Token, deriveToken, tokenFromSeed, tokenSummary } from "@cse/core";
// Vite inlines the woff2 as a data URI, so the pinned bundle needs no network.
// A 5.4 KB subset of JetBrains Mono (OFL 1.1) that renders pixel-identically to
// the full font. See assets/README.md before regenerating it.
import fontUrl from "./assets/CSEGlyph.woff2?url";
import { Engine } from "./renderer.js";

const params = new URLSearchParams(location.search);
const MASTER_FALLBACK = "CUBIC-SYMMETRY-ENGINE";
const inline = (window as unknown as { CSE?: { id?: number; seed?: string } }).CSE ?? {};

function resolveToken(): Token {
  const seed = inline.seed ?? params.get("seed");
  const id = Number(inline.id ?? params.get("id") ?? params.get("tokenId") ?? "1");
  if (seed) return tokenFromSeed(seed, Number.isFinite(id) ? id : 0);
  const master = params.get("master") ?? MASTER_FALLBACK;
  const nonce = Number(params.get("nonce") ?? "0");
  return deriveToken(master, Number.isFinite(id) ? id : 1, nonce);
}

const canvas = document.getElementById("art") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLElement;

function fit(): number {
  return Math.floor(Math.min(window.innerWidth, window.innerHeight));
}

async function boot() {
  const engine = await Engine.create({ canvas, size: fit(), fontUrl });
  const token = resolveToken();
  engine.load(token);

  const s = tokenSummary(token);
  hud.textContent = [
    `CSE #${String(token.tokenId).padStart(4, "0")}`,
    s.equation,
    `Δ ${s.discriminant.toFixed(3)}`,
    `${s.traits.structure} · ${s.traits.rootState} · ω${s.traits.phase}`,
  ].join("   ");

  window.addEventListener("resize", () => engine.resize(fit()));

  if (params.get("static") === "1") {
    engine.capture(fit(), 0);
  } else {
    engine.start();
  }

  // Handles driven by the generator's Playwright harness.
  const api = {
    ready: true,
    /** The token this page booted with. Use `current()` after any load. */
    token,
    summary: s,
    /**
     * The token actually loaded right now. `token` above is captured once at
     * boot, so anything reading it after a loadById gets stale data.
     */
    current: () => {
      const t = engine.token;
      return t ? tokenSummary(t) : null;
    },
    capture: (size: number, at = 0) => engine.capture(size, at),
    captureLoopFrame: (size: number, t = 0) => engine.captureLoopFrame(size, t),
    captureSVG: (size: number, at = 0) => engine.captureSVG(size, at),
    captureText: (at = 0) => engine.captureText(at),
    fingerprint: (at = 0) => engine.fingerprint(at),
    framing: () => engine.framing,
    projectAnchors: (size: number) => engine.projectAnchors(size),
    rotateBy: (dx: number, dy: number) => engine.rotateBy(dx, dy),
    load: (t: Token) => engine.load(t),
    loadById: (id: number, master = MASTER_FALLBACK, nonce = 0) =>
      engine.load(deriveToken(master, id, nonce)),
    /** The contract's path: a token straight from its seed. */
    loadSeed: (seed: string, id = 0) => engine.load(tokenFromSeed(seed, id)),
    /** Force a palette — used only to render the documentation stills. */
    loadWithPalette: (id: number, master: string, nonce: number, palette: unknown) =>
      engine.load(deriveToken(master, id, nonce), { palette: palette as never }),
    stop: () => engine.stop(),
  };
  (window as unknown as { __CSE: typeof api }).__CSE = api;
  (window as unknown as { __CSE_READY: boolean }).__CSE_READY = true;
}

boot().catch((err) => {
  hud.textContent = `ERROR: ${String(err)}`;
  console.error(err);
});
