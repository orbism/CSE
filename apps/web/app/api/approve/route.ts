import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type Prior, collision, hashFromHex, priorOf, tokenFromSeed } from "@cse/core";
import { MINT_TYPES, mintDomain } from "@/lib/abi";
import { CONTRACT_ADDRESS, COVERS_BASE, IS_DEMO, activeChain } from "@/lib/config";
import { HAS_DB, db } from "@/lib/db";
import { mintState, mintedSeeds } from "@/lib/seeds-server";

/**
 * The approver. A seed may only be minted with this key's signature over
 * (minter, seed, deadline), which the contract checks against `msg.sender`;
 * the signature is what makes a roll both unique and un-snipeable.
 *
 * Before signing, the candidate is checked against every minted Form:
 *   - structurally, from the seeds on chain (derived here, no render needed)
 *   - perceptually, against the fingerprints the mint watcher files after
 *     rendering each token (the Fingerprint table; covers/index.json when the
 *     site runs without a database)
 * plus whatever this instance has approved in the last few minutes and not yet
 * seen minted. The browser sends the candidate's own fingerprint, computed by
 * the same engine; a client could lie about it, which would only ever cost the
 * collection one look-alike that the watcher's own render then flags.
 *
 * During ALLOWLIST the minter also has to be a raffle winner; the approval then
 * carries the Merkle proof the contract wants.
 *
 *   POST { seed, minter, hash?, dryRun? }
 *     -> { ok: true, deadline, signature, proof } approved
 *     -> { ok: true }                             dryRun, would be approved
 *     -> 403 { error }                            allowlist phase, wallet not drawn
 *     -> 409 { ok: false, reason, against }       too close to a minted Form
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APPROVAL_SECONDS = 10 * 60;
const CACHE_MS = 10_000;

let priorsCache: { at: number; priors: Prior[]; total: number } | null = null;
/** Approved but not yet seen on chain: seed -> prior, with expiry. */
const pending = new Map<string, { prior: Prior; expires: number }>();

async function priors(): Promise<Prior[]> {
  const now = Date.now();
  if (priorsCache && now - priorsCache.at < CACHE_MS) return priorsCache.priors;
  const { total, tokens } = await mintedSeeds();
  const hashes = await fingerprints();
  const list = tokens.map((t) => {
    const p = priorOf(tokenFromSeed(t.seed, t.id));
    const h = hashes.get(t.id);
    return h ? { ...p, hash: h } : p;
  });
  priorsCache = { at: now, priors: list, total };
  // anything approved that has since been minted no longer needs holding
  for (const [seed, entry] of pending) if (entry.expires < now || tokens.some((t) => t.seed === seed)) pending.delete(seed);
  return list;
}

async function fingerprints(): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (HAS_DB) {
    for (const f of await db().fingerprint.findMany({ select: { tokenId: true, hash: true } })) out.set(f.tokenId, f.hash);
    return out;
  }
  if (!COVERS_BASE) return out;
  try {
    const res = await fetch(`${COVERS_BASE}index.json`, { cache: "no-store" });
    if (!res.ok) return out;
    const body = (await res.json()) as { tokens?: { tokenId: number; hash?: string }[] };
    for (const t of body.tokens ?? []) if (t.hash) out.set(t.tokenId, t.hash);
  } catch {
    // the watcher's index is a second line of defence; the structural check still runs
  }
  return out;
}

export async function POST(request: Request) {
  if (IS_DEMO) return NextResponse.json({ error: "the mint is closed" }, { status: 503 });
  const key = process.env.SIGNER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) return NextResponse.json({ error: "no approver configured" }, { status: 503 });

  let body: { seed?: string; minter?: string; hash?: string; dryRun?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const seed = body.seed?.toLowerCase();
  if (!seed || !/^0x[0-9a-f]{64}$/.test(seed) || /^0x0+$/.test(seed)) {
    return NextResponse.json({ error: "seed must be 32 bytes of hex" }, { status: 400 });
  }
  if (!body.minter || !isAddress(body.minter)) return NextResponse.json({ error: "minter must be an address" }, { status: 400 });
  if (body.hash !== undefined && !/^[0-9a-f]{124}$/.test(body.hash)) {
    return NextResponse.json({ error: "hash must be 124 hex chars" }, { status: 400 });
  }

  const token = tokenFromSeed(seed);
  const hash = body.hash ? hashFromHex(body.hash) : null;
  const all = [...(await priors()), ...[...pending.values()].map((p) => p.prior)];
  const hit = collision(token, hash, all);
  if (hit) return NextResponse.json({ ok: false, ...hit }, { status: 409 });
  if (body.dryRun) return NextResponse.json({ ok: true });

  // allowlist window: only drawn wallets, and they need their proof
  let proof: string[] = [];
  if ((await mintState()) === 1) {
    const entry = HAS_DB ? await db().allowlistEntry.findUnique({ where: { address: body.minter.toLowerCase() } }) : null;
    if (!entry?.won) {
      return NextResponse.json(
        { error: "This wallet is not on the allowlist. The public mint opens after the allowlist window." },
        { status: 403 },
      );
    }
    proof = entry.proof;
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + APPROVAL_SECONDS);
  const signature = await privateKeyToAccount(key).signTypedData({
    domain: mintDomain(activeChain.id, CONTRACT_ADDRESS),
    types: MINT_TYPES,
    primaryType: "Mint",
    message: { minter: body.minter as `0x${string}`, seed: seed as `0x${string}`, deadline },
  });
  pending.set(seed, { prior: priorOf(token, hash ?? undefined), expires: Date.now() + APPROVAL_SECONDS * 1000 });
  return NextResponse.json({ ok: true, deadline: deadline.toString(), signature, proof });
}
