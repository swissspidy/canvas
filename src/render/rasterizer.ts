/**
 * Where the SVG-to-PNG implementation is registered.
 *
 * The same split as fonts, for the same reason. Rasterizing needs a native
 * library in Node, and the feedback channel is the only thing that wants it —
 * so the channel asks a registry rather than importing resvg, and the document
 * model, surfaces, scorer and renderer stay free of Node.
 *
 * Two backends: resvg in Node (`raster.ts`) and a canvas in the browser
 * (`browser-raster.ts`). Neither is imported by the feedback channel, so the
 * document model, surfaces, scorer and renderer stay free of both Node and the
 * DOM.
 *
 * If nothing is registered, asking for a screenshot throws rather than quietly
 * returning text. A feedback condition that silently stopped sending
 * screenshots would corrupt the variable the study is built around.
 */

import type { Doc } from "../doc/types.js";
import type { RenderOptions } from "./svg.js";

export interface RasterOptions extends RenderOptions {
  /** Width of the PNG in pixels. */
  pixelWidth?: number;
}

/**
  * May be synchronous (resvg, in Node) or asynchronous (a canvas, in a
  * browser). The async case is why the feedback channel awaits its blocks.
  */
export type Rasterizer = (doc: Doc, opts: RasterOptions) => Uint8Array | Promise<Uint8Array>;

export const DEFAULT_SCREENSHOT_WIDTH = 768;

/**
 * Ceiling on the pixels a single screenshot may allocate.
 *
 * Roughly a 4K frame. The tasks here are all around 1080x1350, so nothing
 * legitimate comes close; the cap exists because the canvas is not fixed in
 * every path into the rasterizer. The live page takes width and height from a
 * query string, and a document need only be tall and thin — 16 x 8000, say —
 * for a 768px-wide render to work out at 768 x 384,000 and try to allocate a
 * gigabyte of RGBA.
 */
export const MAX_SCREENSHOT_PIXELS = 4096 * 2160;

/**
 * The pixel width to actually render at: what was asked for, reduced until the
 * output fits the budget. Scaling down beats refusing — the screenshot is what
 * the agent sees, and a smaller one is still a screenshot.
 */
export function fitPixelWidth(doc: Doc, requested = DEFAULT_SCREENSHOT_WIDTH): number {
  const wanted = Math.max(1, Math.round(requested));
  const aspect = doc.height > 0 && doc.width > 0 ? doc.height / doc.width : 1;
  const budgeted = Math.floor(Math.sqrt(MAX_SCREENSHOT_PIXELS / aspect));
  return Math.max(1, Math.min(wanted, budgeted));
}

let rasterizer: Rasterizer | null = null;

export function setRasterizer(fn: Rasterizer | null): void {
  rasterizer = fn;
}

export function hasRasterizer(): boolean {
  return rasterizer !== null;
}

export async function rasterizeDoc(doc: Doc, opts: RasterOptions = {}): Promise<Uint8Array> {
  if (!rasterizer) {
    throw new Error(
      "No rasterizer registered, so screenshots are unavailable. " +
        "In Node, import 'src/render/raster.js' for the resvg backend; " +
        "in a browser, 'src/render/browser-raster.js' for the canvas one.",
    );
  }
  return rasterizer(doc, opts);
}

/**
 * Base64 for image bytes, on either platform.
 *
 * `Buffer.toString("base64")` in Node, chunked `btoa` in a browser — chunked
 * because `String.fromCharCode(...bytes)` blows the argument limit on anything
 * bigger than a thumbnail.
 */
export function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
