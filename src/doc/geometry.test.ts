import { describe, expect, it } from "vitest";
import {
  aabb,
  corners,
  convexClip,
  outOfBoundsArea,
  overlapArea,
  polygonArea,
  polygonContainsPoint,
  rectToPolygon,
  visibleAreaAfterSubtracting,
} from "./geometry.js";
import type { Element } from "./types.js";

function el(partial: Partial<Element>): Element {
  return {
    id: "e",
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    z: 0,
    style: {},
    ...partial,
  };
}

describe("polygonArea", () => {
  it("measures an axis-aligned square", () => {
    expect(polygonArea(rectToPolygon({ x: 0, y: 0, width: 10, height: 20 }))).toBe(200);
  });

  it("is winding-independent", () => {
    const poly = rectToPolygon({ x: 3, y: 4, width: 5, height: 6 });
    expect(polygonArea([...poly].reverse())).toBeCloseTo(30, 9);
  });

  it("is zero for degenerate polygons", () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
  });
});

describe("overlapArea", () => {
  it("is the full area for identical boxes", () => {
    const a = el({ id: "a" });
    expect(overlapArea(a, el({ id: "b" }))).toBeCloseTo(10_000, 6);
  });

  it("is zero for disjoint boxes", () => {
    expect(overlapArea(el({ id: "a" }), el({ id: "b", x: 200 }))).toBeCloseTo(0, 9);
  });

  it("is zero for boxes that merely touch", () => {
    expect(overlapArea(el({ id: "a" }), el({ id: "b", x: 100 }))).toBeCloseTo(0, 6);
  });

  it("measures a partial axis-aligned overlap", () => {
    // 100x100 boxes offset by (60, 30) overlap on a 40x70 region.
    expect(overlapArea(el({ id: "a" }), el({ id: "b", x: 60, y: 30 }))).toBeCloseTo(2800, 6);
  });

  it("accounts for rotation", () => {
    // A square rotated 45 degrees about the same center: the intersection is
    // a regular octagon of area 2*(sqrt(2)-1)*s^2 for equal squares.
    const a = el({ id: "a" });
    const b = el({ id: "b", rotation: 45 });
    const expected = 2 * (Math.SQRT2 - 1) * 100 * 100;
    expect(overlapArea(a, b)).toBeCloseTo(expected, 3);
  });

  it("finds overlap that bounding boxes would miss entirely", () => {
    // Two thin bars crossing at 90 degrees overlap only where they cross.
    const bar = el({ id: "a", x: 0, y: 45, width: 100, height: 10 });
    const cross = el({ id: "b", x: 45, y: 0, width: 10, height: 100 });
    expect(overlapArea(bar, cross)).toBeCloseTo(100, 6);
  });
});

describe("outOfBoundsArea", () => {
  const canvas = { x: 0, y: 0, width: 400, height: 400 };

  it("is zero when fully inside", () => {
    expect(outOfBoundsArea(el({ x: 10, y: 10 }), canvas)).toBeCloseTo(0, 6);
  });

  it("measures the part hanging off an edge", () => {
    expect(outOfBoundsArea(el({ x: -40, y: 10 }), canvas)).toBeCloseTo(4000, 6);
  });

  it("measures a fully outside element as its whole area", () => {
    expect(outOfBoundsArea(el({ x: 500, y: 500 }), canvas)).toBeCloseTo(10_000, 6);
  });

  it("handles a rotated element crossing a corner", () => {
    const rotated = el({ x: -50, y: -50, rotation: 45 });
    const out = outOfBoundsArea(rotated, canvas);
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(10_000);
  });
});

describe("corners / aabb", () => {
  it("returns the box itself when unrotated", () => {
    expect(corners(el({ x: 1, y: 2, width: 3, height: 4 }))).toEqual([
      { x: 1, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 6 },
      { x: 1, y: 6 },
    ]);
  });

  it("grows the bounding box under rotation", () => {
    const box = aabb(el({ rotation: 45 }));
    expect(box.width).toBeCloseTo(Math.SQRT2 * 100, 6);
    expect(box.height).toBeCloseTo(Math.SQRT2 * 100, 6);
    // Rotation is about the center, so the center is unmoved.
    expect(box.x + box.width / 2).toBeCloseTo(50, 6);
  });
});

describe("convexClip", () => {
  it("returns the subject when fully contained", () => {
    const subject = rectToPolygon({ x: 2, y: 2, width: 2, height: 2 });
    const clip = rectToPolygon({ x: 0, y: 0, width: 10, height: 10 });
    expect(polygonArea(convexClip(subject, clip))).toBeCloseTo(4, 9);
  });

  it("returns nothing when disjoint", () => {
    const subject = rectToPolygon({ x: 20, y: 20, width: 2, height: 2 });
    const clip = rectToPolygon({ x: 0, y: 0, width: 10, height: 10 });
    expect(polygonArea(convexClip(subject, clip))).toBeCloseTo(0, 9);
  });
});

describe("visibleAreaAfterSubtracting", () => {
  const subject = rectToPolygon({ x: 0, y: 0, width: 100, height: 100 });
  // Five disjoint 10-wide bars: exactly half the subject survives.
  const bars = [10, 30, 50, 70, 90].map((x) => rectToPolygon({ x, y: 0, width: 10, height: 100 }));

  it("subtracts every clip when the piece cap is not reached", () => {
    expect(visibleAreaAfterSubtracting(subject, bars)).toBeCloseTo(5000, 6);
  });

  // Abandoning the remaining clips when the cap trips would report 9000 here —
  // an *upper* bound, which hides occlusion instead of over-reporting it.
  it("stays a lower bound when the piece cap trips", () => {
    const capped = visibleAreaAfterSubtracting(subject, bars, 1);
    expect(capped).toBeLessThanOrEqual(5000 + 1e-6);
    expect(capped).toBeCloseTo(5000, 6);
  });

  it("clamps to zero when the clips more than cover the subject", () => {
    const overlapping = [
      rectToPolygon({ x: 0, y: 0, width: 60, height: 100 }),
      rectToPolygon({ x: 40, y: 0, width: 60, height: 100 }),
    ];
    expect(visibleAreaAfterSubtracting(subject, overlapping, 1)).toBe(0);
  });
});

describe("polygonContainsPoint", () => {
  it("excludes the corners a rotated box's bounding box would claim", () => {
    const square = corners(el({ x: 0, y: 0, width: 100, height: 100, rotation: 45 }));
    expect(polygonContainsPoint(square, { x: 50, y: 50 })).toBe(true);
    // Inside the AABB (which spans roughly -21..121 on both axes), outside the
    // diamond the element actually paints.
    expect(polygonContainsPoint(square, { x: 0, y: 0 })).toBe(false);
    expect(polygonContainsPoint(square, { x: 100, y: 100 })).toBe(false);
  });

  it("holds for an unrotated box", () => {
    const square = corners(el({ x: 10, y: 10, width: 20, height: 20 }));
    expect(polygonContainsPoint(square, { x: 20, y: 20 })).toBe(true);
    expect(polygonContainsPoint(square, { x: 9, y: 20 })).toBe(false);
  });
});
