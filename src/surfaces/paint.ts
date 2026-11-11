/**
 * Drawing tools, one set per vocabulary.
 *
 * Attached only for tasks that draw (`Task.paint`), the way the animation
 * tools are attached only for tasks that animate, so every other task sends
 * exactly the tool list it always has.
 *
 * All of them make the same thing — a `path` element — and reach exactly the
 * same paths; `paint.test.ts` proves it. They differ in the one way the
 * surfaces are meant to. Coordinate's `draw` takes every point as two numbers.
 * Relational's `draw` takes every point as a place on something ("the right
 * edge of el_3"), and `connect` works a whole line out: where it leaves one
 * element and meets another, and, asked to, a way round whatever is between
 * them. Document-as-code writes `points` in the JSON.
 */

import { z } from "zod";
import { zPoints, zStyle } from "../doc/schema.js";
import type { Doc, Element, Point, Polygon, Rect, Style } from "../doc/types.js";
import { MAX_PATH_POINTS } from "../doc/types.js";
import { addElement, patchElement, requireElement, ToolError, topZ } from "../doc/ops.js";
import { aabb, round, shapePolygons } from "../doc/geometry.js";
import { boxOfPoints, pathSegments, PATH_DEFAULT_STROKE_WIDTH, type Pt } from "../doc/path.js";
import { describeElementShort, zElementId } from "./common.js";
import type { ToolContext, ToolDef, ToolOutcome, ToolSurface } from "./types.js";

/** What every surface is told about paths. Appended to the system prompt of a task that draws. */
export const PAINT_NOTE = [
  "This document can also hold a fourth kind of element, a path: a line drawn through a list of points,",
  "given as [x, y] pairs in canvas units. A path is open unless it is closed, which joins its last point back",
  "to its first. style.curve 'smooth' passes a curve through every point instead of joining them with straight",
  "segments; a smooth curve bulges a little past its points wherever it turns. A path is stroked in",
  `style.strokeColor at style.strokeWidth (default ${PATH_DEFAULT_STROKE_WIDTH}), centred on the line, so it paints half its width to`,
  "either side; style.lineCap is 'round' (the default) or 'butt', style.dash makes it dashed, and style.arrow puts",
  "an arrowhead on the 'end', the 'start' or 'both' ends of an open path, its tip exactly on the path's last",
  "point. A closed path with a style.fill is filled, and has no stroke unless style.strokeColor is set.",
  "A path's box is always the bounding box of its points: moving or resizing the element carries the points with it.",
].join(" ");

const zDrawStyle = zStyle.optional().describe("Stroke and fill: strokeColor, strokeWidth, fill, curve, lineCap, dash, arrow, opacity.");
const zDrawZ = z.number().int().optional().describe("Paint order; higher is nearer the viewer. A new path defaults to above everything.");
const zRedrawId = zElementId.optional().describe("An existing path to redraw through these points instead of making a new one. Its style is kept unless 'style' is given.");
const zClosed = z.boolean().optional().describe("Join the last point back to the first. Default false for a new path.");

function pointsPhrase(points: readonly Pt[]): string {
  const shown = points.slice(0, 12).map(([x, y]) => `(${round(x, 1)},${round(y, 1)})`).join(" ");
  return points.length > 12 ? `${shown} … (${points.length} points)` : shown;
}

/** Make a path through `points`, or redraw an existing one. Shared, so every drawing tool confirms alike. */
function commitPath(
  ctx: ToolContext,
  input: { id?: string; closed?: boolean; style?: Style; z?: number },
  points: Pt[],
  how = "",
): ToolOutcome {
  if (points.length > MAX_PATH_POINTS) throw new ToolError(`A path holds at most ${MAX_PATH_POINTS} points; this one has ${points.length}.`);
  const box = boxOfPoints(points);
  if (input.id !== undefined) {
    const el = requireElement(ctx.doc, input.id);
    if (el.type !== "path") throw new ToolError(`${input.id} is a ${el.type} element, not a path.`, "Leave out 'id' to draw a new path.");
    const closed = input.closed ?? !!el.closed;
    if (closed && points.length < 3) throw new ToolError("A closed path needs at least three points.");
    // Unrotated: the points given are where the line now runs, so a rotation
    // the old line carried would turn them away from where they were asked for.
    const doc = patchElement(ctx.doc, input.id, {
      ...box,
      rotation: 0,
      points,
      closed,
      ...(input.style ? { style: input.style } : {}),
      ...(input.z !== undefined ? { z: input.z } : {}),
    });
    return { doc, message: `Redrew ${input.id} through ${pointsPhrase(points)}${how}.`, touched: [input.id] };
  }
  if (input.closed && points.length < 3) throw new ToolError("A closed path needs at least three points.");
  const el: Element = {
    id: ctx.session.allocateId(),
    type: "path",
    ...box,
    rotation: 0,
    z: input.z ?? topZ(ctx.doc) + 1,
    points,
    style: input.style ?? {},
  };
  if (input.closed) el.closed = true;
  return {
    doc: addElement(ctx.doc, el),
    message: `Drew ${describeElementShort(el)} through ${pointsPhrase(points)}${how}, z=${el.z}.`,
    touched: [el.id],
  };
}

// --- coordinate: every point as numbers -------------------------------------

export const zDrawInput = z.strictObject({
  id: zRedrawId,
  points: zPoints,
  closed: zClosed,
  style: zDrawStyle,
  z: zDrawZ,
});

export const drawTool: ToolDef<z.infer<typeof zDrawInput>> = {
  name: "draw",
  description: "Draw a path through the points you give, or redraw an existing path through new ones.",
  schema: zDrawInput,
  run(ctx, input) {
    return commitPath(ctx, input, input.points as Pt[]);
  },
};

// --- relational: every point as a place on something ------------------------

const ANCHORS = ["top_left", "top", "top_right", "left", "center", "right", "bottom_left", "bottom", "bottom_right"] as const;
type Anchor = (typeof ANCHORS)[number];

const zAnchoredPoint = z.strictObject({
  on: z.string().min(1).describe("'canvas', or the id of the element the point is taken from."),
  anchor: z.enum(ANCHORS).optional().describe("Which point of its bounding box. Default 'center'."),
  dx: z.number().optional().describe("Then this far to the right, in canvas units. Default 0."),
  dy: z.number().optional().describe("Then this far down, in canvas units. Default 0."),
});

function anchorPoint(box: Rect, anchor: Anchor): Point {
  const fx = anchor.endsWith("left") ? 0 : anchor.endsWith("right") ? 1 : 0.5;
  const fy = anchor.startsWith("top") ? 0 : anchor.startsWith("bottom") ? 1 : 0.5;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

function resolvePoint(doc: Doc, p: z.infer<typeof zAnchoredPoint>): Pt {
  const box = p.on === "canvas" ? { x: 0, y: 0, width: doc.width, height: doc.height } : aabb(requireElement(doc, p.on));
  const at = anchorPoint(box, p.anchor ?? "center");
  return [at.x + (p.dx ?? 0), at.y + (p.dy ?? 0)];
}

export const zSketchInput = z.strictObject({
  id: zRedrawId,
  points: z
    .array(zAnchoredPoint)
    .min(2)
    .max(MAX_PATH_POINTS)
    .describe("The points the line runs through, in order, each given as a place on the canvas or on an element."),
  closed: zClosed,
  style: zDrawStyle,
  z: zDrawZ,
});

export const sketchTool: ToolDef<z.infer<typeof zSketchInput>> = {
  name: "draw",
  description:
    "Draw a path through points named by where they are — a corner, an edge midpoint or the center of the canvas or " +
    "of an element, optionally offset — or redraw an existing path through new ones. The coordinates are worked out for you.",
  schema: zSketchInput,
  run(ctx, input) {
    return commitPath(ctx, input, input.points.map((p) => resolvePoint(ctx.doc, p)));
  },
};

// --- relational: connect ------------------------------------------------------

const ROUTES = ["straight", "elbow", "around"] as const;

export const zConnectInput = z.strictObject({
  id: zRedrawId,
  from: zElementId.describe("The element the line starts at."),
  to: zElementId.describe("The element the line ends at."),
  route: z
    .enum(ROUTES)
    .optional()
    .describe(
      "'straight' (the default) runs along the line joining the two centers. 'elbow' runs horizontally from the first, " +
        "then vertically to the second. 'around' finds the shortest route of horizontal and vertical runs that keeps " +
        "clear of every element in 'avoid'.",
    ),
  ends: z
    .enum(["edge", "center"])
    .optional()
    .describe("Where the line starts and stops: on each element's outline ('edge', the default) or at its center."),
  avoid: z
    .union([z.array(zElementId), z.literal("all")])
    .optional()
    .describe("For 'around': the elements the line must not touch, or 'all' for every element but the two being connected."),
  clearance: z.number().min(0).max(500).optional().describe("For 'around': clear space to leave between the line's edge and anything avoided. Default 0."),
  style: zDrawStyle,
  z: zDrawZ,
});

const mid = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** Where the segment a→b crosses the outline of `shape`, as fractions of the way along it. */
function crossings(a: Point, b: Point, shape: Polygon[]): number[] {
  const out: number[] = [];
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  for (const poly of shape) {
    for (let i = 0; i < poly.length; i++) {
      const c = poly[i]!;
      const d = poly[(i + 1) % poly.length]!;
      const sx = d.x - c.x;
      const sy = d.y - c.y;
      const den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
      const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
      if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) out.push(Math.max(0, Math.min(1, t)));
    }
  }
  return out;
}

/**
 * Cut a line that runs center to center back to the two outlines: it starts
 * where it last leaves `from` and stops where it then first meets `to`.
 */
function trimToEdges(line: Point[], from: Element, to: Element): Point[] {
  const a = shapePolygons(from);
  const b = shapePolygons(to);
  let start = { seg: 0, t: 0 };
  for (let i = 0; i + 1 < line.length; i++) {
    for (const t of crossings(line[i]!, line[i + 1]!, a)) if (i > start.seg || t > start.t) start = { seg: i, t };
  }
  let end = { seg: line.length - 2, t: 1 };
  search: for (let i = start.seg; i + 1 < line.length; i++) {
    const ts = crossings(line[i]!, line[i + 1]!, b).filter((t) => i > start.seg || t > start.t).sort((x, y) => x - y);
    if (ts.length) {
      end = { seg: i, t: ts[0]! };
      break search;
    }
  }
  const at = (seg: number, t: number): Point => {
    const p = line[seg]!;
    const q = line[seg + 1]!;
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
  };
  return [at(start.seg, start.t), ...line.slice(start.seg + 1, end.seg + 1), at(end.seg, end.t)];
}

/** Drop repeated points and the middle one of any three in a row along one line. */
function simplify(line: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of line) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-6) continue;
    const prev = out[out.length - 2];
    if (prev && last && Math.abs((last.x - prev.x) * (p.y - last.y) - (last.y - prev.y) * (p.x - last.x)) < 1e-6) out.pop();
    out.push(p);
  }
  return out;
}

/** A binary min-heap keyed on a number. */
class Heap<T> {
  private readonly items: { key: number; value: T }[] = [];
  get size(): number {
    return this.items.length;
  }
  push(key: number, value: T): void {
    const a = this.items;
    a.push({ key, value });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent]!.key <= a[i]!.key) break;
      [a[parent], a[i]] = [a[i]!, a[parent]!];
      i = parent;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.key < a[m]!.key) m = l;
        if (r < a.length && a[r]!.key < a[m]!.key) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top.value;
  }
}

/** What a turn costs a route, in canvas units: enough that a straight run beats a staircase of the same length. */
const BEND_COST = 30;

/**
 * The shortest route of horizontal and vertical runs from `a` to `b` that
 * stays out of every box in `blocked`.
 *
 * Searched on the grid of lines through the two ends and along every box's
 * sides: a shortest rectilinear route among boxes can always be slid onto
 * those lines, so nothing shorter is missed. `open` are the two elements being
 * connected — the line may cross them, since it starts and ends inside them.
 */
export function routeAround(a: Point, b: Point, blocked: Rect[], open: Rect[], bounds: Rect): Point[] | null {
  const uniq = (vals: number[], lo: number, hi: number) =>
    [...new Set(vals.filter((v) => v >= lo - 1e-9 && v <= hi + 1e-9).map((v) => Math.round(v * 100) / 100))].sort((p, q) => p - q);
  const xs = uniq([a.x, b.x, bounds.x, bounds.x + bounds.width, ...blocked.flatMap((r) => [r.x, r.x + r.width])], bounds.x, bounds.x + bounds.width);
  const ys = uniq([a.y, b.y, bounds.y, bounds.y + bounds.height, ...blocked.flatMap((r) => [r.y, r.y + r.height])], bounds.y, bounds.y + bounds.height);
  const within = (r: Rect, p: Point) => p.x > r.x + 1e-6 && p.x < r.x + r.width - 1e-6 && p.y > r.y + 1e-6 && p.y < r.y + r.height - 1e-6;
  const free = (p: Point) => open.some((r) => within({ x: r.x - 1e-3, y: r.y - 1e-3, width: r.width + 2e-3, height: r.height + 2e-3 }, p)) || !blocked.some((r) => within(r, p));
  const nearest = (vals: number[], v: number) => vals.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(vals[best]! - v) ? i : best), 0);
  const sx = nearest(xs, a.x);
  const sy = nearest(ys, a.y);
  const tx = nearest(xs, b.x);
  const ty = nearest(ys, b.y);

  const W = xs.length;
  const H = ys.length;
  // State: grid node and the direction it was entered by (0 none, 1 horizontal, 2 vertical).
  const index = (ix: number, iy: number, dir: number) => (iy * W + ix) * 3 + dir;
  const best = new Float64Array(W * H * 3).fill(Infinity);
  const prev = new Int32Array(W * H * 3).fill(-1);
  const heap = new Heap<number>();
  best[index(sx, sy, 0)] = 0;
  heap.push(0, index(sx, sy, 0));
  const heuristic = (ix: number, iy: number) => Math.abs(xs[ix]! - xs[tx]!) + Math.abs(ys[iy]! - ys[ty]!);
  let goal = -1;
  while (heap.size) {
    const state = heap.pop()!;
    const dir = state % 3;
    const node = (state - dir) / 3;
    const ix = node % W;
    const iy = (node - ix) / W;
    if (ix === tx && iy === ty) {
      goal = state;
      break;
    }
    const cost = best[state]!;
    for (const [dx, dy, d] of [[1, 0, 1], [-1, 0, 1], [0, 1, 2], [0, -1, 2]] as const) {
      const nx = ix + dx;
      const ny = iy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const p = { x: xs[ix]!, y: ys[iy]! };
      const q = { x: xs[nx]!, y: ys[ny]! };
      if (!free({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }) || !free(q)) continue;
      const next = index(nx, ny, d);
      const g = cost + Math.abs(q.x - p.x) + Math.abs(q.y - p.y) + (dir !== 0 && dir !== d ? BEND_COST : 0);
      if (g < best[next]! - 1e-9) {
        best[next] = g;
        prev[next] = state;
        heap.push(g + heuristic(nx, ny), next);
      }
    }
  }
  if (goal === -1) return null;
  const line: Point[] = [];
  for (let s = goal; s !== -1; s = prev[s]!) {
    const node = (s - (s % 3)) / 3;
    line.push({ x: xs[node % W]!, y: ys[(node - (node % W)) / W]! });
  }
  line.reverse();
  // The grid is rounded to hundredths; put the true ends back.
  line[0] = { x: a.x, y: a.y };
  line[line.length - 1] = { x: b.x, y: b.y };
  return simplify(line);
}

function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 };
}

/** The boxes a route has to stay out of: an element's bounding box, or each stretch of a drawn line. */
function obstacleBoxes(el: Element): Rect[] {
  if (el.type !== "path" || (el.closed && el.style.fill !== undefined)) return [aabb(el)];
  const half = (el.style.strokeWidth ?? PATH_DEFAULT_STROKE_WIDTH) / 2;
  return pathSegments(el).map(([p, q]) =>
    inflate({ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(q.x - p.x), height: Math.abs(q.y - p.y) }, half),
  );
}

export const connectTool: ToolDef<z.infer<typeof zConnectInput>> = {
  name: "connect",
  description:
    "Draw a path from one element to another. Where the line leaves the first and meets the second is worked out " +
    "for you, and with route='around' so is a way past everything named in 'avoid'.",
  schema: zConnectInput,
  run(ctx, input) {
    const from = requireElement(ctx.doc, input.from);
    const to = requireElement(ctx.doc, input.to);
    if (from.id === to.id) throw new ToolError(`Cannot connect ${from.id} to itself.`);
    const route = input.route ?? "straight";
    if (route !== "around" && (input.avoid !== undefined || input.clearance !== undefined)) {
      throw new ToolError("'avoid' and 'clearance' only apply to route 'around'.");
    }
    const a = mid(aabb(from));
    const b = mid(aabb(to));

    let line: Point[];
    if (route === "straight") line = [a, b];
    else if (route === "elbow") line = simplify([a, { x: b.x, y: a.y }, b]);
    else {
      const skip = new Set([from.id, to.id, ...(input.id ? [input.id] : [])]);
      const avoided =
        input.avoid === "all" || input.avoid === undefined
          ? ctx.doc.elements.filter((e) => !skip.has(e.id))
          : input.avoid.filter((id) => !skip.has(id)).map((id) => requireElement(ctx.doc, id));
      const reach = (input.clearance ?? 0) + (input.style?.strokeWidth ?? PATH_DEFAULT_STROKE_WIDTH) / 2;
      const half = (input.style?.strokeWidth ?? PATH_DEFAULT_STROKE_WIDTH) / 2;
      const found = routeAround(
        a,
        b,
        avoided.flatMap(obstacleBoxes).map((r) => inflate(r, reach)),
        [aabb(from), aabb(to)],
        inflate({ x: 0, y: 0, width: ctx.doc.width, height: ctx.doc.height }, -half),
      );
      if (!found) {
        throw new ToolError(
          `There is no way from ${from.id} to ${to.id} that keeps ${round(input.clearance ?? 0, 1)} units clear of everything avoided.`,
          "Lower the clearance, avoid fewer elements, or move something out of the way.",
        );
      }
      line = found;
    }
    if ((input.ends ?? "edge") === "edge") line = simplify(trimToEdges(line, from, to));
    if (line.length < 2) {
      throw new ToolError(`${from.id} and ${to.id} overlap, so there is no gap to draw a line across.`, "Use ends='center', or move them apart.");
    }
    const length = line.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - line[i]!.x, p.y - line[i]!.y), 0);
    return commitPath(
      ctx,
      { id: input.id, style: input.style, z: input.z, closed: false },
      line.map((p): Pt => [p.x, p.y]),
      `, connecting ${from.id} to ${to.id} (${route}, ${round(length, 1)} units long)`,
    );
  },
};

/** A surface with the drawing tools its vocabulary calls for, and the note that explains a path. */
export function withPaint(surface: ToolSurface): ToolSurface {
  const tools =
    surface.id === "coordinate"
      ? [drawTool]
      : surface.id === "relational"
        ? [sketchTool, connectTool]
        : surface.id === "hybrid"
          ? [drawTool, connectTool]
          : [];
  return { ...surface, notes: [...(surface.notes ?? []), PAINT_NOTE], tools: [...surface.tools, ...tools] };
}
