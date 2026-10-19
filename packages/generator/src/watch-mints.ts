/**
 * The mint watcher. Follows the contract, and for every new token:
 *
 *   1. renders its cover (PNG for marketplaces, SVG master) at the canonical
 *      pose and uploads both to Vercel Blob as covers/<id>.png|svg
 *   2. fingerprints the render and adds it to covers/index.json, which the
 *      site's approver reads so no later seed can land too close to this one
 *
 *   pnpm --filter @cse/generator watch-mints --contract 0x… --rpc https://… [--once] [--interval 15]
 *       [--size 1200] [--local <dir>]      # --local writes files instead of uploading
 *
 * Needs BLOB_READ_WRITE_TOKEN unless --local. Keeps its place in out/watch so a
 * restart picks up where it stopped. Runs a real browser (Playwright) because
 * the fingerprint is of the rendered piece; this is a long-lived process on a
 * machine you control, not a serverless function.
 */

import "./env.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { http, createPublicClient, parseAbi } from "viem";
import { type Prior, capturePose, dHash, priorOf, tokenFromSeed } from "@cse/core";
import { openRenderer } from "./render.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const contract = (arg("contract") ?? process.env.CSE_PROXY) as `0x${string}` | undefined;
const rpc = arg("rpc") ?? process.env.RPC_URL;
if (!contract || !rpc) throw new Error("need --contract and --rpc (or CSE_PROXY and RPC_URL)");
const once = process.argv.includes("--once");
const interval = Number(arg("interval") ?? 15) * 1000;
const size = Number(arg("size") ?? 1200);
const local = arg("local") ? resolve(arg("local")!) : null;
if (!local && !process.env.BLOB_READ_WRITE_TOKEN) throw new Error("set BLOB_READ_WRITE_TOKEN, or pass --local <dir>");

const abi = parseAbi([
  "function totalMinted() view returns (uint256)",
  "function seedOf(uint256) view returns (bytes32)",
]);
const client = createPublicClient({ transport: http(rpc) });
const chainId = await client.getChainId();
const STATE_DIR = resolve("../../out/watch");
const statePath = join(STATE_DIR, `${chainId}-${contract.toLowerCase()}.json`);
await mkdir(STATE_DIR, { recursive: true });

interface State {
  lastId: number;
  index: (Prior & { seed: `0x${string}` })[];
}
let state: State = { lastId: 0, index: [] };
try {
  state = JSON.parse(await readFile(statePath, "utf8"));
} catch {
  // first run against this contract
}
// A redeploy at the same address (every anvil run, or a fresh testnet proxy
// at a reused nonce) leaves the old record pointing at tokens that no longer
// exist. Trust the chain, not the file: keep only the prefix whose seeds match.
const seedAt = (id: number) => client.readContract({ address: contract, abi, functionName: "seedOf", args: [BigInt(id)] });
const onChain = await Promise.all(state.index.map((t) => seedAt(t.tokenId).catch(() => null)));
const stale = state.index.findIndex((t, i) => onChain[i] !== t.seed);
if (stale >= 0) {
  console.log(`state from #${state.index[stale].tokenId} on no longer matches the chain; re-rendering from there`);
  state.index.length = stale;
  state.lastId = stale > 0 ? state.index[stale - 1].tokenId : 0;
}

// ---- sinks
async function store(path: string, body: Buffer | string, type: string) {
  if (local) {
    const file = join(local, path);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, body);
    return `${local}/${path}`;
  }
  const { put } = await import("@vercel/blob");
  const res = await put(path, body, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: type,
    cacheControlMaxAge: path.endsWith(".json") ? 30 : 60 * 60 * 24 * 365,
  });
  return res.url;
}

const renderer = await openRenderer("CUBIC-SYMMETRY-ENGINE");
let base = "";

async function processToken(id: number) {
  const seed = await seedAt(id);
  const token = tokenFromSeed(seed, id);
  const pose = capturePose(token);
  const { png, svg, grid } = await renderer.page.evaluate(
    ([s, i, p, px]) => {
      const api = (window as any).__CSE;
      api.loadSeed(s, i);
      return {
        png: api.capture(px, p) as string,
        svg: api.captureSVG(3000, p) as string,
        grid: api.fingerprint(p) as number[],
      };
    },
    [seed, id, pose, size] as const,
  );
  const url = await store(`covers/${id}.png`, Buffer.from(png.split(",")[1], "base64"), "image/png");
  await store(`covers/${id}.svg`, svg, "image/svg+xml");
  base ||= url.slice(0, url.lastIndexOf("/") + 1);
  state.index.push({ ...priorOf(token, dHash(grid)), seed });
  state.lastId = id;
  await publishIndex();
  console.log(`#${String(id).padStart(3)} ${token.traits.structure.padEnd(13)} ${url}`);
}

/** The approver's view of the minted set. Also written once on start, so a wiped sink gets it back. */
async function publishIndex() {
  await store("covers/index.json", JSON.stringify({ contract, chainId, updatedAt: new Date().toISOString(), tokens: state.index }), "application/json");
  await writeFile(statePath, JSON.stringify(state));
}

async function sweep() {
  const total = Number(await client.readContract({ address: contract!, abi, functionName: "totalMinted" }));
  for (let id = state.lastId + 1; id <= total; id++) await processToken(id);
  return total;
}

try {
  let total = await sweep();
  await publishIndex();
  if (once) console.log(`up to date: ${total} minted${base ? `, covers at ${base}` : ""}`);
  while (!once) {
    await new Promise((r) => setTimeout(r, interval));
    total = await sweep();
  }
} finally {
  await renderer.close();
}
