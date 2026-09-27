import { NextResponse } from "next/server";
import { createPublicClient, http, isAddress } from "viem";
import { CONTRACT_ADDRESS, activeChain } from "@/lib/config";
import { CSE_ABI } from "@/lib/abi";

/**
 * Token ids held by a wallet.
 *
 * Proxied server-side so the Alchemy key never reaches the browser. On a local
 * chain (or with no key configured) it falls back to sweeping ownerOf over the
 * minted range, which keeps the anvil loop working with zero external services.
 */
export const runtime = "nodejs";

const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY;
const ALCHEMY_NETWORK = process.env.ALCHEMY_NETWORK ?? "eth-sepolia";

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address")?.trim();
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "invalid address" }, { status: 400 });
  }

  try {
    const tokenIds =
      ALCHEMY_KEY && activeChain.id !== 31337
        ? await viaAlchemy(address)
        : await viaRpcSweep(address);
    return NextResponse.json(
      { address, tokenIds, source: ALCHEMY_KEY && activeChain.id !== 31337 ? "alchemy" : "rpc" },
      { headers: { "cache-control": "public, max-age=30" } },
    );
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}

async function viaAlchemy(owner: string): Promise<number[]> {
  const ids: number[] = [];
  let pageKey: string | undefined;

  do {
    const url = new URL(
      `https://${ALCHEMY_NETWORK}.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/getNFTsForOwner`,
    );
    url.searchParams.set("owner", owner);
    url.searchParams.set("contractAddresses[]", CONTRACT_ADDRESS);
    url.searchParams.set("withMetadata", "false");
    url.searchParams.set("pageSize", "100");
    if (pageKey) url.searchParams.set("pageKey", pageKey);

    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`alchemy ${res.status}`);
    const body = (await res.json()) as {
      ownedNfts?: { tokenId: string }[];
      pageKey?: string;
    };
    for (const nft of body.ownedNfts ?? []) ids.push(Number(nft.tokenId));
    pageKey = body.pageKey;
  } while (pageKey);

  return ids.sort((a, b) => a - b);
}

/**
 * ownerOf sweep over the ids that actually exist.
 *
 * The contract lets buyers choose their token id, so the minted set is sparse:
 * a wallet can hold #1098 while totalSupply is 3. Scanning 1..totalSupply — the
 * obvious thing when ids were sequential — silently returned nothing. The
 * bitmap gives the exact set of live ids in one call, and only those are
 * queried.
 *
 * Deliberately not `multicall`: a bare anvil has no Multicall3 deployed, and
 * with allowFailure the whole sweep came back empty with no error at all.
 */
async function viaRpcSweep(owner: string): Promise<number[]> {
  const client = createPublicClient({
    chain: activeChain,
    transport: http(process.env.NEXT_PUBLIC_RPC_URL || undefined, {
      batch: { batchSize: 200, wait: 8 },
    }),
  });

  const bitmap = (await client.readContract({
    address: CONTRACT_ADDRESS,
    abi: CSE_ABI,
    functionName: "mintedBitmap",
  })) as readonly bigint[];

  const live: number[] = [];
  for (let word = 0; word < bitmap.length; word++) {
    let bits = bitmap[word];
    if (bits === 0n) continue;
    for (let bit = 0; bit < 256; bit++) {
      if ((bits >> BigInt(bit)) & 1n) live.push(word * 256 + bit + 1);
    }
    bits = 0n;
  }
  if (live.length === 0) return [];

  const target = owner.toLowerCase();
  const ids: number[] = [];
  const CHUNK = 200;

  for (let start = 0; start < live.length; start += CHUNK) {
    const slice = live.slice(start, start + CHUNK);
    const owners = await Promise.all(
      slice.map((id) =>
        client
          .readContract({
            address: CONTRACT_ADDRESS,
            abi: CSE_ABI,
            functionName: "ownerOf",
            args: [BigInt(id)],
          })
          // a burnt id reverts; that is not a lookup failure
          .catch(() => null),
      ),
    );
    owners.forEach((o, k) => {
      if (o && String(o).toLowerCase() === target) ids.push(slice[k]);
    });
  }

  return ids.sort((a, b) => a - b);
}
