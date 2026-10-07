import { describe, expect, it } from "vitest";
import { PROTOTYPE_TASKS, TASKS, getTask } from "./index.js";
import { normalizeDoc } from "../doc/schema.js";
import { runChecks, universalChecks } from "../eval/checks.js";
import type { Doc } from "../doc/types.js";
import { PROTOTYPE_SOLUTIONS, SOLUTIONS } from "./solutions.js";

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

describe("every task can be finished", () => {
  it("has a reference solution for every task in the registry", () => {
    expect(Object.keys(SOLUTIONS).sort()).toEqual(TASKS.map((t) => t.id).sort());
  });

  it.each(TASKS.map((t) => t.id))("%s scores full marks on a competent layout", async (id) => {
    const solution = SOLUTIONS[id]!();
    const score = scoreOf(id, solution);
    if (process.env.CANVAS_DUMP) (await import("node:fs")).writeFileSync(`${process.env.CANVAS_DUMP}/${id}.json`, JSON.stringify(solution));
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

describe("every prototype can be finished", () => {
  it("has a reference solution for every prototype", () => {
    expect(Object.keys(PROTOTYPE_SOLUTIONS).sort()).toEqual(PROTOTYPE_TASKS.map((t) => t.id).sort());
  });

  it.each(PROTOTYPE_TASKS.map((t) => t.id))("%s scores full marks on a competent construction", async (id) => {
    const solution = PROTOTYPE_SOLUTIONS[id]!();
    if (process.env.CANVAS_DUMP) (await import("node:fs")).writeFileSync(`${process.env.CANVAS_DUMP}/${id}.json`, JSON.stringify(solution));
    const score = scoreOf(id, solution);
    expect(score, `${id} scored ${(score * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(FULL_MARKS);
  });

  it("starts every prototype well below full marks", () => {
    for (const task of PROTOTYPE_TASKS) {
      expect(runChecks(task.initial(), [...universalChecks(), ...task.checks]).score, task.id).toBeLessThan(0.9);
    }
  });
});
