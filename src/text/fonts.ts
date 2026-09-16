/**
 * Font registry. Two weights of one family, vendored into the repo so that
 * layout is byte-identical on every machine that clones it.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFont, type FontMetrics } from "./ttf.js";
import type { FontWeight } from "../doc/types.js";

const here = dirname(fileURLToPath(import.meta.url));
export const FONT_DIR = join(here, "..", "..", "assets", "fonts");

/** The family name written into rendered SVG; see `src/render/svg.ts`. */
export const FONT_FAMILY = "Canvas Sans";

export const FONT_FILES: Record<FontWeight, string> = {
  regular: "LiberationSans-Regular.ttf",
  bold: "LiberationSans-Bold.ttf",
};

const cache = new Map<FontWeight, FontMetrics>();

export function getFont(weight: FontWeight = "regular"): FontMetrics {
  const hit = cache.get(weight);
  if (hit) return hit;
  const file = join(FONT_DIR, FONT_FILES[weight]);
  const parsed = parseFont(new Uint8Array(readFileSync(file)), FONT_FAMILY);
  cache.set(weight, parsed);
  return parsed;
}

/** Raw bytes, for the live page's `@font-face` and for the rasterizer. */
export function fontBytes(weight: FontWeight = "regular"): Buffer {
  return readFileSync(join(FONT_DIR, FONT_FILES[weight]));
}
