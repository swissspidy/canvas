/**
 * SVG -> PNG. This is the screenshot the agent sees under the screenshot
 * feedback conditions, and the image the judge scores.
 *
 * resvg rather than a headless browser: a run sweeps hundreds of renders, and
 * a per-render browser round trip would dominate wall-clock. Text metrics do
 * not depend on the rasterizer — `src/text/layout.ts` already fixed every line
 * break and pinned each run's width with `textLength` — so resvg only paints
 * glyphs into positions that were decided elsewhere.
 */

import { Resvg } from "@resvg/resvg-js";
import type { Doc } from "../doc/types.js";
import { renderSvg } from "./svg.js";
import { FONT_DIR, FONT_FAMILY, FONT_FILES } from "../text/fonts.js";
import { join } from "node:path";
import { DEFAULT_SCREENSHOT_WIDTH, fitPixelWidth, setRasterizer, type RasterOptions } from "./rasterizer.js";

export { DEFAULT_SCREENSHOT_WIDTH, type RasterOptions };

const fontFiles = [
  join(FONT_DIR, FONT_FILES.regular),
  join(FONT_DIR, FONT_FILES.bold),
];

export function rasterize(doc: Doc, opts: RasterOptions = {}): Buffer {
  const svg = renderSvg(doc, opts);
  // A tall, thin canvas turns a modest width into an enormous height, so the
  // width is reduced until the output fits the pixel budget.
  return rasterizeSvg(svg, fitPixelWidth(doc, opts.pixelWidth));
}

export function rasterizeSvg(svg: string, pixelWidth: number): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: Math.max(1, Math.round(pixelWidth)) },
    font: {
      fontFiles,
      loadSystemFonts: false,
      defaultFontFamily: FONT_FAMILY,
    },
  });
  return Buffer.from(resvg.render().asPng());
}

export function toDataUri(png: Buffer): string {
  return `data:image/png;base64,${png.toString("base64")}`;
}

// Importing this module is what makes screenshots available on the server.
setRasterizer((doc, opts) => rasterize(doc, opts));
