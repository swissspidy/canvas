/**
 * Bundle the browser entry points.
 *
 * The main live page needs no build — it is plain ES modules talking to a
 * server. The WebMCP host does, because it runs the whole bench (document
 * model, surfaces, renderer, scorer) in the browser and therefore has to
 * bundle the TypeScript source.
 *
 * Output is gitignored; `npm run serve` builds before starting.
 */
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "web", "dist");
mkdirSync(outdir, { recursive: true });

const minify = process.argv.includes("--minify");

const result = await build({
  entryPoints: [join(root, "src", "webmcp", "page.ts")],
  outfile: join(outdir, "webmcp.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: !minify,
  minify,
  logLevel: "info",
  metafile: true,
});

const [, script] = Object.entries(result.metafile.outputs).find(([file]) => file.endsWith(".js")) ?? [];
console.log(`web/dist/webmcp.js — ${((script?.bytes ?? 0) / 1024).toFixed(0)}KB${minify ? " (minified)" : ""}`);
