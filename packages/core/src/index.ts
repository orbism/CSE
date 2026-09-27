export * from "./complex.js";
export * from "./hash.js";
export * from "./solve.js";
export * from "./palettes.js";
export * from "./traits.js";
export * from "./token.js";

/** Collection constants shared by the generator, contract scripts and the site. */
export const COLLECTION = {
  name: "Cubic Symmetry Engine",
  symbol: "CSE",
  supply: 512,
  reserve: 11,
  maxPerWallet: 20,
  priceEth: "0.005",
} as const;
