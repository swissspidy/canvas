/**
 * Where the SVG-to-PNG implementation is registered.
 *
 * The same split as fonts, for the same reason. Rasterizing needs a native
 * library in Node, and the feedback channel is the only thing that wants it —
 * so the channel asks a registry rather than importing resvg, and the document
 * model, surfaces, scorer and renderer stay free of Node.
 *
 * In a browser no rasterizer is registered, and the screenshot feedback
 * conditions therefore fail loudly rather than silently degrading to text. A
 * feedback condition that quietly stopped sending screenshots would corrupt
 * the variable the study is built around; refusing to start is the correct
 * behaviour.
 */

import type { Doc } from "../doc/types.js";
import type { RenderOptions } from "./svg.js";

export interface RasterOptions extends RenderOptions {
  /** Width of the PNG in pixels. */
  pixelWidth?: number;
}

export type Rasterizer = (doc: Doc, opts: RasterOptions) => Uint8Array;

export const DEFAULT_SCREENSHOT_WIDTH = 768;

let rasterizer: Rasterizer | null = null;

export function setRasterizer(fn: Rasterizer | null): void {
  rasterizer = fn;
}

export function hasRasterizer(): boolean {
  return rasterizer !== null;
}

export function rasterizeDoc(doc: Doc, opts: RasterOptions = {}): Uint8Array {
  if (!rasterizer) {
    throw new Error(
      "No rasterizer registered, so screenshots are unavailable. " +
        "In Node, import 'src/render/raster.js' once to install the resvg backend. " +
        "In a browser there is none, so the screenshot feedback conditions cannot run there.",
    );
  }
  return rasterizer(doc, opts);
}
