import { NextResponse } from "next/server";
import { HAS_DB, db } from "@/lib/db";

/**
 * Where the mint watcher files each token's fingerprint after rendering it.
 * Bearer WATCHER_SECRET. The approver reads this table on every check.
 *
 *   POST { tokenId, seed, structure, vector, hash }
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.WATCHER_SECRET;
  if (!HAS_DB || !secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const b = (await request.json()) as { tokenId?: number; seed?: string; structure?: string; vector?: number[]; hash?: string };
  if (
    !Number.isInteger(b.tokenId) ||
    typeof b.seed !== "string" ||
    typeof b.structure !== "string" ||
    !Array.isArray(b.vector) ||
    typeof b.hash !== "string"
  ) {
    return NextResponse.json({ error: "malformed fingerprint" }, { status: 400 });
  }
  const data = { seed: b.seed.toLowerCase(), structure: b.structure, vector: b.vector, hash: b.hash };
  await db().fingerprint.upsert({ where: { tokenId: b.tokenId! }, create: { tokenId: b.tokenId!, ...data }, update: data });
  return NextResponse.json({ ok: true });
}
