/**
 * Pin the collection to 4EVERLAND.
 *
 *   pnpm upload                      # stage 1 — art, images, svg
 *   CSE_IMAGES_CID=… pnpm upload     # stage 2 — rewrite + pin metadata
 *   CSE_IMAGES_CID=… CSE_METADATA_CID=… pnpm upload   # stage 3 — write upload.json
 *   pnpm upload -- --dry-run
 *
 * Why three stages: a directory CID on 4EVERLAND only exists once you take a
 * Snapshot of the folder in the dashboard, and there is no S3 or HTTP API for
 * it. So each stage uploads what it can, then stops and tells you which folder
 * to snapshot and which variable to set on the next run. Re-running is cheap —
 * anything already pinned is skipped, not re-sent.
 *
 * The ordering is forced: metadata embeds the art and image CIDs, so it cannot
 * be pinned until those are known.
 *
 * On success it writes out/collection/upload.json and prints the baseURI to
 * pass to the SetBaseURI script.
 */

// side effect: loads the repo-root .env before any config is read
import "./env.js";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { client, rewriteMetadata, uploadDir, verify } from "./upload.js";

const has = (n: string) => process.argv.includes(`--${n}`);
const flag = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const OUT = resolve(process.cwd(), flag("out") ?? "../../out/collection");
const ART_DIST = resolve(process.cwd(), "../art/dist");
const BUCKET = process.env.FOUREVERLAND_BUCKET ?? "";
const force = has("force");

const dirs = {
  art: ART_DIST,
  images: resolve(OUT, "images"),
  svg: resolve(OUT, "svg"),
  metadata: resolve(OUT, "metadata"),
};

if (has("dry-run")) {
  for (const [name, dir] of Object.entries(dirs)) {
    const files = await readdir(dir).catch(() => []);
    console.log(`${name.padEnd(9)} ${String(files.length).padStart(5)} files  ${dir}`);
  }
  console.log("\ndry run — nothing uploaded");
  process.exit(0);
}

/**
 * Stop with instructions rather than an error. A missing directory CID is the
 * expected state between stages, not a failure — the only way to get one is to
 * go and click Snapshot.
 */
function needSnapshot(folder: string, variable: string, alsoSet: string[] = []): never {
  const vars = [...alsoSet, `${variable}=<cid>`].join(" ");
  console.log(`
─── snapshot needed ───

  1. open  https://dashboard.4everland.org/bucket/${BUCKET}
  2. select the folder  ${folder}  and click  Snapshot
  3. copy the CID it produces, then re-run:

       ${vars} pnpm upload

  (already-pinned files are skipped, so this is fast)
`);
  process.exit(0);
}

const s3 = client();

// 1. art bundle — a single index.html, so its own file CID is the art CID
console.log("uploading art bundle…");
const art = await uploadDir(s3, dirs.art, "cse/art", { force });
const artCID = process.env.CSE_ART_CID ?? art.directoryCID ?? art.cids["index.html"];
if (!artCID) throw new Error("could not resolve the art CID; set CSE_ART_CID explicitly");
console.log(`  artCID ${artCID}`);

// 2. images
console.log("uploading images…");
const images = await uploadDir(s3, dirs.images, "cse/images", { force });
const imagesCID = process.env.CSE_IMAGES_CID ?? images.directoryCID;

// 3. svg masters (not referenced by metadata, pinned for provenance)
console.log("uploading svg masters…");
const svg = await uploadDir(s3, dirs.svg, "cse/svg", { force });

if (!imagesCID) needSnapshot("cse/images", "CSE_IMAGES_CID");

// 4. rewrite metadata, then pin it
console.log("rewriting metadata with real CIDs…");
const rewritten = await rewriteMetadata(dirs.metadata, artCID, imagesCID);
console.log(`  ${rewritten} files`);

// The rewrite changes file contents, so any metadata pinned under an older CID
// pair is stale — always re-send this one.
console.log("uploading metadata…");
const metadata = await uploadDir(s3, dirs.metadata, "cse/metadata", { force: true });
const metadataCID = process.env.CSE_METADATA_CID ?? metadata.directoryCID;

if (!metadataCID) {
  needSnapshot("cse/metadata", "CSE_METADATA_CID", [`CSE_IMAGES_CID=${imagesCID}`]);
}

// 5. verify a sample actually resolves through the gateway
console.log("verifying a sample through the gateway…");
const sample = ["1.png", "2.png", "500.png"];
const check = await verify(imagesCID, dirs.images, sample);
if (check.failures.length) {
  console.error(`  ${check.failures.length}/${check.checked} failed:`);
  for (const f of check.failures) console.error(`    ${f}`);
} else {
  console.log(`  ${check.checked}/${check.checked} verified`);
}

const result = {
  artCID,
  imagesCID,
  svgCID: svg.directoryCID,
  metadataCID,
  baseURI: `ipfs://${metadataCID}/`,
  counts: {
    art: art.files,
    images: images.files,
    svg: svg.files,
    metadata: metadata.files,
  },
  bytes: {
    art: art.bytes,
    images: images.bytes,
    svg: svg.bytes,
    metadata: metadata.bytes,
  },
  verified: check.failures.length === 0,
};

await writeFile(resolve(OUT, "upload.json"), JSON.stringify(result, null, 2));

console.log("\n─── pinned ───");
console.log(`art       ipfs://${artCID}/`);
console.log(`images    ipfs://${imagesCID}/`);
console.log(`metadata  ipfs://${metadataCID}/`);
console.log(`\nset the contract baseURI to:\n  ipfs://${metadataCID}/`);

// sanity: the metadata must no longer contain placeholders
const one = await readFile(resolve(dirs.metadata, "1.json"), "utf8");
if (one.includes("PENDING_")) {
  console.error("\nWARNING: metadata still contains PENDING placeholders");
  process.exit(1);
}
