import { describe, expect, it } from "vitest";
import { inkPolygons, occluderPolygons, occludersAbove, occlusionOf } from "./occlusion.js";
import { polygonArea } from "./geometry.js";
import { nextElementId } from "./ops.js";
import type { Doc, Element } from "./types.js";

function el(partial: Partial<Element> & { id: string }): Element {
  return { type: "rect", x: 0, y: 0, width: 100, height: 100, rotation: 0, z: 0, style: {}, ...partial };
}

function doc(...elements: Element[]): Doc {
  return { width: 1000, height: 1000, background: "#ffffff", elements };
}

describe("occluderPolygons", () => {
  it("covers the whole box for an image", () => {
    expect(polygonArea(occluderPolygons(el({ id: "a", type: "image", src: "photo/mountains" }))[0]!)).toBeCloseTo(
      10_000,
      6,
    );
  });

  it("ignores a rect whose fill is transparent", () => {
    expect(occluderPolygons(el({ id: "a", style: { fill: "transparent" } }))).toEqual([]);
    expect(occluderPolygons(el({ id: "a", style: { fill: "#00000000" } }))).toEqual([]);
  });

  it("still covers a rect with no declared fill, which the renderer paints grey", () => {
    expect(occluderPolygons(el({ id: "a" }))).toHaveLength(1);
  });

  // A headline painted over another headline hides the glyphs it covers, not
  // the whole rectangle it was declared in.
  it("uses glyph ink rather than the box for a text element", () => {
    const text = el({
      id: "t",
      type: "text",
      text: "Hi",
      width: 600,
      height: 400,
      style: { fontSize: 40, color: "#000000" },
    });
    const covered = occluderPolygons(text).reduce((s, p) => s + polygonArea(p), 0);
    expect(covered).toBeGreaterThan(0);
    // Two characters at 40pt come nowhere near 600x400.
    expect(covered).toBeLessThan(10_000);
    expect(covered).toBeCloseTo(
      inkPolygons(text).reduce((s, p) => s + polygonArea(p), 0),
      6,
    );
  });

  it("covers the whole box for a text element with an opaque block fill", () => {
    const text = el({ id: "t", type: "text", text: "Hi", style: { fill: "#ffffff", fontSize: 40 } });
    expect(polygonArea(occluderPolygons(text)[0]!)).toBeCloseTo(10_000, 6);
  });

  it("ignores text that paints nothing", () => {
    expect(occluderPolygons(el({ id: "t", type: "text", text: "" }))).toEqual([]);
    // Transparent glyphs and no block fill: nothing reaches the canvas.
    expect(occluderPolygons(el({ id: "t", type: "text", text: "Hi", style: { color: "transparent" } }))).toEqual([]);
    expect(occluderPolygons(el({ id: "t", type: "text", text: "Hi", style: { color: "#11111100" } }))).toEqual([]);
  });

  it("ignores anything below the opacity floor", () => {
    expect(occluderPolygons(el({ id: "a", style: { fill: "#000000", opacity: 0.2 } }))).toEqual([]);
  });
});

describe("occludersAbove", () => {
  it("lists only what is painted later and paints something", () => {
    const d = doc(
      el({ id: "base", type: "text", text: "Hello", style: { fontSize: 40 } }),
      el({ id: "ghost", style: { fill: "transparent" } }),
      el({ id: "solid", style: { fill: "#000000" } }),
    );
    expect(occludersAbove(d, d.elements[0]!).map((e) => e.id)).toEqual(["solid"]);
    // Nothing is painted above the topmost element.
    expect(occludersAbove(d, d.elements[2]!)).toEqual([]);
  });
});

describe("occlusionOf", () => {
  it("reports a headline buried under a solid rect", () => {
    const d = doc(
      el({ id: "t", type: "text", text: "Hello", width: 400, height: 100, style: { fontSize: 40 } }),
      el({ id: "cover", x: 0, y: 0, width: 400, height: 100, style: { fill: "#000000" } }),
    );
    expect(occlusionOf(d, d.elements[0]!).hiddenFraction).toBeCloseTo(1, 3);
  });

  // The box-shaped occluder was the bug: a line of type declared in a tall box
  // reported everything under that box as hidden, even the parts it never
  // touched.
  it("does not bury a caption merely because a text box overlaps it", () => {
    const d = doc(
      el({ id: "caption", type: "text", text: "Caption", x: 0, y: 300, width: 400, height: 40, style: { fontSize: 20 } }),
      el({
        id: "headline",
        type: "text",
        text: "Hi",
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        style: { fontSize: 40, valign: "top" },
      }),
    );
    expect(occlusionOf(d, d.elements[0]!).hiddenFraction).toBeCloseTo(0, 6);
  });

  it("leaves a headline on a card unoccluded, because the card is painted below", () => {
    const card = el({ id: "card", x: 0, y: 0, width: 400, height: 200, style: { fill: "#eeeeee" } });
    const headline = el({
      id: "t",
      type: "text",
      text: "Hello",
      x: 20,
      y: 20,
      width: 360,
      height: 80,
      style: { fontSize: 40 },
    });
    const d = doc(card, headline);
    expect(occlusionOf(d, headline).hiddenArea).toBeCloseTo(0, 6);
    // The card loses only the glyph ink drawn over it, not the headline's
    // whole 360x80 box — that difference is the point of measuring ink.
    const cardHidden = occlusionOf(d, card).hiddenArea;
    expect(cardHidden).toBeGreaterThan(0);
    expect(cardHidden).toBeLessThan(360 * 80);
  });
});

describe("nextElementId", () => {
  it("counts up from the highest suffix ever used", () => {
    expect(nextElementId([])).toBe("el_1");
    expect(nextElementId(["el_1", "el_2"])).toBe("el_3");
    expect(nextElementId(["el_7", "headline"])).toBe("el_8");
  });

  // `Number("9007199254740993") + 1` is `9007199254740992 + 1`, which rounds
  // straight back to itself — the allocator would hand out a live id.
  it("does not let a suffix past 2^53 collide with itself", () => {
    const huge = "el_9007199254740993";
    expect(nextElementId([huge])).not.toBe(huge);
    expect(nextElementId([huge])).toBe("el_1");
  });

  it("never returns an id that is already in use", () => {
    for (const used of [["el_9007199254740993"], ["el_9007199254740993", "el_1"], ["el_02", "el_1"]]) {
      expect(used).not.toContain(nextElementId(used));
    }
  });
});
