import { build } from "esbuild";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What the browser entry point is allowed to drag in with it.
 *
 * The split between loading and use — fonts registered rather than imported, a
 * rasterizer registered rather than imported — exists so that the document
 * model, the surfaces, the renderer and the scorer contain no Node and no
 * provider SDK, which is what lets the whole surface layer run in a browser.
 * Nothing enforced it, and the failure is quiet in the worst way: esbuild
 * happily bundles `@ai-sdk/anthropic` for the browser, the output grows by a
 * few KB, and the page throws on load reading a property of undefined.
 *
 * That is exactly how it broke: `scoreRun` needed to know whether the judge's
 * model had a price, reached for the model registry to ask, and pulled six
 * provider SDKs into the page through one type-level question. The answer now
 * rides on the judge's own result. This test is the guard.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * What must not be in the bundle.
 *
 * The packages are the symptom, and naming only them would let this pass the
 * day the agent loop stops importing an SDK directly. The modules below are
 * the cause: the loop, the model registry and the judge belong to whatever
 * *drives* the bench, not to the bench itself, and the page drives it over
 * WebMCP precisely so it needs none of them. `models.ts` earns its line —
 * reaching into it for one boolean is how six provider SDKs got in.
 *
 * `src/agent/events.ts` is deliberately absent: it is types and one string
 * predicate, with nothing behind it, so there is no reason the page should not
 * name a stop reason.
 */
const FORBIDDEN = [
  /^node_modules\/ai\//,
  /^node_modules\/@ai-sdk\//,
  /^node_modules\/@resvg\//,
  /^src\/agent\/loop\.ts$/,
  /^src\/agent\/models\.ts$/,
  /^src\/eval\/judge\.ts$/,
];

describe("the browser bundle", () => {
  it("pulls in no provider SDK, no agent loop and no Node-only renderer", async () => {
    const result = await build({
      entryPoints: [join(root, "src", "webmcp", "page.ts")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
      logLevel: "silent",
      metafile: true,
    });

    const inputs = Object.keys(result.metafile.inputs).map((f) => relative(".", f));
    const offenders = inputs.filter((f) => FORBIDDEN.some((re) => re.test(f)));

    expect(
      offenders,
      `The browser entry point reached a Node-only or provider module. The import chain into the ` +
        `first of these is what to look at:\n  ${offenders.slice(0, 5).join("\n  ")}`,
    ).toEqual([]);

    // Sanity: the bench itself really is in there, so a bundle that failed to
    // resolve anything cannot pass this test by being empty.
    expect(inputs).toContain(join("src", "eval", "score.ts"));
    expect(inputs).toContain(join("src", "surfaces", "index.ts"));
  });

  it("uses no Node builtins", async () => {
    const result = await build({
      entryPoints: [join(root, "src", "webmcp", "page.ts")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
      logLevel: "silent",
      metafile: true,
    });

    const imported = Object.values(result.metafile.inputs)
      .flatMap((input) => input.imports.map((i) => i.path))
      .filter((path) => path.startsWith("node:"));

    expect([...new Set(imported)]).toEqual([]);
  });
});
