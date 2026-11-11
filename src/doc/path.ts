/**
 * Paths: a line drawn through points.
 *
 * This is the part of the model that is a painting app rather than a layout
 * tool. A path is open or closed, runs straight between its points or curves
 * smoothly through them, and is stroked, filled, or both.
 *
 * Two rules keep it from needing special cases anywhere else.
 *
 * **The box is the bounding box of the points.** Every other element is a box
 * with something stretched to fill it, and so is this one: `fitPointsToBox`
 * carries the points along whenever the box is moved or resized, and
 * `boxOfPoints` derives the box when only points are given. So `move`,
 * `place`, `align`, rotation and every check that reads a box work on a path
 * without knowing it is one.
 *
 * **What is painted is the flattened outline, exactly.** A smooth path is
 * turned into short straight segments here, once, and the renderer draws those
 * same segments rather than asking SVG for a curve. The geometry the checks
 * measure and the pixels the agent is shown therefore cannot disagree, which
 * is the same bargain `textLength` strikes for type.
 *
 * Everything downstream (occlusion, bounds, contrast) works on convex pieces,
 * so a stroke becomes one quad per segment and a fill is triangulated. Pieces
 * of one path may overlap at the joints; nothing here relies on them being
 * disjoint.
 */

import type { Element, Point, Polygon, Rect } from "./types.js";

/** Stroke width of a path that does not set one. */
export const PATH_DEFAULT_STROKE_WIDTH = 4;
/** Stroke colour of a path that sets neither a stroke nor a fill. */
export const PATH_DEFAULT_STROKE = "#111111";

export type Pt = [number, number];

export function pointsBounds(points: readonly Pt[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (minX > maxX) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The box a set of points gives its element. An element is at least one unit
 * wide and tall, so a perfectly horizontal or vertical line gets a one-unit
 * box centred on it.
 */
export function boxOfPoints(points: readonly Pt[]): Rect {
  const b = pointsBounds(points);
  const width = Math.max(1, b.width);
  const height = Math.max(1, b.height);
  return { x: b.x - (width - b.width) / 2, y: b.y - (height - b.height) / 2, width, height };
}

/**
 * Points stretched so their bounding box is `box`. An axis the points do not
 * extend along cannot be stretched, so they sit on the box's centre line.
 */
export function fitPointsToBox(points: readonly Pt[], box: Rect): Pt[] {
  const b = pointsBounds(points);
  const fx = (x: number) => (b.width > 0 ? box.x + ((x - b.x) / b.width) * box.width : box.x + box.width / 2);
  const fy = (y: number) => (b.height > 0 ? box.y + ((y - b.y) / b.height) * box.height : box.y + box.height / 2);
  return points.map(([x, y]) => [fx(x), fy(y)]);
}

/** True when the points already fill `box`, to within what rounding leaves. */
export function pointsFitBox(points: readonly Pt[], box: Rect, slack = 0.011): boolean {
  const want = boxOfPoints(points);
  return (
    Math.abs(want.x - box.x) <= slack &&
    Math.abs(want.y - box.y) <= slack &&
    Math.abs(want.width - box.width) <= slack &&
    Math.abs(want.height - box.height) <= slack
  );
}

export interface StrokePaint {
  color: string;
  width: number;
}

/**
 * The stroke a path draws, or null. A path with neither a stroke nor a fill
 * declared still draws: a line nobody styled is a thin dark line, the way a
 * rect nobody styled is grey.
 */
export function pathStroke(el: Element): StrokePaint | null {
  const width = el.style.strokeWidth ?? PATH_DEFAULT_STROKE_WIDTH;
  if (width <= 0) return null;
  if (el.style.strokeColor !== undefined) return { color: el.style.strokeColor, width };
  return pathFill(el) === null ? { color: PATH_DEFAULT_STROKE, width } : null;
}

/** The fill a path draws, or null. Only a closed path encloses anything to fill. */
export function pathFill(el: Element): string | null {
  return el.closed && el.style.fill !== undefined ? el.style.fill : null;
}

/** Length and half-width of an arrowhead on a stroke `width` wide. */
export function arrowSize(width: number): { length: number; half: number } {
  return { length: Math.max(14, width * 4), half: Math.max(6, width * 1.8) };
}

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** Most segments one path is flattened into, so a 400-point curve stays cheap to measure. */
const MAX_OUTLINE_SEGMENTS = 1600;

/**
 * The line as drawn, before rotation: every point for a straight path, and a
 * run of short segments along the curve for a smooth one.
 *
 * Smooth is a uniform Catmull-Rom spline, which passes through every point and
 * leaves each one heading toward the next along the line joining its two
 * neighbours. It overshoots a little past sharp turns, the way a hand-drawn
 * curve does — which is exactly the thing an agent drawing blind has to allow
 * for.
 */
export function localOutline(el: Element): Point[] {
  const raw = (el.points ?? []).map(([x, y]) => ({ x, y }));
  // Coincident neighbours add nothing and would give a segment no direction.
  const pts = raw.filter((p, i) => i === 0 || dist(p, raw[i - 1]!) > 1e-9);
  if (el.closed && pts.length > 1 && dist(pts[0]!, pts[pts.length - 1]!) <= 1e-9) pts.pop();
  if ((el.style.curve ?? "straight") !== "smooth" || pts.length < 3) return pts;

  const n = pts.length;
  const spans = el.closed ? n : n - 1;
  const cap = Math.max(2, Math.floor(MAX_OUTLINE_SEGMENTS / spans));
  const at = (i: number) => (el.closed ? pts[((i % n) + n) % n]! : pts[Math.max(0, Math.min(n - 1, i))]!);
  const out: Point[] = [pts[0]!];
  for (let i = 0; i < spans; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    const steps = Math.max(2, Math.min(cap, 12, Math.ceil(dist(p1, p2) / 10)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      out.push({
        x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
        y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y,
      });
    }
  }
  // A closed curve ends where it began; the closing segment is implied.
  if (el.closed) out.pop();
  return out;
}

function rotator(el: Element): (p: Point) => Point {
  if (!el.rotation) return (p) => p;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const theta = (el.rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return (p) => ({ x: cx + (p.x - cx) * cos - (p.y - cy) * sin, y: cy + (p.x - cx) * sin + (p.y - cy) * cos });
}

/** The line as drawn, in canvas space: the outline with the element's rotation applied. */
export function pathOutline(el: Element): Point[] {
  return localOutline(el).map(rotator(el));
}

/** The outline as a list of segments, including the closing one of a closed path. */
export function pathSegments(el: Element): [Point, Point][] {
  const pts = pathOutline(el);
  const out: [Point, Point][] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i]!, pts[i + 1]!]);
  if (el.closed && pts.length > 2) out.push([pts[pts.length - 1]!, pts[0]!]);
  return out;
}

/** Length of the drawn line, closing segment included. */
export function pathLength(el: Element): number {
  return pathSegments(el).reduce((sum, [a, b]) => sum + dist(a, b), 0);
}

/** Which ends of a path carry an arrowhead. A closed path has no ends. */
function arrowEnds(el: Element): { start: boolean; end: boolean } {
  const arrow = el.closed ? "none" : (el.style.arrow ?? "none");
  return { start: arrow === "start" || arrow === "both", end: arrow === "end" || arrow === "both" };
}

/** Cut `length` off the end of a polyline, so an arrowhead's point is not blunted by the shaft under it. */
function trimEnd(pts: Point[], length: number): Point[] {
  const out = [...pts];
  let left = length;
  while (out.length > 1) {
    const a = out[out.length - 2]!;
    const b = out[out.length - 1]!;
    const d = dist(a, b);
    if (d > left) {
      out[out.length - 1] = { x: b.x + ((a.x - b.x) * left) / d, y: b.y + ((a.y - b.y) * left) / d };
      return out;
    }
    // Never trim a line away entirely: keep its first segment's direction.
    if (out.length === 2) return out;
    left -= d;
    out.pop();
  }
  return out;
}

export interface PathDrawing {
  /** The filled outline, as one ring, or null when the path has no fill. */
  fill: Point[] | null;
  /** The stroked line, arrowhead ends already shortened, or null when it has no stroke. */
  stroke: { points: Point[]; closed: boolean; width: number; round: boolean } | null;
  /** One triangle per arrowhead, tip first. */
  arrows: Polygon[];
}

function draw(el: Element, pts: Point[]): PathDrawing {
  const stroke = pathStroke(el);
  const fill = pathFill(el) !== null && pts.length >= 3 ? pts : null;
  if (!stroke || pts.length === 0) return { fill, stroke: null, arrows: [] };

  const closed = !!el.closed && pts.length > 2;
  const ends = arrowEnds(el);
  const arrows: Polygon[] = [];
  let line = pts;
  if (pts.length >= 2 && (ends.start || ends.end)) {
    const { length, half } = arrowSize(stroke.width);
    const head = (tip: Point, from: Point): Polygon => {
      const d = dist(tip, from) || 1;
      const ux = (tip.x - from.x) / d;
      const uy = (tip.y - from.y) / d;
      const bx = tip.x - ux * length;
      const by = tip.y - uy * length;
      return [tip, { x: bx - uy * half, y: by + ux * half }, { x: bx + uy * half, y: by - ux * half }];
    };
    if (ends.end) {
      arrows.push(head(line[line.length - 1]!, line[line.length - 2]!));
      line = trimEnd(line, length * 0.75);
    }
    if (ends.start) {
      arrows.push(head(line[0]!, line[1]!));
      line = trimEnd([...line].reverse(), length * 0.75).reverse();
    }
  }
  return { fill, stroke: { points: line, closed, width: stroke.width, round: (el.style.lineCap ?? "round") === "round" }, arrows };
}

/** What a path draws before rotation, for the renderer (which rotates the group). */
export function localDrawing(el: Element): PathDrawing {
  return draw(el, localOutline(el));
}

/** What a path draws, in canvas space. */
export function pathDrawing(el: Element): PathDrawing {
  return draw(el, pathOutline(el));
}

// --- convex pieces ---------------------------------------------------------

function signedArea2(poly: Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function inTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const d1 = cross(a, b, p);
  const d2 = cross(b, c, p);
  const d3 = cross(c, a, p);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * A simple polygon cut into triangles by ear clipping.
 *
 * Exact for a polygon that does not cross itself. One that does has no single
 * right answer; when no ear can be found the remainder is fanned out, which
 * keeps every triangle inside the outline's convex hull and the total bounded.
 */
export function triangulate(ring: Point[]): Polygon[] {
  if (ring.length < 3) return [];
  const pts = signedArea2(ring) >= 0 ? [...ring] : [...ring].reverse();
  const idx = pts.map((_, i) => i);
  const out: Polygon[] = [];
  let guard = idx.length * idx.length + 8;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length]!;
      const ib = idx[i]!;
      const ic = idx[(i + 1) % idx.length]!;
      const a = pts[ia]!;
      const b = pts[ib]!;
      const c = pts[ic]!;
      const turn = cross(a, b, c);
      if (turn < 0) continue; // reflex corner
      if (turn > 1e-12) {
        let blocked = false;
        for (const j of idx) {
          if (j === ia || j === ib || j === ic) continue;
          if (inTriangle(pts[j]!, a, b, c)) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
        out.push([a, b, c]);
      }
      // A corner with no area is dropped without leaving a triangle.
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push([pts[idx[0]!]!, pts[idx[1]!]!, pts[idx[2]!]!]);
  else for (let i = 1; i + 1 < idx.length; i++) out.push([pts[idx[0]!]!, pts[idx[i]!]!, pts[idx[i + 1]!]!]);
  return out.filter((t) => Math.abs(signedArea2(t)) > 1e-9);
}

/** One quad per segment of a stroked line. Round ends and joins reach half a width past each point. */
export function strokeQuads(points: Point[], closed: boolean, width: number, round: boolean): Polygon[] {
  const half = width / 2;
  const out: Polygon[] = [];
  const add = (a: Point, b: Point) => {
    const d = dist(a, b);
    if (d <= 1e-9) return;
    const ux = (b.x - a.x) / d;
    const uy = (b.y - a.y) / d;
    const ext = round ? half : 0;
    const ax = a.x - ux * ext;
    const ay = a.y - uy * ext;
    const bx = b.x + ux * ext;
    const by = b.y + uy * ext;
    out.push([
      { x: ax - uy * half, y: ay + ux * half },
      { x: bx - uy * half, y: by + ux * half },
      { x: bx + uy * half, y: by - ux * half },
      { x: ax + uy * half, y: ay - ux * half },
    ]);
  };
  for (let i = 0; i + 1 < points.length; i++) add(points[i]!, points[i + 1]!);
  if (closed && points.length > 2) add(points[points.length - 1]!, points[0]!);
  if (out.length === 0 && points.length > 0 && round) {
    // A single point with a round cap is a dot.
    const p = points[0]!;
    out.push([
      { x: p.x - half, y: p.y - half },
      { x: p.x + half, y: p.y - half },
      { x: p.x + half, y: p.y + half },
      { x: p.x - half, y: p.y + half },
    ]);
  }
  return out;
}

export interface PathPieces {
  /** The filled interior, as triangles. Empty when the path has no fill. */
  fill: Polygon[];
  /** The stroke and its arrowheads, as convex pieces. Empty when it has no stroke. */
  stroke: Polygon[];
}

const pieceCache = new WeakMap<Element, { key: string; pieces: PathPieces }>();

function pieceKey(el: Element): string {
  const s = el.style;
  return [
    el.x, el.y, el.width, el.height, el.rotation, el.closed ? 1 : 0, s.curve, s.strokeWidth, s.lineCap, s.arrow,
    s.strokeColor === undefined ? 0 : 1, s.fill === undefined ? 0 : 1, JSON.stringify(el.points ?? []),
  ].join("|");
}

/**
 * The convex pieces a path draws, in canvas space. Memoized per element:
 * scoring asks for these many times over, and triangulating a long outline is
 * the one expensive thing in the geometry.
 */
export function pathPieces(el: Element): PathPieces {
  const key = pieceKey(el);
  const hit = pieceCache.get(el);
  if (hit && hit.key === key) return hit.pieces;
  const drawing = pathDrawing(el);
  const pieces: PathPieces = {
    fill: drawing.fill ? triangulate(drawing.fill) : [],
    stroke: drawing.stroke
      ? [...strokeQuads(drawing.stroke.points, drawing.stroke.closed, drawing.stroke.width, drawing.stroke.round), ...drawing.arrows]
      : [],
  };
  pieceCache.set(el, { key, pieces });
  return pieces;
}

// --- measuring a line against other things ----------------------------------

/** Shortest distance from a point to a segment. */
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-18) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** True when two segments share a point. */
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (p: Point, q: Point, r: Point) =>
    Math.min(p.x, q.x) - 1e-9 <= r.x && r.x <= Math.max(p.x, q.x) + 1e-9 && Math.min(p.y, q.y) - 1e-9 <= r.y && r.y <= Math.max(p.y, q.y) + 1e-9;
  return (
    (Math.abs(d1) <= 1e-9 && on(c, d, a)) ||
    (Math.abs(d2) <= 1e-9 && on(c, d, b)) ||
    (Math.abs(d3) <= 1e-9 && on(a, b, c)) ||
    (Math.abs(d4) <= 1e-9 && on(a, b, d))
  );
}

/** Shortest distance between two segments; zero when they cross. */
export function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

/** Shortest distance from a segment to a convex polygon; zero when it touches or enters it. */
export function segmentPolygonDistance(a: Point, b: Point, poly: Polygon): number {
  if (poly.length < 3) return Infinity;
  // Inside counts as touching: an endpoint within the polygon has distance 0
  // even though it is nowhere near an edge.
  const inside = (p: Point) => {
    let pos = false;
    let neg = false;
    for (let i = 0; i < poly.length; i++) {
      const c = cross(poly[i]!, poly[(i + 1) % poly.length]!, p);
      if (c > 1e-9) pos = true;
      if (c < -1e-9) neg = true;
    }
    return !(pos && neg);
  };
  if (inside(a) || inside(b)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, segmentDistance(a, b, poly[i]!, poly[(i + 1) % poly.length]!));
  return best;
}
