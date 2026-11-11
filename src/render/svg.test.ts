import { describe, expect, it } from "vitest";
import { renderSvg } from "./svg.js";
import type { Doc, Element } from "../doc/types.js";

function doc(...elements: Element[]): Doc {
  return { width: 1000, height: 1000, background: "#ffffff", elements };
}

describe("renderSvg gradients", () => {
  // The scorer reads a text block's fill as a gradient when it has a fillTo,
  // so the reader has to see one too.
  it("draws a text block's fill as a gradient, as it does a rect's", () => {
    const text: Element = {
      id: "t",
      type: "text",
      x: 0,
      y: 0,
      width: 400,
      height: 200,
      rotation: 0,
      z: 0,
      text: "Hi",
      style: { fontSize: 40, fill: "transparent", fillTo: "#000000" },
    };
    const svg = renderSvg(doc(text));
    expect(svg).toContain('<linearGradient id="fill_0"');
    expect(svg).toContain('fill="url(#fill_0)"');
  });
});

describe("renderSvg and what is off the canvas", () => {
  // A text or image element far outside the view box makes resvg abort the
  // process, so it must not reach the SVG at all.
  it("leaves out an element that is wholly off the canvas, and keeps one that reaches it", async () => {
    const far: Element = { id: "far", type: "text", x: 100, y: 4200, width: 300, height: 100, rotation: 0, z: 0, text: "Far", style: {} };
    const edge: Element = { id: "edge", type: "text", x: 900, y: 950, width: 300, height: 100, rotation: 0, z: 1, text: "Edge", style: {} };
    const svg = renderSvg(doc(far, edge));
    expect(svg).not.toContain('data-id="far"');
    expect(svg).toContain('data-id="edge"');
    const { rasterizeDoc } = await import("./rasterizer.js");
    expect((await rasterizeDoc(doc(far, edge), { pixelWidth: 100 })).length).toBeGreaterThan(0);
  });
});
