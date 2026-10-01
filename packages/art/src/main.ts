/**
 * Standalone entry for the pinned art bundle.
 *
 * Served as `animation_url`, so it takes its subject entirely from the query
 * string and never touches the network:
 *   index.html?tokenId=417&master=<master seed>
 *   index.html?seed=<64 hex chars>   (renders that seed directly)
 */

import { type Token, deriveToken, tokenSummary } from "@cse/core";
// Vite inlines the woff2 as a data URI, so the pinned bundle needs no network.
// A 5.4 KB subset of JetBrains Mono (OFL 1.1) that renders pixel-identically to
// the full font. See assets/README.md before regenerating it.
import fontUrl from "./assets/CSEGlyph.woff2?url";
import { Engine } from "./renderer.js";

const params = new URLSearchParams(location.search);
const MASTER_FALLBACK = "CUBIC-SYMMETRY-ENGINE";

function resolveToken(): Token {
  const tokenId = Number(params.get("tokenId") ?? "1");
  const master = params.get("master") ?? MASTER_FALLBACK;
  const nonce = Number(params.get("nonce") ?? "0");
  return deriveToken(master, Number.isFinite(tokenId) ? tokenId : 1, nonce);
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
