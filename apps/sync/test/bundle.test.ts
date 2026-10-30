import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-expect-error -- a plain .mjs helper shared with scripts/build-api.mjs
import { bundleHash, sourceHash } from "../../../scripts/source-hash.mjs";

// The function Vercel runs is api/index.mjs, built from apps/sync/src and
// packages/shared/src. Vercel rebuilds it on every deploy, and the committed
// copy has to keep up too: for six days in Oct 2026 the deploy shipped a copy
// nobody had rebuilt, and two commits never went live. This fails the moment
// the source moves without `npm run build:api`.
test("the committed bundle was built from the current source", () => {
  const bundle = readFileSync(new URL("../../../api/index.mjs", import.meta.url), "utf8");
  const baked = bundleHash(bundle);
  assert.ok(baked, "api/index.mjs carries no source fingerprint on its first line: run npm run build:api");
  assert.equal(baked, sourceHash(), "api/index.mjs is older than its source: run npm run build:api and commit it");
});
