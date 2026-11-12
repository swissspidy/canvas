/**
 * The paint family: tasks that are drawn rather than laid out.
 *
 * Three rounds of harder layout tasks all ended the same way — a strong model
 * computes exact box arithmetic exactly (`docs/PREREGISTRATION.md` §13). These
 * ask for something else. A route has to be *found*: between chips, through a
 * maze, with nothing in the brief to compute it from. A connector ends where a
 * line meets an ellipse or a diamond, not where a box does. A pie slice has a
 * curved edge that no primitive draws, so it has to be approximated well
 * enough to cover the same paper. And an illustration has no right answer at
 * all, only a better and a worse one, which is what the judge and the pairwise
 * comparison are for.
 *
 * Prototypes, like `proto` and `anim`: resolvable by id or together as
 * `paint` (see `paintTasks` for which), and in no default sweep or grid until
 * a pilot says they separate something. Each carries `paint: true`, which attaches the drawing tools and
 * the paragraph explaining a path.
 */

import { defineTask } from "./types.js";
import { blank, doc, rect, text } from "./helpers.js";
import type { Doc, Element, Point } from "../doc/types.js";
import type { Check } from "../eval/checks.js";
import { check, containsText, coverage, fontSizeAtLeast, geometryUnchanged, preservesElements, styleUnchanged } from "../eval/checks.js";
import {
  connects,
  pathClearOf,
  pathCount,
  pathEnds,
  pathLengthAtMost,
  pathOrthogonal,
  pathThrough,
  pathWith,
  pathsApart,
  regionCovers,
  sectorRing,
  styleIs,
} from "../eval/paint.js";
import { reviseTasks } from "./paint-revise.js";
import { paintsAnything } from "../doc/occlusion.js";

// --- paint.route ---------------------------------------------------------------

export const BOARD = { width: 1200, height: 800 };

/** Chips: where a trace may not go. */
export const CHIPS = [
  { x: 200, y: 110, w: 180, h: 170 },
  { x: 470, y: 60, w: 140, h: 260 },
  { x: 700, y: 150, w: 220, h: 120 },
  { x: 990, y: 190, w: 120, h: 200 },
  { x: 130, y: 380, w: 250, h: 110 },
  { x: 460, y: 400, w: 120, h: 260 },
  { x: 660, y: 360, w: 200, h: 140 },
  { x: 930, y: 470, w: 170, h: 120 },
  { x: 180, y: 580, w: 200, h: 130 },
  { x: 680, y: 590, w: 260, h: 110 },
].map((c, i) => ({ ...c, id: `chip_${i + 1}` }));

const PAD = 36;
/** Pads, in pairs: each trace joins the two of one colour. */
export const NETS = [
  { name: "a", color: "#ffd166", from: { x: 70, y: 70 }, to: { x: 1150, y: 430 } },
  { name: "b", color: "#ef476f", from: { x: 70, y: 740 }, to: { x: 640, y: 330 } },
  { name: "c", color: "#4cc9f0", from: { x: 425, y: 30 }, to: { x: 1000, y: 740 } },
];
export const TRACE_WIDTH = 10;
export const TRACE_CLEARANCE = 12;
export const TRACE_MAX_LENGTH = 2300;

const padIds = NETS.flatMap((n) => [`pad_${n.name}1`, `pad_${n.name}2`]);
const chipIds = CHIPS.map((c) => c.id);

const board = (): Doc =>
  doc(
    [
      ...CHIPS.map((c) => rect({ ...c, style: { fill: "#2f5d46", radius: 8 } })),
      ...NETS.flatMap((n) =>
        [n.from, n.to].map((p, i) =>
          rect({ id: `pad_${n.name}${i + 1}`, x: p.x - PAD / 2, y: p.y - PAD / 2, w: PAD, h: PAD, style: { fill: n.color, shape: "ellipse" } }),
        ),
      ),
    ],
    { ...BOARD, background: "#10261c" },
  );

const trace = (color: string) => pathWith({ stroke: color, closed: false });
const anyTrace = (el: Element) => NETS.some((n) => trace(n.color)(el));

const route = defineTask({
  id: "paint.route",
  title: "Route three traces across a circuit board",
  family: "paint",
  paint: true,
  brief: [
    `This is a circuit board, ${BOARD.width} by ${BOARD.height}. The ten rounded rectangles are chips, and the six circles are pads, two of each of three colours.`,
    `Draw three traces, one for each colour: an open path that starts at the centre of one pad and ends at the centre of the other pad of the same colour, stroked in that pad's colour at strokeWidth ${TRACE_WIDTH}, with no arrowheads and straight segments.`,
    "",
    "- Every run of a trace is horizontal or vertical.",
    `- The edge of a trace stays at least ${TRACE_CLEARANCE} units away from every chip and from every pad of another colour. A trace is ${TRACE_WIDTH} wide, so its centre line stays ${TRACE_CLEARANCE + TRACE_WIDTH / 2} away.`,
    `- No two traces cross or touch: their edges stay at least ${TRACE_CLEARANCE} units apart.`,
    `- No trace is longer than ${TRACE_MAX_LENGTH} units, and every trace stays on the board.`,
    "- Do not move, restyle or delete the chips or the pads, and add nothing but the three traces.",
  ].join("\n"),
  initial: board,
  checks: [
    ...NETS.flatMap((n): Check[] => [
      pathCount(trace(n.color), 1, 1, `One ${n.color} trace`),
      pathEnds(trace(n.color), n.from, n.to, 2, { label: `The ${n.color} trace joins its two pads, centre to centre` }),
      pathClearOf(
        trace(n.color),
        [...chipIds, ...padIds.filter((id) => !id.startsWith(`pad_${n.name}`))],
        TRACE_CLEARANCE,
        4,
        `The ${n.color} trace keeps ${TRACE_CLEARANCE} units clear of the chips and the other pads`,
      ),
    ]),
    pathsApart(anyTrace, TRACE_CLEARANCE, 5, "No two traces cross or come within 12 units"),
    pathOrthogonal(anyTrace, 2, "Traces run only horizontally and vertically"),
    pathLengthAtMost(anyTrace, TRACE_MAX_LENGTH, 2),
    styleIs(anyTrace, { strokeWidth: TRACE_WIDTH }, 1, `Traces are ${TRACE_WIDTH} wide`),
    geometryUnchanged(board(), [...chipIds, ...padIds], 2),
    preservesElements([...chipIds, ...padIds], 2),
    pathCount((el) => el.type === "path" && paintsAnything(el), 3, 1, "Nothing drawn but the three traces"),
  ],
  judgeCriteria: ["Reads as a tidy circuit board: traces take direct, deliberate routes rather than wandering."],
  maxTurns: 30,
});

// --- paint.maze ----------------------------------------------------------------

export const MAZE = { cols: 8, rows: 6, cell: 120, x: 60, y: 60, wall: 12 };
export const MAZE_CANVAS = { width: MAZE.x * 2 + MAZE.cols * MAZE.cell, height: MAZE.y * 2 + MAZE.rows * MAZE.cell };
export const MAZE_LINE = 8;
export const MAZE_CLEARANCE = 10;

/** A fixed pseudo-random stream, so the maze is the same maze on every machine. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Maze {
  /** `open[r][c]` holds whether the cell's right and bottom walls are open. */
  right: boolean[][];
  down: boolean[][];
  /** The one way through, as cells from start to goal. */
  solution: [number, number][];
}

/** A perfect maze by depth-first carving: exactly one route between any two cells. */
function carve(): Maze {
  const { cols, rows } = MAZE;
  const rnd = lcg(20261111);
  const right = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));
  const down = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));
  const seen = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));
  const parent = new Map<string, [number, number] | null>([["0,0", null]]);
  const stack: [number, number][] = [[0, 0]];
  seen[0]![0] = true;
  while (stack.length) {
    const [c, r] = stack[stack.length - 1]!;
    const next = ([[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]] as [number, number][]).filter(
      ([nc, nr]) => nc >= 0 && nr >= 0 && nc < cols && nr < rows && !seen[nr]![nc],
    );
    if (next.length === 0) {
      stack.pop();
      continue;
    }
    const [nc, nr] = next[Math.floor(rnd() * next.length)]!;
    if (nc > c) right[r]![c] = true;
    else if (nc < c) right[r]![nc] = true;
    else if (nr > r) down[r]![c] = true;
    else down[nr]![c] = true;
    seen[nr]![nc] = true;
    parent.set(`${nc},${nr}`, [c, r]);
    stack.push([nc, nr]);
  }
  const solution: [number, number][] = [];
  for (let at: [number, number] | null = [cols - 1, rows - 1]; at; at = parent.get(`${at[0]},${at[1]}`) ?? null) solution.push(at);
  return { right, down, solution: solution.reverse() };
}

export const MAZE_PLAN = carve();
export const mazeCellCentre = ([c, r]: [number, number]): Point => ({ x: MAZE.x + (c + 0.5) * MAZE.cell, y: MAZE.y + (r + 0.5) * MAZE.cell });
/** Length of the one way through, cell centre to cell centre. */
export const MAZE_ROUTE_LENGTH = (MAZE_PLAN.solution.length - 1) * MAZE.cell;
/** A fifth more than the way through: room for a wobble, none for a different route (there is none). */
export const MAZE_MAX_LENGTH = Math.round((MAZE_ROUTE_LENGTH * 1.2) / 10) * 10;

/** Walls, with runs along one line merged into single rects so the document stays readable. */
function mazeWalls(): Element[] {
  const { cols, rows, cell, x, y, wall } = MAZE;
  const out: Element[] = [];
  let n = 0;
  const add = (x0: number, y0: number, x1: number, y1: number) =>
    out.push(
      rect({
        id: `wall_${++n}`,
        x: Math.min(x0, x1) - wall / 2,
        y: Math.min(y0, y1) - wall / 2,
        w: Math.abs(x1 - x0) + wall,
        h: Math.abs(y1 - y0) + wall,
        style: { fill: "#1d1d2b" },
      }),
    );
  // Horizontal lines: line k sits above row k. Outer lines are solid.
  for (let k = 0; k <= rows; k++) {
    let start: number | null = null;
    for (let c = 0; c <= cols; c++) {
      const solid = c < cols && (k === 0 || k === rows || !MAZE_PLAN.down[k - 1]![c]);
      if (solid && start === null) start = c;
      if (!solid && start !== null) {
        add(x + start * cell, y + k * cell, x + c * cell, y + k * cell);
        start = null;
      }
    }
  }
  for (let k = 0; k <= cols; k++) {
    let start: number | null = null;
    for (let r = 0; r <= rows; r++) {
      const solid = r < rows && (k === 0 || k === cols || !MAZE_PLAN.right[r]![k - 1]);
      if (solid && start === null) start = r;
      if (!solid && start !== null) {
        add(x + k * cell, y + start * cell, x + k * cell, y + r * cell);
        start = null;
      }
    }
  }
  return out;
}

const MARK = 44;
const mazeStart = mazeCellCentre([0, 0]);
const mazeGoal = mazeCellCentre([MAZE.cols - 1, MAZE.rows - 1]);

const maze = (): Doc =>
  doc(
    [
      ...mazeWalls(),
      rect({ id: "start", x: mazeStart.x - MARK / 2, y: mazeStart.y - MARK / 2, w: MARK, h: MARK, style: { fill: "#2a9d8f", shape: "ellipse" } }),
      rect({ id: "goal", x: mazeGoal.x - MARK / 2, y: mazeGoal.y - MARK / 2, w: MARK, h: MARK, style: { fill: "#f4a261", shape: "star" } }),
    ],
    { ...MAZE_CANVAS, background: "#f7f4ee" },
  );

const wallIds = mazeWalls().map((w) => w.id);
const thread = pathWith({ stroke: "#e63946", closed: false });

const mazeTask = defineTask({
  id: "paint.maze",
  title: "Draw the way through a maze",
  family: "paint",
  paint: true,
  brief: [
    `This is a maze of ${MAZE.cols} by ${MAZE.rows} cells, each ${MAZE.cell} units square. The dark rectangles are its walls, each ${MAZE.wall} units thick. The green circle marks the start and the orange star the goal.`,
    `Draw the way through: one open path from the centre of the circle to the centre of the star, stroked in #e63946 at strokeWidth ${MAZE_LINE}, with straight segments and no arrowheads.`,
    "",
    `- The line never touches a wall: its edge stays at least ${MAZE_CLEARANCE} units from every wall.`,
    `- It is no longer than ${MAZE_MAX_LENGTH} units.`,
    "- Do not move, restyle or delete the walls or the two markers, and add nothing but the one path.",
  ].join("\n"),
  initial: maze,
  checks: [
    pathCount(thread, 1, 1, "One red path"),
    pathEnds(thread, mazeStart, mazeGoal, 3, { label: "The path runs from the centre of the start to the centre of the goal" }),
    pathClearOf(thread, wallIds, MAZE_CLEARANCE, 12, `The path keeps ${MAZE_CLEARANCE} units clear of every wall`),
    pathLengthAtMost(thread, MAZE_MAX_LENGTH, 1),
    styleIs(thread, { strokeWidth: MAZE_LINE }, 1, `The path is ${MAZE_LINE} wide`),
    geometryUnchanged(maze(), [...wallIds, "start", "goal"], 2),
    preservesElements([...wallIds, "start", "goal"], 2),
    pathCount((el) => el.type === "path" && paintsAnything(el), 1, 1, "Nothing drawn but the one path"),
  ],
  judgeCriteria: ["The route reads as one clean line through the corridors, not a scribble."],
  maxTurns: 30,
});

// --- paint.flowchart -----------------------------------------------------------

/** Boxes, ovals and one diamond: a line meets each of them somewhere different. */
export const NODES = [
  { id: "brief", label: "Brief", x: 90, y: 70, w: 220, h: 100, shape: "ellipse", fill: "#1f6f66" },
  { id: "draft", label: "Draft", x: 530, y: 50, w: 230, h: 110, shape: "rect", fill: "#264653" },
  { id: "review", label: "Review", x: 860, y: 290, w: 260, h: 210, shape: "polygon", fill: "#a63d2a" },
  { id: "revise", label: "Revise", x: 420, y: 400, w: 210, h: 100, shape: "rect", fill: "#264653" },
  { id: "publish", label: "Publish", x: 880, y: 690, w: 230, h: 120, shape: "rect", fill: "#264653" },
  { id: "archive", label: "Archive", x: 120, y: 660, w: 240, h: 130, shape: "ellipse", fill: "#6d597a" },
] as const;

export const EDGES: [string, string][] = [
  ["brief", "draft"],
  ["draft", "review"],
  ["review", "revise"],
  ["revise", "draft"],
  ["review", "publish"],
  ["publish", "archive"],
  ["revise", "archive"],
];

export const FLOW_STROKE = "#1d1d2b";
export const FLOW_WIDTH = 5;

const flowchart = (): Doc =>
  doc(
    [
      ...NODES.map((n) =>
        rect({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, style: { fill: n.fill, ...(n.shape === "rect" ? { radius: 0 } : { shape: n.shape, ...(n.shape === "polygon" ? { sides: 4 } : {}) }) } }),
      ),
      ...NODES.map((n) =>
        text({ id: `${n.id}_label`, x: n.x, y: n.y, w: n.w, h: n.h, text: n.label, style: { fontSize: 34, fontWeight: "bold", color: "#ffffff", align: "center", valign: "middle" } }),
      ),
    ],
    { width: 1200, height: 880, background: "#f7f4ee" },
  );

const nodeIds = NODES.flatMap((n) => [n.id, `${n.id}_label`]);
const connector = pathWith({ closed: false });
const sayNode = (id: string) => `'${NODES.find((n) => n.id === id)!.label}'`;

const flow = defineTask({
  id: "paint.flowchart",
  title: "Connect a flowchart's shapes with arrows",
  family: "paint",
  paint: true,
  brief: [
    "This flowchart has six shapes — two rectangles on the top row and two below, two ovals and a diamond — each with a label on it, and no connectors yet. Draw these seven arrows:",
    "",
    ...EDGES.map(([a, b]) => `- from ${sayNode(a)} to ${sayNode(b)}`),
    "",
    `Each arrow is an open path of exactly two points, stroked in ${FLOW_STROKE} at strokeWidth ${FLOW_WIDTH}, with an arrowhead at its end (style.arrow 'end').`,
    "It runs along the straight line joining the centres of the two shapes, but covers only the gap between them: it starts exactly on the outline of the shape it comes from and ends exactly on the outline of the shape it goes to, to within 2 units. The outline is the shape as drawn — an oval's curve and the diamond's slanted sides, not the box around them.",
    "Do not move, restyle or delete the shapes or their labels, and add nothing but the seven arrows.",
  ].join("\n"),
  initial: flowchart,
  checks: [
    ...EDGES.map(([a, b]) => connects(a, b, 3, { arrow: true, label: `An arrow runs from ${sayNode(a)} to ${sayNode(b)}, outline to outline` })),
    pathCount((el) => el.type === "path" && paintsAnything(el), EDGES.length, 2, "Exactly seven paths"),
    styleIs(connector, { strokeColor: FLOW_STROKE, strokeWidth: FLOW_WIDTH }, 2, "Arrows are drawn in the stated stroke"),
    geometryUnchanged(flowchart(), nodeIds, 2),
    preservesElements(nodeIds, 2),
    styleUnchanged(flowchart(), nodeIds, 1),
  ],
  judgeCriteria: ["Reads as a clear flowchart: every arrow visibly joins the two shapes it is meant to."],
  maxTurns: 30,
});

// --- paint.diagram -------------------------------------------------------------

/**
 * The flowchart, built out around the one miss the Luna pilot found: an arrow
 * landing a few units off an oval's curve. Twelve shapes and twenty arrows, nearly all of the shapes
 * curved, slanted or turned, so every one of forty endpoints is a line
 * meeting an outline that is not a box — an ellipse at an angle, a pentagon
 * stretched to its box, a rotated octagon — and several arrows meet their
 * shape at a shallow angle, where a small error across the line is a large
 * one along it. `connect` works each end out; on the other surfaces the agent
 * derives the outline from the box, the rotation and the stretching rule.
 */
export const DIAGRAM = { width: 1400, height: 1000 };

export interface DiagramNode {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: "rect" | "ellipse" | "polygon";
  sides?: number;
  rot?: number;
  fill: string;
}

export const DIAGRAM_NODES: DiagramNode[] = [
  { id: "start", label: "Start", x: 70, y: 70, w: 210, h: 110, shape: "ellipse", rot: 0, fill: "#1f6f66" },
  { id: "intake", label: "Intake", x: 420, y: 50, w: 210, h: 150, shape: "polygon", sides: 6, fill: "#264653" },
  { id: "triage", label: "Triage", x: 770, y: 40, w: 220, h: 180, shape: "polygon", sides: 4, fill: "#a63d2a" },
  { id: "assess", label: "Assess", x: 1110, y: 70, w: 210, h: 180, shape: "polygon", sides: 5, rot: 10, fill: "#3d405b" },
  { id: "queue", label: "Queue", x: 80, y: 390, w: 230, h: 120, shape: "ellipse", rot: -20, fill: "#6d597a" },
  { id: "review", label: "Review", x: 450, y: 360, w: 190, h: 190, shape: "polygon", sides: 8, rot: 22, fill: "#264653" },
  { id: "decide", label: "Decide", x: 800, y: 370, w: 240, h: 180, shape: "polygon", sides: 4, rot: 15, fill: "#a63d2a" },
  { id: "escalate", label: "Escalate", x: 1120, y: 400, w: 230, h: 150, shape: "polygon", sides: 6, rot: -12, fill: "#7a4419" },
  { id: "fix", label: "Fix", x: 110, y: 730, w: 200, h: 180, shape: "polygon", sides: 5, fill: "#3d405b" },
  { id: "test", label: "Test", x: 460, y: 770, w: 240, h: 120, shape: "ellipse", rot: 30, fill: "#1f6f66" },
  { id: "ship", label: "Ship", x: 830, y: 740, w: 200, h: 200, shape: "polygon", sides: 4, fill: "#a63d2a" },
  { id: "close", label: "Close", x: 1150, y: 770, w: 190, h: 130, shape: "ellipse", fill: "#6d597a" },
];

export const DIAGRAM_EDGES: [string, string][] = [
  ["start", "intake"],
  ["intake", "triage"],
  ["triage", "assess"],
  ["start", "queue"],
  ["intake", "review"],
  ["triage", "decide"],
  ["assess", "escalate"],
  ["queue", "review"],
  ["review", "decide"],
  ["decide", "escalate"],
  ["queue", "fix"],
  ["review", "test"],
  ["decide", "ship"],
  ["escalate", "close"],
  ["fix", "test"],
  ["test", "ship"],
  ["ship", "close"],
  // Diagonals, which meet their shapes at shallow angles.
  ["intake", "decide"],
  ["queue", "test"],
  ["triage", "escalate"],
];

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "twenty-one",
  "twenty-two", "twenty-three", "twenty-four", "twenty-five", "twenty-six", "twenty-seven", "twenty-eight",
  "twenty-nine", "thirty",
];
const say = (n: number) => NUMBER_WORDS[n] ?? String(n);

export interface DiagramSpec {
  id: string;
  title: string;
  /** What the brief calls it: "process diagram", "org chart". */
  noun: string;
  /** The shapes in a phrase, for the brief's opening line. */
  shapes: string;
  canvas: { width: number; height: number };
  nodes: DiagramNode[];
  edges: [string, string][];
  fontSize?: number;
}

/** The starting document of a diagram: its shapes, each with its label laid over it. */
export function diagramDoc(spec: DiagramSpec): Doc {
  return doc(
    [
      ...spec.nodes.map((n) =>
        rect({
          id: n.id,
          x: n.x,
          y: n.y,
          w: n.w,
          h: n.h,
          rot: n.rot ?? 0,
          style: { fill: n.fill, ...(n.shape === "rect" ? {} : { shape: n.shape }), ...(n.sides ? { sides: n.sides } : {}) },
        }),
      ),
      ...spec.nodes.map((n) =>
        text({
          id: `${n.id}_label`,
          x: n.x,
          y: n.y,
          w: n.w,
          h: n.h,
          text: n.label,
          style: { fontSize: spec.fontSize ?? 28, fontWeight: "bold", color: "#ffffff", align: "center", valign: "middle" },
        }),
      ),
    ],
    { ...spec.canvas, background: "#f7f4ee" },
  );
}

/**
 * A diagram task: draw every listed arrow from outline to outline. One brief,
 * one set of checks, for every layout, so the diagrams differ only in the
 * geometry the agent has to work out.
 */
export function diagramTask(spec: DiagramSpec) {
  const ids = spec.nodes.flatMap((n) => [n.id, `${n.id}_label`]);
  const label = (id: string) => `'${spec.nodes.find((n) => n.id === id)!.label}'`;
  const arrows = say(spec.edges.length);
  return defineTask({
    id: spec.id,
    title: spec.title,
    family: "paint",
    paint: true,
    brief: [
      `This ${spec.noun} has ${say(spec.nodes.length)} shapes — ${spec.shapes} — each with a label on it, and no connectors yet. Draw these ${arrows} arrows:`,
      "",
      ...spec.edges.map(([a, b]) => `- from ${label(a)} to ${label(b)}`),
      "",
      `Each arrow is an open path of exactly two points, stroked in ${FLOW_STROKE} at strokeWidth ${FLOW_WIDTH}, with an arrowhead at its end (style.arrow 'end').`,
      "It runs along the straight line joining the centres of the two shapes — a shape's centre is the centre of its box, the point its rotation turns it about — but covers only the gap between them: it starts exactly on the outline of the shape it comes from and ends exactly on the outline of the shape it goes to, to within 2 units.",
      "The outline is the shape as drawn: an oval's curve and a polygon's sides, stretched to fill the box and turned with it — not the box around them.",
      `Do not move, restyle or delete the shapes or their labels, and add nothing but the ${arrows} arrows.`,
    ].join("\n"),
    initial: () => diagramDoc(spec),
    checks: [
      ...spec.edges.map(([a, b]) => connects(a, b, 3, { arrow: true, label: `An arrow runs from ${label(a)} to ${label(b)}, outline to outline` })),
      pathCount((el) => el.type === "path" && paintsAnything(el), spec.edges.length, 2, `Exactly ${arrows} paths`),
      styleIs(connector, { strokeColor: FLOW_STROKE, strokeWidth: FLOW_WIDTH }, 2, "Arrows are drawn in the stated stroke"),
      geometryUnchanged(diagramDoc(spec), ids, 2),
      preservesElements(ids, 2),
      styleUnchanged(diagramDoc(spec), ids, 1),
    ],
    judgeCriteria: [`Reads as a clear ${spec.noun}: every arrow visibly joins the two shapes it is meant to.`],
    maxTurns: 30,
  });
}

export const DIAGRAM_SPEC: DiagramSpec = {
  id: "paint.diagram",
  title: "Connect a process diagram's shapes with arrows",
  noun: "process diagram",
  shapes: "ovals, diamonds, hexagons, pentagons and an octagon, several of them turned",
  canvas: DIAGRAM,
  nodes: DIAGRAM_NODES,
  edges: DIAGRAM_EDGES,
};

const diagramTask1 = diagramTask(DIAGRAM_SPEC);

// --- the confirmatory diagrams -------------------------------------------------
//
// Three more layouts for the confirmatory set (`docs/PREREGISTRATION.md`,
// 2026-11-12), each a different structure: a hub with a ring around it, so
// arrows run at every angle; a tree that fans out, so several arrows leave one
// shape at shallow angles; and a dense grid of small shapes with diagonals,
// so the gaps are short and the outlines close together. Built by rule
// rather than by hand, and checked by `paint.test.ts` for the same things the
// first diagram was: no arrow passes over another shape or label, and the
// reference solution scores full marks.

const FILLS = ["#264653", "#a63d2a", "#1f6f66", "#3d405b", "#6d597a", "#7a4419"];

type Kind = Pick<DiagramNode, "shape" | "sides">;
const OVAL: Kind = { shape: "ellipse" };
const DIAMOND: Kind = { shape: "polygon", sides: 4 };
const PENTAGON: Kind = { shape: "polygon", sides: 5 };
const HEXAGON: Kind = { shape: "polygon", sides: 6 };
const OCTAGON: Kind = { shape: "polygon", sides: 8 };
const BOX: Kind = { shape: "rect" };

/** A node centred on (cx, cy). */
function node(id: string, label: string, cx: number, cy: number, w: number, h: number, kind: Kind, rot: number, fill: string): DiagramNode {
  return { id, label, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h, ...kind, rot, fill };
}

/** The hub and ring: one shape in the middle, eight around it. */
export const CYCLE_SPEC: DiagramSpec = (() => {
  const labels = ["Plan", "Build", "Measure", "Learn", "Adapt", "Release", "Support", "Retire"];
  const kinds = [OVAL, HEXAGON, DIAMOND, PENTAGON, BOX, OCTAGON, OVAL, HEXAGON];
  const rots = [-20, 0, 18, 0, 25, 12, 35, -15];
  const sizes: [number, number][] = [[200, 120], [190, 150], [200, 160], [180, 160], [190, 110], [170, 170], [210, 120], [190, 140]];
  const cx = 600;
  const cy = 600;
  const r = 420;
  const ring = labels.map((label, i) => {
    const a = (i * Math.PI * 2) / labels.length;
    return node(label.toLowerCase(), label, cx + Math.sin(a) * r, cy - Math.cos(a) * r, sizes[i]![0], sizes[i]![1], kinds[i]!, rots[i]!, FILLS[i % FILLS.length]!);
  });
  const hub = node("core", "Core", cx, cy, 230, 150, HEXAGON, 15, "#264653");
  const ids = ring.map((n) => n.id);
  const edges: [string, string][] = [
    ...ids.map((id, i): [string, string] => [id, ids[(i + 1) % ids.length]!]),
    ...ids.map((id, i): [string, string] => (i % 2 === 0 ? ["core", id] : [id, "core"])),
  ];
  return {
    id: "paint.cycle",
    title: "Connect a cycle diagram's shapes with arrows",
    noun: "cycle diagram",
    shapes: "one in the middle and eight in a ring around it: ovals, hexagons, a diamond, a pentagon, an octagon and a box, most of them turned",
    canvas: { width: 1200, height: 1200 },
    nodes: [hub, ...ring],
    edges,
  };
})();

/** The tree: one shape at the top, four below it, two below each of those. */
export const ORG_SPEC: DiagramSpec = (() => {
  const W = 1400;
  const mids = ["Design", "Product", "Sales", "Support"];
  const leaves = ["Brand", "Web", "Mobile", "Data", "North", "South", "Help", "Docs"];
  const midKinds = [OVAL, DIAMOND, OCTAGON, PENTAGON];
  const midRots = [15, 0, 20, -10];
  const leafKinds = [HEXAGON, OVAL, DIAMOND, BOX, OVAL, PENTAGON, HEXAGON, OCTAGON];
  const leafRots = [0, -25, 15, 20, 30, 0, -15, 10];
  const root = node("board", "Board", W / 2, 120, 240, 150, HEXAGON, 10, "#3d405b");
  const midNodes = mids.map((label, i) =>
    node(label.toLowerCase(), label, 175 + i * 350, 450, 210, 140, midKinds[i]!, midRots[i]!, FILLS[(i + 1) % FILLS.length]!),
  );
  const leafNodes = leaves.map((label, i) =>
    node(label.toLowerCase(), label, 87.5 + i * 175, 830, 140, 100, leafKinds[i]!, leafRots[i]!, FILLS[(i + 3) % FILLS.length]!),
  );
  const edges: [string, string][] = [
    ...midNodes.map((m): [string, string] => ["board", m.id]),
    ...leafNodes.map((l, i): [string, string] => [midNodes[Math.floor(i / 2)]!.id, l.id]),
    [midNodes[0]!.id, midNodes[1]!.id],
    [midNodes[3]!.id, midNodes[2]!.id],
  ];
  return {
    id: "paint.orgchart",
    title: "Connect an org chart's shapes with arrows",
    noun: "org chart",
    shapes: "one at the top, four below it and eight below those: ovals, hexagons, diamonds, pentagons, octagons and a box, many of them turned",
    canvas: { width: W, height: 960 },
    nodes: [root, ...midNodes, ...leafNodes],
    edges,
    fontSize: 24,
  };
})();

/** The grid: sixteen small shapes, four by four, with arrows across, down and diagonally. */
export const NETWORK_SPEC: DiagramSpec = (() => {
  const kinds = [OVAL, DIAMOND, HEXAGON, PENTAGON, OCTAGON, BOX, OVAL, HEXAGON];
  const rots = [0, 20, -15, 10, 25, -30, 15, 0, -20, 30, 0, 12, -10, 18, 35, -25];
  const id = (r: number, c: number) => `n${r}${c}`;
  const nodes: DiagramNode[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const i = r * 4 + c;
      nodes.push(node(id(r, c), `${"ABCD"[r]}${c + 1}`, 160 + c * 330, 130 + r * 280, 150, 100, kinds[(i * 3) % kinds.length]!, rots[i]!, FILLS[(i * 5) % FILLS.length]!));
    }
  }
  const edges: [string, string][] = [];
  for (const r of [0, 2]) for (let c = 0; c < 3; c++) edges.push([id(r, c), id(r, c + 1)]);
  for (const r of [1, 3]) for (let c = 0; c < 2; c++) edges.push([id(r, c + 1), id(r, c)]);
  for (const c of [0, 3]) for (let r = 0; r < 3; r++) edges.push([id(r, c), id(r + 1, c)]);
  edges.push([id(0, 1), id(1, 1)], [id(3, 2), id(2, 2)]);
  edges.push(
    [id(0, 0), id(1, 1)],
    [id(0, 3), id(1, 2)],
    [id(1, 1), id(2, 2)],
    [id(2, 1), id(3, 0)],
    [id(2, 2), id(3, 3)],
    [id(1, 3), id(2, 2)],
  );
  return {
    id: "paint.network",
    title: "Connect a network diagram's shapes with arrows",
    noun: "network diagram",
    shapes: "small ones in a four by four grid: ovals, diamonds, hexagons, pentagons, octagons and boxes, most of them turned",
    canvas: { width: 1400, height: 1100 },
    nodes,
    edges,
    fontSize: 24,
  };
})();

export const DIAGRAM_SPECS: DiagramSpec[] = [DIAGRAM_SPEC, CYCLE_SPEC, ORG_SPEC, NETWORK_SPEC];
const confirmatoryDiagrams = [CYCLE_SPEC, ORG_SPEC, NETWORK_SPEC].map(diagramTask);

// --- paint.chart ---------------------------------------------------------------

export const PLOT = { x: 140, y: 150, w: 960, h: 480 };
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const VISITORS = [320, 410, 380, 560, 640, 720, 910, 870, 690, 540, 450, 610];
export const Y_MAX = 1000;
export const DOT = 16;
export const PEAK_DOT = 30;
export const LINE_COLOR = "#1d3557";
export const AREA_COLOR = "#1d355733";
export const DOT_COLOR = "#e63946";

export const dataPoint = (i: number): Point => ({
  x: PLOT.x + (PLOT.w * i) / (MONTHS.length - 1),
  y: PLOT.y + PLOT.h - (VISITORS[i]! / Y_MAX) * PLOT.h,
});
export const DATA_POINTS = MONTHS.map((_, i) => dataPoint(i));
const PEAK = VISITORS.indexOf(Math.max(...VISITORS));
export const AREA_RING: Point[] = [...DATA_POINTS, { x: PLOT.x + PLOT.w, y: PLOT.y + PLOT.h }, { x: PLOT.x, y: PLOT.y + PLOT.h }];

const chart = (): Doc =>
  doc(
    [
      text({ id: "title", x: 140, y: 50, w: 960, h: 60, text: "Visitors per month", style: { fontSize: 44, fontWeight: "bold", color: "#1d1d2b" } }),
      rect({ id: "plot", ...PLOT, style: { fill: "transparent", strokeColor: "#b8b2a7", strokeWidth: 2 } }),
      ...MONTHS.map((m, i) =>
        text({ id: `month_${i + 1}`, x: dataPoint(i).x - 40, y: PLOT.y + PLOT.h + 16, w: 80, h: 32, text: m, style: { fontSize: 22, color: "#55514a", align: "center" } }),
      ),
      ...[0, 250, 500, 750, 1000].map((v) =>
        text({ id: `tick_${v}`, x: 30, y: PLOT.y + PLOT.h - (v / Y_MAX) * PLOT.h - 16, w: 96, h: 32, text: String(v), style: { fontSize: 22, color: "#55514a", align: "right", valign: "middle" } }),
      ),
    ],
    { width: 1200, height: 760, background: "#ffffff" },
  );

const chartFixed = ["title", "plot", ...MONTHS.map((_, i) => `month_${i + 1}`), ...[0, 250, 500, 750, 1000].map((v) => `tick_${v}`)];
const dataLine = pathWith({ stroke: LINE_COLOR, closed: false });
const dataArea = pathWith({ fill: AREA_COLOR, closed: true });
const isDot = (el: Element) => el.type === "rect" && el.style.shape === "ellipse" && el.style.fill?.toLowerCase() === DOT_COLOR && paintsAnything(el);

/** One dot per data point: an ellipse of the stated size centred on it. */
function dotsOnData(weight: number): Check {
  return check("dots", "A dot sits on every data point, the peak's larger", weight, (d) => {
    const dots = d.elements.filter(isDot);
    if (dots.length === 0) return { score: 0, detail: "No dots." };
    let got = 0;
    const missing: string[] = [];
    DATA_POINTS.forEach((p, i) => {
      const size = i === PEAK ? PEAK_DOT : DOT;
      const hit = dots.some(
        (el) =>
          Math.abs(el.x + el.width / 2 - p.x) <= 1.5 &&
          Math.abs(el.y + el.height / 2 - p.y) <= 1.5 &&
          Math.abs(el.width - size) <= 1 &&
          Math.abs(el.height - size) <= 1,
      );
      if (hit) got++;
      else missing.push(MONTHS[i]!);
    });
    const extra = Math.max(0, dots.length - DATA_POINTS.length);
    return {
      score: Math.max(0, (got - extra) / DATA_POINTS.length),
      detail: missing.length ? `Missing or misplaced: ${missing.join(", ")}.` : extra ? `${extra} dot(s) too many.` : "All twelve in place.",
    };
  });
}

/** The wash under the line, the line, then the dots. */
function chartLayers(weight: number): Check {
  return check("chart_layers", "The area is behind the line, and the line behind the dots", weight, (d) => {
    const order = d.elements;
    const area = order.findIndex(dataArea);
    const line = order.findIndex(dataLine);
    const dots = order.map((el, i) => (isDot(el) ? i : -1)).filter((i) => i >= 0);
    if (area < 0 || line < 0 || dots.length === 0) return { score: 0, detail: "The area, the line and the dots are not all there." };
    const ok = [area < line, dots.every((i) => i > line)];
    return { score: ok.filter(Boolean).length / ok.length, detail: ok.every(Boolean) ? "In order." : "Out of order." };
  });
}

const chartTask = defineTask({
  id: "paint.chart",
  title: "Plot a year of data as a line chart",
  family: "paint",
  paint: true,
  brief: [
    "Plot this data on the empty chart. Visitors per month, January to December:",
    "",
    VISITORS.map((v, i) => `${MONTHS[i]} ${v}`).join(", "),
    "",
    `The plot frame is the outlined rectangle, x ${PLOT.x} to ${PLOT.x + PLOT.w} and y ${PLOT.y} to ${PLOT.y + PLOT.h}. January sits on its left edge and December on its right, the months evenly spaced between; 0 visitors is its bottom edge and ${Y_MAX} its top.`,
    "",
    `1. The line: one open path with straight segments through the twelve data points in order, stroked in ${LINE_COLOR} at strokeWidth 6.`,
    `2. The area under it: one closed path filled with ${AREA_COLOR} and no stroke, covering exactly the region between the line and the bottom edge of the frame.`,
    `3. A dot on every data point: an ellipse ${DOT} units across filled with ${DOT_COLOR}, centred on the point. The dot on the highest month is ${PEAK_DOT} across instead.`,
    "",
    "Paint the area behind the line and the line behind the dots. Do not move, restyle or delete anything already on the chart.",
  ].join("\n"),
  initial: chart,
  checks: [
    pathCount(dataLine, 1, 1, "One data line"),
    pathThrough(dataLine, DATA_POINTS, 5, { label: "The line passes through the twelve data points in order" }),
    styleIs(dataLine, { strokeWidth: 6 }, 1, "The line is 6 wide"),
    pathCount(dataArea, 1, 1, "One filled area"),
    regionCovers(dataArea, AREA_RING, 4, { min: 0.985, floor: 0.8, label: "The area covers exactly the region under the line" }),
    dotsOnData(5),
    chartLayers(2),
    geometryUnchanged(chart(), chartFixed, 2),
    preservesElements(chartFixed, 2),
    styleUnchanged(chart(), chartFixed, 1),
  ],
  judgeCriteria: ["Reads as a finished, legible line chart."],
  maxTurns: 30,
});

// --- paint.pie -----------------------------------------------------------------

export const PIE = { cx: 500, cy: 540, r: 320 };
export const SLICES = [
  { name: "Housing", share: 34, color: "#264653" },
  { name: "Food", share: 22, color: "#2a9d8f" },
  { name: "Transport", share: 18, color: "#e9c46a" },
  { name: "Savings", share: 15, color: "#f4a261" },
  { name: "Other", share: 11, color: "#e76f51" },
];
/** Each slice's start and end, in degrees clockwise from straight up. */
export const SLICE_ANGLES = SLICES.map((s, i) => {
  const before = SLICES.slice(0, i).reduce((sum, t) => sum + t.share, 0);
  return { start: before * 3.6, end: (before + s.share) * 3.6 };
});

const pie = (): Doc =>
  doc(
    [text({ id: "title", x: 100, y: 60, w: 800, h: 80, text: "Where the budget went", style: { fontSize: 56, fontWeight: "bold", color: "#1d1d2b", align: "center" } })],
    { width: 1000, height: 1000, background: "#fbfaf7" },
  );

const slice = (color: string) => pathWith({ fill: color, closed: true });

const pieTask = defineTask({
  id: "paint.pie",
  title: "Draw a pie chart from five shares",
  family: "paint",
  paint: true,
  brief: [
    `Draw a pie chart under the title: a circle centred at (${PIE.cx}, ${PIE.cy}) with radius ${PIE.r}, divided into five slices. The first slice starts at twelve o'clock and they run clockwise in this order:`,
    "",
    ...SLICES.map((s) => `- ${s.name}, ${s.share}%, filled ${s.color}`),
    "",
    "Draw each slice as one closed path, filled with its colour and with no stroke. No element draws an arc, so a slice's curved edge has to be approximated by the path's own points — closely: each slice is compared with the exact sector it stands for and must cover the same area to within 3%. A slice with a straight outer edge does not.",
    "Add nothing but the five slices, and leave the title as it is.",
  ].join("\n"),
  initial: pie,
  checks: [
    ...SLICES.flatMap((s, i): Check[] => [
      pathCount(slice(s.color), 1, 1, `One ${s.name} slice`),
      regionCovers(slice(s.color), sectorRing(PIE.cx, PIE.cy, PIE.r, SLICE_ANGLES[i]!.start, SLICE_ANGLES[i]!.end), 4, {
        label: `The ${s.name} slice covers its ${s.share}% sector`,
      }),
    ]),
    check("no_stroke", "Slices have no stroke", 1, (d) => {
      const slices = d.elements.filter((el) => SLICES.some((s) => slice(s.color)(el)));
      if (slices.length === 0) return { score: 0, detail: "No slices." };
      const stroked = slices.filter((el) => el.style.strokeColor !== undefined);
      return { score: 1 - stroked.length / slices.length, detail: stroked.length ? `${stroked.map((e) => e.id).join(", ")} stroked.` : "None stroked." };
    }),
    pathCount((el) => el.type !== "text" && paintsAnything(el), SLICES.length, 1, "Nothing drawn but the five slices"),
    geometryUnchanged(pie(), ["title"], 1),
    preservesElements(["title"], 1),
  ],
  judgeCriteria: ["Reads as a clean pie chart: a true circle, slices meeting without gaps."],
  maxTurns: 30,
});

// --- paint.lighthouse ------------------------------------------------------------

const drawn = (el: Element) => el.type === "path" && paintsAnything(el);

/** At least so many paths of a kind: the floor an illustration is asked to clear. */
function atLeast(n: number, what: string, pred: (el: Element) => boolean, weight: number): Check {
  return check("paths_at_least", `At least ${n} ${what}`, weight, (d) => {
    const got = d.elements.filter((el) => drawn(el) && pred(el)).length;
    return { score: Math.min(1, got / n), detail: `${got} of ${n}.` };
  });
}

const lighthouse = defineTask({
  id: "paint.lighthouse",
  title: "Illustrate a lighthouse at dusk",
  family: "paint",
  paint: true,
  brief: [
    "Illustrate a poster: a lighthouse on a rocky headland at dusk, its beam sweeping out over the sea.",
    "Draw it — the headland, the tower, the lantern, the beam, the waves — with paths, using shapes and gradients where they serve. It should read at a glance as a lighthouse by the sea in the evening.",
    "",
    "- Use at least twelve paths, at least five of them closed and filled, and at least three of them smooth curves.",
    "- The picture fills the poster: no large empty areas, and nothing hanging off the canvas.",
    "- Set the title 'Lands End Light' in bold, at least 64 units, somewhere it reads clearly against what is behind it. It is the only text on the poster.",
  ].join("\n"),
  initial: () => blank({ background: "#ffffff" }),
  checks: [
    atLeast(12, "paths", () => true, 3),
    atLeast(5, "closed, filled paths", (el) => !!el.closed && el.style.fill !== undefined, 2),
    atLeast(3, "smooth paths", (el) => el.style.curve === "smooth", 2),
    containsText(["Lands End Light"], 2),
    fontSizeAtLeast(64, 1),
    coverage(0.45, 1, 2),
  ],
  judgeCriteria: [
    "Reads at a glance as a lighthouse on a headland by the sea.",
    "The light and colour say dusk.",
    "The drawing is composed: the tower is the subject, the beam leads the eye, the title belongs to the picture.",
    "Shapes are drawn with care: curves where things are curved, no stray or accidental marks.",
  ],
  maxTurns: 30,
});

/**
 * What `--tasks paint` runs. The 2026-11-12 Luna pilot passed the maze, the
 * board and the flowchart on every surface but for three slips, and the only
 * one of those a tool would have prevented was an arrow landing off an oval's
 * curve — so the diagram is the flowchart built out around that, and the rest
 * are shelved. The lighthouse stays for head-to-head judging.
 */
export const paintTasks = [diagramTask1, ...confirmatoryDiagrams, ...reviseTasks, lighthouse];

/**
 * Kept, resolvable by id, and out of `--tasks paint`. The chart and the pie
 * are arithmetic from numbers in the brief with no tool on any surface for
 * either. The maze, the board and the first flowchart did not separate
 * surfaces on GPT-5.6 Luna (`docs/PREREGISTRATION.md`, 2026-11-12).
 */
export const shelvedPaintTasks = [route, mazeTask, flow, chartTask, pieTask];
