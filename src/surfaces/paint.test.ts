import { describe, expect, it } from "vitest";
import { DocSession } from "../doc/session.js";
import { executeToolCall } from "./execute.js";
import { surfaceFor } from "./index.js";
import { systemPrompt } from "../agent/prompt.js";
import { PAINT_NOTE } from "./paint.js";
import { parseDoc } from "../doc/schema.js";
import { boxOfPoints, pathLength, pathPieces, pointsBounds, segmentPolygonDistance, triangulate } from "../doc/path.js";
import { outOfBoundsArea, polygonArea } from "../doc/geometry.js";
import { renderSvg } from "../render/svg.js";
import { describeDoc } from "../render/describe.js";
import { getTask } from "../tasks/index.js";
import { scoreDocument } from "../eval/score.js";
import { PAINT_SOLUTIONS } from "../tasks/paint-solutions.js";
import { DIAGRAM_SPECS, MAZE_CLEARANCE, MAZE_LINE, NETS, PIE, SLICES, SLICE_ANGLES, TRACE_CLEARANCE, TRACE_WIDTH } from "../tasks/paint.js";
import { aabb, polygonContainsPoint, shapePolygons } from "../doc/geometry.js";
import { inkPolygons } from "../doc/occlusion.js";
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

describe.each(DIAGRAM_SPECS.map((spec) => [spec.id, spec] as const))("the diagram %s", (_id, spec) => {
  const task = getTask(spec.id);
  const start = task.initial();
  const byId = new Map(start.elements.map((e) => [e.id, e]));
  const centre = (e: Element) => ({ x: e.x + e.width / 2, y: e.y + e.height / 2 });

  it("has no arrow whose centre line passes near another shape or label, and every label sits inside its shape", () => {
    for (const [a, b] of spec.edges) {
      const p = centre(byId.get(a)!);
      const q = centre(byId.get(b)!);
      for (const el of start.elements) {
        const owner = el.id.replace(/_label$/, "");
        if (owner === a || owner === b) continue;
        for (const poly of el.type === "text" ? inkPolygons(el) : shapePolygons(el)) {
          expect(segmentPolygonDistance(p, q, poly), `${a} to ${b} passes ${el.id}`).toBeGreaterThanOrEqual(25);
        }
      }
    }
    for (const n of spec.nodes) {
      const shape = shapePolygons(byId.get(n.id)!);
      for (const ink of inkPolygons(byId.get(`${n.id}_label`)!)) {
        for (const pt of ink) expect(shape.some((poly) => polygonContainsPoint(poly, pt)), `${n.id}'s label`).toBe(true);
      }
    }
  });

  it("is finished by connect alone, one call per arrow", () => {
    const s = new DocSession(start);
    for (const [from, to] of spec.edges) call(s, relational, "connect", { from, to, style: { strokeColor: "#1d1d2b", strokeWidth: 5, arrow: "end" } });
    expect(scoreDocument(s.doc, task).score).toBeGreaterThanOrEqual(0.999);
  });

  it("does not pass with arrows ended on each shape's box rather than its outline", () => {
    // The approximation an agent reaches for when it does not derive the
    // outline: where the centre line leaves the bounding box.
    const exitBox = (from: Element, toward: { x: number; y: number }): [number, number] => {
      const b = aabb(from);
      const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      const dx = toward.x - c.x;
      const dy = toward.y - c.y;
      const t = Math.min(dx ? b.width / 2 / Math.abs(dx) : Infinity, dy ? b.height / 2 / Math.abs(dy) : Infinity);
      return [c.x + dx * t, c.y + dy * t];
    };
    const arrows = spec.edges.map(([a, b], i): Element => {
      const pts: [number, number][] = [exitBox(byId.get(a)!, centre(byId.get(b)!)), exitBox(byId.get(b)!, centre(byId.get(a)!))];
      return { id: `p${i}`, type: "path", ...boxOfPoints(pts), rotation: 0, z: 500 + i, points: pts, style: { strokeColor: "#1d1d2b", strokeWidth: 5, arrow: "end" } };
    });
    const doc = parseDoc(JSON.parse(JSON.stringify({ ...start, elements: [...start.elements, ...arrows] })));
    expect(scoreDocument(doc, task).score).toBeLessThan(0.9);
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

describe("revising a large painting", () => {
  // The edits touch 70 elements; every surface must be able to make them in
  // its own vocabulary, or the task measures a missing verb.
  it("can be done on every surface, and scores full marks each way", async () => {
    const { reviseSolution, crownIds, rayIds, birdIds, SUN, SUN_MOVED, RAY_DISTANCE, RAY_COUNT, AUTUMN, NEW_TITLE } = await import("../tasks/paint-revise.js");
    const task = getTask("paint.revise");
    const dx = SUN_MOVED.cx - SUN.cx;
    const dy = SUN_MOVED.cy - SUN.cy;

    const coord = new DocSession(task.initial());
    for (const id of crownIds) call(coord, coordinate, "set_style", { id, style: { fill: AUTUMN } });
    for (const id of ["sun", ...rayIds]) {
      const el = coord.doc.elements.find((e) => e.id === id)!;
      call(coord, coordinate, "move", { id, x: el.x + dx, y: el.y + dy });
    }
    for (const id of birdIds) call(coord, coordinate, "delete", { id });
    call(coord, coordinate, "set_style", { id: "title", text: NEW_TITLE });

    const rel = new DocSession(task.initial());
    for (const id of crownIds) call(rel, relational, "set_style", { id, style: { fill: AUTUMN } });
    call(rel, relational, "align", { ids: ["sun"], edge: "left", to: "canvas", margin: SUN_MOVED.cx - SUN.r });
    call(rel, relational, "align", { ids: ["sun"], edge: "top", to: "canvas", margin: SUN_MOVED.cy - SUN.r });
    rayIds.forEach((id, i) => call(rel, relational, "place", { id, relation: "around", target: "sun", gap: RAY_DISTANCE, angle: (i * 360) / RAY_COUNT }));
    for (const id of birdIds) call(rel, relational, "delete", { id });
    call(rel, relational, "set_style", { id: "title", text: NEW_TITLE });

    const docs = new DocSession(task.initial());
    call(docs, document, "write_document", { document: JSON.parse(JSON.stringify(reviseSolution())) });

    for (const [name, s] of [["coordinate", coord], ["relational", rel], ["document", docs]] as const) {
      expect(scoreDocument(s.doc, task).score, name).toBeGreaterThanOrEqual(0.999);
    }
  });

  it("does not pay for rebuilding the trees instead of recolouring them", async () => {
    const { crownIds, reviseSolution } = await import("../tasks/paint-revise.js");
    const task = getTask("paint.revise");
    const solved = reviseSolution();
    const rebuilt = { ...solved, elements: solved.elements.map((e) => (crownIds.includes(e.id) ? { ...e, id: `new_${e.id}` } : e)) };
    expect(scoreDocument(parseDoc(JSON.parse(JSON.stringify(rebuilt))), task).score).toBeLessThan(0.85);
  });
});

describe("the revision at four sizes", () => {
  it("holds the edits fixed and grows only the untouched scenery", async () => {
    const { SCALE_SIZES, REVISE_SOLUTIONS, SUN, SUN_MOVED } = await import("../tasks/paint-revise.js");
    const edited = (d: Doc) =>
      JSON.stringify(d.elements.filter((e) => /^(sun|ray_|crown_|bird_|title)/.test(e.id)).map(({ z: _z, ...rest }) => rest));
    const tasks = SCALE_SIZES.map((n) => getTask(`paint.revise-${n}`));
    const first = edited(tasks[0]!.initial());
    expect(JSON.parse(first)).toHaveLength(1 + 8 + 12 + 6 + 1);
    tasks.forEach((task, i) => {
      const start = task.initial();
      expect(start.elements, task.id).toHaveLength(SCALE_SIZES[i]!);
      expect(edited(start), task.id).toBe(first);
      expect(scoreDocument(REVISE_SOLUTIONS[task.id]!(), task).score, task.id).toBeGreaterThanOrEqual(0.999);
    });

    // The largest, reached incrementally on both edit surfaces.
    const task = getTask("paint.revise-560");
    const dx = SUN_MOVED.cx - SUN.cx;
    const dy = SUN_MOVED.cy - SUN.cy;
    for (const surface of [coordinate, relational]) {
      const s = new DocSession(task.initial());
      for (let i = 1; i <= 12; i++) call(s, surface, "set_style", { id: `crown_${i}`, style: { fill: "#d9822b" } });
      for (const id of ["sun", ...Array.from({ length: 8 }, (_, i) => `ray_${i + 1}`)]) {
        const el = s.doc.elements.find((e) => e.id === id)!;
        if (surface === coordinate) call(s, surface, "move", { id, x: el.x + dx, y: el.y + dy });
      }
      if (surface === relational) {
        call(s, surface, "align", { ids: ["sun"], edge: "left", to: "canvas", margin: SUN_MOVED.cx - SUN.r });
        call(s, surface, "align", { ids: ["sun"], edge: "top", to: "canvas", margin: SUN_MOVED.cy - SUN.r });
        for (let i = 0; i < 8; i++) call(s, surface, "place", { id: `ray_${i + 1}`, relation: "around", target: "sun", gap: 160, angle: i * 45 });
      }
      for (let i = 1; i <= 6; i++) call(s, surface, "delete", { id: `bird_${i}` });
      call(s, surface, "set_style", { id: "title", text: "Autumn in the Valley" });
      expect(scoreDocument(s.doc, task).score, surface.id).toBeGreaterThanOrEqual(0.999);
    }
  });
});

describe("the document as a model reads it", () => {
  it("is the same document, at about half the tokens of indented JSON", async () => {
    const { documentJson } = await import("./document.js");
    for (const id of ["paint.revise-560", "measure.menu", "repair.overlapping-stack"]) {
      const d = getTask(id).initial();
      const text = documentJson(d);
      expect(JSON.parse(text), id).toEqual(JSON.parse(JSON.stringify(d)));
      if (d.elements.length > 20) expect(text.length, id).toBeLessThan(JSON.stringify(d, null, 2).length * 0.65);
    }
    expect(JSON.parse(documentJson({ width: 10, height: 10, background: "#fff", elements: [] })).elements).toEqual([]);
  });
});

describe("the measured ablation", () => {
  it("is coordinate plus the measuring tools, the same objects relational uses", () => {
    const measured = surfaceFor("measured", { paint: true });
    const coord = surfaceFor("coordinate", { paint: true });
    const rel = surfaceFor("relational", { paint: true });
    const names = measured.tools.map((t) => t.name);
    expect(names).toEqual([...coord.tools.map((t) => t.name), "fit_text", "connect"].filter((n, i, a) => a.indexOf(n) === i).sort((a, b) => names.indexOf(a) - names.indexOf(b)));
    for (const name of ["fit_text", "connect"]) {
      expect(measured.tools.find((t) => t.name === name), name).toBe(rel.tools.find((t) => t.name === name));
    }
    expect(measured.tools.some((t) => t.name === "place" || t.name === "align")).toBe(false);
    expect(surfaceFor("measured").tools.some((t) => t.name === "connect")).toBe(false);
  });

  it("finishes a diagram with connect alone", () => {
    const task = getTask("paint.cycle");
    const s = new DocSession(task.initial());
    const measured = surfaceFor("measured", task);
    for (const [from, to] of DIAGRAM_SPECS.find((d) => d.id === "paint.cycle")!.edges) {
      call(s, measured, "connect", { from, to, style: { strokeColor: "#1d1d2b", strokeWidth: 5, arrow: "end" } });
    }
    expect(scoreDocument(s.doc, task).score).toBeGreaterThanOrEqual(0.999);
  });
});

describe("the strict measured ablation", () => {
  it("draws only through connect, and is measured everywhere else", () => {
    const strict = surfaceFor("measured_strict", { paint: true });
    const names = strict.tools.map((t) => t.name);
    expect(names).toContain("connect");
    expect(names).not.toContain("draw");
    expect(surfaceFor("measured_strict").tools.map((t) => t.name)).toEqual(surfaceFor("measured").tools.map((t) => t.name));
  });
});


describe("editing sessions", () => {
  it("end at their single-brief twin's page, under the same checks, with every instruction delivered", async () => {
    const { SESSION_TWINS } = await import("../tasks/session.js");
    for (const [sessionId, twinId] of Object.entries(SESSION_TWINS)) {
      const session = getTask(sessionId);
      const twin = getTask(twinId);
      expect(session.rounds?.length, sessionId).toBeGreaterThan(1);
      expect(JSON.stringify(session.initial()), sessionId).toBe(JSON.stringify(twin.initial()));
      expect(session.checks.map((c) => [c.id, c.label, c.weight]), sessionId).toEqual(twin.checks.map((c) => [c.id, c.label, c.weight]));
      // Everything the single brief asked for is asked for somewhere in the session.
      const all = [session.brief, ...session.rounds!].join("\n");
      for (const line of twin.brief.split("\n").filter((l) => l.startsWith("- from ") || /^\d\. /.test(l))) {
        expect(all, `${sessionId}: ${line}`).toContain(line.replace(/^\d\. /, ""));
      }
    }
  });
});
