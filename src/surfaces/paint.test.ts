import { describe, expect, it } from "vitest";
import { DocSession } from "../doc/session.js";
import { executeToolCall } from "./execute.js";
import { surfaceFor } from "./index.js";
import { systemPrompt } from "../agent/prompt.js";
import { PAINT_NOTE } from "./paint.js";
import { parseDoc } from "../doc/schema.js";
import { boxOfPoints, pathLength, pathPieces, pointsBounds, triangulate } from "../doc/path.js";
import { outOfBoundsArea, polygonArea } from "../doc/geometry.js";
import { renderSvg } from "../render/svg.js";
import { describeDoc } from "../render/describe.js";
import { getTask } from "../tasks/index.js";
import { scoreDocument } from "../eval/score.js";
import { PAINT_SOLUTIONS } from "../tasks/paint-solutions.js";
import { MAZE_CLEARANCE, MAZE_LINE, NETS, PIE, SLICES, SLICE_ANGLES, TRACE_CLEARANCE, TRACE_WIDTH } from "../tasks/paint.js";
import type { Doc, Element } from "../doc/types.js";

const coordinate = surfaceFor("coordinate", { paint: true });
const relational = surfaceFor("relational", { paint: true });
const document = surfaceFor("document", { paint: true });

const blank = (): Doc => ({ width: 1000, height: 800, background: "#ffffff", elements: [] });
const box = (id: string, x: number, y: number, w = 100, h = 100, style: Element["style"] = { fill: "#888888" }): Element => ({
  id, type: "rect", x, y, width: w, height: h, rotation: 0, z: 0, style,
});

function call(session: DocSession, surface: typeof coordinate, name: string, input: unknown) {
  const result = executeToolCall(session, surface, name, input);
  if (!result.ok) throw new Error(result.message);
  return result;
}
const last = (s: DocSession) => s.doc.elements[s.doc.elements.length - 1]!;
const scoreOf = (taskId: string, doc: Doc) => scoreDocument(doc, getTask(taskId));

describe("the path element", () => {
  it("takes the bounding box of its points when it is given no box", () => {
    const doc = parseDoc({ ...blank(), elements: [{ id: "p", type: "path", z: 0, points: [[100, 200], [400, 260]] }] });
    expect(doc.elements[0]).toMatchObject({ x: 100, y: 200, width: 300, height: 60, points: [[100, 200], [400, 260]] });
  });

  it("gives a level line a one-unit box centred on it, and leaves the line where it was drawn", () => {
    const doc = parseDoc({ ...blank(), elements: [{ id: "p", type: "path", z: 0, points: [[10, 50], [90, 50]] }] });
    expect(doc.elements[0]).toMatchObject({ y: 49.5, height: 1, points: [[10, 50], [90, 50]] });
  });

  it("carries its points with it when moved and scales them when resized", () => {
    const s = new DocSession(blank());
    call(s, coordinate, "draw", { points: [[100, 100], [300, 200], [200, 300]] });
    call(s, coordinate, "move", { id: "el_1", x: 500, y: 0 });
    expect(last(s).points).toEqual([[500, 0], [700, 100], [600, 200]]);
    call(s, coordinate, "resize", { id: "el_1", width: 100, height: 400 });
    expect(last(s).points).toEqual([[500, 0], [600, 200], [550, 400]]);
    expect(pointsBounds(last(s).points!)).toEqual({ x: 500, y: 0, width: 100, height: 400 });
  });

  it("is stable under normalizing again", () => {
    const s = new DocSession(blank());
    call(s, coordinate, "draw", { points: [[10.123, 20.456], [333.333, 77.777], [50, 400]], style: { curve: "smooth" } });
    expect(JSON.stringify(parseDoc(JSON.parse(JSON.stringify(s.doc))))).toBe(JSON.stringify(s.doc));
  });

  it("refuses points on anything but a path, a path without points, and a half-given box", () => {
    const bad = (el: object) => () => parseDoc({ ...blank(), elements: [el] });
    expect(bad({ id: "r", type: "rect", x: 0, y: 0, width: 10, height: 10, z: 0, points: [[0, 0], [1, 1]] })).toThrow(/validation/);
    expect(bad({ id: "p", type: "path", z: 0 })).toThrow(/validation/);
    expect(bad({ id: "p", type: "path", z: 0, x: 0, points: [[0, 0], [1, 1]] })).toThrow(/validation/);
    expect(bad({ id: "p", type: "path", z: 0, closed: true, points: [[0, 0], [1, 1]] })).toThrow(/validation/);
    expect(bad({ id: "r", type: "rect", y: 0, width: 10, height: 10, z: 0 })).toThrow(/validation/);
  });

  it("triangulates a concave outline to its exact area", () => {
    // An L: a 100 square with a 50 square bitten out of one corner.
    const ring = [[0, 0], [100, 0], [100, 50], [50, 50], [50, 100], [0, 100]].map(([x, y]) => ({ x: x!, y: y! }));
    expect(triangulate(ring).reduce((sum, t) => sum + polygonArea(t), 0)).toBeCloseTo(7500, 6);
  });

  it("measures a stroke by its width: half of it hangs off an edge it is drawn along", () => {
    const el: Element = { id: "p", type: "path", ...boxOfPoints([[0, 100], [0, 300]]), rotation: 0, z: 0, points: [[0, 100], [0, 300]], style: { strokeWidth: 20, lineCap: "butt" } };
    expect(outOfBoundsArea(el, { x: 0, y: 0, width: 1000, height: 800 })).toBeCloseTo(2000, 3);
    expect(pathPieces(el).stroke).toHaveLength(1);
    expect(pathLength(el)).toBe(200);
  });

  it("renders and describes a path, and paints a gradient whatever the element is called", () => {
    const doc = parseDoc({
      ...blank(),
      elements: [
        { id: "a b)", type: "rect", x: 0, y: 0, width: 50, height: 50, z: 0, style: { fill: "#000000", fillTo: "#ffffff" } },
        { id: "p", type: "path", z: 1, points: [[10, 10], [90, 10], [50, 80]], closed: true, style: { fill: "#ff0000", strokeColor: "#000000", arrow: "end" } },
      ],
    });
    const svg = renderSvg(doc);
    expect(svg).toContain('fill="url(#fill_0)"');
    expect(svg).toContain("M10 10 L90 10 L50 80 Z");
    // A closed path has no ends to put an arrowhead on.
    expect(svg).not.toContain("<polygon");
    expect(describeDoc(doc)).toContain("closed path through 3 point(s)");
  });
});

describe("drawing tools", () => {
  it("are attached only when asked for, with the note that explains a path", () => {
    expect(surfaceFor("coordinate").tools.map((t) => t.name)).not.toContain("draw");
    expect(coordinate.tools.map((t) => t.name)).toContain("draw");
    expect(relational.tools.map((t) => t.name)).toEqual(expect.arrayContaining(["draw", "connect"]));
    expect(document.tools.map((t) => t.name)).toEqual(["read_document", "write_document"]);
    for (const s of [coordinate, relational, document]) expect(systemPrompt(s)).toContain(PAINT_NOTE);
    expect(systemPrompt(surfaceFor("coordinate"))).not.toContain("a path:");
    const names = surfaceFor("hybrid", { paint: true, motion: true }).tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("reach the same path on every surface", () => {
    const start = (): Doc => ({ ...blank(), elements: [box("a", 100, 100), box("b", 600, 500, 200, 100)] });
    const style = { strokeColor: "#ff0000", strokeWidth: 6, curve: "smooth" as const };

    const c = new DocSession(start());
    call(c, coordinate, "draw", { points: [[200, 150], [400, 90], [700, 500]], style });

    const r = new DocSession(start());
    call(r, relational, "draw", {
      points: [{ on: "a", anchor: "right" }, { on: "canvas", anchor: "top_left", dx: 400, dy: 90 }, { on: "b", anchor: "top" }],
      style,
    });

    const d = new DocSession(start());
    call(d, document, "write_document", {
      document: { ...start(), elements: [...start().elements, { id: "el_1", type: "path", z: 1, points: [[200, 150], [400, 90], [700, 500]], style }] },
    });

    expect(last(r)).toEqual(last(c));
    expect(last(d)).toEqual(last(c));
  });

  it("redraw an existing path in place, keeping its id and style", () => {
    const s = new DocSession(blank());
    call(s, coordinate, "draw", { points: [[0, 0], [100, 100]], style: { strokeColor: "#00ff00" } });
    call(s, coordinate, "draw", { id: "el_1", points: [[50, 50], [200, 50], [200, 300]], closed: true });
    expect(s.doc.elements).toHaveLength(1);
    expect(last(s)).toMatchObject({ id: "el_1", closed: true, style: { strokeColor: "#00ff00" }, points: [[50, 50], [200, 50], [200, 300]] });
    expect(executeToolCall(s, coordinate, "draw", { points: [[0, 0], [1, 1]], closed: true }).ok).toBe(false);
  });

  it("connect stops a straight line on each outline, whatever the shape", () => {
    const s = new DocSession({
      ...blank(),
      elements: [box("a", 100, 300, 200, 200, { fill: "#888888", shape: "ellipse" }), box("b", 600, 300, 200, 200, { fill: "#888888", shape: "polygon", sides: 4 })],
    });
    call(s, relational, "connect", { from: "a", to: "b" });
    // The ellipse's right-hand point and the diamond's left-hand corner.
    expect(last(s).points![0]![0]).toBeCloseTo(300, 0);
    expect(last(s).points![1]![0]).toBeCloseTo(600, 0);
    expect(last(s).points!.every(([, y]) => Math.abs(y - 400) < 0.01)).toBe(true);
  });

  it("connect refuses arguments it would ignore, and says when there is no way through", () => {
    const walled: Doc = {
      ...blank(),
      elements: [box("a", 50, 350), box("b", 850, 350), box("wall", 480, -10, 40, 820)],
    };
    const s = new DocSession(walled);
    expect(executeToolCall(s, relational, "connect", { from: "a", to: "b", clearance: 5 }).message).toMatch(/only apply/);
    expect(executeToolCall(s, relational, "connect", { from: "a", to: "b", route: "around", avoid: "all" }).message).toMatch(/no way/);
    expect(executeToolCall(s, relational, "connect", { from: "a", to: "a" }).ok).toBe(false);
  });
});

describe("the paint tasks, drawn with the relational tools", () => {
  it("connect finds the way through the maze", () => {
    const s = new DocSession(getTask("paint.maze").initial());
    call(s, relational, "connect", {
      from: "start", to: "goal", route: "around", avoid: "all", ends: "center", clearance: MAZE_CLEARANCE,
      style: { strokeColor: "#e63946", strokeWidth: MAZE_LINE },
    });
    expect(scoreOf("paint.maze", s.doc).score).toBeGreaterThanOrEqual(0.999);
  });

  it("connect routes the board, in an order that does not wall a pad in", () => {
    const attempt = (order: typeof NETS) => {
      const s = new DocSession(getTask("paint.route").initial());
      for (const net of order) {
        const r = executeToolCall(s, relational, "connect", {
          from: `pad_${net.name}1`, to: `pad_${net.name}2`, route: "around", avoid: "all", ends: "center", clearance: TRACE_CLEARANCE,
          style: { strokeColor: net.color, strokeWidth: TRACE_WIDTH },
        });
        if (!r.ok) return 0;
      }
      return scoreOf("paint.route", s.doc).score;
    };
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map((o) => o.map((i) => NETS[i]!));
    const scores = orders.map(attempt);
    expect(Math.max(...scores)).toBeGreaterThanOrEqual(0.999);
    // And not every order works, which is what makes it a task.
    expect(Math.min(...scores)).toBeLessThan(0.999);
  });

  it("connect draws every flowchart arrow outline to outline", () => {
    const task = getTask("paint.flowchart");
    const s = new DocSession(task.initial());
    for (const [from, to] of [["brief", "draft"], ["draft", "review"], ["review", "revise"], ["revise", "draft"], ["review", "publish"], ["publish", "archive"], ["revise", "archive"]]) {
      call(s, relational, "connect", { from, to, style: { strokeColor: "#1d1d2b", strokeWidth: 5, arrow: "end" } });
    }
    expect(scoreDocument(s.doc, task).score).toBeGreaterThanOrEqual(0.999);
  });
});

describe("the paint tasks cannot be satisfied cheaply", () => {
  const add = (taskId: string, ...els: Element[]): Doc => {
    const doc = getTask(taskId).initial();
    return parseDoc(JSON.parse(JSON.stringify({ ...doc, elements: [...doc.elements, ...els] })));
  };
  const line = (id: string, points: [number, number][], style: Element["style"], closed = false): Element =>
    ({ id, type: "path", ...boxOfPoints(points), rotation: 0, z: 500, points, style, ...(closed ? { closed: true } : {}) });

  it("a straight line through the maze's walls scores far below the way through", () => {
    const straight = add("paint.maze", line("p", [[120, 120], [960, 720]], { strokeColor: "#e63946", strokeWidth: MAZE_LINE }));
    const check = scoreOf("paint.maze", straight).results.find((r) => r.id === "path_clear")!;
    expect(check.score).toBe(0);
    expect(scoreOf("paint.maze", straight).score).toBeLessThan(0.75);
  });

  it("an invisible path earns nothing", () => {
    for (const id of ["paint.maze", "paint.route", "paint.pie"]) {
      const task = getTask(id);
      const ghost = add(id, line("ghost", [[120, 120], [960, 720], [500, 100]], { strokeColor: "#e63946", fill: "#264653", opacity: 0 }, true));
      expect(scoreDocument(ghost, task).score, id).toBeCloseTo(scoreDocument(task.initial(), task).score, 6);
    }
  });

  it("a pie slice with a straight outer edge does not pass for its sector", () => {
    const corner = (deg: number): [number, number] => [PIE.cx + Math.sin((deg * Math.PI) / 180) * PIE.r, PIE.cy - Math.cos((deg * Math.PI) / 180) * PIE.r];
    const chords = add(
      "paint.pie",
      ...SLICES.map((s, i) => line(`s${i}`, [[PIE.cx, PIE.cy], corner(SLICE_ANGLES[i]!.start), corner(SLICE_ANGLES[i]!.end)], { fill: s.color }, true)),
    );
    const scored = scoreOf("paint.pie", chords);
    expect(scored.results.filter((r) => r.id === "region").every((r) => r.score < 0.999)).toBe(true);
    expect(scored.score).toBeLessThan(scoreOf("paint.pie", PAINT_SOLUTIONS["paint.pie"]!()).score);
  });

  it("a pie drawn as smooth curves through a few points passes: the mask does not care how", () => {
    const at = (deg: number, r = PIE.r): [number, number] => [PIE.cx + Math.sin((deg * Math.PI) / 180) * r, PIE.cy - Math.cos((deg * Math.PI) / 180) * r];
    const dense = add(
      "paint.pie",
      ...SLICES.map((s, i) => {
        const { start, end } = SLICE_ANGLES[i]!;
        const n = Math.ceil((end - start) / 12);
        const arc = Array.from({ length: n + 1 }, (_, k) => at(start + ((end - start) * k) / n));
        return line(`s${i}`, [[PIE.cx, PIE.cy], ...arc], { fill: s.color }, true);
      }),
    );
    expect(scoreOf("paint.pie", dense).score).toBeGreaterThanOrEqual(0.999);
  });

  it("a flowchart arrow drawn box to box rather than outline to outline loses its marks", () => {
    // From the oval's bounding box corner region, not its curve.
    const sloppy = add("paint.flowchart", line("p", [[310, 120], [530, 105]], { strokeColor: "#1d1d2b", strokeWidth: 5, arrow: "end" }));
    const first = scoreOf("paint.flowchart", sloppy).results.find((r) => r.id === "connects")!;
    expect(first.score).toBeLessThan(1);
    const backwards = add("paint.flowchart", line("p", [[530, 105.2], [309.6, 119.1]], { strokeColor: "#1d1d2b", strokeWidth: 5, arrow: "end" }));
    expect(scoreOf("paint.flowchart", backwards).results.find((r) => r.id === "connects")!.score).toBeLessThan(0.5);
  });
});
