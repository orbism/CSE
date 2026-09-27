/**
 * 4EVERLAND IPFS upload.
 *
 * Ordering matters: the metadata embeds the art-bundle and image CIDs, so it
 * cannot be pinned until those exist. The pipeline writes metadata with
 * PENDING_* placeholders and this step rewrites them before the final pass.
 *
 *   1. art bundle   (packages/art/dist)  -> artCID
 *   2. images       (out/collection/images) -> imagesCID
 *   3. rewrite metadata with the real CIDs
 *   4. metadata     -> metadataCID   <- this becomes the contract's baseURI
 *
 * env:
 *   FOUREVERLAND_KEY / FOUREVERLAND_SECRET   S3 credentials from the dashboard
 *   FOUREVERLAND_BUCKET                      an IPFS-type bucket
 *   FOUREVERLAND_ENDPOINT                    default https://endpoint.4everland.co
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const ENDPOINT = process.env.FOUREVERLAND_ENDPOINT ?? "https://endpoint.4everland.co";
const BUCKET = process.env.FOUREVERLAND_BUCKET ?? "";
const GATEWAY = process.env.CSE_IPFS_GATEWAY ?? "https://4everland.io/ipfs";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".html": "text/html",
  ".txt": "text/plain",
  ".js": "application/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
};

export function client(): S3Client {
  const accessKeyId = process.env.FOUREVERLAND_KEY;
  const secretAccessKey = process.env.FOUREVERLAND_SECRET;
  if (!accessKeyId || !secretAccessKey || !BUCKET) {
    throw new Error(
      "missing 4EVERLAND config: set FOUREVERLAND_KEY, FOUREVERLAND_SECRET and FOUREVERLAND_BUCKET",
    );
  }
  return new S3Client({
    endpoint: ENDPOINT,
    region: "us-west-2",
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

/**
 * 4EVERLAND reports a pinned object's CID in two places, and a PUT response is
 * neither of them — it carries no `x-amz-meta-*` at all, so reading the CID
 * back from the upload call always yielded undefined.
 *
 *   - ListObjectsV2 puts the CID in `ETag` (not an MD5, as on real S3)
 *   - HeadObject exposes it as `Metadata["ipfs-hash"]`
 *
 * The list is what `uploadDir` uses: one call per thousand objects instead of
 * a HEAD per file, which matters at 512 images.
 */
const isCID = (s: string) => /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/.test(s);

const unquote = (s: string) => s.replace(/^"|"$/g, "");

function cidOf(res: { Metadata?: Record<string, string> } | undefined): string | undefined {
  return res?.Metadata?.["ipfs-hash"] ?? res?.Metadata?.cid;
}

/** Per-file CIDs for everything under `prefix/`, keyed by file name. */
async function listCIDs(s3: S3Client, prefix: string): Promise<Record<string, string>> {
  const cids: Record<string, string> = {};
  let ContinuationToken: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${prefix}/`, ContinuationToken }),
    );
    for (const o of page.Contents ?? []) {
      // a key ending in "/" is a folder marker, not one of our files
      if (!o.Key || !o.ETag || o.Key.endsWith("/")) continue;
      const tag = unquote(o.ETag);
      if (isCID(tag)) cids[basename(o.Key)] = tag;
    }
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return cids;
}

async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const wait = 500 * 2 ** i;
      process.stderr.write(`  retry ${i + 1}/${tries} ${label}: ${String(e)} (${wait}ms)\n`);
      await new Promise((ok) => setTimeout(ok, wait));
    }
  }
  throw lastError;
}

export interface UploadedDir {
  prefix: string;
  files: number;
  bytes: number;
  /** Per-file CIDs, keyed by file name. */
  cids: Record<string, string>;
  /** Directory CID, when 4EVERLAND reports one for the prefix. */
  directoryCID?: string;
}

/**
 * Upload every file in `dir` under `prefix/`. Concurrency is bounded because
 * the full run is hundreds of multi-megabyte PNGs and the endpoint will throttle.
 *
 * Directory CIDs come from a dashboard snapshot, so a full pin takes more than
 * one run of this. Anything already pinned under the prefix is skipped rather
 * than re-sent, which keeps the second and third passes near-instant; `force`
 * re-uploads regardless, for when the local files have actually changed.
 */
export async function uploadDir(
  s3: S3Client,
  dir: string,
  prefix: string,
  { concurrency = 8, force = false }: { concurrency?: number; force?: boolean } = {},
): Promise<UploadedDir> {
  const names = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => e.name);

  const already = force ? {} : await listCIDs(s3, prefix);
  const pending = names.filter((n) => !already[n]);
  if (pending.length < names.length) {
    process.stdout.write(`  ${prefix}: ${names.length - pending.length} already pinned, skipping\n`);
  }

  let bytes = 0;
  let done = 0;

  const queue = [...pending];
  const worker = async () => {
    for (;;) {
      const name = queue.shift();
      if (!name) return;
      const body = await readFile(join(dir, name));
      bytes += body.length;
      await withRetry(`${prefix}/${name}`, () =>
        s3.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: `${prefix}/${name}`,
            Body: body,
            ContentType: CONTENT_TYPES[extname(name).toLowerCase()] ?? "application/octet-stream",
          }),
        ),
      );
      if (++done % 50 === 0 || done === pending.length) {
        process.stdout.write(`  ${prefix}: ${done}/${pending.length}\n`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  // The PUT responses carry no CID, so read them back off the listing.
  const cids = await listCIDs(s3, prefix);
  const missing = names.filter((n) => !cids[n]);
  if (missing.length) {
    process.stderr.write(
      `  warning: no CID reported for ${missing.length}/${names.length} in ${prefix}` +
        ` (e.g. ${missing.slice(0, 3).join(", ")})\n`,
    );
  }

  // Ask for the directory CID. 4EVERLAND exposes it on the prefix once every
  // child is pinned; if it does not, the caller has to supply it manually
  // rather than us guessing a CID that would silently break every token.
  let directoryCID: string | undefined;
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: prefix }));
    directoryCID = head.Metadata?.cid ?? cidOf(head);
  } catch {
    directoryCID = undefined;
  }

  return { prefix, files: names.length, bytes, cids, directoryCID };
}

/** Fetch a sample back through the gateway and compare bytes. */
export async function verify(
  dirCID: string,
  dir: string,
  names: string[],
): Promise<{ checked: number; failures: string[] }> {
  const failures: string[] = [];
  for (const name of names) {
    const url = `${GATEWAY}/${dirCID}/${name}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        failures.push(`${name}: HTTP ${res.status}`);
        continue;
      }
      const got = Buffer.from(await res.arrayBuffer());
      const want = await readFile(join(dir, basename(name)));
      if (!got.equals(want)) failures.push(`${name}: content mismatch`);
    } catch (e) {
      failures.push(`${name}: ${String(e)}`);
    }
  }
  return { checked: names.length, failures };
}

/** Replace the PENDING_* placeholders in every metadata file. */
export async function rewriteMetadata(
  metadataDir: string,
  artCID: string,
  imagesCID: string,
): Promise<number> {
  const names = (await readdir(metadataDir)).filter((n) => n.endsWith(".json"));
  for (const name of names) {
    const path = join(metadataDir, name);
    const text = await readFile(path, "utf8");
    const next = text
      .replaceAll("PENDING_ART_CID", artCID)
      .replaceAll("PENDING_IMAGES_CID", imagesCID);
    if (next !== text) await writeFile(path, next);
  }
  return names.length;
}
