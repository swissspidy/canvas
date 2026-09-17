/**
 * Geometry for rotated boxes.
 *
 * Every element is an oriented rectangle, so overlap and out-of-bounds are
 * polygon problems, not `Math.max(0, ...)` on axis-aligned intervals. These
 * are the headline deterministic metrics, so they are computed exactly
 * (Sutherland-Hodgman convex clipping + the shoelace formula) rather than
 * approximated by bounding boxes.
 */

import type { Element, Point, Polygon, Rect } from "./types.js";

/** Floating point slack, in canvas units. Positions are O(1000), so 1e-6 is generous. */
export const EPS = 1e-6;

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function center(el: Rect): Point {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

/**
 * The four corners of an element's box, in clockwise order starting from the
 * unrotated top-left, rotated about the box center.
 */
export function corners(el: Rect & { rotation?: number }): Polygon {
  const c = center(el);
  const theta = degToRad(el.rotation ?? 0);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const pts: Polygon = [
    { x: el.x, y: el.y },
    { x: el.x + el.width, y: el.y },
    { x: el.x + el.width, y: el.y + el.height },
    { x: el.x, y: el.y + el.height },
  ];
  if (theta === 0) return pts;
  return pts.map((p) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
  });
}

/** Signed area doubled; positive for clockwise in a y-down coordinate system. */
function shoelace2(poly: Polygon): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

export function polygonArea(poly: Polygon): number {
  if (poly.length < 3) return 0;
  return Math.abs(shoelace2(poly)) / 2;
}

/** Ensure clockwise winding (positive shoelace in y-down space). */
function toClockwise(poly: Polygon): Polygon {
  return shoelace2(poly) > 0 ? poly : [...poly].reverse();
}

/**
 * Clip a polygon to one side of the directed line `a -> b`. With clockwise
 * winding in y-down space, `keepInside` keeps the left-hand (interior) side.
 * This is the single primitive behind both intersection and difference.
 */
export function clipHalfPlane(poly: Polygon, a: Point, b: Point, keepInside: boolean): Polygon {
  if (poly.length < 3) return [];
  const side = (p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const wanted = (p: Point) => (keepInside ? side(p) >= -EPS : side(p) <= EPS);
  const out: Polygon = [];

  for (let j = 0; j < poly.length; j++) {
    const cur = poly[j]!;
    const prev = poly[(j + poly.length - 1) % poly.length]!;
    const curIn = wanted(cur);
    const prevIn = wanted(prev);
    if (curIn) {
      if (!prevIn) {
        const p = lineIntersection(prev, cur, a, b);
        if (p) out.push(p);
      }
      out.push(cur);
    } else if (prevIn) {
      const p = lineIntersection(prev, cur, a, b);
      if (p) out.push(p);
    }
  }
  return out;
}

/**
 * Clip `subject` against the convex polygon `clip` (Sutherland-Hodgman).
 * Both polygons must be convex; element boxes always are.
 */
export function convexClip(subject: Polygon, clip: Polygon): Polygon {
  if (subject.length < 3 || clip.length < 3) return [];
  const cw = toClockwise(clip);
  let output: Polygon = subject;
  for (let i = 0; i < cw.length && output.length > 0; i++) {
    output = clipHalfPlane(output, cw[i]!, cw[(i + 1) % cw.length]!, true);
  }
  return output;
}

/**
 * `subject` minus `clip`, as a list of disjoint convex pieces.
 *
 * Walking the clip polygon's edges, everything on the outside of edge `i` (and
 * inside every earlier edge) is one convex piece; what survives all edges is
 * the intersection, which is what gets removed. Exact, and it keeps every
 * piece convex so the result can be fed straight back in for the next
 * subtraction.
 */
export function convexDifference(subject: Polygon, clip: Polygon): Polygon[] {
  if (subject.length < 3) return [];
  if (clip.length < 3) return [subject];
  const cw = toClockwise(clip);
  const pieces: Polygon[] = [];
  let remaining: Polygon = subject;

  for (let i = 0; i < cw.length; i++) {
    const a = cw[i]!;
    const b = cw[(i + 1) % cw.length]!;
    const outside = clipHalfPlane(remaining, a, b, false);
    if (polygonArea(outside) > EPS) pieces.push(outside);
    remaining = clipHalfPlane(remaining, a, b, true);
    if (remaining.length < 3) break;
  }
  return pieces;
}

/**
 * Area of `subject` not covered by any polygon in `clips`.
 *
 * Subtracting convex polygons can split a piece up to four ways per clip, so
 * the piece list is capped. Element counts here are small (a document holds
 * tens of elements, and only those painted above a given one can occlude it),
 * so the cap is a guard rather than a routine path.
 *
 * When it does trip, abandoning the remaining clips would leave their area
 * *un*subtracted and overstate what is visible — the wrong direction for a
 * metric that is supposed to catch hidden text. Fall back instead on the union
 * bound: covered area never exceeds the sum of the individual intersections,
 * so `subject − Σ intersections` is a true lower bound on visible area. It errs
 * toward reporting more occlusion, which is the safe way to be wrong here.
 */
export function visibleAreaAfterSubtracting(subject: Polygon, clips: Polygon[], maxPieces = 512): number {
  let pieces: Polygon[] = [subject];
  for (const clip of clips) {
    const next: Polygon[] = [];
    for (const piece of pieces) {
      // Cheap reject: no shared area means the piece survives untouched.
      if (polygonArea(convexClip(piece, clip)) <= EPS) {
        next.push(piece);
        continue;
      }
      next.push(...convexDifference(piece, clip));
    }
    pieces = next.filter((p) => polygonArea(p) > EPS);
    if (pieces.length > maxPieces) return unionBoundVisibleArea(subject, clips);
  }
  return pieces.reduce((sum, p) => sum + polygonArea(p), 0);
}

/** Lower bound on visible area: subject area less every intersection, summed. */
function unionBoundVisibleArea(subject: Polygon, clips: Polygon[]): number {
  const covered = clips.reduce((sum, clip) => sum + polygonArea(convexClip(subject, clip)), 0);
  return Math.max(0, polygonArea(subject) - covered);
}

function lineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < EPS) return null;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

/** Exact area of the intersection of two elements' (possibly rotated) boxes. */
export function overlapArea(a: Element, b: Element): number {
  return polygonArea(convexClip(corners(a), corners(b)));
}

/** Axis-aligned bounding box of an element's rotated box. */
export function aabb(el: Rect & { rotation?: number }): Rect {
  const pts = corners(el);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export function rectToPolygon(r: Rect): Polygon {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}

/** Area of the element that falls outside `bounds`. Zero when fully inside. */
export function outOfBoundsArea(el: Element, bounds: Rect): number {
  const poly = corners(el);
  const inside = polygonArea(convexClip(poly, rectToPolygon(bounds)));
  return Math.max(0, polygonArea(poly) - inside);
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width - EPS &&
    b.x < a.x + a.width - EPS &&
    a.y < b.y + b.height - EPS &&
    b.y < a.y + a.height - EPS
  );
}

export function containsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x - EPS && p.x <= r.x + r.width + EPS && p.y >= r.y - EPS && p.y <= r.y + r.height + EPS;
}

/**
 * Point-in-convex-polygon, orientation-agnostic. Needed wherever a rotated box
 * is asked "do you cover this point?" — its bounding box says yes over as much
 * as 2x the area it actually paints, which at 45 degrees is most of a corner.
 */
export function polygonContainsPoint(poly: Polygon, p: Point): boolean {
  if (poly.length < 3) return false;
  let positive = false;
  let negative = false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross > EPS) positive = true;
    if (cross < -EPS) negative = true;
    if (positive && negative) return false;
  }
  return true;
}

/**
 * Smallest gap between two elements' bounding boxes along each axis.
 * Negative means the projections overlap on that axis.
 */
export function gapBetween(a: Element, b: Element): { x: number; y: number } {
  const ra = aabb(a);
  const rb = aabb(b);
  const gx = rb.x > ra.x ? rb.x - (ra.x + ra.width) : ra.x - (rb.x + rb.width);
  const gy = rb.y > ra.y ? rb.y - (ra.y + ra.height) : ra.y - (rb.y + rb.height);
  return { x: gx, y: gy };
}

export function round(n: number, places = 2): number {
  const f = 10 ** places;
  // `+ 0` normalizes -0 to 0 so serialized docs compare cleanly.
  return Math.round(n * f) / f + 0;
}
