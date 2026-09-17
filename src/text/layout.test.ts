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

  it("reads glyph outline bounds, and reports nothing for a space", () => {
    expect(font.hasOutlines).toBe(true);
    const cap = font.inkOf("H".codePointAt(0)!)!;
    const descender = font.inkOf("g".codePointAt(0)!)!;
    // A capital sits on the baseline; a `g` hangs below it.
    expect(cap.yMin).toBe(0);
    expect(descender.yMin).toBeLessThan(0);
    // And the capital is the taller of the two.
    expect(cap.yMax).toBeGreaterThan(descender.yMax);
    // Outlines are narrower than the advance they are set in.
    expect(cap.xMax - cap.xMin).toBeLessThan(font.advanceOf("H".codePointAt(0)!));
    expect(font.inkOf(" ".codePointAt(0)!)).toBeNull();
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

  // The separator between two words is the whitespace that followed the
  // earlier one. Reading it off the later token collapsed every multi-space
  // run to one space, so the laid-out text stopped matching the element's.
  it("preserves the exact whitespace between words", () => {
    const lines = wrapText("a  b   c", { fontSize: 20, maxWidth: 1000, font });
    expect(lines.map((l) => l.text)).toEqual(["a  b   c"]);
    expect(lines[0]!.width).toBeCloseTo(measureText(font, "a  b   c", 20), 6);
  });

  it("keeps tab-separated words intact", () => {
    const lines = wrapText("a\tb", { fontSize: 20, maxWidth: 1000, font });
    expect(lines.map((l) => l.text)).toEqual(["a\tb"]);
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


describe("line ink", () => {
  // The line box runs ascender to descender whatever the line contains. What
  // the glyphs cover is a good deal less, and several checks ask about the
  // glyphs — see `src/doc/occlusion.ts`.
  it("is tighter than the line box, and tighter still without descenders", () => {
    const layout = layoutTextElement(textEl({ text: "RIDGELINE", style: { fontSize: 100 } }));
    const line = layout.lines[0]!;
    expect(layout.inkMeasured).toBe(true);
    const ink = line.ink!;
    expect(ink.height).toBeLessThan(layout.ascent + layout.descent);
    expect(ink.width).toBeLessThanOrEqual(line.width);
    // Capitals stop at the baseline, bar the optical overshoot on round
    // letters, and come nowhere near the descender the line box reserves.
    const belowBaseline = ink.y + ink.height - line.baseline;
    expect(belowBaseline).toBeGreaterThanOrEqual(0);
    expect(belowBaseline).toBeLessThan(layout.descent / 4);

    const descending = layoutTextElement(textEl({ text: "Ridgeline pg", style: { fontSize: 100 } }));
    expect(descending.lines[0]!.ink!.y + descending.lines[0]!.ink!.height).toBeGreaterThan(
      descending.lines[0]!.baseline,
    );
  });

  it("is null for a line that draws nothing", () => {
    const layout = layoutTextElement(textEl({ text: "one\n\ntwo" }));
    expect(layout.lines).toHaveLength(3);
    expect(layout.lines[1]!.ink).toBeNull();
    expect(layout.lines[0]!.ink).not.toBeNull();
  });

  // A CFF/OTTO face has no `glyf`, so nothing here can bound its glyphs. The
  // flag is what tells a caller that `null` means "unknown", not "draws
  // nothing" — the difference between falling back to the line box and
  // silently reporting a headline as painting no ink at all.
  it("says so when the face carries no outlines to measure", () => {
    const outlineless = { ...font, hasOutlines: false, inkOf: () => null };
    const layout = layoutTextElement(textEl({ text: "Ridgeline" }), outlineless);
    expect(layout.inkMeasured).toBe(false);
    expect(layout.lines[0]!.ink).toBeNull();
    // Line breaking is unaffected: only the ink box is unavailable.
    expect(layout.lines[0]!.width).toBeGreaterThan(0);
  });

  it("follows the line as alignment moves it", () => {
    const left = layoutTextElement(textEl({ text: "Hi", style: { fontSize: 40, align: "left" } }));
    const right = layoutTextElement(textEl({ text: "Hi", style: { fontSize: 40, align: "right" } }));
    expect(right.lines[0]!.ink!.x).toBeGreaterThan(left.lines[0]!.ink!.x);
    expect(right.lines[0]!.ink!.width).toBeCloseTo(left.lines[0]!.ink!.width, 6);
  });
});
