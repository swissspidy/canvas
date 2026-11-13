/**
 * Reference solutions for the paint family: for each task, a drawing that
 * scores full marks. They prove the checks can be satisfied together
 * (`solvable.test.ts`); no agent ever sees them.
 *
 * The routes are found by the same router `connect` uses, which is the point
 * of having one: a route the reference cannot find is a brief that asks for
 * something the relational surface's own tool cannot do.
 */

import type { Doc, Element, Point, Rect, Style } from "../doc/types.js";
import { normalizeDoc } from "../doc/schema.js";
import { aabb, shapePolygons } from "../doc/geometry.js";
import { boxOfPoints, type Pt } from "../doc/path.js";
import { routeAround } from "../surfaces/paint.js";
import { getTask } from "./index.js";
import { REVISE_SOLUTIONS } from "./paint-revise.js";
import { SESSION_TWINS } from "./session.js";
import {
  AREA_COLOR, AREA_RING, CHIPS, DATA_POINTS, DIAGRAM_SPECS, DOT, DOT_COLOR, EDGES, FLOW_STROKE, FLOW_WIDTH, LINE_COLOR, MAZE_LINE, MAZE_PLAN,
  NETS, PEAK_DOT, PIE, SLICES, SLICE_ANGLES, TRACE_CLEARANCE, TRACE_WIDTH, VISITORS, mazeCellCentre,
} from "./paint.js";

let z = 100;

export function path(id: string, points: Point[], style: Style, closed = false): Element {
  const pts = points.map((p): Pt => [p.x, p.y]);
  return { id, type: "path", ...boxOfPoints(pts), rotation: 0, z: z++, points: pts, style, ...(closed ? { closed: true } : {}) };
}

function shape(id: string, box: Rect, style: Style, rotation = 0): Element {
  return { id, type: "rect", ...box, rotation, z: z++, style };
}

function withAdded(taskId: string, added: Element[]): Doc {
  const doc = getTask(taskId).initial();
  return normalizeDoc({ ...doc, elements: [...doc.elements, ...added] });
}

const inflate = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 });

/** Where the segment a→b crosses a shape's outline, as fractions of the way along. */
function crossings(a: Point, b: Point, el: Element): number[] {
  const out: number[] = [];
  for (const poly of shapePolygons(el)) {
    for (let i = 0; i < poly.length; i++) {
      const c = poly[i]!;
      const d = poly[(i + 1) % poly.length]!;
      const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
      const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push(t);
    }
  }
  return out;
}

const FIRST_SOLUTIONS: Record<string, () => Doc> = {
  "paint.route": () => {
    const doc = getTask("paint.route").initial();
    const reach = TRACE_CLEARANCE + TRACE_WIDTH / 2;
    const bounds = { x: reach, y: reach, width: doc.width - reach * 2, height: doc.height - reach * 2 };
    const chips = CHIPS.map((c) => inflate({ x: c.x, y: c.y, width: c.w, height: c.h }, reach));
    // The order matters: a trace laid first can wall a later pad in. Trying
    // the orders is what an agent has to do too.
    const lay = (order: typeof NETS): Element[] | null => {
      const laid: Rect[] = [];
      const out: Element[] = [];
      for (const net of order) {
        const own = doc.elements.filter((e) => e.id.startsWith(`pad_${net.name}`)).map(aabb);
        const otherPads = doc.elements
          .filter((e) => e.id.startsWith("pad_") && !e.id.startsWith(`pad_${net.name}`))
          .map((e) => inflate(aabb(e), reach));
        const line = routeAround(net.from, net.to, [...chips, ...otherPads, ...laid], own, bounds);
        if (!line) return null;
        // Later traces keep clear of this one: a trace's width plus the gap.
        for (let i = 0; i + 1 < line.length; i++) {
          const p = line[i]!;
          const q = line[i + 1]!;
          laid.push(inflate({ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(q.x - p.x), height: Math.abs(q.y - p.y) }, TRACE_WIDTH + TRACE_CLEARANCE));
        }
        out.push(path(`trace_${net.name}`, line, { strokeColor: net.color, strokeWidth: TRACE_WIDTH }));
      }
      return out;
    };
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map((o) => o.map((i) => NETS[i]!));
    const traces = orders.map(lay).find((t) => t !== null);
    if (!traces) throw new Error("no order of the three nets routes");
    return normalizeDoc({ ...doc, elements: [...doc.elements, ...traces] });
  },

  "paint.maze": () =>
    withAdded("paint.maze", [path("thread", MAZE_PLAN.solution.map(mazeCellCentre), { strokeColor: "#e63946", strokeWidth: MAZE_LINE })]),

  "paint.flowchart": () => arrowsBetween("paint.flowchart", EDGES),
  ...Object.fromEntries(DIAGRAM_SPECS.map((spec) => [spec.id, () => arrowsBetween(spec.id, spec.edges)])),
};

/** Straight arrows from outline to outline along the line joining box centres. */
function arrowsBetween(taskId: string, edges: [string, string][]): Doc {
  {
    const doc = getTask(taskId).initial();
    const byId = new Map(doc.elements.map((e) => [e.id, e]));
    const mid = (e: Element): Point => ({ x: e.x + e.width / 2, y: e.y + e.height / 2 });
    const arrows = edges.map(([from, to]) => {
      const a = mid(byId.get(from)!);
      const b = mid(byId.get(to)!);
      const leave = Math.max(...crossings(a, b, byId.get(from)!));
      const meet = Math.min(...crossings(a, b, byId.get(to)!));
      const at = (t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      return path(`${from}_to_${to}`, [at(leave), at(meet)], { strokeColor: FLOW_STROKE, strokeWidth: FLOW_WIDTH, arrow: "end" });
    });
    return normalizeDoc({ ...doc, elements: [...doc.elements, ...arrows] });
  }
}

const MORE_SOLUTIONS: Record<string, () => Doc> = {
  "paint.chart": () => {
    const peak = VISITORS.indexOf(Math.max(...VISITORS));
    return withAdded("paint.chart", [
      path("area", AREA_RING, { fill: AREA_COLOR }, true),
      path("line", DATA_POINTS, { strokeColor: LINE_COLOR, strokeWidth: 6 }),
      ...DATA_POINTS.map((p, i) => {
        const size = i === peak ? PEAK_DOT : DOT;
        return shape(`dot_${i + 1}`, { x: p.x - size / 2, y: p.y - size / 2, width: size, height: size }, { fill: DOT_COLOR, shape: "ellipse" });
      }),
    ]);
  },

  "paint.pie": () =>
    withAdded(
      "paint.pie",
      SLICES.map((s, i) => {
        const { start, end } = SLICE_ANGLES[i]!;
        // A point every five degrees or so: the chord then misses the arc by a tenth of a percent.
        const steps = Math.ceil((end - start) / 5);
        const ring: Point[] = [{ x: PIE.cx, y: PIE.cy }];
        for (let k = 0; k <= steps; k++) {
          const a = ((start + ((end - start) * k) / steps) * Math.PI) / 180;
          ring.push({ x: PIE.cx + Math.sin(a) * PIE.r, y: PIE.cy - Math.cos(a) * PIE.r });
        }
        return path(`slice_${s.name.toLowerCase()}`, ring, { fill: s.color }, true);
      }),
    ),

  "paint.lighthouse": () => {
    const W = 1080;
    const H = 1350;
    const p = (x: number, y: number): Point => ({ x, y });
    const wave = (y: number, amp: number) => Array.from({ length: 10 }, (_, i) => p(40 + i * 111, y + (i % 2 ? amp : -amp)));
    const els: Element[] = [
      shape("sky", { x: 0, y: 0, width: W, height: H }, { fill: "#1b2a4a", fillTo: "#f4a261", gradientAngle: 90 }),
      shape("moon", { x: 780, y: 130, width: 110, height: 110 }, { fill: "#fdf0d5", shape: "ellipse" }),
      // Straight-sided: a smooth closed curve bulges past its corners, and these corners are the canvas's.
      path("sea", [p(0, 900), p(270, 880), p(540, 905), p(810, 885), p(W, 900), p(W, H), p(0, H)], { fill: "#1d3557" }, true),
      path("beam_left", [p(470, 372), p(20, 250), p(20, 430)], { fill: "#ffd16655" }, true),
      path("beam_right", [p(610, 372), p(1060, 260), p(1060, 440)], { fill: "#ffd16655" }, true),
      path("headland", [p(120, 1150), p(260, 960), p(420, 900), p(640, 890), p(820, 960), p(960, 1150)], { fill: "#3a2e39", curve: "smooth" }, true),
      path("tower", [p(450, 920), p(480, 440), p(600, 440), p(630, 920)], { fill: "#f1faee" }, true),
      path("stripe_1", [p(474, 540), p(606, 540), p(611, 620), p(469, 620)], { fill: "#e63946" }, true),
      path("stripe_2", [p(464, 700), p(616, 700), p(621, 780), p(459, 780)], { fill: "#e63946" }, true),
      path("gallery", [p(455, 440), p(625, 440)], { strokeColor: "#1d1d2b", strokeWidth: 14 }),
      path("lantern", [p(490, 440), p(490, 340), p(590, 340), p(590, 440)], { fill: "#ffd166", strokeColor: "#1d1d2b", strokeWidth: 6 }, true),
      path("roof", [p(475, 340), p(540, 270), p(605, 340)], { fill: "#1d1d2b" }, true),
      path("door", [p(520, 920), p(520, 860), p(540, 840), p(560, 860), p(560, 920)], { fill: "#1d1d2b", curve: "smooth" }, true),
      path("wave_1", wave(1010, 12), { strokeColor: "#a8dadc", strokeWidth: 6, curve: "smooth" }),
      path("wave_2", wave(1080, 14), { strokeColor: "#a8dadc", strokeWidth: 6, curve: "smooth" }),
      path("wave_3", wave(1145, 12), { strokeColor: "#457b9d", strokeWidth: 6, curve: "smooth" }),
      {
        id: "title", type: "text", x: 90, y: 1200, width: 900, height: 110, rotation: 0, z: z++, text: "Lands End Light",
        style: { fontSize: 84, fontWeight: "bold", color: "#fdf0d5", align: "center", valign: "middle" },
      },
    ];
    return normalizeDoc({ width: W, height: H, background: "#ffffff", elements: els });
  },
};

const BASE_SOLUTIONS: Record<string, () => Doc> = { ...FIRST_SOLUTIONS, ...MORE_SOLUTIONS, ...REVISE_SOLUTIONS };

/** A session ends at its single-brief twin's page, so it has the same solution. */
export const PAINT_SOLUTIONS: Record<string, () => Doc> = {
  ...BASE_SOLUTIONS,
  ...Object.fromEntries(Object.entries(SESSION_TWINS).map(([session, twin]) => [session, BASE_SOLUTIONS[twin]!])),
};
