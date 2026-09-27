import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem, zeroAddress } from "viem";
import { CONTRACT_ADDRESS, activeChain } from "@/lib/config";

/**
 * When each token was minted, as a unix timestamp per id.
 *
 * A mint is a Transfer out of the zero address, so the whole answer is one log
 * query — no per-token calls. Proxied server-side for the same reason as the
 * owner lookup: on a real network this goes through Alchemy and the key must
 * not reach the browser.
 *
 * Ordering is the point, not the exact instant, so ids minted in one
 * transaction share a timestamp and are broken apart by id.
 */
export const runtime = "nodejs";
/**
 * Next caches GET route handlers by default, which served a mint list from a
 * previous chain long after it was wrong. Mints keep arriving, so this has to
 * run per request; the cache-control header below is what actually does the
 * caching, at the edge, with a bounded lifetime.
 */
export const dynamic = "force-dynamic";
/**
 * `force-dynamic` alone still let Next serve this out of its own on-disk cache,
 * which survives a restart — locally that meant answering with a previous
 * chain's mints after anvil had been wiped. Nothing Next holds should outlive a
 * request; the cache-control header below is the only caching wanted, and it
 * lives at the edge where a bounded lifetime is correct for an append-only list.
 */
export const revalidate = 0;

const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY;
const ALCHEMY_NETWORK = process.env.ALCHEMY_NETWORK ?? "eth-sepolia";

const TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);

export async function GET() {
  try {
    const mintedAt = await viaLogs();
    return NextResponse.json(
      { mintedAt },
      // Mints are append-only, so a stale answer only ever omits the newest few.
      { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" } },
    );
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}

async function viaLogs(): Promise<Record<number, number>> {
  const client = createPublicClient({
    chain: activeChain,
    transport: http(
      ALCHEMY_KEY && activeChain.id !== 31337
        ? `https://${ALCHEMY_NETWORK}.g.alchemy.com/v2/${ALCHEMY_KEY}`
        : process.env.NEXT_PUBLIC_RPC_URL || undefined,
    ),
  });

  const logs = await client.getLogs({
    address: CONTRACT_ADDRESS,
    event: TRANSFER,
    args: { from: zeroAddress },
    fromBlock: 0n,
    toBlock: "latest",
  });

  // One block holds many mints, so resolve each block once rather than per log.
  const blocks = [...new Set(logs.map((l) => l.blockNumber))].filter(
    (b): b is bigint => b !== null,
  );
  const times = new Map<bigint, number>();
  const CHUNK = 20;
  for (let i = 0; i < blocks.length; i += CHUNK) {
    const slice = blocks.slice(i, i + CHUNK);
    const got = await Promise.all(
      slice.map((blockNumber) =>
        client.getBlock({ blockNumber }).catch(() => null),
      ),
    );
    got.forEach((b, k) => b && times.set(slice[k], Number(b.timestamp)));
  }

  const mintedAt: Record<number, number> = {};
  for (const log of logs) {
    const id = log.args.tokenId;
    if (id === undefined || log.blockNumber === null) continue;
    const t = times.get(log.blockNumber);
    if (t !== undefined) mintedAt[Number(id)] = t;
  }
  return mintedAt;
}
