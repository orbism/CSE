#!/usr/bin/env node
/**
 * Interactive deployer.
 *
 *   pnpm deploy
 *
 * Walks a network deployment end to end: preflight, deploy the implementation
 * and its ERC1967 proxy, verify both on Etherscan, set the metadata base URI,
 * optionally claim the reserve and open the mint. Every step that costs money
 * or is hard to undo is confirmed first, and the run is recorded under
 * deployments/<network>.json.
 *
 * Non-interactive (CI):
 *   pnpm deploy -- --network sepolia --yes
 */

import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stdin, stdout } from "node:process";
import { loadRootEnv } from "./lib/env.mjs";
import {
  buildWebEnv,
  checkAgainstExample,
  renderEnvBlock,
  renderEnvFile,
} from "./lib/web-env.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS = join(ROOT, "packages/contracts");
const WEB = join(ROOT, "apps/web");
const COLLECTION = join(ROOT, "out/collection");
const DEPLOYMENTS = join(ROOT, "deployments");

const argv = process.argv.slice(2);
const flag = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (n) => argv.includes(`--${n}`);
const AUTO = has("yes");

const NETWORKS = {
  sepolia: {
    chainId: 11155111,
    alchemy: "eth-sepolia",
    explorer: "https://sepolia.etherscan.io",
    label: "Sepolia testnet",
  },
  mainnet: {
    chainId: 1,
    alchemy: "eth-mainnet",
    explorer: "https://etherscan.io",
    label: "Ethereum mainnet",
  },
  // Same script, same steps, against a local anvil — so the flow can be
  // rehearsed for free before it is pointed at a network that costs money.
  localhost: {
    chainId: 31337,
    rpc: "http://127.0.0.1:8545",
    explorer: "http://localhost:8545",
    label: "local anvil",
    local: true,
  },
};

/** anvil's first well-known development account. */
const ANVIL_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// ── plumbing ─────────────────────────────────────────────────────────────────

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const rl = createInterface({ input: stdin, output: stdout });
const ok = (s) => console.log(`  ${C.green("✓")} ${s}`);
const warn = (s) => console.log(`  ${C.yellow("!")} ${s}`);
const step = (s) => console.log(`\n${C.bold(`── ${s} `.padEnd(70, "─"))}`);

function die(message) {
  console.error(`\n${C.red("✗")} ${message}\n`);
  rl.close();
  process.exit(1);
}

/**
 * Read one line, treating a closed stdin as "take the default".
 *
 * Without this, piping input or running under CI throws ERR_USE_AFTER_CLOSE the
 * moment the input runs out — mid-deploy, which is the worst possible place to
 * fall over.
 */
let stdinClosed = false;
rl.on("close", () => {
  stdinClosed = true;
});

async function readLine(prompt) {
  if (stdinClosed) return null;
  try {
    return await rl.question(prompt);
  } catch {
    stdinClosed = true;
    return null;
  }
}

async function ask(question, fallback) {
  if (AUTO) return fallback ?? "";
  const suffix = fallback ? C.dim(` [${fallback}]`) : "";
  const answer = await readLine(`${question}${suffix}: `);
  if (answer === null) return fallback ?? "";
  return answer.trim() || fallback || "";
}

async function confirm(question, fallback = false) {
  if (AUTO) return true;
  const hint = fallback ? "Y/n" : "y/N";
  const answer = await readLine(`${question} ${C.dim(`(${hint})`)} `);
  if (answer === null) return fallback;
  const normalised = answer.trim().toLowerCase();
  if (!normalised) return fallback;
  return normalised === "y" || normalised === "yes";
}

async function choose(question, options) {
  if (AUTO) return options[0].value;
  console.log(`\n${question}`);
  options.forEach((o, i) => console.log(`  ${C.cyan(String(i + 1))}. ${o.label}`));
  for (;;) {
    const answer = await readLine("> ");
    // no input at all is not a safe default for "which network" — stop instead
    if (answer === null) die("no selection given (stdin closed)");
    const trimmed = answer.trim();
    const idx = Number(trimmed) - 1;
    if (idx >= 0 && idx < options.length) return options[idx].value;
    const byName = options.find((o) => o.value === trimmed);
    if (byName) return byName.value;
    console.log(C.red("  pick a number from the list"));
  }
}

/** Run a command and capture stdout. Streams to the terminal when `show`. */
function run(cmd, args, { cwd, env, show = false } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const p = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: show ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => {
      out += d;
      if (show) stdout.write(d);
    });
    p.stderr.on("data", (d) => {
      err += d;
      if (show) stdout.write(d);
    });
    p.on("exit", (code) =>
      code === 0
        ? resolveRun(out)
        : rejectRun(new Error(`${cmd} ${args[0]} exited ${code}\n${err || out}`)),
    );
  });
}

async function rpc(url, method, params = []) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  // A rejected key returns HTML or an empty body, not JSON-RPC. Parsing that
  // blind gives "Unexpected end of JSON input", which says nothing about the
  // actual problem — and a bad key is the likeliest first failure here.
  const text = await res.text();
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? " — check ALCHEMY_API_KEY"
        : res.status === 404
          ? " — check the URL and network"
          : "";
    throw new Error(`HTTP ${res.status}${hint}${text ? `: ${text.slice(0, 160)}` : ""}`);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response: ${text.slice(0, 160) || "(empty)"}`);
  }
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

const exists = (p) =>
  access(p)
    .then(() => true)
    .catch(() => false);

const eth = (wei) => (Number(BigInt(wei)) / 1e18).toFixed(6);

// ── main ─────────────────────────────────────────────────────────────────────

console.log(C.bold("\nCubic Symmetry Engine — deploy\n"));

await loadRootEnv();

// 1. network -----------------------------------------------------------------

const network =
  flag("network") ??
  (await choose("Which network?", [
    { value: "sepolia", label: `${C.bold("Sepolia")} — testnet, free ETH, safe to redo` },
    { value: "mainnet", label: `${C.bold("Mainnet")} — real money, permanent` },
    {
      value: "localhost",
      label: `${C.bold("Localhost")} — rehearse the whole flow against anvil ${C.dim("(needs `pnpm dev` running)")}`,
    },
  ]));

const net = NETWORKS[network];
if (!net) die(`unknown network "${network}" (expected sepolia, mainnet or localhost)`);

// 2. preflight ---------------------------------------------------------------

step("Preflight");

const alchemyKey = process.env.ALCHEMY_API_KEY;
// nothing to verify against on a local chain
const etherscanKey = net.local ? undefined : process.env.ETHERSCAN_API_KEY;
// Localhost always uses anvil's prefunded account. Falling back to a real
// DEPLOYER_PRIVATE_KEY here would deploy from a key with no balance on anvil
// and fail with a confusing "deployer has no ETH".
const pk = net.local ? ANVIL_PK : process.env.DEPLOYER_PRIVATE_KEY;

if (!pk) die("DEPLOYER_PRIVATE_KEY is not set. Copy .env.example to .env and fill it in.");
if (!net.local && !alchemyKey && !process.env.RPC_URL) {
  die("ALCHEMY_API_KEY is not set (or set RPC_URL to a full node URL).");
}
if (!net.local && !etherscanKey) warn("ETHERSCAN_API_KEY is not set — contracts will not be verified.");

const rpcUrl = net.local
  ? net.rpc
  : (process.env.RPC_URL ?? `https://${net.alchemy}.g.alchemy.com/v2/${alchemyKey}`);
ok(`RPC ${C.dim(alchemyKey ? rpcUrl.replace(alchemyKey, "…") : rpcUrl)}`);

let chainId;
try {
  chainId = Number(await rpc(rpcUrl, "eth_chainId"));
} catch (e) {
  die(`cannot reach the RPC endpoint: ${e.message}`);
}
if (chainId !== net.chainId) {
  die(`RPC reports chain ${chainId}, expected ${net.chainId} for ${network}`);
}
ok(`chain ${chainId} (${net.label})`);

// derive the deployer address without pulling in a signing library
let deployer;
try {
  deployer = (await run("cast", ["wallet", "address", "--private-key", pk])).trim();
} catch {
  die("could not derive the deployer address — is `cast` (foundry) installed?");
}
const balance = await rpc(rpcUrl, "eth_getBalance", [deployer, "latest"]);
ok(`deployer ${deployer}`);
if (BigInt(balance) === 0n) {
  die(
    `deployer has no ETH on ${network}.` +
      (network === "sepolia" ? " Get some from a Sepolia faucet." : ""),
  );
}
ok(`balance ${eth(balance)} ETH`);

if (!(await exists(join(CONTRACTS, "lib/forge-std")))) {
  die("foundry libs are missing. Run: cd packages/contracts && forge install");
}

// 3. base URI ----------------------------------------------------------------

step("Metadata");

let baseURI = process.env.CSE_BASE_URI;
const uploadPath = join(COLLECTION, "upload.json");

if (!baseURI && (await exists(uploadPath))) {
  const upload = JSON.parse(await readFile(uploadPath, "utf8"));
  if (upload.baseURI) {
    baseURI = upload.baseURI;
    ok(`found a pinned collection: ${baseURI}`);
  }
}

if (!baseURI) {
  warn("no pinned collection found (out/collection/upload.json)");
  console.log(
    C.dim(
      "  Pin it first with `pnpm upload`, or set a placeholder now and call\n" +
        "  SetBaseURI later — the contract is upgradeable and the URI is settable.",
    ),
  );
  baseURI = await ask("  Base URI", "ipfs://PENDING/");
}

if (!baseURI.endsWith("/")) {
  baseURI += "/";
  warn(`appended a trailing slash: ${baseURI}`);
}
if (network === "mainnet" && baseURI.includes("PENDING")) {
  const go = await confirm(
    C.yellow("  Base URI is still a placeholder on mainnet. Continue anyway?"),
    false,
  );
  if (!go) die("aborted");
}

// 3b. provenance -------------------------------------------------------------
// Committed once at initialisation and never settable again, so a live deploy
// that goes out without it can never acquire one. Refuse rather than shrug.

const provenancePath = join(COLLECTION, "provenance.json");
let provenance = null;
if (await exists(provenancePath)) {
  provenance = JSON.parse(await readFile(provenancePath, "utf8"));
}

const liveNetwork = network === "mainnet" || network === "sepolia";
if (liveNetwork) {
  if (!provenance) {
    die(
      `no ${provenancePath}. Run \`pnpm generate\` first — the provenance hash is set\n` +
        "  once at initialisation and cannot be added later.",
    );
  }
  if (!provenance.complete) {
    die(
      `provenance.json covers ${provenance.supply} tokens, not the full collection.\n` +
        "  That is a partial run. Regenerate before deploying.",
    );
  }
  if (provenance.supply !== 512) {
    die(`provenance covers ${provenance.supply} tokens but MAX_SUPPLY is 512.`);
  }
}

// 4. parameters --------------------------------------------------------------

step("Parameters");

const owner = (await ask("  Contract owner", process.env.CSE_OWNER ?? deployer)) || deployer;
const priceEth = await ask("  Mint price in ETH", process.env.CSE_PRICE_ETH ?? "0.005");
const priceWei = (await run("cast", ["to-wei", priceEth, "ether"])).trim();
const royaltyReceiver = (await ask("  Royalty receiver", process.env.CSE_ROYALTY ?? owner)) || owner;
const royaltyBps = await ask("  Royalty basis points", process.env.CSE_ROYALTY_BPS ?? "500");

console.log(`
  ${C.dim("network ")} ${net.label} (${net.chainId})
  ${C.dim("deployer")} ${deployer}
  ${C.dim("owner   ")} ${owner}
  ${C.dim("price   ")} ${priceEth} ETH ${C.dim(`(${priceWei} wei)`)}
  ${C.dim("royalty ")} ${royaltyBps} bps -> ${royaltyReceiver}
  ${C.dim("baseURI ")} ${baseURI}
  ${C.dim("supply  ")} 512 (11 reserved, 20 per wallet)
  ${C.dim("proven. ")} ${provenance ? `${provenance.hash} ${C.dim(`(${provenance.supply} tokens)`)}` : C.yellow("none — local only")}
  ${C.dim("seed    ")} ${provenance?.masterSeed ?? process.env.CSE_MASTER_SEED ?? "CUBIC-SYMMETRY-ENGINE"}
  ${C.dim("verify  ")} ${etherscanKey ? "yes" : C.yellow("no (no Etherscan key)")}
`);

if (network === "mainnet") {
  console.log(C.yellow("  This spends real ETH and cannot be undone."));
  const typed = await ask(`  Type ${C.bold("mainnet")} to proceed`, AUTO ? "mainnet" : "");
  if (typed !== "mainnet") die("aborted");
} else if (!(await confirm("  Deploy with these settings?", true))) {
  die("aborted");
}

// 5. deploy ------------------------------------------------------------------

step("Deploying");

const deployEnv = {
  PRIVATE_KEY: pk,
  CSE_OWNER: owner,
  CSE_PRICE_WEI: priceWei,
  CSE_BASE_URI: baseURI,
  CSE_ROYALTY: royaltyReceiver,
  CSE_ROYALTY_BPS: royaltyBps,
  CSE_PROVENANCE:
    provenance?.hash ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
  CSE_MASTER_SEED:
    provenance?.masterSeed ?? process.env.CSE_MASTER_SEED ?? "CUBIC-SYMMETRY-ENGINE",
};

const deployArgs = [
  "script",
  "script/Deploy.s.sol:Deploy",
  "--rpc-url",
  rpcUrl,
  "--broadcast",
  "-vv",
];
if (etherscanKey) deployArgs.push("--verify", "--etherscan-api-key", etherscanKey, "--delay", "8");

let deployOut;
try {
  deployOut = await run("forge", deployArgs, { cwd: CONTRACTS, env: deployEnv, show: true });
} catch (e) {
  die(`deployment failed:\n${e.message}`);
}

const proxy = deployOut.match(/proxy\s+:\s*(0x[a-fA-F0-9]{40})/)?.[1];
const implementation = deployOut.match(/implementation\s+:\s*(0x[a-fA-F0-9]{40})/)?.[1];
if (!proxy || !implementation) die("could not parse the deployed addresses from forge output");

ok(`implementation ${implementation}`);
ok(`proxy         ${proxy}`);
console.log(`  ${C.dim(`${net.explorer}/address/${proxy}`)}`);

// 6. verification ------------------------------------------------------------

if (etherscanKey) {
  step("Verification");
  const verified = /Contract successfully verified|is already verified/i.test(deployOut);
  if (verified) {
    ok("verified during deployment");
  } else {
    warn("inline verification did not confirm — retrying standalone");
    // The proxy's constructor args have to be re-encoded for a standalone pass.
    const initCalldata = (
      await run("cast", [
        "calldata",
        "initialize(address,uint256,string,address,uint96)",
        owner,
        priceWei,
        baseURI,
        royaltyReceiver,
        royaltyBps,
      ])
    ).trim();
    const proxyArgs = (
      await run("cast", ["abi-encode", "constructor(address,bytes)", implementation, initCalldata])
    ).trim();

    for (const [addr, contract, args] of [
      [implementation, "src/CubicSymmetryEngine.sol:CubicSymmetryEngine", null],
      [proxy, "lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy", proxyArgs],
    ]) {
      const v = [
        "verify-contract",
        addr,
        contract,
        "--chain-id",
        String(net.chainId),
        "--etherscan-api-key",
        etherscanKey,
        "--watch",
      ];
      if (args) v.push("--constructor-args", args);
      try {
        await run("forge", v, { cwd: CONTRACTS, show: true });
        ok(`verified ${addr}`);
      } catch (e) {
        warn(`could not verify ${addr}: ${e.message.split("\n")[0]}`);
        console.log(C.dim(`    retry later: cd packages/contracts && forge ${v.join(" ")}`));
      }
    }
  }

  // Etherscan needs to be told a proxy is a proxy before it shows the ABI.
  console.log(
    C.dim(`  If the proxy shows no read/write tabs, mark it as a proxy at\n` +
      `    ${net.explorer}/proxyContractChecker?a=${proxy}`),
  );
}

// 7. post-deploy actions ------------------------------------------------------

step("Post-deploy");

const adminEnv = { PRIVATE_KEY: pk, CSE_PROXY: proxy };

async function admin(contract, extraEnv, label) {
  try {
    await run(
      "forge",
      ["script", `script/Admin.s.sol:${contract}`, "--rpc-url", rpcUrl, "--broadcast"],
      { cwd: CONTRACTS, env: { ...adminEnv, ...extraEnv } },
    );
    ok(label);
    return true;
  } catch (e) {
    warn(`${label} failed: ${e.message.split("\n")[0]}`);
    return false;
  }
}

if (owner.toLowerCase() === deployer.toLowerCase()) {
  if (await confirm("  Claim the 11 reserved Forms (#502-#512) now?", false)) {
    const to = (await ask("    Send reserve to", owner)) || owner;
    // ids are explicit now that buyers choose theirs; hold back the tail
    await admin(
      "ReserveMint",
      { CSE_RESERVE_TO: to, CSE_RESERVE_FROM: "502", CSE_RESERVE_QTY: "11" },
      `reserved #502-#512 -> ${to}`,
    );
  }

  if (await confirm("  Open the mint (set state to LIVE) now?", false)) {
    await admin("SetMintState", { CSE_MINT_STATE: "1" }, "mint state -> LIVE");
  } else {
    console.log(
      C.dim(
        `    open it later with:\n` +
          `      CSE_PROXY=${proxy} CSE_MINT_STATE=1 PRIVATE_KEY=… \\\n` +
          `        forge script script/Admin.s.sol:SetMintState --rpc-url <rpc> --broadcast`,
      ),
    );
  }
} else {
  warn(`owner is ${owner}, not the deployer — run reserve/mint-state actions from that key`);
}

// 8. record + hand off --------------------------------------------------------

step("Recorded");

await mkdir(DEPLOYMENTS, { recursive: true });
const record = {
  network,
  chainId: net.chainId,
  proxy,
  implementation,
  owner,
  deployer,
  priceWei,
  priceEth,
  baseURI,
  royalty: { receiver: royaltyReceiver, bps: Number(royaltyBps) },
  explorer: `${net.explorer}/address/${proxy}`,
  deployedAt: new Date().toISOString(),
};
const recordPath = join(DEPLOYMENTS, `${network}.json`);
await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
ok(recordPath.replace(`${ROOT}/`, ""));

if (net.local) {
  // `pnpm dev` owns apps/web/.env.local and adds the local asset server and a
  // direct RPC URL. Writing a partial file over it here would break the site.
  console.log(
    `\n  ${C.dim("This was a rehearsal against anvil. `pnpm dev` manages the site's")}\n` +
      `  ${C.dim("environment for local runs, so there is nothing to copy.")}\n`,
  );
} else {
  // Same builder the local loop uses, so the two can never drift apart.
  let imagesCid = process.env.CSE_IMAGES_CID ?? "";
  let artCid = process.env.CSE_ART_CID ?? "";
  if ((!imagesCid || !artCid) && (await exists(uploadPath))) {
    const upload = JSON.parse(await readFile(uploadPath, "utf8"));
    imagesCid ||= upload.imagesCID ?? "";
    artCid ||= upload.artCID ?? "";
  }

  const webEnv = buildWebEnv({
    chainId: net.chainId,
    contract: proxy,
    masterSeed: process.env.CSE_MASTER_SEED,
    alchemyKey,
    alchemyNetwork: net.alchemy,
    imagesCid,
    artCid,
    gateway: process.env.CSE_IPFS_GATEWAY,
  });

  for (const w of await checkAgainstExample(webEnv, join(WEB, ".env.example"))) {
    warn(`env: ${w}`);
  }

  console.log(
    `\n${C.bold("Set these on the site")} ${C.dim("(Vercel project → Environment Variables)")}\n`,
  );
  console.log(renderEnvBlock(webEnv));

  if (!imagesCid || !artCid) {
    console.log(
      C.yellow(`\n  The image and art CIDs are empty because the collection is not pinned yet.`) +
        C.dim(`\n  Run \`pnpm upload\`, then SetBaseURI, then fill the two CIDs above.`),
    );
  }

  if (await confirm(`\n  Also write apps/web/.env.local for local testing?`, false)) {
    await writeFile(
      join(WEB, ".env.local"),
      renderEnvFile(webEnv, "written by scripts/deploy.mjs"),
    );
    ok("apps/web/.env.local");
  }
}

console.log(`\n${C.green("Done.")} ${net.local ? proxy : `${net.explorer}/address/${proxy}`}\n`);
rl.close();
