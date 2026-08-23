// Bundles the sync server into a single self-contained ESM file that Vercel
// deploys as-is (api/index.mjs) — no TypeScript or module resolution happens
// on Vercel's side. Run by the buildCommand in vercel.json.
import { build } from "esbuild";

await build({
  entryPoints: ["apps/sync/src/vercel-entry.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "api/index.mjs",
  sourcemap: false,
  logLevel: "info",
});
