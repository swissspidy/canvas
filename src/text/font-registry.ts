/**
 * Where parsed font metrics live. Platform-neutral on purpose.
 *
 * The layout engine, the SVG renderer, the checks and every tool surface are
 * otherwise free of Node: they are pure functions over a document. Reading the
 * font off disk was the single thing tying them to a server, which mattered
 * the moment the question came up of running the tool surfaces *in the
 * browser* — as WebMCP tools, say, driven by someone else's harness.
 *
 * So loading is split from use. This module holds the metrics and knows
 * nothing about where the bytes came from. `fonts.ts` is the Node loader that
 * reads them off disk; a browser registers them from a `fetch`.
 */

import { parseFont, type FontMetrics } from "./ttf.js";
import type { FontWeight } from "../doc/types.js";

/** The family name written into rendered SVG. */
export const FONT_FAMILY = "Canvas Sans";

/**
 * Subsetted Liberation Sans — see `scripts/subset-fonts.py`. Only the
 * characters the task set and a typed brief are likely to use, which takes the
 * pair from ~825KB to ~111KB without moving a single advance width.
 */
export const FONT_FILES: Record<FontWeight, string> = {
  regular: "LiberationSans-Regular.ttf",
  bold: "LiberationSans-Bold.ttf",
};

const parsed = new Map<FontWeight, FontMetrics>();

/** A synchronous source of font bytes, installed by the platform loader. */
export type FontLoader = (weight: FontWeight) => Uint8Array;

let loader: FontLoader | null = null;

/** Install a synchronous loader. `fonts.ts` does this for Node on import. */
export function setFontLoader(fn: FontLoader | null): void {
  loader = fn;
}

/** Register already-fetched font bytes. The browser path. */
export function registerFontBytes(weight: FontWeight, bytes: Uint8Array): FontMetrics {
  const metrics = parseFont(bytes, FONT_FAMILY);
  parsed.set(weight, metrics);
  return metrics;
}

export function hasFont(weight: FontWeight): boolean {
  return parsed.has(weight);
}

/**
 * Metrics for a weight. Synchronous, because line breaking happens deep inside
 * pure layout code that has no business being async.
 */
export function getFont(weight: FontWeight = "regular"): FontMetrics {
  const hit = parsed.get(weight);
  if (hit) return hit;

  if (loader) return registerFontBytes(weight, loader(weight));

  throw new Error(
    `No font registered for weight '${weight}'. ` +
      `In Node, import 'src/text/fonts.js' once to install the disk loader. ` +
      `In a browser, fetch ${FONT_FILES[weight]} and call registerFontBytes('${weight}', bytes).`,
  );
}

/** Drop everything. Tests only. */
export function resetFonts(): void {
  parsed.clear();
}
