/**
 * Checks for what is drawn: lines, the things they join and avoid, and the
 * regions they fill.
 *
 * The layout checks in `checks.ts` read boxes. A drawing has none worth
 * reading — a route is right or wrong along its whole length, and a filled
 * region is right or wrong over its whole area — so these read the line as it
 * is drawn (`pathSegments`, the same flattened outline the renderer paints)
 * and, for area, a mask: both regions sampled on one grid and compared cell by
 * cell. A mask has no opinion about how a region was drawn, which is the
 * point. A pie slice traced with sixty points and one drawn as a smooth curve
 * through seven are the same slice if they cover the same paper.
 *
 * Every check here scores zero on a page with nothing drawn. The tasks start
 * from such a page, and a check that answered "no lines, so no line is wrong"
 * would hand the blank canvas most of its marks.
 */

import type { Doc, Element, Point, Polygon, Style } from "../doc/types.js";
import { shapePolygons, round } from "../doc/geometry.js";
import { paintsAnything } from "../doc/occlusion.js";
import {
  pathDrawing,
  pathLength,
  pathOutline,
  pathSegments,
  pathStroke,
  pointSegmentDistance,
  segmentDistance,
  segmentPolygonDistance,
} from "../doc/path.js";
import { check, gradeDefect, select, type Check, type Selector } from "./checks.js";

const sameColor = (a: string | undefined, b: string) => a !== undefined && a.toLowerCase() === b.toLowerCase();

/** A visible path, optionally one with a given stroke or fill colour, open or closed. */
export function pathWith(want: { stroke?: string; fill?: string; closed?: boolean } = {}): (el: Element) => boolean {
  return (el) =>
    el.type === "path" &&
    paintsAnything(el) &&
    (want.closed === undefined || !!el.closed === want.closed) &&
    (want.stroke === undefined || sameColor(pathStroke(el)?.color, want.stroke)) &&
    (want.fill === undefined || sameColor(el.style.fill, want.fill));
}

const NOTHING_DRAWN = "No such path has been drawn.";
const pt = (p: Point) => `(${round(p.x, 1)}, ${round(p.y, 1)})`;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const halfWidth = (el: Element) => (pathStroke(el)?.width ?? 0) / 2;

/** Exactly this many paths match. One short or one over is half marks; two is none. */
export function pathCount(selector: Selector, count: number, weight = 1, label?: string): Check {
  return check("path_count", label ?? `Exactly ${count} such path(s)`, weight, (doc) => {
    const n = select(doc, selector).length;
    return { score: gradeDefect(Math.abs(n - count), 0, 2), detail: `${n} drawn, ${count} wanted.` };
  });
}

/** The path starts at one stated point and ends at the other, in either direction unless `directed`. */
export function pathEnds(
  selector: Selector,
  a: Point,
  b: Point,
  weight = 1,
  opts: { tolerance?: number; directed?: boolean; label?: string } = {},
): Check {
  const tol = opts.tolerance ?? 2;
  return check("path_ends", opts.label ?? `Runs from ${pt(a)} to ${pt(b)}`, weight, (doc) => {
    const els = select(doc, selector);
    if (els.length === 0) return { score: 0, detail: NOTHING_DRAWN };
    let worst = 0;
    for (const el of els) {
      const line = pathOutline(el);
      if (line.length < 2 || el.closed) return { score: 0, detail: `${el.id} is not an open line.` };
      const first = line[0]!;
      const last = line[line.length - 1]!;
      const forward = Math.max(dist(first, a), dist(last, b));
      const backward = Math.max(dist(first, b), dist(last, a));
      worst = Math.max(worst, opts.directed ? forward : Math.min(forward, backward));
    }
    return { score: gradeDefect(worst, tol, tol + 40), detail: `Ends are within ${round(worst, 1)} units of where they belong.` };
  });
}

/**
 * The stroke keeps a stated distance from every obstacle, measured from the
 * stroke's edge rather than its centre line — a 10-unit line whose centre
 * clears a wall by 4 is painted over it.
 */
export function pathClearOf(selector: Selector, obstacles: Selector, clearance: number, weight = 1, label?: string): Check {
  return check("path_clear", label ?? `Keeps ${clearance} units clear of the obstacles`, weight, (doc) => {
    const els = select(doc, selector);
    if (els.length === 0) return { score: 0, detail: NOTHING_DRAWN };
    const blocks = select(doc, obstacles).map((el) => ({ id: el.id, polys: shapePolygons(el) }));
    let worst = 0;
    const hits = new Set<string>();
    for (const el of els) {
      const half = halfWidth(el);
      for (const [p, q] of pathSegments(el)) {
        for (const block of blocks) {
          let d = Infinity;
          for (const poly of block.polys) d = Math.min(d, segmentPolygonDistance(p, q, poly));
          const short = clearance - (d - half);
          if (short > 0.5) {
            worst = Math.max(worst, short);
            hits.add(`${el.id} near ${block.id}`);
          }
        }
      }
    }
    return {
      // Touching scores nothing: a line through a wall is not a near miss.
      score: gradeDefect(worst, 0.5, Math.max(1, clearance)),
      detail: hits.size ? `Too close: ${[...hits].slice(0, 6).join(", ")} (worst ${round(worst, 1)} units short).` : "Clear of everything.",
    };
  });
}

/** No two of the matched lines touch: their strokes stay `clearance` apart, edge to edge. */
export function pathsApart(selector: Selector, clearance: number, weight = 1, label?: string): Check {
  return check("paths_apart", label ?? `Lines stay ${clearance} units apart`, weight, (doc) => {
    const els = select(doc, selector);
    if (els.length < 2) return { score: 0, detail: "Fewer than two lines drawn." };
    let worst = 0;
    const hits: string[] = [];
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        let d = Infinity;
        for (const [p, q] of pathSegments(els[i]!)) for (const [r, s] of pathSegments(els[j]!)) d = Math.min(d, segmentDistance(p, q, r, s));
        const short = clearance - (d - halfWidth(els[i]!) - halfWidth(els[j]!));
        if (short > 0.5) {
          worst = Math.max(worst, short);
          hits.push(`${els[i]!.id} and ${els[j]!.id}`);
        }
      }
    }
    return {
      score: gradeDefect(worst, 0.5, Math.max(1, clearance)),
      detail: hits.length ? `Too close or crossing: ${hits.join("; ")}.` : "No two lines touch.",
    };
  });
}

/** No matched line is longer than `max`: what stops a route going round by the edge of the canvas. */
export function pathLengthAtMost(selector: Selector, max: number, weight = 1, label?: string): Check {
  return check("path_length", label ?? `No line longer than ${max} units`, weight, (doc) => {
    const els = select(doc, selector);
    if (els.length === 0) return { score: 0, detail: NOTHING_DRAWN };
    const longest = Math.max(...els.map(pathLength));
    return { score: gradeDefect(longest - max, 0.5, max * 0.25), detail: `Longest is ${round(longest, 1)} units.` };
  });
}

/** Every run of the line is horizontal or vertical. */
export function pathOrthogonal(selector: Selector, weight = 1, label?: string): Check {
  return check("path_orthogonal", label ?? "Lines run only horizontally and vertically", weight, (doc) => {
    const els = select(doc, selector);
    if (els.length === 0) return { score: 0, detail: NOTHING_DRAWN };
    let worst = 0;
    for (const el of els) for (const [p, q] of pathSegments(el)) worst = Math.max(worst, Math.min(Math.abs(p.x - q.x), Math.abs(p.y - q.y)));
    return { score: gradeDefect(worst, 0.5, 20), detail: worst > 0.5 ? `A run is ${round(worst, 1)} units off square.` : "Every run is square." };
  });
}

/** The path's own points are exactly these, in order (or in reverse). */
export function pathThrough(selector: Selector, points: Point[], weight = 1, opts: { tolerance?: number; label?: string } = {}): Check {
  const tol = opts.tolerance ?? 1.5;
  return check("path_through", opts.label ?? `Runs through the ${points.length} stated points in order`, weight, (doc) => {
    const el = select(doc, selector)[0];
    if (!el) return { score: 0, detail: NOTHING_DRAWN };
    const mine = pathOutline({ ...el, style: { ...el.style, curve: "straight" } });
    if (mine.length !== points.length) return { score: 0, detail: `${el.id} has ${mine.length} points; ${points.length} wanted.` };
    const off = (order: Point[]) => Math.max(...order.map((p, i) => dist(p, points[i]!)));
    const worst = Math.min(off(mine), off([...mine].reverse()));
    return { score: gradeDefect(worst, tol, tol + 30), detail: `Furthest point is ${round(worst, 1)} units from its place.` };
  });
}

/** Each matched element carries these style values. Colours compare without regard to case. */
export function styleIs(selector: Selector, want: Partial<Style>, weight = 1, label?: string): Check {
  const keys = Object.keys(want) as (keyof Style)[];
  return check("style_is", label ?? `Styled ${keys.map((k) => `${k}=${want[k]}`).join(", ")}`, weight, (doc) => {
    const els = select(doc, selector);
    if (els.length === 0) return { score: 0, detail: "No matching element." };
    const wrong: string[] = [];
    let total = 0;
    for (const el of els) {
      for (const key of keys) {
        total++;
        const got = el.style[key];
        const expected = want[key];
        const same =
          typeof expected === "number"
            ? typeof got === "number" && Math.abs(got - expected) <= 0.01
            : typeof expected === "string" && typeof got === "string"
              ? got.toLowerCase() === expected.toLowerCase()
              : got === expected;
        if (!same) wrong.push(`${el.id}.${key}=${got ?? "unset"}`);
      }
    }
    return { score: 1 - wrong.length / total, detail: wrong.length ? `Wanted ${keys.map((k) => `${k}=${want[k]}`).join(", ")}; got ${wrong.slice(0, 6).join(", ")}.` : "As specified." };
  });
}

/** Shortest distance from a point to the outline of what an element draws. */
function outlineDistance(el: Element, p: Point): number {
  let best = Infinity;
  for (const poly of shapePolygons(el)) {
    for (let i = 0; i < poly.length; i++) best = Math.min(best, pointSegmentDistance(p, poly[i]!, poly[(i + 1) % poly.length]!));
  }
  return best;
}

const centreOf = (el: Element): Point => ({ x: el.x + el.width / 2, y: el.y + el.height / 2 });

/**
 * A connector from one element to another: a straight line that starts on the
 * first one's outline, ends on the second's, runs along the line joining
 * their centres, and (asked to) carries an arrowhead at the far end.
 *
 * The agent names its own paths, so the connector is found rather than named:
 * whichever open path's ends sit nearest the two outlines is taken to be it.
 */
export function connects(
  fromId: string,
  toId: string,
  weight = 1,
  opts: { tolerance?: number; arrow?: boolean; candidates?: Selector; label?: string } = {},
): Check {
  const tol = opts.tolerance ?? 2;
  return check("connects", opts.label ?? `A connector runs from ${fromId} to ${toId}`, weight, (doc) => {
    const from = doc.elements.find((e) => e.id === fromId);
    const to = doc.elements.find((e) => e.id === toId);
    if (!from || !to) return { score: 0, detail: "One of the two elements is gone." };
    const a = centreOf(from);
    const b = centreOf(to);
    let best: { el: Element; off: number } | null = null;
    for (const el of select(doc, opts.candidates ?? pathWith({ closed: false }))) {
      const line = pathOutline(el);
      if (line.length < 2) continue;
      const first = line[0]!;
      const last = line[line.length - 1]!;
      // On each outline, and every point of the line on the centre line.
      const ends = Math.max(outlineDistance(from, first), outlineDistance(to, last));
      const straight = Math.max(...line.map((p) => pointSegmentDistance(p, a, b)));
      // The right way round: the end on `to` is the one nearer its centre.
      const reversed = dist(first, b) < dist(last, b) ? tol + 40 : 0;
      const off = Math.max(ends, straight, reversed);
      if (!best || off < best.off) best = { el, off };
    }
    if (!best) return { score: 0, detail: "No connector has been drawn." };
    const geometry = gradeDefect(best.off, tol, tol + 40);
    const arrow = best.el.style.arrow ?? "none";
    const headed = !opts.arrow || arrow === "end";
    return {
      score: headed ? geometry : geometry * 0.5,
      detail: `${best.el.id} is ${round(best.off, 1)} units off` + (headed ? "." : `, and its arrow is '${arrow}', not 'end'.`),
    };
  });
}

// --- regions, by mask --------------------------------------------------------

/** Cell size of the comparison grid, in canvas units. */
const MASK_CELL = 2;

/** Mark every grid cell whose centre lies inside the ring (even-odd), by scanline. */
function fillRing(mask: Uint8Array, cols: number, rows: number, ring: readonly Point[]): void {
  if (ring.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const r0 = Math.max(0, Math.floor(minY / MASK_CELL));
  const r1 = Math.min(rows - 1, Math.ceil(maxY / MASK_CELL));
  const xs: number[] = [];
  for (let r = r0; r <= r1; r++) {
    const y = (r + 0.5) * MASK_CELL;
    xs.length = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      if (a.y <= y === b.y <= y) continue;
      xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k]! / MASK_CELL - 0.5));
      const c1 = Math.min(cols - 1, Math.floor(xs[k + 1]! / MASK_CELL - 0.5));
      for (let c = c0; c <= c1; c++) mask[r * cols + c] = 1;
    }
  }
}

/** The cells of the canvas grid that any of `rings` covers. */
export function maskOf(doc: Doc, rings: readonly (readonly Point[])[]): Uint8Array {
  const cols = Math.ceil(doc.width / MASK_CELL);
  const rows = Math.ceil(doc.height / MASK_CELL);
  const mask = new Uint8Array(cols * rows);
  for (const ring of rings) fillRing(mask, cols, rows, ring);
  return mask;
}

/** Intersection over union of two masks: 1 when they cover exactly the same cells. */
export function maskIoU(a: Uint8Array, b: Uint8Array): number {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) both++;
    if (a[i] || b[i]) either++;
  }
  return either === 0 ? 0 : both / either;
}

/** The filled interiors of the matched closed paths, as rings. */
function filledRings(doc: Doc, selector: Selector): Polygon[] {
  return select(doc, selector).flatMap((el) => {
    const fill = pathDrawing(el).fill;
    return fill ? [fill] : [];
  });
}

/**
 * The matched fills cover a stated region — the same paper, to within `min`
 * intersection over union. Scored from `floor` up, so a slice a few degrees
 * out earns part marks and one in the wrong place earns none.
 */
export function regionCovers(
  selector: Selector,
  region: Point[],
  weight = 1,
  opts: { min?: number; floor?: number; label?: string } = {},
): Check {
  const min = opts.min ?? 0.97;
  const floor = opts.floor ?? 0.7;
  return check("region", opts.label ?? "The filled region is the one asked for", weight, (doc) => {
    const rings = filledRings(doc, selector);
    if (rings.length === 0) return { score: 0, detail: "No filled path matches." };
    const iou = maskIoU(maskOf(doc, rings), maskOf(doc, [region]));
    return {
      score: iou >= min ? 1 : Math.max(0, (iou - floor) / (min - floor)),
      detail: `Covers the region with ${round(iou * 100, 1)}% overlap (wanted ${round(min * 100, 1)}%).`,
    };
  });
}

/** A circular sector as a ring: centre, then the arc from `start` to `end` degrees clockwise from straight up. */
export function sectorRing(cx: number, cy: number, r: number, start: number, end: number): Point[] {
  const steps = Math.max(2, Math.ceil(Math.abs(end - start) / 0.5));
  const out: Point[] = [{ x: cx, y: cy }];
  for (let i = 0; i <= steps; i++) {
    const a = ((start + ((end - start) * i) / steps) * Math.PI) / 180;
    out.push({ x: cx + Math.sin(a) * r, y: cy - Math.cos(a) * r });
  }
  return out;
}

/**
 * Nothing visible is added but lines. A drawing task asks for paths; an opaque
 * rectangle over the whole page leaves every path check satisfied and the
 * picture gone, so anything else that paints is counted against it.
 */
export function onlyPathsAdded(reference: Doc, weight = 1, label = "Nothing is added but the lines asked for"): Check {
  const known = new Set(reference.elements.map((e) => e.id));
  return check("only_paths_added", label, weight, (doc) => {
    const extra = doc.elements.filter((e) => !known.has(e.id) && e.type !== "path" && paintsAnything(e)).map((e) => e.id);
    return {
      score: extra.length === 0 ? 1 : Math.max(0, 1 - extra.length / 3),
      detail: extra.length ? `Added: ${extra.slice(0, 6).join(", ")}` : "Only lines added.",
    };
  });
}

