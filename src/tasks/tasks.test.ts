import { describe, expect, it } from "vitest";
import { TASKS, getTask, resolveTasks, tasksInFamily } from "./index.js";
import { TASK_FAMILIES } from "./types.js";
import { parseDoc } from "../doc/schema.js";
import { runChecks, universalChecks } from "../eval/checks.js";
import { renderSvg } from "../render/svg.js";

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
