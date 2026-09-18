import { describe, expect, it } from "vitest";
import { TASKS, getTask, resolveTasks, tasksInFamily } from "./index.js";
import { TASK_FAMILIES } from "./types.js";
import { normalizeDoc, parseDoc } from "../doc/schema.js";
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
  it("holds eighteen to twenty-four tasks", () => {
    // The ceiling is a budget, not a principle: every task multiplies through
    // surfaces, feedback conditions, models and repeats, and
    // `docs/PREREGISTRATION.md` sizes the grid from this number.
    expect(TASKS.length).toBeGreaterThanOrEqual(18);
    expect(TASKS.length).toBeLessThanOrEqual(24);
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


  /**
   * The same loophole one notch up from zero.
   *
   * `paintedPolygons` used to ask only whether opacity was above *zero*, so
   * closing the door on `opacity: 0` left `opacity: 0.02` wide open — and a
   * colour's own alpha was a second way in, since the two were never
   * multiplied. Five elements nobody can see scored 85% on a task whose
   * starting document scores 38%.
   */
  it("gains nothing from elements that are almost invisible either", () => {
    const ghosts: Element[] = [
      {
        id: "faint_text",
        type: "text",
        x: 60,
        y: 60,
        width: 900,
        height: 400,
        rotation: 0,
        z: 910,
        text: "Ridgeline Festival\nSeptember 12-14\nAlpine Meadow, Colorado\nTickets at ridgeline.fm",
        style: { fontSize: 40, color: "#ffffff", opacity: 0.02 },
      },
      {
        id: "faint_image",
        type: "image",
        x: 60,
        y: 500,
        width: 400,
        height: 300,
        rotation: 0,
        z: 911,
        src: "photo/mountains",
        style: { opacity: 0.02 },
      },
      // Opacity and colour alpha multiply: 40% of 5% is 2%.
      {
        id: "faint_rect",
        type: "rect",
        x: 60,
        y: 860,
        width: 400,
        height: 300,
        rotation: 0,
        z: 912,
        style: { fill: "#ff000066", opacity: 0.05 },
      },
    ];

    for (const task of TASKS) {
      const before = task.initial();
      const padded: Doc = { ...before, elements: [...before.elements, ...ghosts] };
      expect(scoreOf(task, padded), task.id).toBeCloseTo(scoreOf(task, before), 10);
    }
  });

  /**
   * The fit family's one-line solution, on every surface: shrink until it
   * fits. It works, it scores, and it produces a page nobody can read — so it
   * has to score below the fix that finds the room instead.
   */
  it("prefers finding the room to shrinking the type out of legibility", () => {
    const cases: { id: string; ids: string[]; shrunk: number; honest: (el: Element) => Element }[] = [
      {
        id: "fit.body-overflow",
        ids: ["body"],
        shrunk: 9,
        honest: (el) => (el.id === "body" ? { ...el, height: 800 } : el),
      },
      {
        id: "fit.long-headline",
        ids: ["headline"],
        shrunk: 20,
        honest: (el) =>
          el.id === "headline"
            ? { ...el, y: 300, height: 280, style: { ...el.style, fontSize: 52 } }
            : el.id === "para"
              ? { ...el, y: 610, height: 320 }
              : el,
      },
    ];
    for (const c of cases) {
      const task = getTask(c.id);
      const shrunk = edit(task, (el) =>
        c.ids.includes(el.id) ? { ...el, style: { ...el.style, fontSize: c.shrunk } } : el,
      );
      const honest = edit(task, c.honest);
      expect(scoreOf(task, honest), `${c.id} honest`).toBeGreaterThan(scoreOf(task, shrunk));
      // And it is a real fix, not just a better one: full marks are reachable.
      expect(scoreOf(task, honest), `${c.id} honest`).toBeCloseTo(1, 6);
    }
  });

  it("penalises three different fixes where the brief asks for one treatment", () => {
    const task = getTask("fit.three-overflowing");
    const sizes: Record<string, number> = { one: 40, two: 30, three: 38 };
    const perBlock = edit(task, (el) =>
      sizes[el.id] === undefined
        ? el
        : { ...el, height: 320, y: { one: 120, two: 480, three: 900 }[el.id]!, style: { ...el.style, fontSize: sizes[el.id]! } },
    );
    const oneSize = edit(task, (el) =>
      sizes[el.id] === undefined
        ? el
        : { ...el, height: 320, y: { one: 120, two: 480, three: 900 }[el.id]!, style: { ...el.style, fontSize: 36 } },
    );
    expect(scoreOf(task, oneSize)).toBeGreaterThan(scoreOf(task, perBlock));
  });

  /**
   * The caption can always be made to fit by growing its box upwards. The
   * photograph is what the page is for, so that is not a fix — and nothing was
   * watching, because the occlusion check only ever asked about text.
   */
  it("penalises fitting the caption by burying the photograph", () => {
    const task = getTask("fit.caption-under-image");
    const overPhoto = edit(task, (el) =>
      el.id === "caption" ? { ...el, y: 560, height: 420, style: { ...el.style, fill: "#f7f4ee" } } : el,
    );
    const inTheGap = edit(task, (el) =>
      el.id === "caption" ? { ...el, y: 860, height: 300, style: { ...el.style, fontSize: 30 } } : el,
    );
    expect(scoreOf(task, inTheGap)).toBeGreaterThan(scoreOf(task, overPhoto));
  });

  /**
   * A newline is a hard line break, so a poster can be four elements or seven
   * and neither is a defect. What *is* a defect is pouring every voice into one
   * block, because then there is one font size and no hierarchy — which used
   * to score full marks on `typeHierarchy`, since one size cannot contradict
   * itself.
   */
  it("gives a single block holding every line no hierarchy", () => {
    const task = getTask("compose.festival-poster");
    const doc = task.initial();
    const oneBlock: Doc = {
      ...doc,
      elements: [
        {
          id: "bg",
          type: "image",
          x: 0,
          y: 0,
          width: doc.width,
          height: doc.height,
          rotation: 0,
          z: 0,
          src: "photo/mountains",
          style: {},
        },
        {
          id: "everything",
          type: "text",
          x: 80,
          y: 300,
          width: 920,
          height: 700,
          rotation: 0,
          z: 1,
          text: "Ridgeline Festival\nSeptember 12-14\nAlpine Meadow, Colorado\nTickets at ridgeline.fm",
          style: { fontSize: 60, color: "#ffffff", align: "center" },
        },
      ],
    };
    const results = runChecks(oneBlock, [...universalChecks(), ...task.checks]);
    const hierarchy = results.results.find((r) => r.id === "type_hierarchy")!;
    expect(hierarchy.score).toBe(0);
    expect(hierarchy.detail).toMatch(/no hierarchy/i);
    // And the copy is still all there, so this is a hierarchy finding rather
    // than a missing-copy one.
    expect(results.results.find((r) => r.id === "contains_text")!.score).toBe(1);
  });

  /**
   * The other half of the same point: a line break inside one element is a
   * perfectly good way to set a two-line title, and nothing may charge for it.
   * This is the check that would have failed against "at least five elements".
   */
  it("does not charge a composition for breaking a title with a newline", () => {
    const task = getTask("compose.festival-poster");
    const doc = task.initial();
    const composed: Doc = {
      ...doc,
      elements: [
        { id: "bg", type: "image", x: 0, y: 0, width: doc.width, height: doc.height, rotation: 0, z: 0, src: "photo/mountains", style: {} },
        { id: "scrim", type: "rect", x: 0, y: 0, width: doc.width, height: doc.height, rotation: 0, z: 1, style: { fill: "#0b0b18aa" } },
        {
          id: "title",
          type: "text",
          x: 80,
          y: 200,
          width: 920,
          height: 380,
          rotation: 0,
          z: 2,
          text: "Ridgeline\nFestival",
          style: { fontSize: 140, fontWeight: "bold", color: "#ffffff", align: "center" },
        },
        { id: "dates", type: "text", x: 80, y: 640, width: 920, height: 90, rotation: 0, z: 3, text: "September 12-14", style: { fontSize: 64, color: "#f6e7c1", align: "center" } },
        { id: "venue", type: "text", x: 80, y: 760, width: 920, height: 70, rotation: 0, z: 4, text: "Alpine Meadow, Colorado", style: { fontSize: 42, color: "#e6e6f2", align: "center" } },
        { id: "cta", type: "text", x: 80, y: 1180, width: 920, height: 70, rotation: 0, z: 5, text: "Tickets at ridgeline.fm", style: { fontSize: 36, color: "#ffffff", align: "center" } },
      ],
    };
    expect(scoreOf(task, composed)).toBeCloseTo(1, 6);
  });

  it("penalises hiding the photograph instead of restacking it", () => {
    const task = getTask("repair.z-order");
    const faded = edit(task, (el) => (el.id === "hero_photo" ? { ...el, style: { ...el.style, opacity: 0 } } : el));
    // Normalized, because changing a `z` is exactly the mutation that reorders
    // the array, and every surface hands the scorer a normalized document.
    const restacked = normalizeDoc(
      edit(task, (el) => {
        const z: Record<string, number> = { hero_photo: 0, scrim: 1, hero_title: 2, hero_sub: 3 };
        return z[el.id] === undefined ? el : { ...el, z: z[el.id]! };
      }),
    );
    expect(scoreOf(task, restacked)).toBeGreaterThan(scoreOf(task, faded));
    expect(scoreOf(task, restacked)).toBeCloseTo(1, 6);
  });

  it("penalises a dark theme made by fading everything out", () => {
    const task = getTask("restyle.dark-mode");
    const faded = edit(task, (el) => ({ ...el, style: { ...el.style, opacity: 0.1 } }));
    expect(scoreOf(task, faded)).toBeLessThan(scoreOf(task, task.initial()));
  });

  /**
   * On-palette is not the same as on-brief. Every colour here comes from the
   * five the brief lists, and every one of them is in the wrong place.
   */
  it("penalises a palette applied to the wrong elements", () => {
    const task = getTask("restyle.palette-swap");
    const scrambled = edit(task, (el) => {
      if (el.id === "panel") return { ...el, style: { ...el.style, fill: "#e3655b" } };
      if (el.id === "button") return { ...el, style: { ...el.style, fill: "#1e1e33" } };
      if (el.type === "text") return { ...el, style: { ...el.style, color: "#f4f1ea" } };
      return el;
    });
    const scrambledDoc: Doc = { ...scrambled, background: "#12121f" };
    const assigned = edit(task, (el) => {
      if (el.id === "panel") return { ...el, style: { ...el.style, fill: "#1e1e33" } };
      if (el.id === "button") return { ...el, style: { ...el.style, fill: "#e3655b" } };
      if (el.id === "description") return { ...el, style: { ...el.style, color: "#a8a3c0" } };
      if (el.type === "text") return { ...el, style: { ...el.style, color: "#f4f1ea" } };
      return el;
    });
    const assignedDoc: Doc = { ...assigned, background: "#12121f" };
    expect(scoreOf(task, assignedDoc)).toBeGreaterThan(scoreOf(task, scrambledDoc));
  });

  it("penalises a button label with nothing painted under it", () => {
    const task = getTask("compose.product-card");
    const doc = task.initial();
    const label: Element = {
      id: "label",
      type: "text",
      x: 64,
      y: 1160,
      width: 420,
      height: 110,
      rotation: 0,
      z: 5,
      text: "Add to basket",
      style: { fontSize: 34, color: "#22223b", align: "center", valign: "middle" },
    };
    const shape: Element = {
      id: "button",
      type: "rect",
      x: 64,
      y: 1160,
      width: 420,
      height: 110,
      rotation: 0,
      z: 4,
      style: { fill: "#d94f3d", radius: 55 },
    };
    const bare = runChecks({ ...doc, elements: [label] }, [...universalChecks(), ...task.checks]);
    const onShape = runChecks({ ...doc, elements: [shape, label] }, [...universalChecks(), ...task.checks]);
    expect(bare.results.find((r) => r.id === "text_on_shape")!.score).toBe(0);
    expect(onShape.results.find((r) => r.id === "text_on_shape")!.score).toBe(1);
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
