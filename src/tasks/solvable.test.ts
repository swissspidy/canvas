import { describe, expect, it } from "vitest";
import { TASKS, getTask } from "./index.js";
import { normalizeDoc } from "../doc/schema.js";
import { runChecks, universalChecks } from "../eval/checks.js";
import type { Doc, Element } from "../doc/types.js";

/**
 * The other half of the eval's own eval.
 *
 * `tasks.test.ts` asserts that every task starts broken. This one asserts that
 * every task can be *finished*: for each one there is a document a competent
 * designer would produce, and it scores full marks.
 *
 * Without this, a task can be quietly impossible and nothing says so. Every run
 * in every cell records the same failure, the surfaces all tie, and the result
 * reads as "the surface does not matter" — which is the finding this study is
 * most at risk of manufacturing by accident.
 *
 * It caught exactly that. `restyle.palette-swap` assigned the button label the
 * palette's primary text and put it on the palette's accent fill, which is
 * 2.97:1, while the same brief asked for 4.5:1 — the two checks could not both
 * be satisfied, and every run would have lost the same three points forever.
 * The label is now assigned the background colour, which is 5.55:1 on the
 * accent.
 *
 * These documents are reference *solutions*, not reference *renderings*: they
 * are here to prove the checks are satisfiable together, and no agent ever sees
 * them.
 */

const FULL_MARKS = 0.999;

function scoreOf(taskId: string, doc: Doc): number {
  const task = getTask(taskId);
  return runChecks(normalizeDoc(doc), [...universalChecks(), ...task.checks]).score;
}

/** A solution built by editing the starting document, which is most of them. */
function edit(taskId: string, fn: (el: Element) => Element, background?: string): Doc {
  const doc = getTask(taskId).initial();
  return { ...doc, ...(background ? { background } : {}), elements: doc.elements.map(fn) };
}

const text = (
  id: string,
  body: string,
  box: { x: number; y: number; w: number; h: number; z: number },
  style: Element["style"],
): Element => ({
  id,
  type: "text",
  x: box.x,
  y: box.y,
  width: box.w,
  height: box.h,
  rotation: 0,
  z: box.z,
  text: body,
  style,
});

const W = 1080;
const H = 1350;

/**
 * One reference solution per task. Where the fix is an edit of the starting
 * document it is written as one, so the diff from the broken state is the
 * point rather than a wall of literals.
 */
const SOLUTIONS: Record<string, () => Doc> = {
  // --- compose: built from nothing ----------------------------------------

  "compose.festival-poster": () => ({
    width: W,
    height: H,
    background: "#101020",
    elements: [
      { id: "bg", type: "image", x: 0, y: 0, width: W, height: H, rotation: 0, z: 0, src: "photo/mountains", style: {} },
      { id: "scrim", type: "rect", x: 0, y: 0, width: W, height: H, rotation: 0, z: 1, style: { fill: "#0b0b18aa" } },
      // Two lines, one element: the newline is a hard line break, and nothing
      // here may charge a composition for using one.
      text("title", "Ridgeline\nFestival", { x: 80, y: 200, w: 920, h: 380, z: 2 }, { fontSize: 140, fontWeight: "bold", color: "#ffffff", align: "center" }),
      text("dates", "September 12-14", { x: 80, y: 640, w: 920, h: 90, z: 3 }, { fontSize: 64, color: "#f6e7c1", align: "center" }),
      text("venue", "Alpine Meadow, Colorado", { x: 80, y: 760, w: 920, h: 70, z: 4 }, { fontSize: 42, color: "#e6e6f2", align: "center" }),
      text("cta", "Tickets at ridgeline.fm", { x: 80, y: 1180, w: 920, h: 70, z: 5 }, { fontSize: 36, color: "#ffffff", align: "center" }),
    ],
  }),

  "compose.event-flyer": () => ({
    width: W,
    height: H,
    background: "#fdf6ec",
    elements: [
      text("head", "Saturday\nCoffee Morning", { x: 60, y: 90, w: 960, h: 260, z: 0 }, { fontSize: 96, fontWeight: "bold", color: "#3a2417", align: "center" }),
      { id: "photo", type: "image", x: 60, y: 400, width: 960, height: 520, rotation: 0, z: 1, src: "photo/coffee", style: { radius: 16 } },
      text("when", "Every Saturday, 9am to noon", { x: 60, y: 960, w: 960, h: 70, z: 2 }, { fontSize: 48, color: "#4a3121", align: "center" }),
      text("where", "Corner of Fifth and Pine", { x: 60, y: 1050, w: 960, h: 60, z: 3 }, { fontSize: 38, color: "#5a3d28", align: "center" }),
      text("signoff", "All welcome. Bring a friend.", { x: 60, y: 1180, w: 960, h: 60, z: 4 }, { fontSize: 32, color: "#6a4a30", align: "center" }),
    ],
  }),

  "compose.quote-card": () => ({
    width: W,
    height: H,
    background: "#1b1b28",
    elements: [
      { id: "rule", type: "rect", x: 140, y: 380, width: 120, height: 8, rotation: 0, z: 0, style: { fill: "#e3a35b" } },
      text("quote", "We shape our buildings; thereafter they shape us.", { x: 120, y: 440, w: 840, h: 480, z: 1 }, { fontSize: 82, fontWeight: "bold", color: "#f4f1ea", lineHeight: 1.3 }),
      text("who", "Winston Churchill, 1943", { x: 120, y: 960, w: 840, h: 60, z: 2 }, { fontSize: 34, color: "#a8a3c0" }),
    ],
  }),

  "compose.product-card": () => ({
    width: W,
    height: H,
    background: "#ffffff",
    elements: [
      { id: "photo", type: "image", x: 0, y: 0, width: W, height: 660, rotation: 0, z: 0, src: "photo/coffee", style: {} },
      text("name", "Ridge Roast", { x: 64, y: 720, w: 700, h: 90, z: 1 }, { fontSize: 72, fontWeight: "bold", color: "#22223b" }),
      text("price", "$18.00", { x: 64, y: 830, w: 700, h: 70, z: 2 }, { fontSize: 52, fontWeight: "bold", color: "#2b3a67" }),
      text("desc", "A dark, cocoa-forward blend from three Colorado farms. Roasted weekly.", { x: 64, y: 930, w: 860, h: 180, z: 3 }, { fontSize: 30, color: "#4a4a63", lineHeight: 1.4 }),
      // Dark enough that the white label clears 4.5:1 on it.
      { id: "button", type: "rect", x: 64, y: 1160, width: 420, height: 110, rotation: 0, z: 4, style: { fill: "#a8352a", radius: 55 } },
      text("button_label", "Add to basket", { x: 64, y: 1160, w: 420, h: 110, z: 5 }, { fontSize: 34, fontWeight: "bold", color: "#ffffff", align: "center", valign: "middle" }),
    ],
  }),

  // The gradient runs from #ff7a59 to #ffd166, so white type on it is 1.9:1
  // and the readable answer is dark ink.
  "compose.title-card": () => ({
    width: W,
    height: H,
    background: "#ffffff",
    elements: [
      { id: "bg", type: "image", x: 0, y: 0, width: W, height: H, rotation: 0, z: 0, src: "texture/gradient", style: {} },
      text("talk", "Interfaces That\nExplain Themselves", { x: 80, y: 420, w: 920, h: 380, z: 1 }, { fontSize: 96, fontWeight: "bold", color: "#1a1208" }),
      text("speaker", "Dana Okonkwo", { x: 80, y: 860, w: 920, h: 80, z: 2 }, { fontSize: 52, color: "#2a1c10" }),
      text("event", "Layout Conf 2026", { x: 80, y: 960, w: 920, h: 60, z: 3 }, { fontSize: 36, color: "#33220f" }),
    ],
  }),

  // --- repair: edits of the broken document --------------------------------

  "repair.overlapping-stack": () =>
    edit("repair.overlapping-stack", (el) => {
      if (el.id === "headline") return { ...el, x: 100, y: 250, width: 880, height: 110 };
      if (el.id === "subhead") return { ...el, x: 100, y: 380, width: 880, height: 60 };
      if (el.id === "body") return { ...el, x: 100, y: 470, width: 880, height: 200 };
      if (el.id === "badge") return { ...el, x: 700, y: 720, width: 240, height: 240 };
      return el;
    }),

  "repair.off-canvas": () =>
    edit("repair.off-canvas", (el) => {
      if (el.id === "photo") return { ...el, x: 40, y: 40 };
      if (el.id === "caption") return { ...el, x: 40, y: 700, width: 1000 };
      if (el.id === "credit") return { ...el, x: 40, y: 830 };
      if (el.id === "tag_a") return { ...el, x: 140, y: 1150 };
      if (el.id === "tag_b") return { ...el, x: 640, y: 1150 };
      return el;
    }),

  // The shape keeps its size and its place on the card; what changes is what
  // is painted over what.
  "repair.buried-text": () =>
    edit("repair.buried-text", (el) => {
      const z: Record<string, number> = { blot: 1, title: 2, note: 3 };
      return z[el.id] === undefined ? el : { ...el, z: z[el.id]! };
    }),

  "repair.z-order": () =>
    edit("repair.z-order", (el) => {
      const z: Record<string, number> = { hero_photo: 0, scrim: 1, hero_title: 2, hero_sub: 3 };
      return z[el.id] === undefined ? el : { ...el, z: z[el.id]! };
    }),

  // Narrowing the title's box reflows it onto two lines, so the box has to
  // grow with it — which is the part of this task that is not arithmetic.
  "repair.crowded-margins": () =>
    edit("repair.crowded-margins", (el) => {
      if (el.id === "kicker") return { ...el, x: 60, y: 60, width: 500, height: 60 };
      if (el.id === "title") return { ...el, x: 60, y: 140, width: 960, height: 240 };
      if (el.id === "art") return { ...el, x: 60, y: 410, width: 960, height: 600 };
      if (el.id === "footer") return { ...el, x: 60, y: 1234, width: 960, height: 56 };
      return el;
    }),

  "repair.mixed-defects": () =>
    edit("repair.mixed-defects", (el) => {
      if (el.id === "cover") return { ...el, x: 40, y: 60, z: 0 };
      if (el.id === "plate") return { ...el, x: 90, y: 810, z: 1 };
      if (el.id === "lead") return { ...el, y: 850, z: 2 };
      if (el.id === "standfirst") return { ...el, y: 1035, z: 3 };
      if (el.id === "byline") return { ...el, x: 90, y: 1260, z: 4 };
      return el;
    }),

  // --- fit: find the room, do not shrink the type out of legibility --------

  "fit.long-headline": () =>
    edit("fit.long-headline", (el) => {
      if (el.id === "headline") return { ...el, y: 300, height: 280, style: { ...el.style, fontSize: 52 } };
      if (el.id === "para") return { ...el, y: 610, height: 320 };
      return el;
    }),

  // The page had 660 units of unused space between the body and the caption.
  "fit.body-overflow": () => edit("fit.body-overflow", (el) => (el.id === "body" ? { ...el, height: 800 } : el)),

  "fit.three-overflowing": () =>
    edit("fit.three-overflowing", (el) => {
      const y: Record<string, number> = { one: 120, two: 480, three: 900 };
      return y[el.id] === undefined ? el : { ...el, y: y[el.id]!, height: 320, style: { ...el.style, fontSize: 36 } };
    }),

  "fit.caption-under-image": () =>
    edit("fit.caption-under-image", (el) =>
      el.id === "caption" ? { ...el, height: 300, style: { ...el.style, fontSize: 30 } } : el,
    ),

  // The longer column decides the size, and the shorter one takes it too.
  "fit.two-column": () =>
    edit("fit.two-column", (el) =>
      el.id === "left_col" || el.id === "right_col" ? { ...el, style: { ...el.style, fontSize: 36 } } : el,
    ),

  // --- restyle: colour only ------------------------------------------------

  "restyle.palette-swap": () =>
    edit(
      "restyle.palette-swap",
      (el) => {
        const style = { ...el.style };
        if (el.id === "panel") style.fill = "#1e1e33";
        if (el.id === "heading" || el.id === "price") style.color = "#f4f1ea";
        if (el.id === "description") style.color = "#a8a3c0";
        if (el.id === "button") style.fill = "#e3655b";
        if (el.id === "button_label") style.color = "#12121f";
        return { ...el, style };
      },
      "#12121f",
    ),

  "restyle.dark-mode": () =>
    edit(
      "restyle.dark-mode",
      (el) => {
        const style = { ...el.style };
        if (el.id === "sheet") style.fill = "#12121f";
        if (el.id === "title") style.color = "#f4f1ea";
        if (el.id === "standfirst") style.color = "#cfcadd";
        if (el.id === "byline") style.color = "#b3aec6";
        if (el.id === "tag") style.fill = "#3a2f5a";
        if (el.id === "tag_label") style.color = "#e9e4f2";
        return { ...el, style };
      },
      "#0e0e18",
    ),

  // --- arrange: one gap, one edge ------------------------------------------

  "arrange.ragged-column": () =>
    edit("arrange.ragged-column", (el) => {
      const i = ["r1", "r2", "r3", "r4", "r5"].indexOf(el.id);
      return i < 0 ? el : { ...el, x: 132, y: 355 + i * 140 };
    }),

  "arrange.uneven-row": () =>
    edit("arrange.uneven-row", (el) => {
      const i = ["c1", "c2", "c3", "c4"].indexOf(el.id);
      return i < 0 ? el : { ...el, x: 40 + i * (200 + 200 / 3), y: 520 };
    }),

  "arrange.card-grid": () =>
    edit("arrange.card-grid", (el) => {
      const i = ["g1", "g2", "g3", "g4", "g5", "g6"].indexOf(el.id);
      if (i < 0) return el;
      return { ...el, x: 40 + (i % 3) * 360, y: 320 + Math.floor(i / 3) * 390 };
    }),
};

describe("every task can be finished", () => {
  it("has a reference solution for every task in the registry", () => {
    expect(Object.keys(SOLUTIONS).sort()).toEqual(TASKS.map((t) => t.id).sort());
  });

  it.each(TASKS.map((t) => t.id))("%s scores full marks on a competent layout", (id) => {
    const solution = SOLUTIONS[id]!();
    const score = scoreOf(id, solution);
    // Reported rather than merely asserted: a solution that scrapes past the
    // threshold is a check that disagrees with a designer, and worth reading.
    expect(score, `${id} scored ${(score * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(FULL_MARKS);
  });

  it("scores every reference solution above its own starting document", () => {
    for (const task of TASKS) {
      const baseline = runChecks(task.initial(), [...universalChecks(), ...task.checks]).score;
      expect(scoreOf(task.id, SOLUTIONS[task.id]!()), task.id).toBeGreaterThan(baseline);
    }
  });
});
