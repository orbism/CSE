#!/usr/bin/env node
/**
 * Full localhost loop: anvil -> deploy -> assets -> next dev.
 *
 * Writes apps/web/.env.local with the freshly deployed proxy address so the
 * site picks it up without any manual copying, and prints the same block for
 * anyone keeping their own file. Ctrl-C tears everything down.
 *
 *   node scripts/dev-local.mjs            # assumes a collection already exists
 *   node scripts/dev-local.mjs --live     # also flip the mint to PUBLIC
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "./lib/env.mjs";
import {
  buildWebEnv,
  checkAgainstExample,
  preserveUnmanaged,
  renderEnvBlock,
  renderEnvFile,
} from "./lib/web-env.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS = join(ROOT, "packages/contracts");
const WEB = join(ROOT, "apps/web");
const COVERS = join(ROOT, "out/local-covers");

// anvil's first well-known development account
const DEPLOYER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

let ASSET_PORT = 8788;
let WEB_PORT = 3000;
const RPC = "http://127.0.0.1:8545";
const WANT_LIVE = process.argv.includes("--live");

const children = [];
let shuttingDown = false;

function start(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: "pipe", ...opts });
  children.push(child);
  const tag = name.padEnd(8);
  child.stdout?.on("data", (d) =>
    String(d).trimEnd().split("\n").forEach((l) => console.log(`[${tag}] ${l}`)),
  );
  child.stderr?.on("data", (d) =>
    String(d).trimEnd().split("\n").forEach((l) => console.error(`[${tag}] ${l}`)),
  );
  child.on("exit", (code) => {
    if (!shuttingDown && code !== 0) {
      console.error(`[${tag}] exited with ${code}`);
      shutdown(1);
    }
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Chain id of whatever is answering on the RPC port, or null if nothing is. */
async function probeChain(url = RPC) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body.result ? Number(body.result) : null;
  } catch {
    return null;
  }
}

/**
 * Wait for the node to answer, but give up early if the child we spawned has
 * already died.
 *
 * Polling the port alone is not a readiness check: a leftover anvil from a
 * previous run answers immediately, so the script reported "anvil ready" while
 * its own child was exiting with "Address already in use", and only fell over
 * later during deploy.
 */
async function waitForOwnAnvil(child, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    if ((await probeChain()) !== null) return true;
    await sleep(250);
  }
  return false;
}

/**
 * First free TCP port at or after `preferred`.
 *
 * Both binds have to succeed. On macOS neither test alone is sufficient and
 * each misses the other's case: probing only 127.0.0.1 called 3000 free while
 * Next held :::3000, and probing only the wildcard called 8788 free while the
 * asset server held 127.0.0.1:8788. Either way the banner announced a port that
 * then died with EADDRINUSE.
 */
async function freePort(preferred) {
  const { createServer } = await import("node:net");

  const canBind = (port, host) =>
    new Promise((resolve) => {
      const s = createServer();
      s.once("error", () => resolve(false));
      s.once("listening", () => s.close(() => resolve(true)));
      if (host) s.listen(port, host);
      else s.listen(port);
    });

  for (let port = preferred; port < preferred + 40; port++) {
    if ((await canBind(port, "127.0.0.1")) && (await canBind(port, null))) return port;
  }
  throw new Error(`no free port near ${preferred}`);
}

function run(cmd, args, opts = {}) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("exit", (code) =>
      code === 0 ? ok(out) : fail(new Error(`${cmd} ${args.join(" ")} failed:\n${err || out}`)),
    );
  });
}

await loadRootEnv();

// Resolve the asset port before anything embeds it: the cover base goes into
// the site's env, so it has to be settled first.
const wantedAssetPort = ASSET_PORT;
ASSET_PORT = await freePort(ASSET_PORT);
if (ASSET_PORT !== wantedAssetPort) {
  console.log(`port ${wantedAssetPort} is busy — serving assets on ${ASSET_PORT}`);
}

// Next hard-fails on a taken port rather than moving, so pick one it can have.
const wantedWebPort = WEB_PORT;
WEB_PORT = await freePort(WEB_PORT);
if (WEB_PORT !== wantedWebPort) {
  console.log(`port ${wantedWebPort} is busy — serving the site on ${WEB_PORT}`);
}

// ── preflight ────────────────────────────────────────────────────────────────

// Bootstrap whatever is missing rather than telling the user to go and do it.
// A clean checkout should get a working local demo from one command.

const exists = (p) =>
  access(p)
    .then(() => true)
    .catch(() => false);

/** Run a command, streaming its output, and reject on a non-zero exit. */
function runVisible(cmd, args, opts = {}) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("exit", (code) =>
      code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(" ")} exited ${code}`)),
    );
  });
}

if (!(await exists(join(ROOT, "packages/art/dist/index.html")))) {
  console.log("no art bundle — building it…");
  await runVisible("pnpm", ["--filter", "@cse/art", "build"], { cwd: ROOT });
}
// The engine page the renderer carries on chain, so local tokenURIs are the real thing.
const ONCHAIN = join(ROOT, "out/onchain");
if (!(await exists(join(ONCHAIN, "page-tail.b64")))) {
  console.log("no on-chain page — packing it…");
  await runVisible("pnpm", ["--filter", "@cse/generator", "onchain"], { cwd: ROOT });
}

// ── 1. anvil ─────────────────────────────────────────────────────────────────

// Reuse a node that is already listening rather than fighting it for the port.
// A previous run that was killed rather than Ctrl-C'd leaves anvil behind, and
// spawning a second one just fails with EADDRINUSE.
const runningChain = await probeChain();

if (runningChain === 31337) {
  console.log(`reusing the anvil already listening on ${RPC}`);
  console.log("  (state carries over; Ctrl-C here will not stop it)");
} else if (runningChain !== null) {
  console.error(
    `Something on ${RPC} is answering as chain ${runningChain}, not anvil (31337).\n` +
      `Stop it, or point CSE_RPC elsewhere.`,
  );
  process.exit(1);
} else {
  console.log("starting anvil…");
  const anvil = start("anvil", "anvil", ["--silent", "--host", "127.0.0.1"]);
  if (!(await waitForOwnAnvil(anvil))) {
    console.error(
      anvil.exitCode !== null
        ? `anvil exited with ${anvil.exitCode}. Is another one already running?\n` +
            `  lsof -nP -iTCP:8545 -sTCP:LISTEN`
        : "anvil did not come up in time",
    );
    shutdown(1);
  }
  console.log("anvil ready");
}

// ── 2. deploy ────────────────────────────────────────────────────────────────

console.log("deploying…");
const coversBase = `http://127.0.0.1:${ASSET_PORT}/covers/`;

// The deployer is owner and approver here; the site signs with the same anvil
// key (SIGNER_PRIVATE_KEY below), which is the whole local loop in one account.
const deployOut = await run(
  "forge",
  ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", RPC, "--broadcast", "-vv"],
  {
    cwd: CONTRACTS,
    env: {
      ...process.env,
      PRIVATE_KEY: DEPLOYER_PK,
      CSE_OWNER: DEPLOYER,
      CSE_PRICE_WEI: "7000000000000000",
      CSE_ALLOWLIST_PRICE_WEI: "5000000000000000",
      CSE_SIGNER: DEPLOYER,
      CSE_REVEALER: DEPLOYER,
      CSE_ONCHAIN_DIR: ONCHAIN,
      CSE_IMAGE_BASE: coversBase,
    },
  },
);

const proxy = deployOut.match(/proxy\s+:\s*(0x[a-fA-F0-9]{40})/)?.[1];
if (!proxy) {
  console.error(deployOut);
  console.error("could not parse the proxy address from the deploy output");
  shutdown(1);
}
console.log(`proxy ${proxy}`);

async function setMintState(state) {
  await run("forge", ["script", "script/Admin.s.sol:SetMintState", "--rpc-url", RPC, "--broadcast"], {
    cwd: CONTRACTS,
    env: { ...process.env, PRIVATE_KEY: DEPLOYER_PK, CSE_PROXY: proxy, CSE_MINT_STATE: String(state) },
  });
}

// ── 2a. mint a handful of Forms ──────────────────────────────────────────────
// So the gallery has something in it the moment the site comes up. Each mint
// goes through the real path: a random seed, an EIP-712 approval signed for the
// minter (by the deployer, who is the approver locally), then `mint`.
const DEMO_MINTS = Number(process.env.CSE_DEV_TOKENS ?? 12);
if (DEMO_MINTS > 0) {
  await setMintState(2);
  const chainId = 31337;
  const typed = (minter, seed, deadline) =>
    JSON.stringify({
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        Mint: [
          { name: "minter", type: "address" },
          { name: "seed", type: "bytes32" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Mint",
      domain: { name: "Cubic Symmetry Engine", version: "1", chainId, verifyingContract: proxy },
      message: { minter, seed, deadline: String(deadline) },
    });
  for (let i = 0; i < DEMO_MINTS; i++) {
    const seed = `0x${randomBytes(32).toString("hex")}`;
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const sig = (
      await run("cast", ["wallet", "sign", "--private-key", DEPLOYER_PK, "--data", typed(DEPLOYER, seed, deadline)])
    ).trim();
    await run(
      "cast",
      ["send", proxy, "mint(bytes32,uint256,bytes,bytes32[])", seed, String(deadline), sig, "[]", "--value", "7000000000000000",
        "--private-key", DEPLOYER_PK, "--rpc-url", RPC],
      { cwd: CONTRACTS },
    );
  }
  console.log(`minted ${DEMO_MINTS} Forms from random seeds`);

  // covers + fingerprints, the way the watcher does it in production
  console.log("rendering covers…");
  await runVisible(
    "pnpm",
    ["--filter", "@cse/generator", "watch-mints", "--", "--contract", proxy, "--rpc", RPC, "--once", "--local", COVERS, "--size", "600"],
    { cwd: ROOT },
  );
}
await setMintState(WANT_LIVE ? 2 : 0);
console.log(`mint state -> ${WANT_LIVE ? "PUBLIC" : "CLOSED"}`);

let envBlock = "";

// ── 3. env for the site ──────────────────────────────────────────────────────

const envPath = join(WEB, ".env.local");
const envEntries = buildWebEnv({
  chainId: 31337,
  contract: proxy,
  masterSeed: process.env.CSE_MASTER_SEED,
  rpcUrl: RPC,
  localAssets: `http://127.0.0.1:${ASSET_PORT}`,
  signerKey: DEPLOYER_PK,
  coversBase,
});

const existing = await readFile(envPath, "utf8").catch(() => "");
const preserved = preserveUnmanaged(existing, envEntries);

await writeFile(
  envPath,
  renderEnvFile(envEntries, "written by scripts/dev-local.mjs") +
    (preserved.length ? `\n# kept from your previous file\n${preserved.join("\n")}\n` : ""),
);

// Surface drift rather than letting the site fail on a key nobody wired up.
for (const w of await checkAgainstExample(envEntries, join(WEB, ".env.example"))) {
  console.warn(`env warning: ${w}`);
}

envBlock = renderEnvBlock(envEntries);

// ── 4. assets + site ─────────────────────────────────────────────────────────

start("assets", process.execPath, [join(ROOT, "scripts/serve-assets.mjs")], {
  env: { ...process.env, CSE_ASSET_PORT: String(ASSET_PORT), CSE_COVERS_DIR: COVERS },
});
start("next", "pnpm", ["--filter", "@cse/web", "dev"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(WEB_PORT) },
});

const RULE = "─".repeat(78);

console.log(`
${RULE}
  site      http://localhost:${WEB_PORT}
  assets    http://127.0.0.1:${ASSET_PORT}
  rpc       ${RPC}
  contract  ${proxy}
  state     ${WANT_LIVE ? "PUBLIC" : "CLOSED (demo box)"}

  deployer  ${DEPLOYER}

  To mint from the site, import this into your BROWSER WALLET and add a
  network for ${RPC} with chain ID 31337:

  ${DEPLOYER_PK}

  This is anvil's public test account — every anvil user has the same one.
  It is NOT your .env DEPLOYER_PRIVATE_KEY, which is only used by
  \`pnpm deploy\` for Sepolia and mainnet. Never send real funds here.
${RULE}

apps/web/.env.local  — already written; copy/paste if you keep your own:

${envBlock}

${RULE}
  rolls on the input page are approved by this same key (SIGNER_PRIVATE_KEY in
  .env.local); covers come from out/local-covers, rendered at mint by the watcher.
  flip the mint on later with:
  CSE_PROXY=${proxy} CSE_MINT_STATE=1 PRIVATE_KEY=${DEPLOYER_PK} \\
    forge script script/Admin.s.sol:SetMintState --rpc-url ${RPC} --broadcast

  ctrl-c to stop everything
${RULE}
`);
