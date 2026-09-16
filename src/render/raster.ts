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
import { renderSvg, type RenderOptions } from "./svg.js";
import { FONT_DIR, FONT_FAMILY, FONT_FILES } from "../text/fonts.js";
import { join } from "node:path";

export interface RasterOptions extends RenderOptions {
  /**
   * Width of the PNG in pixels. Screenshots sent to the model are downscaled
   * from canvas units; a 1080-wide canvas at 768px is comfortably inside the
   * API's image budget while staying legible.
   */
  pixelWidth?: number;
}

export const DEFAULT_SCREENSHOT_WIDTH = 768;

const fontFiles = [
  join(FONT_DIR, FONT_FILES.regular),
  join(FONT_DIR, FONT_FILES.bold),
];

export function rasterize(doc: Doc, opts: RasterOptions = {}): Buffer {
  const svg = renderSvg(doc, opts);
  return rasterizeSvg(svg, opts.pixelWidth ?? DEFAULT_SCREENSHOT_WIDTH);
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
