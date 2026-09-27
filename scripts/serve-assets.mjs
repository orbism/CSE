#!/usr/bin/env node
/**
 * Static asset server for the localhost loop.
 *
 * Serves the generated collection and the built art bundle in the shape the
 * site and the contract expect:
 *
 *   /metadata/<id>.json   <- contract baseURI points here
 *   /images/<id>.png
 *   /art/index.html       <- animation_url
 *   /tokens.json          <- gallery index
 *
 * CORS is wide open because this only ever runs against a local anvil node.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.CSE_ASSET_PORT ?? 8788);
const COLLECTION = process.env.CSE_COLLECTION_DIR ?? join(ROOT, "out/collection");
const ART = join(ROOT, "packages/art/dist");

const TYPES = {
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

/** Map a request path to a file, refusing anything that escapes its root. */
function resolveTarget(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  if (clean.startsWith("/art/")) {
    const rel = clean.slice("/art/".length) || "index.html";
    return join(ART, rel);
  }
  if (clean === "/art" || clean === "/art/") return join(ART, "index.html");
  return join(COLLECTION, clean.replace(/^\/+/, ""));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const target = resolveTarget(url.pathname);
  const root = target.startsWith(ART) ? ART : COLLECTION;

  if (!resolve(target).startsWith(resolve(root))) {
    res.writeHead(403).end("forbidden");
    return;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("not a file");
    res.writeHead(200, {
      "content-type": TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
      "content-length": info.size,
      "access-control-allow-origin": "*",
      "cache-control": "no-cache",
    });
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, { "access-control-allow-origin": "*" }).end("not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`assets  http://127.0.0.1:${PORT}`);
  console.log(`  collection ${COLLECTION}`);
  console.log(`  art        ${ART}`);
});
