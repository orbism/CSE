/**
 * The site's environment, defined once.
 *
 * `dev-local.mjs` and `deploy.mjs` both have to hand the user a working set of
 * variables, and they were drifting: the local loop was writing five keys while
 * apps/web/.env.example documented eight. Building the block here — and
 * checking it against the example — means adding a key to the example without
 * wiring it up is a warning rather than a silent omission at runtime.
 */

import { readFile } from "node:fs/promises";

/** Keys the site reads but which are not required for every deployment. */
const OPTIONAL = new Set([
  "NEXT_PUBLIC_RPC_URL",
  "NEXT_PUBLIC_LOCAL_ASSETS",
  "RPC_URL",
  "ALCHEMY_API_KEY",
  "ALCHEMY_NETWORK",
  "NEXT_PUBLIC_IMAGES_CID",
  "NEXT_PUBLIC_ART_CID",
]);

/**
 * @param {object} o
 * @param {number} o.chainId
 * @param {string} o.contract
 * @param {string} [o.masterSeed]
 * @param {string} [o.rpcUrl]        browser-visible RPC; only for anvil
 * @param {string} [o.localAssets]   local static server; only for anvil
 * @param {string} [o.alchemyKey]
 * @param {string} [o.alchemyNetwork]
 * @param {string} [o.imagesCid]
 * @param {string} [o.artCid]
 * @param {string} [o.gateway]
 * @returns {{key:string,value:string,note?:string,commented?:boolean}[]}
 */
export function buildWebEnv(o) {
  const local = o.chainId === 31337;

  return [
    { key: "NEXT_PUBLIC_CHAIN_ID", value: String(o.chainId) },
    { key: "NEXT_PUBLIC_CONTRACT_ADDRESS", value: o.contract },
    {
      key: "NEXT_PUBLIC_MASTER_SEED",
      value: o.masterSeed ?? "CUBIC-SYMMETRY-ENGINE",
      note: "must match the seed the collection was generated with",
    },

    // RPC. Locally the browser talks straight to anvil; on a real network it
    // goes through /api/rpc so the Alchemy key stays server-side.
    local
      ? {
          key: "NEXT_PUBLIC_RPC_URL",
          value: o.rpcUrl ?? "http://127.0.0.1:8545",
          note: "anvil has no key to protect, so skip the /api/rpc proxy",
        }
      : {
          key: "NEXT_PUBLIC_RPC_URL",
          value: "",
          commented: true,
          note: "leave unset: the browser uses /api/rpc",
        },
    {
      key: "ALCHEMY_API_KEY",
      value: o.alchemyKey ?? "",
      commented: local,
      note: local ? "not needed against anvil" : "server-side only, never exposed to the browser",
    },
    {
      key: "ALCHEMY_NETWORK",
      value: o.alchemyNetwork ?? (local ? "" : "eth-sepolia"),
      commented: local,
      note: local ? "not needed against anvil" : "must match NEXT_PUBLIC_CHAIN_ID",
    },

    // Assets
    {
      key: "NEXT_PUBLIC_IMAGES_CID",
      value: o.imagesCid ?? "",
      note: local ? "unset locally: served from NEXT_PUBLIC_LOCAL_ASSETS" : "from out/collection/upload.json",
    },
    {
      key: "NEXT_PUBLIC_ART_CID",
      value: o.artCid ?? "",
      note: local ? "unset locally: served from NEXT_PUBLIC_LOCAL_ASSETS" : "from out/collection/upload.json",
    },
    {
      key: "NEXT_PUBLIC_IPFS_GATEWAY",
      value: o.gateway ?? "https://4everland.io/ipfs",
    },
    {
      key: "NEXT_PUBLIC_LOCAL_ASSETS",
      value: local ? (o.localAssets ?? "http://127.0.0.1:8788") : "",
      commented: !local,
      note: local ? "images, art bundle and tokens.json" : "local development only",
    },
  ];
}

/** The file content: no colour, no notes on their own lines, safe to write. */
export function renderEnvFile(entries, header) {
  const lines = header ? [`# ${header}`] : [];
  for (const e of entries) {
    const prefix = e.commented ? "# " : "";
    lines.push(`${prefix}${e.key}=${e.value}${e.note ? `${e.commented ? "" : "   "}` : ""}`.trimEnd());
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The terminal block: identical keys and values, annotated. Kept free of ANSI
 * colour so selecting and pasting it yields a valid .env file.
 */
export function renderEnvBlock(entries) {
  const width = Math.max(...entries.map((e) => `${e.key}=${e.value}`.length));
  return entries
    .map((e) => {
      const body = `${e.commented ? "# " : ""}${e.key}=${e.value}`;
      return e.note ? `${body.padEnd(width + 2)}  # ${e.note}` : body;
    })
    .join("\n");
}

/**
 * Compare the emitted keys against everything apps/web/.env.example documents,
 * including commented-out lines. Returns human-readable warnings.
 */
export async function checkAgainstExample(entries, examplePath) {
  let text;
  try {
    text = await readFile(examplePath, "utf8");
  } catch {
    return [`could not read ${examplePath} to cross-check`];
  }

  const documented = new Set();
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/);
    if (m) documented.add(m[1]);
  }

  const emitted = new Set(entries.map((e) => e.key));
  const warnings = [];

  for (const key of documented) {
    if (!emitted.has(key) && !OPTIONAL.has(key)) {
      warnings.push(`${key} is documented in .env.example but not emitted here`);
    }
  }
  for (const key of emitted) {
    if (!documented.has(key)) {
      warnings.push(`${key} is emitted here but missing from .env.example`);
    }
  }
  return warnings;
}

/** Merge in any keys the user already had that we do not manage. */
export function preserveUnmanaged(existingText, entries) {
  const managed = new Set(entries.map((e) => e.key));
  return existingText
    .split("\n")
    .filter((l) => {
      const m = l.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/);
      return m ? !managed.has(m[1]) : false;
    })
    .filter((l) => l.trim());
}
