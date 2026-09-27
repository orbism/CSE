import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Load the repo-root .env into process.env, synchronously, before anything
 * reads configuration.
 *
 * Imported for its side effect at the top of every generator entrypoint. pnpm
 * does not load .env files, so without this `CSE_MASTER_SEED` and the
 * `FOUREVERLAND_*` credentials sat in .env being quietly ignored — the upload
 * step failed as "missing 4EVERLAND config" with the keys right there on disk,
 * and a custom master seed was honoured by the deploy script but not by the
 * generator that actually built the collection.
 *
 * Real environment variables take precedence over the file.
 */
export function loadRootEnv(path = join(ROOT, ".env")): boolean {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return false;
  }

  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (value && process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
  return true;
}

loadRootEnv();
