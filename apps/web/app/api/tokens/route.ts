import { NextResponse } from "next/server";
import { IS_DEMO } from "@/lib/config";
import { mintedSeeds } from "@/lib/seeds-server";

/**
 * Every minted token's seed: `totalMinted`, then `seedOf` for each id, batched
 * at the JSON-RPC layer. Proxied server-side so the Alchemy key never reaches
 * the browser, and cached briefly at the edge because mints keep arriving.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  if (IS_DEMO) return NextResponse.json({ total: 0, tokens: [] });
  try {
    const { total, tokens } = await mintedSeeds();
    return NextResponse.json({ total, tokens }, { headers: { "cache-control": "public, max-age=15" } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
