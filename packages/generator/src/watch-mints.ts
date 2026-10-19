/**
 * The mint watcher. Follows the contract, and for every new token:
 *
 *   1. renders its cover (PNG for marketplaces, SVG master) at the canonical
 *      pose and uploads both to Vercel Blob as covers/<id>.png|svg
 *   2. fingerprints the render and adds it to covers/index.json, which the
 *      site's approver reads so no later seed can land too close to this one
 *
 *   3. at 512 minted, derives the trait table from the seeds and runs the
 *      reveal (script/Reveal.s.sol) with REVEALER_PRIVATE_KEY, the renderer's
 *      `revealer`
 *
 *   pnpm --filter @cse/generator watch-mints --contract 0x… --rpc https://… [--once] [--interval 15]
 *       [--size 1200] [--local <dir>] [--site https://…]
 *
 *   --local <dir>   write covers and index.json there instead of uploading
 *   --site <url>    file each fingerprint with the site's database
 *                   (POST /api/fingerprints, bearer WATCHER_SECRET); the
 *                   approver reads that table
 *
 * Needs BLOB_READ_WRITE_TOKEN unless --local. Keeps its place in out/watch so a
 * restart picks up where it stopped. Runs a real browser (Playwright) because
 * the fingerprint is of the rendered piece; this is a long-lived process on a
 * machine you control, not a serverless function.
 */

import "./env.js";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { http, createPublicClient, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type Prior, capturePose, dHash, priorOf, tokenFromSeed } from "@cse/core";
import { openRenderer } from "./render.js";
import { revealTable } from "./reveal-table.js";

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
const site = arg("site")?.replace(/\/$/, "");
if (!local && !process.env.BLOB_READ_WRITE_TOKEN) throw new Error("set BLOB_READ_WRITE_TOKEN, or pass --local <dir>");
if (site && !process.env.WATCHER_SECRET) throw new Error("--site needs WATCHER_SECRET");
const revealerKey = process.env.REVEALER_PRIVATE_KEY as `0x${string}` | undefined;

const abi = parseAbi([
  "function totalMinted() view returns (uint256)",
  "function seedOf(uint256) view returns (bytes32)",
  "function renderer() view returns (address)",
  "function revealed() view returns (bool)",
  "function MAX_SUPPLY() view returns (uint256)",
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
  const prior = priorOf(token, dHash(grid));
  state.index.push({ ...prior, seed });
  state.lastId = id;
  await publishIndex();
  if (site) await file(prior, seed);
  console.log(`#${String(id).padStart(3)} ${token.traits.structure.padEnd(13)} ${url}`);
}

/** Hand the fingerprint to the site; the approver checks new rolls against the table. */
async function file(prior: Prior, seed: `0x${string}`) {
  const res = await fetch(`${site}/api/fingerprints`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.WATCHER_SECRET}` },
    body: JSON.stringify({ tokenId: prior.tokenId, seed, structure: prior.structure, vector: prior.vector, hash: prior.hash }),
  });
  if (!res.ok) throw new Error(`site refused fingerprint #${prior.tokenId}: ${res.status} ${await res.text()}`);
}

/**
 * Sell-out: rank the set, write traits.bin, and send the reveal through
 * script/Reveal.s.sol as the revealer. Idempotent; a revealed renderer is left alone.
 */
async function maybeReveal(total: number) {
  const max = Number(await client.readContract({ address: contract!, abi, functionName: "MAX_SUPPLY" }));
  if (total < max || !revealerKey) return false;
  const renderer = await client.readContract({ address: contract!, abi, functionName: "renderer" });
  if (await client.readContract({ address: renderer, abi, functionName: "revealed" })) return true;
  const seeds = await Promise.all(state.index.map((t) => seedAt(t.tokenId)));
  const { traits, sha256 } = revealTable(seeds);
  const dir = resolve("../../out/onchain");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "traits.bin"), traits);
  console.log(`sold out: revealing as ${privateKeyToAccount(revealerKey).address} (traits.bin sha256 ${sha256})`);
  execFileSync("forge", ["script", "script/Reveal.s.sol:Reveal", "--rpc-url", rpc!, "--broadcast"], {
    cwd: resolve("../contracts"),
    stdio: "inherit",
    env: { ...process.env, PRIVATE_KEY: revealerKey, CSE_RENDERER: renderer, CSE_ONCHAIN_DIR: dir },
  });
  return true;
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
  let done = await maybeReveal(total);
  if (once) console.log(`up to date: ${total} minted${base ? `, covers at ${base}` : ""}`);
  while (!once && !done) {
    await new Promise((r) => setTimeout(r, interval));
    total = await sweep();
    done = await maybeReveal(total);
  }
  if (done) console.log("sold out and revealed; nothing left to watch");
} finally {
  await renderer.close();
}
