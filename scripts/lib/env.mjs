import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Load the repo-root .env into process.env.
 *
 * Real environment variables always win, so `FOO=bar pnpm …` overrides the file
 * and CI never has its secrets shadowed by a stray checked-out .env.
 *
 * Every entrypoint that reads configuration must call this. It used to be
 * called only by the deploy script, which meant CSE_MASTER_SEED in .env was
 * honoured when deploying but ignored when generating — so the site would be
 * told to render one seed while the collection had been built from another.
 */
export async function loadRootEnv(path = join(ROOT, ".env")) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return false; // no .env is fine; the vars may come from the shell
  }

  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (value && process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
  return true;
}
