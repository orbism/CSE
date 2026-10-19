/**
 * The allowlist raffle, reproducibly.
 *
 *   pnpm --filter @cse/web draw --block <n> --rpc <url> [--winners 420] [--apply]
 *
 * Every entry is ordered by keccak256(blockHash ‖ address) for a block mined
 * after entries closed, and the first N win. Anyone with the entry list, the
 * block hash and this file gets the same N and the same Merkle root. Without
 * --apply it only prints; with it, winners and their proofs are written to the
 * database, the Draw row closes entries, and the public list goes to
 * out/allowlist/. Then commit the root:
 *
 *   CSE_ALLOWLIST_ROOT=<root> forge script script/Admin.s.sol:SetAllowlistRoot --rpc-url … --broadcast
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { config } from "dotenv";
import { createPublicClient, encodePacked, http, keccak256 } from "viem";
import { db } from "../lib/db";

config({ path: ".env.local" });
config();

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const blockNumber = BigInt(arg("block") ?? "0");
const rpc = arg("rpc") ?? process.env.RPC_URL;
const winners = Number(arg("winners") ?? 420);
const apply = process.argv.includes("--apply");
if (!blockNumber || !rpc) throw new Error("need --block <number> and --rpc <url>");

const block = await createPublicClient({ transport: http(rpc) }).getBlock({ blockNumber });
const entries = await db().allowlistEntry.findMany({ select: { address: true }, orderBy: { address: "asc" } });
if (await db().draw.findUnique({ where: { id: 1 } })) throw new Error("already drawn");

const ticket = (a: string) => keccak256(encodePacked(["bytes32", "address"], [block.hash, a as `0x${string}`]));
const drawn = entries
  .map((e) => e.address)
  .sort((a, b) => (ticket(a) < ticket(b) ? -1 : 1))
  .slice(0, winners);
const tree = StandardMerkleTree.of(drawn.map((a) => [a]), ["address"]);

console.log(`${entries.length} entries, ${drawn.length} drawn by block ${blockNumber} (${block.hash})\nroot ${tree.root}`);
if (!apply) {
  console.log("dry run; pass --apply to write winners and proofs");
  process.exit(0);
}

await db().$transaction([
  ...[...tree.entries()].map(([i, [address]]) =>
    db().allowlistEntry.update({ where: { address }, data: { won: true, proof: tree.getProof(i) } }),
  ),
  db().draw.create({
    data: { id: 1, blockNumber, blockHash: block.hash, root: tree.root, winners: drawn.length, entries: entries.length },
  }),
]);
const out = resolve("../../out/allowlist");
await mkdir(out, { recursive: true });
await writeFile(
  join(out, `draw-${tree.root.slice(2, 10)}.json`),
  JSON.stringify({ root: tree.root, blockNumber: String(blockNumber), blockHash: block.hash, entries: entries.length, winners: drawn }, null, 2),
);
console.log(`written to the database and ${out}\n\nCSE_ALLOWLIST_ROOT=${tree.root} forge script script/Admin.s.sol:SetAllowlistRoot --rpc-url <rpc> --broadcast`);
