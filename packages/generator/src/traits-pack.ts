/**
 * The renderer's trait record: 8 bytes per token, id 1 first. The index order
 * of every vocabulary is the one CSERenderer.sol declares.
 */

import { ARCHETYPES, COLLECTION, PALETTES, type Token } from "@cse/core";

const ROOT_STATES = ["3 Real Distinct", "1 Real 2 Complex", "Double Root", "Triple Root"];
const DISC_CLASSES = ["Separated", "Fractured", "Merged"];
const SYMMETRIES = ["Identity", "Cyclic ω", "Cyclic ω²", "Transposed", "Full S₃"];
const BANDS = ["Faint", "Low", "Mid", "High", "Extreme"];
const ENERGIES = ["Still", "Charged", "Violent"];
const FEEDBACKS = ["None", "Echo", "Resonant", "Runaway"];
export const RECORD = 8;

const index = (list: readonly string[], v: string, what: string) => {
  const i = list.indexOf(v);
  if (i < 0) throw new Error(`unknown ${what}: ${v}`);
  return i;
};

export function packTraits(rows: { token: Token; rarityRank: number }[]): Buffer {
  const out = Buffer.alloc(COLLECTION.supply * RECORD);
  for (const { token, rarityRank } of rows) {
    const t = token.traits;
    if (rarityRank < 1 || rarityRank > 0xffff) throw new Error(`#${token.tokenId}: bad rarity rank ${rarityRank}`);
    const o = (token.tokenId - 1) * RECORD;
    out[o] = index(ARCHETYPES, t.structure, "structure");
    out[o + 1] = index(ROOT_STATES, t.rootState, "root state");
    out[o + 2] = index(SYMMETRIES, t.symmetry, "symmetry");
    out[o + 3] =
      index(DISC_CLASSES, t.discriminantClass, "discriminant class") |
      (index(BANDS, t.discriminantBand, "discriminant band") << 2) |
      (t.phase << 5);
    out[o + 4] =
      index(ENERGIES, t.energyBand, "energy") |
      (index(FEEDBACKS, t.feedbackBand, "feedback") << 2) |
      (index(PALETTES.map((p) => p.name), t.palette.name, "palette") << 4);
    out.writeUInt16BE(rarityRank, o + 5);
    out[o + 7] = 0;
  }
  return out;
}
