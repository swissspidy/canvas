import { describe, expect, it } from "vitest";
import { TASKS, getTask, resolveTasks, tasksInFamily } from "./index.js";
import { TASK_FAMILIES } from "./types.js";
import { parseDoc } from "../doc/schema.js";
import { runChecks, universalChecks } from "../eval/checks.js";
import { renderSvg } from "../render/svg.js";
import type { Doc, Element } from "../doc/types.js";

/**
 * A task whose starting document already scores well teaches nothing: every
 * surface passes it and the cell is wasted. These tests are the eval's own
 * eval — they assert that each task starts in a genuinely broken state and
 * that a plausible fix can move the score.
 */
const HEADROOM_CEILING = 0.9;

describe("task registry", () => {
  it("holds fifteen to twenty tasks", () => {
    expect(TASKS.length).toBeGreaterThanOrEqual(15);
    expect(TASKS.length).toBeLessThanOrEqual(20);
  });

  it("gives every task a unique id", () => {
    const ids = TASKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every family", () => {
    for (const family of TASK_FAMILIES) {
      expect(tasksInFamily(family).length).toBeGreaterThan(0);
    }
  });

  it("resolves selectors by id, family and 'all'", () => {
    expect(resolveTasks("all")).toHaveLength(TASKS.length);
    expect(resolveTasks("fit").every((t) => t.family === "fit")).toBe(true);
    expect(resolveTasks("fit.long-headline").map((t) => t.id)).toEqual(["fit.long-headline"]);
    expect(resolveTasks("fit,arrange").length).toBe(tasksInFamily("fit").length + tasksInFamily("arrange").length);
    // Duplicates collapse.
    expect(resolveTasks("fit.long-headline,fit.long-headline")).toHaveLength(1);
  });

  it("names the known tasks when given an unknown id", () => {
    expect(() => getTask("nope")).toThrow(/Unknown task/);
  });
});

describe.each(TASKS)("task $id", (task) => {
  it("has a brief that states the goal and required copy", () => {
    expect(task.brief.length).toBeGreaterThan(80);
    expect(task.judgeCriteria.length).toBeGreaterThanOrEqual(3);
    expect(task.maxTurns).toBeGreaterThan(0);
  });

  it("starts from a document that validates against the schema", () => {
    const doc = task.initial();
    expect(() => parseDoc(doc)).not.toThrow();
  });

  it("builds a fresh document each time, so runs cannot contaminate each other", () => {
    const a = task.initial();
    const b = task.initial();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a.elements.push({ id: "junk", type: "rect", x: 0, y: 0, width: 1, height: 1, rotation: 0, z: 99, style: {} });
    expect(task.initial().elements.some((e) => e.id === "junk")).toBe(false);
  });

  it("renders without throwing", () => {
    expect(() => renderSvg(task.initial())).not.toThrow();
  });

  it("leaves real headroom from its starting state", () => {
    const checks = [...universalChecks(), ...task.checks];
    const { score } = runChecks(task.initial(), checks);
    expect(score).toBeLessThan(HEADROOM_CEILING);
  });

  it("produces a check result for every declared check", () => {
    const checks = [...universalChecks(), ...task.checks];
    const { results } = runChecks(task.initial(), checks);
    expect(results).toHaveLength(checks.length);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      expect(r.detail.length).toBeGreaterThan(0);
    }
  });
});

/**
 * Loopholes: a brief that forbids something, and a check that lets it through.
 * Each of these is a cheap way to score well without doing the work asked for,
 * so each has to cost something.
 */
describe("the constraints the briefs state are actually scored", () => {
  function scoreOf(task: (typeof TASKS)[number], doc: Doc): number {
    return runChecks(doc, [...universalChecks(), ...task.checks]).score;
  }

  function edit(task: (typeof TASKS)[number], fn: (el: Element) => Element): Doc {
    const doc = task.initial();
    return { ...doc, elements: doc.elements.map(fn) };
  }

  /**
   * Padding a document with elements nobody can see was the cheapest loophole
   * in the suite, and it worked on five checks at once. The worst of them: a
   * poster missing half its required copy and set in a single size scored
   * *full marks* by carrying the missing phrases in a text element at
   * `opacity: 0`. An image at `opacity: 0` satisfied "use this asset". Three
   * invisible rects bought an "at least five elements" floor.
   *
   * The property, asserted across every task rather than check by check, so a
   * check added later that starts counting invisible elements fails here.
   */
  it("gains nothing from elements nobody can see, on any task", () => {
    // In bounds and unclipped, because the checks that ask whether an element
    // hangs off the canvas or overflows its box are about the document rather
    // than the render, and deliberately still see these.
    const ghosts: Element[] = [
      {
        id: "ghost_rect",
        type: "rect",
        x: 100,
        y: 100,
        width: 300,
        height: 300,
        rotation: 0,
        z: 900,
        style: { fill: "transparent" },
      },
      {
        id: "ghost_text",
        type: "text",
        x: 100,
        y: 100,
        width: 800,
        height: 400,
        rotation: 0,
        z: 901,
        text: "Ridgeline Festival September 12-14 Alpine Meadow, Colorado Tickets at ridgeline.fm",
        style: { fontSize: 18, color: "#ffffff", opacity: 0 },
      },
      {
        id: "ghost_image",
        type: "image",
        x: 100,
        y: 100,
        width: 400,
        height: 300,
        rotation: 0,
        z: 902,
        src: "photo/mountains",
        style: { opacity: 0 },
      },
    ];

    for (const task of TASKS) {
      const before = task.initial();
      const padded: Doc = { ...before, elements: [...before.elements, ...ghosts] };
      expect(scoreOf(task, padded), task.id).toBeCloseTo(scoreOf(task, before), 10);
    }
  });

  // The other side of the same boundary: a check that asks what is *in the
  // document* must keep seeing an element that has been made invisible, or
  // "keep every element" would be satisfiable by hiding one.
  it("still counts an invisible element as present and unmoved", () => {
    const task = getTask("repair.overlapping-stack");
    const hidden = edit(task, (el) => (el.id === "badge" ? { ...el, style: { ...el.style, opacity: 0 } } : el));
    const results = runChecks(hidden, [...universalChecks(), ...task.checks]);
    const preserved = results.results.find((r) => r.id === "preserved")!;
    expect(preserved.score).toBe(1);
    expect(preserved.detail).toMatch(/All kept/);
  });

  it("penalises shortening body copy on a task that says to keep it", () => {
    for (const id of ["repair.overlapping-stack", "repair.buried-text"]) {
      const task = getTask(id);
      const gutted = edit(task, (el) => (el.type === "text" ? { ...el, text: el.text?.slice(0, 4) ?? "" } : el));
      expect(scoreOf(task, gutted), id).toBeLessThan(scoreOf(task, task.initial()));
    }
  });

  it("penalises moving elements on a task that says not to", () => {
    for (const id of ["restyle.palette-swap", "restyle.dark-mode", "repair.z-order"]) {
      const task = getTask(id);
      const shoved = edit(task, (el) => ({ ...el, x: el.x + 60, y: el.y + 60 }));
      expect(scoreOf(task, shoved), id).toBeLessThan(scoreOf(task, task.initial()));
    }
  });

  it("penalises resizing elements on an arrange task that says not to", () => {
    for (const id of ["arrange.ragged-column", "arrange.uneven-row"]) {
      const task = getTask(id);
      const squashed = edit(task, (el) => ({ ...el, width: el.width / 2, height: el.height / 2 }));
      expect(scoreOf(task, squashed), id).toBeLessThan(scoreOf(task, task.initial()));
    }
  });

  it("penalises an image on the quote card, which asks for none", () => {
    const task = getTask("compose.quote-card");
    const doc = task.initial();
    const withPhoto: Doc = {
      ...doc,
      elements: [
        ...doc.elements,
        {
          id: "sneaky",
          type: "image",
          src: "photo/mountains",
          x: 0,
          y: 0,
          width: 200,
          height: 200,
          rotation: 0,
          z: 9,
          style: {},
        },
      ],
    };
    expect(scoreOf(task, withPhoto)).toBeLessThan(scoreOf(task, doc));
  });

  it("penalises dropping the gradient the title card is built on", () => {
    const task = getTask("compose.title-card");
    const doc = task.initial();
    expect(scoreOf(task, { ...doc, elements: [] })).toBeLessThan(scoreOf(task, doc));
    const shrunk = edit(task, (el) => (el.id === "bg" ? { ...el, width: 100, height: 100 } : el));
    expect(scoreOf(task, shrunk)).toBeLessThan(scoreOf(task, doc));
  });

  it("penalises a row shoved to one side, however even its inner gaps", () => {
    const task = getTask("arrange.uneven-row");
    const doc = task.initial();
    const hardLeft: Doc = {
      ...doc,
      elements: doc.elements.map((el, i) => ({ ...el, x: 20 + i * 220, y: 520 })),
    };
    const centred: Doc = {
      ...doc,
      elements: doc.elements.map((el, i) => ({ ...el, x: 56 + i * 248, y: 520 })),
    };
    expect(scoreOf(task, hardLeft)).toBeLessThan(scoreOf(task, centred));
  });
});
