/**
 * The sell-out reveal: derive every minted Form from its on-chain seed, rank
 * rarity over the whole set, and write the packed trait table the renderer
 * serves (packages/contracts/script/Reveal.s.sol puts it on chain).
 *
 *   pnpm --filter @cse/generator reveal --contract 0x… --rpc https://… [--allow-partial]
 *
 * Writes out/onchain/traits.bin (512 x 8 bytes, id 1 first) and reveal.json.
 * Anyone can rerun this against the chain and get the same bytes.
 */

import "./env.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { http, createPublicClient, parseAbi } from "viem";
import { COLLECTION } from "@cse/core";
import { revealTable } from "./reveal-table.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const contract = (arg("contract") ?? process.env.CSE_PROXY) as `0x${string}` | undefined;
const rpc = arg("rpc") ?? process.env.RPC_URL;
if (!contract || !rpc) throw new Error("need --contract and --rpc (or CSE_PROXY and RPC_URL)");
const allowPartial = process.argv.includes("--allow-partial");
const OUT = resolve("../../out/onchain");

const abi = parseAbi([
  "function totalMinted() view returns (uint256)",
  "function seedOf(uint256) view returns (bytes32)",
]);
const client = createPublicClient({ transport: http(rpc, { batch: { batchSize: 100, wait: 10 } }) });
const total = Number(await client.readContract({ address: contract, abi, functionName: "totalMinted" }));
if (total !== COLLECTION.supply && !allowPartial) {
  throw new Error(`${total} of ${COLLECTION.supply} minted; the reveal waits for sell-out (--allow-partial to force)`);
}
const seeds = await Promise.all(
  Array.from({ length: total }, (_, i) =>
    client.readContract({ address: contract, abi, functionName: "seedOf", args: [BigInt(i + 1)] }),
  ),
);
const { traits, sha256 } = revealTable(seeds);

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "traits.bin"), traits);
const info = { contract, tokens: total, sha256, revealedAt: new Date().toISOString() };
await writeFile(join(OUT, "reveal.json"), JSON.stringify(info, null, 2));
console.log(`${total} tokens ranked; traits.bin sha256 ${info.sha256}\nwrote ${OUT}`);
