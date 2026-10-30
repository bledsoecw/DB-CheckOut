// Bundles the sync server into a single self-contained ESM file
// (api/index.mjs) — no TypeScript or module resolution happens in the
// function itself. Vercel runs this as the build command on every deploy
// (vercel.json), so a deploy always carries the source it was made from;
// the committed copy is rebuilt with it too, and test/bundle.test.ts fails
// when that copy falls behind the source.
//
// The bundle records what it was built from, and GET /health reports it:
// `source` (the fingerprint in source-hash.mjs), `on` ("vercel" when Vercel
// built it, "local" for the committed copy) and `commit` (Vercel's).
import { build } from "esbuild";
import { sourceHash } from "./source-hash.mjs";

const stamp = {
  source: sourceHash(),
  on: process.env.VERCEL ? "vercel" : "local",
  commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || null,
};

await build({
  entryPoints: ["apps/sync/src/vercel-entry.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "api/index.mjs",
  sourcemap: false,
  logLevel: "info",
  define: { __CLOSEOUT_BUILD__: JSON.stringify(stamp) },
  banner: {
    js: `// GENERATED FILE — do not edit. Source: apps/sync/src/*. Rebuild: npm run build:api · source ${stamp.source}`,
  },
});
console.log(`api/index.mjs · source ${stamp.source} · built ${stamp.on}${stamp.commit ? " · " + stamp.commit : ""}`);
