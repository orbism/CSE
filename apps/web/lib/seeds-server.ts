import { createPublicClient, http } from "viem";
import { CSE_ABI } from "./abi";
import { CONTRACT_ADDRESS, activeChain } from "./config";

/** Server-side read client; the Alchemy URL never reaches the browser. */
export const chainClient = () =>
  createPublicClient({
    chain: activeChain,
    transport: http(process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || undefined, {
      batch: { batchSize: 200, wait: 8 },
    }),
  });

/**
 * Every minted token's seed: `totalMinted`, then `seedOf` for each id, batched
 * at the JSON-RPC layer. Used by /api/tokens (for the site) and /api/approve
 * (to check a candidate against the set).
 */
export async function mintedSeeds(): Promise<{ total: number; tokens: { id: number; seed: `0x${string}` }[] }> {
  const client = chainClient();
  const total = Number(
    await client.readContract({ address: CONTRACT_ADDRESS, abi: CSE_ABI, functionName: "totalMinted" }),
  );
  const seeds = await Promise.all(
    Array.from({ length: total }, (_, i) =>
      client.readContract({ address: CONTRACT_ADDRESS, abi: CSE_ABI, functionName: "seedOf", args: [BigInt(i + 1)] }),
    ),
  );
  return { total, tokens: seeds.map((seed, i) => ({ id: i + 1, seed })) };
}

/** 0 CLOSED, 1 ALLOWLIST, 2 PUBLIC, 3 SOLD_OUT. */
export const mintState = () =>
  chainClient().readContract({ address: CONTRACT_ADDRESS, abi: CSE_ABI, functionName: "mintState" });
