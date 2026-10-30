// A fingerprint of the server's source: every .ts file the bundle can draw
// from, by path and content. build-api.mjs bakes it into api/index.mjs and
// GET /health reports it; test/bundle.test.ts fails when the committed bundle
// carries a different one, i.e. the source changed and nobody rebuilt.
// Line endings are normalized so a Windows checkout hashes the same.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIRS = ["apps/sync/src", "packages/shared/src"];

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

export function sourceHash(root = ROOT) {
  const files = DIRS.flatMap((d) => walk(join(root, d), [])).map((p) => relative(root, p).split(sep).join("/")).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file + "\0");
    hash.update(readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n") + "\0");
  }
  return hash.digest("hex").slice(0, 12);
}

/** The fingerprint a built bundle carries on its first line, or null. */
export function bundleHash(bundleText) {
  const m = /source ([0-9a-f]{12})/.exec(String(bundleText).split("\n", 1)[0]);
  return m ? m[1] : null;
}
