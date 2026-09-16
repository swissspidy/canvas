import { describe, expect, it } from "vitest";
import { getFont } from "./fonts.js";
import { largestFittingFontSize, layoutTextElement, measureText, wrapText } from "./layout.js";
import type { Element } from "../doc/types.js";

const font = getFont("regular");

function textEl(partial: Partial<Element> = {}): Element {
  return {
    id: "t",
    type: "text",
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    rotation: 0,
    z: 0,
    text: "Hello world",
    style: { fontSize: 20, lineHeight: 1.25 },
    ...partial,
  };
}

describe("font metrics", () => {
  it("parses the vendored font", () => {
    expect(font.unitsPerEm).toBe(2048);
    expect(font.ascender).toBeGreaterThan(0);
    expect(font.descender).toBeLessThan(0);
  });

  it("gives wider glyphs a larger advance", () => {
    expect(font.advanceOf("W".codePointAt(0)!)).toBeGreaterThan(font.advanceOf("i".codePointAt(0)!));
  });

  it("scales linearly with font size", () => {
    const at20 = measureText(font, "Hello", 20);
    const at40 = measureText(font, "Hello", 40);
    expect(at40).toBeCloseTo(at20 * 2, 6);
  });

  it("measures bold as wider than regular for the same string", () => {
    const bold = getFont("bold");
    expect(measureText(bold, "Hamburgefonstiv", 32)).toBeGreaterThan(
      measureText(font, "Hamburgefonstiv", 32),
    );
  });
});

describe("wrapText", () => {
  it("keeps a short string on one line", () => {
    const lines = wrapText("Hello world", { fontSize: 20, maxWidth: 1000, font });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe("Hello world");
  });

  it("wraps at word boundaries", () => {
    const lines = wrapText("the quick brown fox jumps over the lazy dog", {
      fontSize: 20,
      maxWidth: 100,
      font,
    });
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.text).not.toMatch(/^\s|\s$/);
  });

  it("honours hard line breaks", () => {
    const lines = wrapText("a\nb\nc", { fontSize: 20, maxWidth: 1000, font });
    expect(lines.map((l) => l.text)).toEqual(["a", "b", "c"]);
  });

  it("preserves empty paragraphs", () => {
    const lines = wrapText("a\n\nb", { fontSize: 20, maxWidth: 1000, font });
    expect(lines.map((l) => l.text)).toEqual(["a", "", "b"]);
  });

  it("does not break a single over-wide word", () => {
    const lines = wrapText("Supercalifragilistic", { fontSize: 40, maxWidth: 20, font });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.width).toBeGreaterThan(20);
  });

  it("never produces a line wider than maxWidth when words fit", () => {
    const lines = wrapText("aa bb cc dd ee ff gg hh ii jj kk ll", {
      fontSize: 20,
      maxWidth: 120,
      font,
    });
    for (const l of lines) expect(l.width).toBeLessThanOrEqual(120);
  });
});

describe("layoutTextElement", () => {
  it("reports no clipping when the text fits", () => {
    const layout = layoutTextElement(textEl());
    expect(layout.clipped).toBe(false);
    expect(layout.overflowX).toBe(0);
    expect(layout.overflowY).toBe(0);
  });

  it("detects vertical overflow", () => {
    const layout = layoutTextElement(
      textEl({ height: 30, text: "one two three four five six seven eight nine ten", width: 120 }),
    );
    expect(layout.overflowY).toBeGreaterThan(0);
    expect(layout.clipped).toBe(true);
    expect(layout.visibleLines).toBeLessThan(layout.lines.length);
  });

  it("detects horizontal overflow from an unbreakable word", () => {
    const layout = layoutTextElement(textEl({ width: 40, text: "Unbreakableword" }));
    expect(layout.overflowX).toBeGreaterThan(0);
    expect(layout.clipped).toBe(true);
  });

  it("insets the content box by padding", () => {
    const layout = layoutTextElement(textEl({ style: { fontSize: 20, padding: 25 } }));
    expect(layout.contentBox).toMatchObject({ x: 25, y: 25, width: 250, height: 150 });
  });

  it("centers the block for valign middle", () => {
    const top = layoutTextElement(textEl({ style: { fontSize: 20, valign: "top" } }));
    const middle = layoutTextElement(textEl({ style: { fontSize: 20, valign: "middle" } }));
    const bottom = layoutTextElement(textEl({ style: { fontSize: 20, valign: "bottom" } }));
    expect(middle.lines[0]!.top).toBeGreaterThan(top.lines[0]!.top);
    expect(bottom.lines[0]!.top).toBeGreaterThan(middle.lines[0]!.top);
    // Middle is exactly halfway.
    expect(middle.lines[0]!.top - top.lines[0]!.top).toBeCloseTo(
      (bottom.lines[0]!.top - top.lines[0]!.top) / 2,
      6,
    );
  });

  it("right-aligns by pushing lines to the content box edge", () => {
    const layout = layoutTextElement(textEl({ style: { fontSize: 20, align: "right" } }));
    const line = layout.lines[0]!;
    expect(line.x + line.width).toBeCloseTo(300, 6);
  });

  it("places the baseline inside the first line box", () => {
    const layout = layoutTextElement(textEl());
    const line = layout.lines[0]!;
    expect(line.baseline).toBeGreaterThan(line.top);
    expect(line.baseline).toBeLessThan(line.top + layout.lineHeightPx);
  });
});

describe("largestFittingFontSize", () => {
  it("finds a size that fits and one point larger that does not", () => {
    const el = textEl({
      width: 200,
      height: 100,
      text: "Fit this headline into the box without clipping",
    });
    const size = largestFittingFontSize(el)!;
    expect(size).toBeGreaterThan(0);
    expect(layoutTextElement({ ...el, style: { ...el.style, fontSize: size } }).clipped).toBe(false);
    expect(layoutTextElement({ ...el, style: { ...el.style, fontSize: size + 1 } }).clipped).toBe(true);
  });

  it("returns null when nothing in range fits", () => {
    const el = textEl({ width: 10, height: 10, text: "Impossibly long single word here" });
    expect(largestFittingFontSize(el, 40, 100)).toBeNull();
  });
});
