import { parseAbi } from "viem";

/**
 * Only the surface the site actually touches, plus every custom error: without
 * the errors viem cannot decode a revert, and a failed mint surfaced as "the
 * contract function reverted" followed by nothing at all.
 */
export const CSE_ABI = parseAbi([
  "error MintNotLive()",
  "error SupplyExhausted()",
  "error WalletLimitExceeded()",
  "error IncorrectPayment()",
  "error InvalidQuantity()",
  "error ReserveExhausted()",
  "error NothingToWithdraw()",
  "error WithdrawFailed()",
  "error ZeroAddress()",
  "error SeedTaken(bytes32 seed)",
  "error ApprovalExpired()",
  "error BadSignature()",
  "error MetadataAlreadyFrozen()",
  "error NotAllowlisted()",
  "event Minted(uint256 indexed tokenId, bytes32 indexed seed, address indexed to)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "function mint(bytes32 seed, uint256 deadline, bytes signature, bytes32[] proof) payable",
  "function mintState() view returns (uint8)",
  "function price() view returns (uint256)",
  "function allowlistPrice() view returns (uint256)",
  "function currentPrice() view returns (uint256)",
  "function allowlistRoot() view returns (bytes32)",
  "function isAllowlisted(address account, bytes32[] proof) view returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
  "function remainingPublic() view returns (uint256)",
  "function MAX_SUPPLY() view returns (uint256)",
  "function MAX_PER_WALLET() view returns (uint256)",
  "function mintedBy(address) view returns (uint256)",
  "function seedOf(uint256 tokenId) view returns (bytes32)",
  "function tokenOfSeed(bytes32 seed) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function renderer() view returns (address)",
  "function signer() view returns (address)",
  "function mintDigest(address minter, bytes32 seed, uint256 deadline) view returns (bytes32)",
]);

/** Index = the contract's MintState. SOLD_OUT is taken by the mint that fills the supply. */
export const MINT_STATE = ["CLOSED", "ALLOWLIST", "PUBLIC", "SOLD_OUT"] as const;
export type MintState = (typeof MINT_STATE)[number];

/** EIP-712 shape of a mint approval; must match the contract's MINT_TYPEHASH and domain. */
export const MINT_TYPES = {
  Mint: [
    { name: "minter", type: "address" },
    { name: "seed", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const mintDomain = (chainId: number, verifyingContract: `0x${string}`) =>
  ({ name: "Cubic Symmetry Engine", version: "1", chainId, verifyingContract }) as const;
