import { NextResponse } from "next/server";

/**
 * Read-only JSON-RPC proxy.
 *
 * The site talks to this instead of Alchemy directly, so the API key never
 * reaches the browser. Alchemy keys can be domain-restricted, but a key in a
 * static bundle is still a key anyone can lift and use elsewhere.
 *
 * Only read methods are forwarded. Writes go through the user's own wallet
 * provider, never through here — without an allowlist this route would be an
 * open relay that anyone could point at our quota.
 */
export const runtime = "nodejs";

const ALLOWED = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "net_version",
  "web3_clientVersion",
]);

function upstream(): string {
  const explicit = process.env.RPC_URL;
  if (explicit) return explicit;

  const key = process.env.ALCHEMY_API_KEY;
  const network = process.env.ALCHEMY_NETWORK ?? "eth-sepolia";
  if (key) return `https://${network}.g.alchemy.com/v2/${key}`;

  // the localhost loop needs no key at all
  return "http://127.0.0.1:8545";
}

type RpcCall = { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };

export async function POST(request: Request) {
  let body: RpcCall | RpcCall[];
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const calls = Array.isArray(body) ? body : [body];
  const blocked = calls.find((c) => !c.method || !ALLOWED.has(c.method));
  if (blocked) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: blocked.id ?? null,
        error: { code: -32601, message: `method not allowed: ${blocked.method ?? "(none)"}` },
      },
      { status: 403 },
    );
  }

  try {
    const res = await fetch(upstream(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32603, message: String(e) } },
      { status: 502 },
    );
  }
}
