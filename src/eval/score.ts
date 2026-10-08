/**
 * Scoring a finished run.
 *
 * Two scores, reported separately and always: a deterministic constraint score
 * and a judge score for intent. The composite exists for ranking convenience
 * and is a fixed 60/40 blend fixed in advance (`docs/PREREGISTRATION.md`) —
 * choosing the weighting after seeing the results would let the headline be
 * tuned into existence.
 *
 * Efficiency travels with the score rather than in a separate table. A surface
 * that wins on quality while costing four times as much has not obviously won,
 * and the analysis should not have to go looking for that.
 */

import type { Doc } from "../doc/types.js";
import type { Task } from "../tasks/types.js";
import { PASS_THRESHOLD, runChecks, universalChecks, type CheckResult } from "./checks.js";
import type { JudgeResult } from "./judge.js";
import type { RunResult } from "../agent/loop.js";

/** Fixed in advance. See `docs/PREREGISTRATION.md`. */
export const CONSTRAINT_WEIGHT = 0.6;
export const JUDGE_WEIGHT = 0.4;

export interface Efficiency {
  turns: number;
  toolCalls: number;
  failedToolCalls: number;
  /** Failed calls as a share of all calls. */
  failureRate: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Agent and judge together: the sweep's bill. */
  costUsd: number;
  /**
   * The agent's spend alone — what it took to produce the page. The cost-to-
   * pass outcome reads this, because the judge's call is the same price
   * whatever the surface and would only dilute the difference. Absent on
   * records written before it existed, which ran without a judge, so
   * `costUsd` is the same number there (`agentCost` in the report).
   */
  agentCostUsd?: number;
  /** False when the model has no pricing entry; `costUsd` is then 0 and meaningless. */
  pricingKnown: boolean;
  wallMs: number;
}

export interface RunScore {
  runId: string;
  taskId: string;
  taskFamily: string;
  surfaceId: string;
  feedbackMode: string;
  model: string;
  stopReason: string;
  error?: string;
  /** 0..1 from the deterministic checks. */
  constraintScore: number;
  checkResults: CheckResult[];
  /** 0..1 from the judge, when one ran. */
  judgeCriteriaScore: number | null;
  judgeOverallScore: number | null;
  judgeSummary: string | null;
  /**
   * How many defects the judge listed, by severity. Null when no judge ran;
   * absent on records written before the judge listed them.
   */
  judgeDefects?: { major: number; minor: number } | null;
  judgeError?: string;
  /** 0..1 blend. Equals the constraint score when no judge ran. */
  composite: number;
  /** What the starting document already scored on the deterministic checks. */
  baselineScore: number;
  /**
   * Share of the available *constraint* improvement the run achieved:
   * `(constraint - baseline) / (1 - baseline)`.
   *
   * Raw scores have a high floor — a run that changes nothing still scores
   * ~70% on a repair task, because most checks are about defects it did not
   * introduce. That squeezes every real difference into the top quarter of the
   * scale and costs statistical power the study cannot spare. Normalizing puts
   * "did nothing" at 0 and "fully fixed" at 1.
   *
   * Constraint-only on purpose. There is no judge score for a starting
   * document to normalize against, and inventing one by judging every baseline
   * would spend money to blur two different measurements together. The judge
   * score is reported raw, as an absolute rating.
   *
   * Deliberately not clamped below zero: a negative value means the agent made
   * the document worse than it found it, which is a finding, not an error.
   */
  normalizedScore: number;
  /**
   * The constraint score after each tool call, in order: entry `i` is the
   * document as it stood after call `i + 1`. A failed call repeats the score
   * before it. Absent on records written before it existed.
   *
   * It is what turns a saturated pass rate back into a measurement. Every
   * condition may end at a pass; they do not get there equally fast, and
   * `passWithinCalls` reads off where each run stood at any budget without
   * re-running anything.
   */
  trajectory?: number[];
  /** The first call after which the document passed, or null if it never did. */
  firstPassCall?: number | null;
  /** Tool calls made in each turn, in order: what maps the trajectory onto turns. */
  callsByTurn?: number[];
  efficiency: Efficiency;
  toolUsage: Record<string, { ok: number; failed: number }>;
}

/** Cached per task — the starting document never varies within a task. */
const baselineCache = new Map<string, number>();

export function baselineFor(task: Task): number {
  const hit = baselineCache.get(task.id);
  if (hit !== undefined) return hit;
  const { score } = scoreDocument(task.initial(), task);
  baselineCache.set(task.id, score);
  return score;
}

export function normalize(score: number, baseline: number): number {
  const headroom = 1 - baseline;
  // A task with no headroom would divide by zero; the task suite's own tests
  // forbid one, so this is a guard rather than a live path.
  if (headroom <= 1e-9) return score >= baseline ? 1 : 0;
  return (score - baseline) / headroom;
}

export function scoreDocument(doc: Doc, task: Task): { score: number; results: CheckResult[] } {
  const { results, score } = runChecks(doc, [...universalChecks(), ...task.checks]);
  return { score, results };
}

/**
 * Score the document after every call. Rounded to four places: the report
 * reads it against a pass threshold of 0.999, and a row of a hundred full-
 * precision floats would make `scores.jsonl` mostly noise.
 */
export function scoreTrajectory(
  actions: readonly { ok: boolean; doc: Doc }[],
  task: Task,
): { trajectory: number[]; firstPassCall: number | null } {
  const trajectory: number[] = [];
  let current = baselineFor(task);
  let firstPassCall: number | null = null;
  actions.forEach((action, i) => {
    // A failed call leaves the document as it was, so its score is the last one.
    if (action.ok) current = scoreDocument(action.doc, task).score;
    trajectory.push(Math.round(current * 10_000) / 10_000);
    if (firstPassCall === null && current >= PASS_THRESHOLD) firstPassCall = i + 1;
  });
  return { trajectory, firstPassCall };
}

/**
 * Would this run have passed had it been stopped after `calls` calls?
 *
 * Read off the trajectory: the document as it stood then, not whether it
 * passed at some earlier point and was then broken again. A run that ended
 * before the budget stands as it ended. Null when the row has no trajectory.
 */
export function passedWithin(row: Pick<RunScore, "trajectory" | "baselineScore">, calls: number): boolean | null {
  if (!row.trajectory) return null;
  if (calls <= 0 || row.trajectory.length === 0) return row.baselineScore >= PASS_THRESHOLD;
  return row.trajectory[Math.min(calls, row.trajectory.length) - 1]! >= PASS_THRESHOLD;
}

/**
 * Would this run have passed had it been stopped after `turns` turns? The
 * surface-neutral reading: any surface can put any number of calls in a turn.
 * Null when the row has no trajectory or no per-turn call counts.
 */
export function passedWithinTurns(
  row: Pick<RunScore, "trajectory" | "baselineScore" | "callsByTurn">,
  turns: number,
): boolean | null {
  if (!row.trajectory || !row.callsByTurn) return null;
  const calls = row.callsByTurn.slice(0, turns).reduce((sum, n) => sum + n, 0);
  return passedWithin(row, calls);
}

export function scoreRun(run: RunResult, task: Task, judge?: JudgeResult): RunScore {
  const { score: constraintScore, results } = scoreDocument(run.finalDoc, task);
  const baseline = baselineFor(task);

  // A run that never finished is scored on what it left behind. Blanking it
  // would hide the difference between "crashed immediately" and "ran out of
  // turns with the layout nearly right", which is exactly the difference
  // between surfaces this study is looking for.
  const judgeCriteria = judge && !judge.error ? judge.criteriaScore : null;
  const composite =
    judgeCriteria === null
      ? constraintScore
      : CONSTRAINT_WEIGHT * constraintScore + JUDGE_WEIGHT * judgeCriteria;

  const totalTokens = run.usage.input + run.usage.output + run.usage.cacheRead + run.usage.cacheWrite;

  return {
    runId: run.runId,
    taskId: run.taskId,
    taskFamily: task.family,
    surfaceId: run.surfaceId,
    feedbackMode: run.feedbackMode,
    model: run.model,
    stopReason: run.stopReason,
    ...(run.error ? { error: run.error } : {}),
    constraintScore,
    checkResults: results,
    judgeCriteriaScore: judgeCriteria,
    judgeOverallScore: judge && !judge.error ? judge.overallScore : null,
    judgeSummary: judge && !judge.error ? judge.judgement.summary : null,
    judgeDefects:
      judge && !judge.error
        ? {
            major: judge.judgement.defects.filter((d) => d.severity === "major").length,
            minor: judge.judgement.defects.filter((d) => d.severity === "minor").length,
          }
        : null,
    ...(judge?.error ? { judgeError: judge.error } : {}),
    composite,
    baselineScore: baseline,
    normalizedScore: normalize(constraintScore, baseline),
    ...scoreTrajectory(run.session.actions, task),
    callsByTurn: run.turnRecords.map((t) => t.toolCalls),
    efficiency: {
      turns: run.turns,
      toolCalls: run.toolCalls,
      failedToolCalls: run.failedToolCalls,
      failureRate: run.toolCalls > 0 ? run.failedToolCalls / run.toolCalls : 0,
      inputTokens: run.usage.input + run.usage.cacheRead + run.usage.cacheWrite,
      outputTokens: run.usage.output,
      totalTokens,
      costUsd: run.costUsd + (judge?.costUsd ?? 0),
      agentCostUsd: run.costUsd,
      // Both models, because the figure above is both models. An unpriced
      // judge contributes a confident $0 to every run in the sweep — the same
      // silent-zero problem the model table already guards against, one level
      // up, where a `--judge-model` naming something newer than `MODELS` used
      // to report the agent's spend as the whole bill. Read off the judge's
      // own result rather than the registry: this module is bundled for the
      // browser and must not reach for a provider SDK.
      pricingKnown: run.pricingKnown && (judge?.pricingKnown ?? true),
      wallMs: run.wallMs,
    },
    toolUsage: run.toolUsage,
  };
}
