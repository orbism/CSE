/**
 * Build the on-chain page the renderer deploy reads (packages/contracts/script/Renderer.s.sol):
 *
 *   out/onchain/page-tail.b64   the engine page from the viewport meta on, with
 *                               the engine gzipped and inlined, base64-encoded
 *                               once here so tokenURI never has to
 *   out/onchain/onchain.json    sizes and hashes, for the deploy record
 *
 *   pnpm --filter @cse/generator onchain
 *
 * The page is split so the contract can prepend a per-token head
 * (`window.CSE = {id, seed}`) without re-encoding the rest: both halves are
 * padded to a multiple of three bytes, which is what lets two base64 strings be
 * concatenated. The tail must begin exactly where the contract's head ends;
 * CSERenderer._pageHead is the other half of this file. Traits are not built
 * here: they are derived from the minted seeds at sell-out (`reveal`).
 */

import "./env.js";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ART_DIST } from "./render.js";

const OUT = resolve("../../out/onchain");

// ---- page
const html = await readFile(join(ART_DIST, "index.html"), "utf8");
const script = /<script type="module"[^>]*>([\s\S]*?)<\/script>/.exec(html);
if (!script) throw new Error("no module script in the art bundle; run pnpm --filter @cse/art build");
const cut = html.indexOf('<meta name="viewport"');
if (cut < 0) throw new Error("the art bundle's <head> has moved; CSERenderer._pageHead expects the viewport meta next");

const gz = gzipSync(script[1], { level: 9 });
const boot =
  "<script>(async()=>{" +
  `const b=Uint8Array.from(atob("${gz.toString("base64")}"),c=>c.charCodeAt(0));` +
  'const t=await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text();' +
  'const s=document.createElement("script");s.type="module";s.textContent=t;document.body.append(s)' +
  "})()</script>";
let tail = html.slice(cut).replace(script[0], boot);
// padded so its base64 has no '=' and the head's base64 can precede it
while (Buffer.byteLength(tail) % 3 !== 0) tail += " ";
const tailB64 = Buffer.from(tail).toString("base64");

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "page-tail.b64"), tailB64);
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const info = {
  engineBytes: script[1].length,
  engineGzipBytes: gz.length,
  pageTailBytes: Buffer.byteLength(tail),
  pageTailBase64Bytes: tailB64.length,
  chunks: Math.ceil(tailB64.length / 24_000),
  sha256: { pageTail: sha(tailB64) },
  artBundleSha256: sha(html),
};
await writeFile(join(OUT, "onchain.json"), JSON.stringify(info, null, 2));
console.log(
  `engine ${info.engineBytes} B -> ${info.engineGzipBytes} B gz; page tail ${info.pageTailBase64Bytes} B base64 in ${info.chunks} chunks
wrote ${OUT}`,
);
