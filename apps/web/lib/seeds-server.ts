import { createPublicClient, http } from "viem";
import { CSE_ABI } from "./abi";
import { CONTRACT_ADDRESS, activeChain } from "./config";

/**
 * Every minted token's seed, server-side: `totalMinted`, then `seedOf` for
 * each id, batched at the JSON-RPC layer. Used by /api/tokens (for the site)
 * and /api/approve (to check a candidate against the set).
 */
export async function mintedSeeds(): Promise<{ total: number; tokens: { id: number; seed: `0x${string}` }[] }> {
  const client = createPublicClient({
    chain: activeChain,
    transport: http(process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || undefined, {
      batch: { batchSize: 200, wait: 8 },
    }),
  });
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
