import { http, createConfig } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { defineChain } from "viem";

export const anvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  // Deliberately no multicall3 entry: a bare anvil does not deploy one, and
  // pointing viem at an empty address made every batched call fail silently.
  // The owner-lookup fallback batches at the JSON-RPC layer instead.
});

/**
 * DEMO: no contract. Minting is off, the mint panel reads CLOSED, the gallery
 * is closed until after the mint, and nothing reads the chain. LIVE is the
 * real thing and the default.
 */
export const IS_DEMO = process.env.MODE === "DEMO";

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;
export const MASTER_SEED = process.env.NEXT_PUBLIC_MASTER_SEED ?? "CUBIC-SYMMETRY-ENGINE";
export const IPFS_GATEWAY =
  process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? "https://4everland.io/ipfs";
export const IMAGES_CID = process.env.NEXT_PUBLIC_IMAGES_CID ?? "";
export const ART_CID = process.env.NEXT_PUBLIC_ART_CID ?? "";
export const LOCAL_ASSETS = process.env.NEXT_PUBLIC_LOCAL_ASSETS ?? "";

export const activeChain =
  CHAIN_ID === mainnet.id ? mainnet : CHAIN_ID === sepolia.id ? sepolia : anvil;

/**
 * Where the browser sends reads.
 *
 * Default is the same-origin `/api/rpc` proxy, which forwards to Alchemy with
 * the key held server-side. Set NEXT_PUBLIC_RPC_URL to bypass it (the anvil loop
 * points straight at 127.0.0.1:8545, where there is no key to protect).
 *
 * A relative URL cannot be fetched during SSR, so on the server we fall back to
 * viem's default for the chain. Nothing reads on the server anyway — every
 * contract read happens in a client effect.
 */
const explicitRpc = process.env.NEXT_PUBLIC_RPC_URL;
const rpc =
  explicitRpc || (typeof window === "undefined" ? undefined : "/api/rpc");

/**
 * No explicit connector list.
 *
 * wagmi discovers injected wallets through EIP-6963 by default, which lists
 * every installed extension rather than whichever one won the `window.ethereum`
 * race. It also keeps `wagmi/connectors` out of the bundle — that barrel pulls
 * in the Coinbase account SDK, whose own optional dependencies do not resolve
 * under webpack. Adding WalletConnect later means importing just that connector,
 * not the barrel.
 *
 * All three chains are registered so a wallet on the wrong network still
 * connects and can be prompted to switch; reads are pinned to `activeChain`.
 */
export const wagmiConfig = createConfig({
  chains: [mainnet, sepolia, anvil],
  multiInjectedProviderDiscovery: true,
  transports: {
    [mainnet.id]: http(activeChain.id === mainnet.id ? rpc || undefined : undefined),
    [sepolia.id]: http(activeChain.id === sepolia.id ? rpc || undefined : undefined),
    [anvil.id]: http(activeChain.id === anvil.id ? rpc || undefined : undefined),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

/**
 * Where a token's PNG lives. Falls back to the local static server so the
 * anvil loop works with no CIDs and no gateway.
 */
export function imageUrl(tokenId: number): string {
  if (IMAGES_CID) return `${IPFS_GATEWAY}/${IMAGES_CID}/${tokenId}.png`;
  if (LOCAL_ASSETS) return `${LOCAL_ASSETS}/images/${tokenId}.png`;
  return "";
}

/** Where the live art lives — used by the token modal's iframe. */
export function animationUrl(tokenId: number, nonce = 0): string {
  const params = new URLSearchParams({
    tokenId: String(tokenId),
    master: MASTER_SEED,
    nonce: String(nonce),
  });
  if (ART_CID) return `${IPFS_GATEWAY}/${ART_CID}/index.html?${params}`;
  if (LOCAL_ASSETS) return `${LOCAL_ASSETS}/art/index.html?${params}`;
  return "";
}

/** Block-explorer link for an address, or null on a chain without one (anvil). */
export function explorerAddressUrl(address: string): string | null {
  const base = activeChain.blockExplorers?.default?.url;
  return base ? `${base}/address/${address}` : null;
}

/** The generator's flat token index, loaded once and filtered client-side. */
export function tokensIndexUrl(): string {
  if (LOCAL_ASSETS) return `${LOCAL_ASSETS}/tokens.json`;
  return "/tokens.json";
}

/** The published provenance commitment, for checking against the chain. */
export function provenanceUrl(): string {
  if (LOCAL_ASSETS) return `${LOCAL_ASSETS}/provenance.json`;
  return "/provenance.json";
}
