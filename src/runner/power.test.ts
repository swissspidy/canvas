import { describe, expect, it } from "vitest";
import { estimateVariance, minimumDetectableEffect, simulatePower } from "./power.js";
import type { RunScore } from "../eval/score.js";

/**
 * The eval's own eval, one level up: `solvable.test.ts` asserts the tasks can be
 * finished, and this asserts the *analysis* can find something when something is
 * there — and, more importantly, that it does not find things that are not.
 */
describe("power simulation", () => {
  // Trials are kept low enough to stay inside a fast suite. Every assertion
  // below is a wide band for that reason: these check the simulation behaves
  // like a power curve, not that a particular percentage is exact.
  const TRIALS = 200;

  it("holds its false-positive rate near the nominal 5% when there is no effect", () => {
    // The load-bearing one. If a bootstrap over 23 clusters resolved a
    // difference far more than 5% of the time with no difference present, every
    // interval in the report would be too narrow and §5's decision rule would
    // be rubber-stamping noise. A percentile bootstrap is mildly liberal at
    // this cluster count, so the band allows for that and would still catch a
    // rate that had come loose.
    const nothing = simulatePower({ effectPoints: 0, trials: TRIALS });
    const falsePositives = nothing.power + nothing.wrongDirection;
    expect(falsePositives).toBeGreaterThan(0.01);
    expect(falsePositives).toBeLessThan(0.12);
  });

  it("resolves a large effect far more often than a small one", () => {
    const small = simulatePower({ effectPoints: 3, trials: TRIALS });
    const large = simulatePower({ effectPoints: 20, trials: TRIALS });
    expect(large.power).toBeGreaterThan(small.power + 0.3);
    expect(large.power).toBeGreaterThan(0.9);
  });

  it("gains more power from tasks than from repeats when the interaction dominates", () => {
    // The finding the whole file exists to make available. With the task x
    // condition interaction the larger term, tripling repeats leaves it
    // untouched while adding tasks shrinks the interval directly — so a budget
    // spent on repeats buys much less than the same budget spent on tasks.
    const base = { effectPoints: 8, taskSdPoints: 15, runSdPoints: 10, trials: TRIALS };
    const moreRepeats = simulatePower({ ...base, tasks: 23, repeats: 9 });
    const moreTasks = simulatePower({ ...base, tasks: 69, repeats: 3 });
    expect(moreTasks.power).toBeGreaterThan(moreRepeats.power);
  });

  it("narrows the interval as tasks are added", () => {
    const few = simulatePower({ tasks: 8, trials: TRIALS });
    const many = simulatePower({ tasks: 60, trials: TRIALS });
    expect(many.medianWidthPoints).toBeLessThan(few.medianWidthPoints);
  });

  it("loses power to the ceiling when both arms run near the top of the scale", () => {
    // `normalizedScore` caps at 1. Two conditions both closing most of the
    // headroom have their difference squeezed by that cap, which is the regime
    // a study is in precisely when its agents are doing well.
    const midScale = simulatePower({ effectPoints: 10, basePoints: 40, trials: TRIALS });
    const againstCeiling = simulatePower({ effectPoints: 10, basePoints: 95, trials: TRIALS });
    expect(againstCeiling.power).toBeLessThan(midScale.power);
  });

  it("is not an artifact of the pipeline's fixed bootstrap seed", () => {
    // The analysis seeds its bootstrap from the number of deltas, so every
    // trial at a given task count resamples identically. If that one pattern
    // were unrepresentative, re-randomising it per trial would move the answer.
    const fixed = simulatePower({ effectPoints: 10, trials: TRIALS });
    const reseeded = simulatePower({ effectPoints: 10, trials: TRIALS, reseedBootstrap: true });
    expect(Math.abs(fixed.power - reseeded.power)).toBeLessThan(0.15);
  });

  it("reports the smallest effect it can resolve 80% of the time", () => {
    const mde = minimumDetectableEffect({ trials: TRIALS });
    expect(mde).not.toBeNull();
    expect(mde!.effectPoints).toBeGreaterThan(0);
    expect(mde!.effectPoints).toBeLessThan(40);
    // A design that resolves X should comfortably resolve twice X.
    const double = simulatePower({ effectPoints: mde!.effectPoints * 2, trials: TRIALS });
    expect(double.power).toBeGreaterThan(0.9);
  });

  it("returns null rather than a number when no effect in range is detectable", () => {
    // One task cannot resolve anything: `pairedDifference` needs more than one
    // delta before it will call a difference resolved at all.
    expect(minimumDetectableEffect({ tasks: 1, trials: 40 })).toBeNull();
  });
});

describe("variance estimation", () => {
  function row(taskId: string, surfaceId: string, points: number, i: number): RunScore {
    return {
      runId: `${taskId}__${surfaceId}__${i}`,
      taskId,
      taskFamily: "sim",
      surfaceId,
      feedbackMode: "structured",
      model: "m",
      stopReason: "completed",
      constraintScore: 0,
      checkResults: [],
      judgeCriteriaScore: null,
      judgeOverallScore: null,
      judgeSummary: null,
      composite: 0,
      baselineScore: 0,
      normalizedScore: points / 100,
      efficiency: {
        turns: 0, toolCalls: 0, failedToolCalls: 0, failureRate: 0, inputTokens: 0,
        outputTokens: 0, totalTokens: 0, costUsd: 0, pricingKnown: true, wallMs: 0,
      },
      toolUsage: {},
    };
  }

  it("separates run noise from the task x condition interaction", () => {
    // Built so the two terms are unmistakable: every repeat within a cell is
    // identical, so run noise is zero, while each task gives condition `a` a
    // different advantage, so the interaction is all that is left.
    const scores: RunScore[] = [];
    const advantages = [0, 10, 20, 30, 40, 50];
    advantages.forEach((advantage, t) => {
      for (let i = 0; i < 3; i++) {
        scores.push(row(`t${t}`, "a", 50 + advantage, i));
        scores.push(row(`t${t}`, "b", 50, i));
      }
    });

    const estimate = estimateVariance(scores, "a", "b");
    expect(estimate.runSdPoints).toBe(0);
    // SD of [0,10,20,30,40,50] is ~18.7.
    expect(estimate.taskSdPoints).toBeGreaterThan(15);
    expect(estimate.taskSdPoints).toBeLessThan(22);
    expect(estimate.pairedTasks).toBe(6);
    expect(estimate.cellsWithRepeats).toBe(12);
  });

  it("finds run noise where repeats disagree and no interaction where they do not", () => {
    // The mirror image: every task gives both conditions the same treatment, so
    // there is no interaction, and the spread lives entirely within cells.
    const scores: RunScore[] = [];
    for (let t = 0; t < 6; t++) {
      [40, 50, 60].forEach((points, i) => {
        scores.push(row(`t${t}`, "a", points, i));
        scores.push(row(`t${t}`, "b", points, i));
      });
    }

    const estimate = estimateVariance(scores, "a", "b");
    expect(estimate.runSdPoints).toBeGreaterThan(5);
    // Deltas are identically zero, so the residual interaction floors at zero
    // rather than going negative.
    expect(estimate.taskSdPoints).toBe(0);
  });

  it("does not invent an interaction out of unequal repeat counts", () => {
    // A resumed or partly-failed sweep leaves cells with different repeat
    // counts, and a thin cell's arm mean is noisier than a full one's. Charging
    // every task the noise of the *best*-covered one subtracts too little, and
    // the leftover looks like a task x condition interaction that is not there.
    //
    // Both arms here are drawn from one distribution, so the true interaction
    // is zero and every delta is run noise. Half the tasks have 2 repeats and
    // half have 8. Collapsing that to a single repeat count reports a ~6.5
    // point interaction; charging each task its own noise reports none.
    let seed = 12345 >>> 0;
    const uniform = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const gauss = () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());

    const scores: RunScore[] = [];
    for (let t = 0; t < 24; t++) {
      const repeats = t % 2 === 0 ? 2 : 8;
      for (const surface of ["a", "b"]) {
        for (let i = 0; i < repeats; i++) scores.push(row(`t${t}`, surface, 50 + gauss() * 15, i));
      }
    }

    const estimate = estimateVariance(scores, "a", "b");
    expect(estimate.pairedTasks).toBe(24);
    expect(estimate.runSdPoints).toBeGreaterThan(10);
    expect(estimate.taskSdPoints).toBeLessThan(2);
  });

  it("reports zeroes rather than throwing on a sweep too thin to estimate from", () => {
    const estimate = estimateVariance([row("t0", "a", 50, 0)], "a", "b");
    expect(estimate).toMatchObject({ runSdPoints: 0, taskSdPoints: 0, pairedTasks: 0, cellsWithRepeats: 0 });
  });
});
