/**
 * Only the surface the site actually touches — plus every custom error.
 *
 * The error entries are not optional decoration: without them viem cannot
 * decode a revert, and a failed mint surfaced as "the contract function
 * reverted with the following reason:" followed by nothing at all.
 */
export const CSE_ABI = [
  { type: "error", name: "MintNotLive", inputs: [] },
  { type: "error", name: "SupplyExhausted", inputs: [] },
  { type: "error", name: "WalletLimitExceeded", inputs: [] },
  { type: "error", name: "IncorrectPayment", inputs: [] },
  { type: "error", name: "InvalidQuantity", inputs: [] },
  { type: "error", name: "ReserveExhausted", inputs: [] },
  { type: "error", name: "NothingToWithdraw", inputs: [] },
  { type: "error", name: "WithdrawFailed", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "InvalidTokenId", inputs: [] },
  { type: "error", name: "AlreadyMinted", inputs: [{ name: "tokenId", type: "uint256" }] },
  // inherited from OpenZeppelin, reachable through this ABI
  {
    type: "error",
    name: "ERC721NonexistentToken",
    inputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "error",
    name: "OwnableUnauthorizedAccount",
    inputs: [{ name: "account", type: "address" }],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "payable",
    inputs: [{ name: "tokenIds", type: "uint256[]" }],
    outputs: [],
  },
  {
    type: "function",
    name: "mintedBitmap",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function",
    name: "isAvailable",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "mintState",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "price",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "remainingPublic",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "mintedBy",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "MAX_SUPPLY",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "MAX_PER_WALLET",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "provenanceHash",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "masterSeed",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "metadataFrozen",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  { type: "error", name: "MetadataAlreadyFrozen", inputs: [] },
] as const;

export const MINT_STATE = ["CLOSED", "LIVE", "SOLD_OUT"] as const;
export type MintState = (typeof MINT_STATE)[number];
