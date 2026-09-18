/**
 * The sweep runner: expand the matrix, run the cells, write the artifacts.
 *
 * Two properties matter more than speed here.
 *
 * Resumability: run ids are derived from the cell, not from a clock or a
 * counter, so a sweep interrupted by a rate limit or a dead laptop picks up
 * exactly where it stopped. A full matrix is thousands of API calls and
 * restarting from zero is not an option.
 *
 * Completeness: every run writes its transcript, its action log and its render
 * to disk. Re-running to answer a question that occurs later costs real money,
 * so nothing that was already paid for gets thrown away.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Task } from "../tasks/types.js";
import { getTask } from "../tasks/index.js";
import { getSurface } from "../surfaces/index.js";
import type { SurfaceId } from "../surfaces/types.js";
import { createFeedbackChannel, type FeedbackMode } from "../feedback/index.js";
import { runAgent } from "../agent/loop.js";
import { DEFAULT_MODEL, getModel, ZERO_USAGE, type Effort } from "../agent/models.js";
import { dryRunModel } from "../agent/scripted.js";
import { judgeRun, DEFAULT_JUDGE_MODEL } from "../eval/judge.js";
import { baselineFor, normalize, scoreDocument, scoreRun, type RunScore } from "../eval/score.js";
import { renderStandaloneSvg } from "../render/svg.js";
import { rasterize } from "../render/raster.js";
import { isHarnessFailure, type AgentEvent } from "../agent/events.js";

export interface SweepConfig {
  /** Output directory for everything this sweep produces. */
  outDir: string;
  taskIds: string[];
  surfaces: SurfaceId[];
  feedback: FeedbackMode[];
  models: string[];
  /** Repeats per cell. Sampling cannot be pinned, so variance is measured. */
  repeats: number;
  effort?: Effort;
  concurrency: number;
  judge: boolean;
  judgeModel: string;
  /** Run against a scripted model instead of the API. Costs nothing. */
  dryRun: boolean;
  /** Re-run cells that already have a result on disk. */
  force: boolean;
  maxTokens?: number;
}

export interface Cell {
  runId: string;
  task: Task;
  surface: SurfaceId;
  feedback: FeedbackMode;
  model: string;
  repeat: number;
}

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "-");

export function cellId(taskId: string, surface: string, feedback: string, model: string, repeat: number): string {
  return [taskId, surface, feedback, model, `r${repeat}`].map(sanitize).join("__");
}

export function expandMatrix(config: SweepConfig): Cell[] {
  const cells: Cell[] = [];
  for (const taskId of config.taskIds) {
    const task = getTask(taskId);
    for (const surface of config.surfaces) {
      for (const feedback of config.feedback) {
        for (const model of config.models) {
          for (let repeat = 1; repeat <= config.repeats; repeat++) {
            cells.push({
              runId: cellId(task.id, surface, feedback, model, repeat),
              task,
              surface,
              feedback,
              model,
              repeat,
            });
          }
        }
      }
    }
  }
  return cells;
}

export interface SweepPaths {
  root: string;
  runs: string;
  renders: string;
  scoresFile: string;
  configFile: string;
}

export function sweepPaths(outDir: string): SweepPaths {
  return {
    root: outDir,
    runs: join(outDir, "runs"),
    renders: join(outDir, "renders"),
    scoresFile: join(outDir, "scores.jsonl"),
    configFile: join(outDir, "config.json"),
  };
}

function ensureDirs(paths: SweepPaths): void {
  for (const dir of [paths.root, paths.runs, paths.renders]) mkdirSync(dir, { recursive: true });
}

/**
 * The settings a run id does *not* encode, but a result depends on.
 *
 * A run id is task, surface, feedback, model and repeat — the matrix. Adding a
 * task to an existing `--out` is therefore a legitimate extension, and resumes
 * correctly. Changing the effort, the token ceiling or the judge is not: the
 * ids are unchanged, so the finished cells are kept and the new ones are run
 * differently, and the report averages the two without saying so. Extending a
 * sweep is meant to be cheap, and silently comparing runs made under different
 * settings is the way that gets expensive.
 */
export function runFingerprint(config: SweepConfig): Record<string, unknown> {
  return {
    // There is one agent loop now, but sweeps made while there were two
    // recorded which one they used. Reading it back means those results refuse
    // to resume into a new sweep instead of being averaged with runs from a
    // harness that no longer exists.
    harness: (config as { runner?: string }).runner ?? "aisdk",
    effort: config.effort ?? null,
    maxTokens: config.maxTokens ?? null,
    judge: config.judge,
    judgeModel: config.judgeModel,
    dryRun: config.dryRun,
  };
}

/** Names the settings that differ between two fingerprints. */
export function fingerprintConflicts(
  previous: Record<string, unknown>,
  current: Record<string, unknown>,
): string[] {
  return Object.keys(current)
    .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(current[key]))
    .map((key) => `${key}: was ${JSON.stringify(previous[key] ?? null)}, now ${JSON.stringify(current[key])}`);
}

function previousFingerprint(paths: SweepPaths): Record<string, unknown> | null {
  if (!existsSync(paths.configFile)) return null;
  try {
    const previous = JSON.parse(readFileSync(paths.configFile, "utf8")) as SweepConfig;
    return runFingerprint(previous);
  } catch {
    return null;
  }
}

/** Scores already on disk, keyed by run id, so a sweep can resume. */
export function loadExistingScores(paths: SweepPaths): Map<string, RunScore> {
  const map = new Map<string, RunScore>();
  if (!existsSync(paths.scoresFile)) return map;

  // Deliberately fatal, and deliberately not the same call as the per-cell
  // guards below. This runs before any cell does, so nothing is in flight and
  // nothing is lost by stopping — whereas carrying on as though the file were
  // empty would re-run every finished cell in the directory and bill for all
  // of them, which is the one outcome resumability exists to prevent.
  let raw: string;
  try {
    raw = readFileSync(paths.scoresFile, "utf8");
  } catch (err) {
    throw new Error(
      `${paths.scoresFile} exists but could not be read (${err instanceof Error ? err.message : String(err)}). ` +
        `That file is how a sweep knows which cells are already done, so continuing would re-run — and re-bill ` +
        `for — every cell in this directory. Fix or remove it, or use a different --out.`,
    );
  }

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const score = JSON.parse(line) as RunScore;
      // Last write wins, so a cell retried after a rate limit supersedes the
      // failure rather than being shadowed by it.
      map.set(score.runId, score);
    } catch {
      // A truncated final line is what an interrupted sweep leaves behind.
      // Skipping it re-runs one cell, which is the cheap and correct repair.
    }
  }
  return map;
}

/**
 * The finished cells, which is not the same set as the recorded ones.
 *
 * A cell that ended in `api_error` or `aborted` is on disk — every run is, so
 * nothing that was paid for is thrown away — but it is not a result, and
 * treating it as one turns the resume mechanism into a trap. The first sweep
 * hits a rate limit on forty cells; the second sweep skips those forty as
 * "already done"; the report averages them in as forty runs that improved
 * nothing. The failures are sticky, silent, and land wherever the rate limiter
 * happened to fall rather than where the surfaces differ.
 *
 * So resume retries them. The cost of re-running a cell that really was
 * hopeless is one more failure; the cost of not retrying is a permanent hole
 * in the grid that reads as data.
 */
export function completedScores(paths: SweepPaths): Map<string, RunScore> {
  const map = loadExistingScores(paths);
  for (const [runId, score] of map) {
    if (isHarnessFailure(score.stopReason)) map.delete(runId);
  }
  return map;
}

export interface SweepProgress {
  onCellStart?(cell: Cell, index: number, total: number): void;
  onCellDone?(score: RunScore, index: number, total: number): void;
  onCellSkipped?(cell: Cell, index: number, total: number): void;
  onEvent?(cell: Cell, event: AgentEvent): void;
  /**
   * Something went wrong beside a cell without changing its score — a render
   * that would not write, a judge that could not be reached. Not a failure of
   * the run, so it does not stop anything; still worth saying, because a sweep
   * that silently wrote no renders at all is one nobody can go back and look
   * at.
   */
  onWarning?(cell: Cell, message: string): void;
  /** Every warning raised during the sweep, once it has finished. */
  onWarnings?(messages: string[]): void;
}

export async function runSweep(config: SweepConfig, progress: SweepProgress = {}): Promise<RunScore[]> {
  const paths = sweepPaths(config.outDir);
  ensureDirs(paths);

  const previous = config.force ? null : previousFingerprint(paths);
  const conflicts = previous ? fingerprintConflicts(previous, runFingerprint(config)) : [];
  if (conflicts.length > 0) {
    throw new Error(
      `${config.outDir} holds results from a sweep with different settings, and run ids do not encode them:\n` +
        conflicts.map((c) => `  - ${c}`).join("\n") +
        `\nResuming would average runs made under both. Use a new --out, or --force to re-run everything here.`,
    );
  }

  writeFileSync(paths.configFile, JSON.stringify({ ...config, startedAt: new Date().toISOString() }, null, 2));

  const cells = expandMatrix(config);
  const existing = config.force ? new Map<string, RunScore>() : completedScores(paths);
  const results: RunScore[] = [];
  const warnings: string[] = [];
  let index = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = index++;
      if (i >= cells.length) return;
      const cell = cells[i]!;

      const done = existing.get(cell.runId);
      if (done) {
        results.push(done);
        progress.onCellSkipped?.(cell, i, cells.length);
        continue;
      }

      progress.onCellStart?.(cell, i, cells.length);
      const warn = (message: string): void => {
        const text = `${cell.runId}: ${message}`;
        warnings.push(text);
        progress.onWarning?.(cell, message);
      };

      // One cell's bad day is not the sweep's. `runAgent` already turns a
      // failed request into a scored run, and `runCell` keeps the score it
      // computed even if the transcript or the render cannot be written — so
      // this catch is the backstop for a cell that fell over before there was
      // a score at all. Without it an unhandled rejection takes down every
      // other worker mid-flight and loses whatever they had already paid for.
      // Hundreds of cells in, that is the difference between a retry and an
      // afternoon.
      const score = await runCell(cell, config, paths, (event) => progress.onEvent?.(cell, event), warn).catch(
        (err: unknown) => harnessFailureScore(cell, err),
      );
      results.push(score);

      // Appended as each cell finishes, so an interrupted sweep keeps its
      // work. Guarded for the same reason as everything else in this loop: a
      // disk that has stopped accepting writes is a bad afternoon, not a
      // reason to abandon the cells still in flight. It is the loudest
      // warning of the lot, though — with no scores file there is nothing to
      // resume from, so the sweep is running without a net.
      try {
        appendFileSync(paths.scoresFile, `${JSON.stringify(score)}\n`);
      } catch (err) {
        warn(
          `its score could not be appended to ${paths.scoresFile} ` +
            `(${err instanceof Error ? err.message : String(err)}). It is in this run's results but not on disk, ` +
            `so resuming will not find it.`,
        );
      }
      progress.onCellDone?.(score, i, cells.length);
    }
  };

  const workers = Array.from({ length: Math.max(1, config.concurrency) }, worker);
  await Promise.all(workers);
  if (warnings.length > 0) progress.onWarnings?.(warnings);
  return results;
}

/**
 * A cell that fell over before it had a score, recorded as the harness failure
 * it is.
 *
 * Only reachable ahead of `scoreRun` — building the feedback channel, or the
 * agent loop itself failing in a way it cannot report. Once a score exists
 * `runCell` keeps it, because from that point the cell has been paid for and
 * losing it would spend the money twice.
 *
 * Scored against the starting document, which is the honest reading of "the
 * run produced nothing": no turn was taken, so there is no later state to
 * score. It carries `api_error`, so `completedScores` hands it back to the
 * next pass and the report keeps it out of the aggregates.
 */
function harnessFailureScore(cell: Cell, err: unknown): RunScore {
  const { score, results } = scoreDocument(cell.task.initial(), cell.task);
  const baseline = baselineFor(cell.task);
  return {
    runId: cell.runId,
    taskId: cell.task.id,
    taskFamily: cell.task.family,
    surfaceId: cell.surface,
    feedbackMode: cell.feedback,
    model: cell.model,
    stopReason: "api_error",
    error: err instanceof Error ? err.message : String(err),
    constraintScore: score,
    checkResults: results,
    judgeCriteriaScore: null,
    judgeOverallScore: null,
    judgeSummary: null,
    composite: score,
    baselineScore: baseline,
    normalizedScore: normalize(score, baseline),
    efficiency: {
      turns: 0,
      toolCalls: 0,
      failedToolCalls: 0,
      failureRate: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      pricingKnown: getModel(cell.model).priced,
      wallMs: 0,
    },
    toolUsage: {},
  };
}

async function runCell(
  cell: Cell,
  config: SweepConfig,
  paths: SweepPaths,
  onEvent: (event: AgentEvent) => void,
  onWarning: (message: string) => void,
): Promise<RunScore> {
  const run = await runAgent({
    runId: cell.runId,
    task: cell.task,
    surface: getSurface(cell.surface),
    feedback: createFeedbackChannel(cell.feedback),
    model: cell.model,
    ...(config.effort ? { effort: config.effort } : {}),
    ...(config.maxTokens ? { maxTokens: config.maxTokens } : {}),
    // A dry run needs a model that never reaches the network — and one that
    // speaks this surface's vocabulary, or the wiring check never gets as far
    // as a tool call.
    ...(config.dryRun ? { languageModel: dryRunModel(cell.surface) } : {}),
    onEvent,
  });

  // `judgeRun` handles its own request failures, but it rasterizes both
  // documents before it gets that far, and that is outside its try. A render
  // that dies here must not cost the run its turns: the agent's work is done
  // and paid for, so the cell is scored without a judge, exactly as a judge
  // that answered unusably would be.
  let judge: Awaited<ReturnType<typeof judgeRun>> | undefined;
  if (config.judge && !config.dryRun) {
    try {
      judge = await judgeRun({
        brief: cell.task.brief,
        criteria: cell.task.judgeCriteria,
        finalDoc: run.finalDoc,
        initialDoc: run.initialDoc,
        model: config.judgeModel,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      onWarning(`the judge could not be run: ${detail}`);
      judge = {
        criteriaScore: 0,
        overallScore: 0,
        judgement: { criteria: [], overall: 1, summary: "" },
        model: config.judgeModel,
        usage: { ...ZERO_USAGE },
        costUsd: 0,
        pricingKnown: getModel(config.judgeModel).priced,
        error: detail,
      };
    }
  }

  const score = scoreRun(run, cell.task, judge);

  // From here the score exists, and the cell has been paid for. Everything
  // below is bookkeeping — a transcript, a render — and none of it can be
  // allowed to throw the score away. Losing it would discard the agent's work
  // *and* mark the cell for a re-run, which is the same money spent twice for
  // want of a file write.
  writeArtifacts(cell, paths, run, judge, score, onWarning);
  return score;
}

/**
 * The per-run record, SVG and PNG. Best effort, and deliberately so.
 *
 * Each write is guarded on its own: a full disk is far likelier to stop the
 * PNG than the JSON, and a cell that kept its transcript but lost its
 * thumbnail is in much better shape than one that discarded both because the
 * second write failed. Failures are reported through `onWarning` rather than
 * swallowed — a sweep whose renders are all missing should say so — but they
 * never change the score.
 */
function writeArtifacts(
  cell: Cell,
  paths: SweepPaths,
  run: Awaited<ReturnType<typeof runAgent>>,
  judge: Awaited<ReturnType<typeof judgeRun>> | undefined,
  score: RunScore,
  onWarning: (message: string) => void,
): void {
  const attempt = (what: string, write: () => void): void => {
    try {
      write();
    } catch (err) {
      onWarning(`${what} could not be written: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  attempt("the run record", () =>
    writeFileSync(
      join(paths.runs, `${cell.runId}.json`),
      JSON.stringify(
        {
          runId: cell.runId,
          task: { id: cell.task.id, family: cell.task.family, title: cell.task.title, brief: cell.task.brief },
          surface: cell.surface,
          feedback: cell.feedback,
          model: cell.model,
          repeat: cell.repeat,
          stopReason: run.stopReason,
          error: run.error ?? null,
          score,
          judgement: judge?.judgement ?? null,
          initialDoc: run.initialDoc,
          finalDoc: run.finalDoc,
          actions: run.session.actions.map((a) => ({
            seq: a.seq,
            tool: a.tool,
            input: a.input,
            ok: a.ok,
            message: a.message,
            touched: a.touched,
            durationMs: a.durationMs,
          })),
          turnRecords: run.turnRecords,
          transcript: run.transcript,
        },
        null,
        2,
      ),
    ),
  );

  // Standalone, so an artifact opened months later still paints in the face
  // its line breaks were computed from.
  attempt("the SVG", () =>
    writeFileSync(join(paths.renders, `${cell.runId}.svg`), renderStandaloneSvg(run.finalDoc)),
  );
  attempt("the PNG", () =>
    writeFileSync(join(paths.renders, `${cell.runId}.png`), rasterize(run.finalDoc, { pixelWidth: 540 })),
  );
}

export const DEFAULT_SWEEP: Omit<SweepConfig, "outDir" | "taskIds"> = {
  surfaces: ["coordinate", "relational", "document"],
  feedback: ["none", "structured", "screenshot", "both"],
  models: [DEFAULT_MODEL],
  repeats: 3,
  concurrency: 4,
  judge: true,
  judgeModel: DEFAULT_JUDGE_MODEL,
  dryRun: false,
  force: false,
};
