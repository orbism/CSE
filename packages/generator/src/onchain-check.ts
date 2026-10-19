/**
 * End-to-end check of the on-chain renderer against a throwaway anvil.
 *
 *   pnpm --filter @cse/generator onchain-check
 *
 * Deploys the token and the renderer from out/onchain, mints three seeds the
 * way the site does (an EIP-712 approval signed for the minter), then for each
 * one reads `tokenURI` straight off the chain, decodes it, checks the JSON, and
 * loads the decoded `animation_url` page in a real browser to confirm it boots
 * the engine and draws exactly the glyph grid the pinned bundle draws for that
 * seed. Needs anvil, forge and cast on PATH, and a built art bundle.
 */

import "./env.js";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createPublicClient, http, keccak256, parseAbi, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { capturePose, tokenFromSeed } from "@cse/core";
import { openRenderer } from "./render.js";

const ROOT = resolve("../..");
const CONTRACTS = join(ROOT, "packages/contracts");
const ONCHAIN = join(ROOT, "out/onchain");
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const; // anvil #0
const IMAGE_BASE = "https://covers.test/";
const PRICE = 7_000_000_000_000_000n; // the public price Deploy.s.sol defaults to
const seeds = ["one", "seven", "aperture"].map((s) => keccak256(toHex(s)));

const sh = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync(cmd, args, { cwd: CONTRACTS, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const anvil = spawn("anvil", ["--port", "8547", "--silent"], { stdio: "ignore" });
const rpc = "http://127.0.0.1:8547";
const client = createPublicClient({ transport: http(rpc) });
for (let i = 0; i < 50; i++) {
  try { await client.getChainId(); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
}
try {
  const out = sh("forge", ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", rpc, "--broadcast", "-vv"], {
    PRIVATE_KEY: PK, CSE_ONCHAIN_DIR: ONCHAIN, CSE_IMAGE_BASE: IMAGE_BASE,
  });
  const proxy = out.match(/proxy\s+:\s*(0x[a-fA-F0-9]{40})/)?.[1] as `0x${string}` | undefined;
  const renderer = out.match(/renderer\s+:\s*(0x[a-fA-F0-9]{40})/)?.[1];
  if (!proxy || !renderer) throw new Error(`deploy output had no addresses:\n${out}`);
  console.log(`token ${proxy}\nrenderer ${renderer}`);

  // the deployer is owner and, by default, the approver
  const account = privateKeyToAccount(PK);
  const chainId = await client.getChainId();
  sh("cast", ["send", proxy, "setMintState(uint8)", "2", "--rpc-url", rpc, "--private-key", PK]); // PUBLIC
  for (const seed of seeds) {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const signature = await account.signTypedData({
      domain: { name: "Cubic Symmetry Engine", version: "1", chainId, verifyingContract: proxy },
      types: { Mint: [{ name: "minter", type: "address" }, { name: "seed", type: "bytes32" }, { name: "deadline", type: "uint256" }] },
      primaryType: "Mint",
      message: { minter: account.address, seed, deadline },
    });
    sh("cast", ["send", proxy, "mint(bytes32,uint256,bytes,bytes32[])", seed, String(deadline), signature, "[]", "--value", String(PRICE), "--rpc-url", rpc, "--private-key", PK]);
  }

  const abi = parseAbi(["function tokenURI(uint256) view returns (string)", "function seedOf(uint256) view returns (bytes32)"]);
  const dir = await mkdtemp(join(tmpdir(), "cse-onchain-"));
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const reference = await openRenderer("CUBIC-SYMMETRY-ENGINE");
  let failures = 0;

  for (let id = 1; id <= seeds.length; id++) {
    const seed = await client.readContract({ address: proxy, abi, functionName: "seedOf", args: [BigInt(id)] });
    const uri = await client.readContract({ address: proxy, abi, functionName: "tokenURI", args: [BigInt(id)] });
    const prefix = "data:application/json;base64,";
    if (!uri.startsWith(prefix)) throw new Error(`#${id}: unexpected tokenURI prefix`);
    const json = JSON.parse(Buffer.from(uri.slice(prefix.length), "base64").toString("utf8"));
    const problems: string[] = [];
    if (seed !== seeds[id - 1]) problems.push(`seedOf is ${seed}, minted ${seeds[id - 1]}`);
    if (json.name !== `Cubic Symmetry Engine #${String(id).padStart(4, "0")}`) problems.push(`name ${json.name}`);
    if (json.image !== `${IMAGE_BASE}${id}.png`) problems.push(`image ${json.image}`);
    if (json.seed !== seed) problems.push(`json seed ${json.seed}`);
    if (JSON.stringify(json.attributes) !== JSON.stringify([{ trait_type: "Traits", value: "Revealed at sell-out" }]))
      problems.push(`attributes before reveal: ${JSON.stringify(json.attributes)}`);

    const ap = "data:text/html;base64,";
    if (!json.animation_url?.startsWith(ap)) problems.push("animation_url is not a base64 html data url");
    const html = Buffer.from(json.animation_url.slice(ap.length), "base64").toString("utf8");
    const pagePath = join(dir, `${id}.html`);
    await writeFile(pagePath, html);
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`file://${pagePath}`);
    try {
      await page.waitForFunction(() => (window as any).__CSE_READY === true, null, { timeout: 60_000 });
    } catch {
      problems.push(`page never became ready; errors: ${errors.join(" | ") || "none"}`);
    }
    if (errors.length) problems.push(`page errors: ${errors.join(" | ")}`);
    if (!problems.length) {
      const token = tokenFromSeed(seed, id);
      const pose = capturePose(token);
      const onchainText = await page.evaluate((p) => (window as any).__CSE.captureText(p), pose);
      await reference.page.evaluate(([s, i]) => (window as any).__CSE.loadSeed(s, i), [seed, id] as const);
      const refText = await reference.page.evaluate((p) => (window as any).__CSE.captureText(p), pose);
      if (onchainText !== refText) problems.push("glyph grid differs from the pinned bundle");
      const current = await page.evaluate(() => (window as any).__CSE.current());
      if (current?.tokenId !== id || current?.seed !== seed.slice(2)) problems.push(`page rendered #${current?.tokenId} ${current?.seed}`);
    }
    await page.close();

    if (problems.length) {
      failures++;
      console.log(`✗ #${id}\n   ${problems.join("\n   ")}`);
    } else console.log(`✓ #${id}  tokenURI ${uri.length} chars, page ${html.length} B, grid identical to the bundle`);
  }
  await reference.close();
  await browser.close();
  console.log(failures ? `\n${failures} failed` : `\nall ${seeds.length} ok`);
  process.exitCode = failures ? 1 : 0;
} finally {
  anvil.kill();
}
