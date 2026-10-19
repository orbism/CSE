import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { HAS_DB, UNIQUE_VIOLATION, db } from "@/lib/db";

/**
 * The allowlist raffle.
 *
 *   POST { address }            enter; 409 when the wallet is already in, 410 once drawn
 *   GET  ?address=0x…           { entries, closed, entered, won, proof }
 *
 * Entries are wallets, one each, as submitted from the connected wallet on
 * /allowlist. The draw (`pnpm draw`) marks winners and writes their proofs.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const normalise = (raw: unknown) => (typeof raw === "string" && isAddress(raw) ? getAddress(raw).toLowerCase() : null);

export async function GET(request: Request) {
  if (!HAS_DB) return NextResponse.json({ error: "no database configured" }, { status: 503 });
  const address = normalise(new URL(request.url).searchParams.get("address"));
  const [entries, draw, entry] = await Promise.all([
    db().allowlistEntry.count(),
    db().draw.findUnique({ where: { id: 1 } }),
    address ? db().allowlistEntry.findUnique({ where: { address } }) : null,
  ]);
  return NextResponse.json({
    entries,
    closed: !!draw,
    entered: !!entry,
    won: !!entry?.won,
    proof: entry?.won ? entry.proof : undefined,
  });
}

export async function POST(request: Request) {
  if (!HAS_DB) return NextResponse.json({ error: "no database configured" }, { status: 503 });
  let body: { address?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const address = normalise(body.address);
  if (!address) return NextResponse.json({ error: "that is not a wallet address" }, { status: 400 });
  if (await db().draw.findUnique({ where: { id: 1 } })) {
    return NextResponse.json({ error: "Entries are closed. The raffle has been drawn." }, { status: 410 });
  }
  try {
    await db().allowlistEntry.create({ data: { address } });
  } catch (e) {
    if ((e as { code?: string }).code === UNIQUE_VIOLATION) {
      return NextResponse.json({ error: "This wallet was already submitted." }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json({ ok: true });
}
