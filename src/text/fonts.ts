/**
 * The Node font loader.
 *
 * Importing this module installs a synchronous disk loader into the registry,
 * so anything on the server side gets fonts without thinking about it. It is
 * the *only* module in the layout/render/surface path that touches Node, which
 * is what lets the rest of it bundle for a browser unchanged.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FontWeight } from "../doc/types.js";
import { FONT_FILES, setFontLoader } from "./font-registry.js";

const here = dirname(fileURLToPath(import.meta.url));
export const FONT_DIR = join(here, "..", "..", "assets", "fonts");

/** Raw bytes, for the rasterizer and for serving to the live page. */
export function fontBytes(weight: FontWeight = "regular"): Buffer {
  return readFileSync(join(FONT_DIR, FONT_FILES[weight]));
}

setFontLoader((weight) => new Uint8Array(fontBytes(weight)));

export { FONT_FAMILY, FONT_FILES, getFont, hasFont, registerFontBytes, resetFonts } from "./font-registry.js";
