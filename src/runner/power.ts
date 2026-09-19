/**
 * How large an effect can this design actually resolve?
 *
 * `docs/PREREGISTRATION.md` §10 sizes the grid in runs and dollars, which is a
 * cost estimate rather than a power analysis. It fixes 23 tasks and 3 repeats,
 * §2 predicts a surface effect of at least 10 improvement points, and §5 calls
 * a resolved difference below 5 points not worth acting on — but nothing
 * establishes that 23 task-clusters can *resolve* 10 points, or 5. A grid that
 * cannot is one that pays for 828 runs to report a set of overlapping
 * intervals.
 *
 * This answers that before the money is spent, by simulation rather than by a
 * closed form. A closed form would have to assume the analysis is a t-test; the
 * analysis is a seeded percentile bootstrap over per-task deltas, so the honest
 * way to characterise it is to run it. Every trial here goes through the real
 * `pairedDifference` — the same function that will produce the paper's
 * numbers — on synthetic `RunScore` rows. Nothing about the analysis path is
 * reimplemented, so this measures the pipeline rather than a model of it.
 *
 * What is being simulated
 * ----------------------
 *
 * A paired comparison of two conditions over `tasks` tasks with `repeats` runs
 * per cell. Each task's delta carries two sources of spread:
 *
 *   - **Task x condition interaction** (`taskSd`). The surface that helps on a
 *     crowded repair may do nothing on a palette swap. Pairing removes the
 *     difficulty of a task; it does not remove the way a condition's advantage
 *     varies *across* tasks. This term does not shrink with repeats.
 *   - **Run-to-run noise** (`runSd`). Sampling cannot be pinned (§7), so a cell
 *     re-run gives a different score. Averaged over `repeats` runs in each arm,
 *     this contributes `2 * runSd^2 / repeats` to the delta's variance.
 *
 * That split is the whole practical point of the exercise. Repeats buy down
 * only the second term, so once run noise is averaged below the interaction the
 * next repeat buys almost nothing and the only thing left that adds power is
 * more tasks. Which of the two dominates is an empirical question, and
 * `estimateVariance` reads it off a real sweep once one exists.
 *
 * The ceiling is modelled because it is real: `normalizedScore` is capped at 1
 * — a run cannot close more than the available headroom — while nothing stops
 * it going negative. Two conditions both scoring near the top have their
 * difference compressed by that cap, which costs power in exactly the regime a
 * successful study ends up in.
 *
 * Everything is in improvement *points* (0-100) rather than the 0..1 the scorer
 * uses, because that is the unit §2 and §5 state their thresholds in.
 */

import { mulberry32, pairedDifference, BOOTSTRAP_SEED, type ResolutionMethod } from "./report.js";
import type { RunScore } from "../eval/score.js";

/** 80% is the convention, and the level `minimumDetectableEffect` solves for. */
export const TARGET_POWER = 0.8;

export interface PowerParams {
  /** True difference between the two conditions, in improvement points. */
  effectPoints: number;
  /** Task clusters. The pre-registered grid has 23. */
  tasks: number;
  /** Runs per cell, per arm. The pre-registered grid has 3. */
  repeats: number;
  /** SD of the task x condition interaction, in points. Does not shrink with repeats. */
  taskSdPoints: number;
  /** SD of run-to-run noise within a cell, in points. */
  runSdPoints: number;
  /**
   * Where the weaker arm sits on the 0-100 scale. Matters only through the
   * ceiling: two arms near 100 have their difference compressed.
   */
  basePoints: number;
  /** Simulated experiments. */
  trials: number;
  /**
   * Vary the bootstrap's own seed per trial.
   *
   * The pipeline's bootstrap is seeded from the number of deltas, so every
   * trial with the same task count resamples in an identical pattern. Left
   * alone, this function therefore measures the behaviour of the exact seeded
   * bootstrap the study will run, which is the honest default. Setting this
   * re-randomises it per trial, which answers the separate question of whether
   * that one fixed pattern is unrepresentative.
   */
  reseedBootstrap: boolean;
  /**
   * Which rule decides "resolved".
   *
   * The point of being able to switch it here is that calibration is not a
   * matter of opinion: run both at the same cluster count with no effect
   * planted and the false-positive rates say which one is a 95% test.
   */
  method: ResolutionMethod;
}

export interface PowerResult extends PowerParams {
  /** Share of trials resolving the difference in the true direction. */
  power: number;
  /**
   * Share of trials resolving it in the *wrong* direction.
   *
   * At `effectPoints: 0` the two together are the false-positive rate, which
   * should land near the bootstrap's nominal 5%. Materially above it means the
   * analysis over-resolves and every interval in the report is too narrow.
   */
  wrongDirection: number;
  /** Median width of the 95% interval, in points. */
  medianWidthPoints: number;
}

export const DEFAULT_PARAMS: PowerParams = {
  effectPoints: 10,
  tasks: 23,
  repeats: 3,
  taskSdPoints: 12,
  runSdPoints: 15,
  basePoints: 50,
  trials: 400,
  reseedBootstrap: false,
  method: "bootstrap",
};

/** Standard normal, Box-Muller over a seeded uniform stream. */
function normals(seed: number): () => number {
  const rand = mulberry32(seed);
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    // `1 - rand()` because Math.log(0) is -Infinity and mulberry32 can return 0.
    const radius = Math.sqrt(-2 * Math.log(1 - rand()));
    const angle = 2 * Math.PI * rand();
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
}

/**
 * A synthetic row carrying only what `pairedDifference` reads: the task it
 * belongs to, the condition it is in, and its normalized score. The rest of
 * `RunScore` is filled to keep the type honest and is never looked at.
 */
function row(taskId: string, surfaceId: string, points: number): RunScore {
  return {
    runId: `${taskId}__${surfaceId}`,
    taskId,
    taskFamily: "sim",
    surfaceId,
    feedbackMode: "sim",
    model: "sim",
    stopReason: "completed",
    constraintScore: 0,
    checkResults: [],
    judgeCriteriaScore: null,
    judgeOverallScore: null,
    judgeSummary: null,
    composite: 0,
    baselineScore: 0,
    // The one field that matters. Points back onto the 0..1 the scorer uses.
    normalizedScore: points / 100,
    efficiency: { turns: 0, toolCalls: 0, failedToolCalls: 0, failureRate: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, pricingKnown: true, wallMs: 0 },
    toolUsage: {},
  };
}

export function simulatePower(params: Partial<PowerParams> = {}): PowerResult {
  const p = { ...DEFAULT_PARAMS, ...params };
  const gauss = normals(BOOTSTRAP_SEED + 104729);

  let resolvedRight = 0;
  let resolvedWrong = 0;
  const widths: number[] = [];

  for (let trial = 0; trial < p.trials; trial++) {
    const scores: RunScore[] = [];
    for (let t = 0; t < p.tasks; t++) {
      const taskId = `t${t}`;
      // The advantage this condition happens to have on this task. Survives
      // pairing, and no number of repeats touches it.
      const interaction = gauss() * p.taskSdPoints;
      for (let r = 0; r < p.repeats; r++) {
        const a = p.basePoints + p.effectPoints + interaction + gauss() * p.runSdPoints;
        const b = p.basePoints + gauss() * p.runSdPoints;
        // Capped above and not below, exactly as `normalizedScore` is.
        scores.push(row(taskId, "a", Math.min(100, a)));
        scores.push(row(taskId, "b", Math.min(100, b)));
      }
    }

    const seed = p.reseedBootstrap ? BOOTSTRAP_SEED + trial * 7919 : BOOTSTRAP_SEED;
    const diff = pairedDifference(scores, (s) => s.surfaceId, "a", "b", (s) => s.normalizedScore, 2000, seed, p.method);
    widths.push((diff.high - diff.low) * 100);
    if (diff.resolved) {
      // `difference` is a - b, so a positive planted effect should resolve positive.
      if (diff.difference > 0 === p.effectPoints >= 0) resolvedRight++;
      else resolvedWrong++;
    }
  }

  widths.sort((x, y) => x - y);
  return {
    ...p,
    power: resolvedRight / p.trials,
    wrongDirection: resolvedWrong / p.trials,
    medianWidthPoints: widths[Math.floor(widths.length / 2)] ?? 0,
  };
}

/**
 * The smallest effect this design resolves `TARGET_POWER` of the time.
 *
 * Bisection on effect size. Power is monotone in the effect, up to simulation
 * noise, so the bracket is safe; the noise is why the result is rounded to a
 * tenth of a point rather than reported to three decimals it has not earned.
 */
export function minimumDetectableEffect(
  params: Partial<PowerParams> = {},
  targetPower = TARGET_POWER,
  maxPoints = 60,
): { effectPoints: number; power: number } | null {
  const at = (effectPoints: number) => simulatePower({ ...params, effectPoints }).power;

  if (at(maxPoints) < targetPower) return null;

  let low = 0;
  let high = maxPoints;
  let best = { effectPoints: maxPoints, power: at(maxPoints) };
  for (let i = 0; i < 12; i++) {
    const mid = (low + high) / 2;
    const power = at(mid);
    if (power >= targetPower) {
      best = { effectPoints: mid, power };
      high = mid;
    } else {
      low = mid;
    }
  }
  return { effectPoints: Math.round(best.effectPoints * 10) / 10, power: best.power };
}

export interface VarianceEstimate {
  taskSdPoints: number;
  runSdPoints: number;
  /** Cells with more than one repeat, which is what `runSdPoints` rests on. */
  cellsWithRepeats: number;
  /** Tasks contributing a delta, which is what `taskSdPoints` rests on. */
  pairedTasks: number;
}

/**
 * Read the two variance terms off a real sweep, so the simulation can be re-run
 * on measured spread instead of assumed spread.
 *
 * `runSd` is pooled within (task, surface, feedback) cells across repeats, which
 * is the only place run-to-run noise appears on its own. `taskSd` is then what
 * is left in the spread of per-task deltas once the run component is removed:
 *
 *     var(delta) = taskSd^2 + 2 * runSd^2 / repeats
 *
 * Negative residuals are floored at zero — that is a sweep whose deltas are
 * tighter than run noise alone predicts, which means not enough tasks to
 * measure the interaction rather than an interaction below zero.
 */
export function estimateVariance(scores: RunScore[], a: string, b: string, condition: (s: RunScore) => string = (s) => s.surfaceId): VarianceEstimate {
  const cells = new Map<string, number[]>();
  for (const s of scores) {
    const key = `${s.taskId}|${s.surfaceId}|${s.feedbackMode}|${s.model}`;
    cells.set(key, [...(cells.get(key) ?? []), s.normalizedScore * 100]);
  }

  // Pooled within-cell variance: sum of squared deviations over total degrees
  // of freedom, rather than a mean of per-cell SDs, which would weight a
  // two-run cell like a ten-run one.
  let ss = 0;
  let df = 0;
  let cellsWithRepeats = 0;
  for (const values of cells.values()) {
    if (values.length < 2) continue;
    cellsWithRepeats++;
    const m = values.reduce((x, y) => x + y, 0) / values.length;
    for (const v of values) ss += (v - m) ** 2;
    df += values.length - 1;
  }
  const runSd = df > 0 ? Math.sqrt(ss / df) : 0;

  const perTask = new Map<string, { a: number[]; b: number[] }>();
  for (const s of scores) {
    const side = condition(s);
    if (side !== a && side !== b) continue;
    const bucket = perTask.get(s.taskId) ?? { a: [], b: [] };
    (side === a ? bucket.a : bucket.b).push(s.normalizedScore * 100);
    perTask.set(s.taskId, bucket);
  }
  const deltas: number[] = [];
  let repeatsPerArm = 1;
  for (const { a: left, b: right } of perTask.values()) {
    if (left.length === 0 || right.length === 0) continue;
    repeatsPerArm = Math.max(repeatsPerArm, Math.min(left.length, right.length));
    deltas.push(
      left.reduce((x, y) => x + y, 0) / left.length - right.reduce((x, y) => x + y, 0) / right.length,
    );
  }

  let taskSd = 0;
  if (deltas.length > 1) {
    const m = deltas.reduce((x, y) => x + y, 0) / deltas.length;
    const varDelta = deltas.reduce((acc, d) => acc + (d - m) ** 2, 0) / (deltas.length - 1);
    taskSd = Math.sqrt(Math.max(0, varDelta - (2 * runSd ** 2) / repeatsPerArm));
  }

  return {
    taskSdPoints: Math.round(taskSd * 10) / 10,
    runSdPoints: Math.round(runSd * 10) / 10,
    cellsWithRepeats,
    pairedTasks: deltas.length,
  };
}
