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
    expect(svg).toContain('<linearGradient id="grad-t"');
    expect(svg).toContain('fill="url(#grad-t)"');
  });
});
