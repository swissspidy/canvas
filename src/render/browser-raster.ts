/**
 * The browser rasterizer: SVG -> PNG through a canvas.
 *
 * The counterpart to resvg in Node, and the reason the screenshot feedback
 * conditions are not a server-only feature. An SVG is drawn into an `<img>`,
 * painted onto a canvas and read back as PNG bytes.
 *
 * The one thing that has to be right is the font. An SVG loaded as an image is
 * an isolated document: it cannot reach the host page's stylesheets, so a
 * `font-family` reference alone would paint in whatever fallback the browser
 * picks. The face is therefore inlined into the SVG as a data URI, which makes
 * it self-contained. Layout is unaffected either way — every line is already
 * pinned to its computed width with `textLength` — but the screenshot the agent
 * sees should be the document the scorer measured, in the same typeface.
 */

import type { Doc } from "../doc/types.js";
import { renderSvg, standaloneFontCss } from "./svg.js";
import { DEFAULT_SCREENSHOT_WIDTH, fitPixelWidth, setRasterizer, type RasterOptions } from "./rasterizer.js";

/** Cached because base64-encoding two font faces per screenshot is wasteful. */
export interface BrowserRasterOptions extends RasterOptions {
  /**
   * Inline the font face into the SVG. On by default and effectively always
   * wanted; `false` exists so a test can prove embedding actually changes what
   * is painted, which is the whole question about SVG-in-an-`<img>`.
   */
  embedFont?: boolean;
}

export async function rasterizeInBrowser(doc: Doc, opts: BrowserRasterOptions = {}): Promise<Uint8Array> {
  const svg = renderSvg(doc, { ...opts, ...(opts.embedFont === false ? {} : { fontCss: standaloneFontCss() }) });
  // Reduced if the canvas is tall enough that the full width would blow the
  // pixel budget; see `fitPixelWidth`.
  const pixelWidth = fitPixelWidth(doc, opts.pixelWidth);
  const pixelHeight = Math.max(1, Math.round((pixelWidth * doc.height) / doc.width));

  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The browser could not decode the rendered SVG."));
      image.src = url;
    });
    // `decode()` waits for the embedded font too; `onload` alone can fire
    // before the face is applied, which would capture a fallback typeface.
    if (typeof image.decode === "function") await image.decode().catch(() => undefined);

    const canvas = document.createElement("canvas");
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get a 2d canvas context.");
    ctx.drawImage(image, 0, 0, pixelWidth, pixelHeight);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("canvas.toBlob produced nothing.");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Install it. Call once, after the fonts are registered. */
export function installBrowserRasterizer(): void {
  setRasterizer(rasterizeInBrowser);
}
