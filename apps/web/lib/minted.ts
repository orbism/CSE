"use client";

import { useMemo } from "react";
import { useReadContract } from "wagmi";
import { COLLECTION } from "@cse/core";
import { CSE_ABI } from "./abi";
import { CONTRACT_ADDRESS, activeChain } from "./config";

/**
 * Which ids are already taken.
 *
 * Read as a packed bitmap in one call. Asking `ownerOf` per id would be 512
 * round-trips every time the panel refreshes, which is the difference between
 * this being usable and not.
 */
export function useMintedSet() {
  const { data, refetch, isLoading } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CSE_ABI,
    functionName: "mintedBitmap",
    chainId: activeChain.id,
    query: { refetchInterval: 15_000 },
  });

  const minted = useMemo(() => {
    const set = new Set<number>();
    const words = data as readonly bigint[] | undefined;
    if (!words) return set;
    for (let id = 1; id <= COLLECTION.supply; id++) {
      const word = words[(id - 1) >> 8];
      if (word !== undefined && (word >> BigInt((id - 1) & 0xff)) & 1n) set.add(id);
    }
    return set;
  }, [data]);

  return { minted, refetch, isLoading };
}

/** A uniformly random id that nobody has taken yet, or null if none remain. */
export function pickAvailable(minted: Set<number>, exclude?: number): number | null {
  const available = COLLECTION.supply - minted.size;
  if (available <= 0) return null;

  // rejection sampling is fine while the collection is mostly unminted; the
  // scan below covers the tail when it is nearly sold out
  for (let tries = 0; tries < 40; tries++) {
    const id = 1 + Math.floor(Math.random() * COLLECTION.supply);
    if (!minted.has(id) && id !== exclude) return id;
  }
  const rest: number[] = [];
  for (let id = 1; id <= COLLECTION.supply; id++) {
    if (!minted.has(id) && id !== exclude) rest.push(id);
  }
  return rest.length ? rest[Math.floor(Math.random() * rest.length)] : null;
}
