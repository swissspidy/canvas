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
import Anthropic from "@anthropic-ai/sdk";
import type { Task } from "../tasks/types.js";
import { getTask } from "../tasks/index.js";
import { getSurface } from "../surfaces/index.js";
import type { SurfaceId } from "../surfaces/types.js";
import { createFeedbackChannel, type FeedbackMode } from "../feedback/index.js";
import { runAgent, type RunResult } from "../agent/loop.js";
import type { Effort } from "../agent/models.js";
import { createScriptedClient, fixedScript } from "../agent/scripted.js";
import { judgeRun, DEFAULT_JUDGE_MODEL } from "../eval/judge.js";
import { scoreRun, type RunScore } from "../eval/score.js";
import { renderSvg } from "../render/svg.js";
import { rasterize } from "../render/raster.js";
import type { AgentEvent } from "../agent/events.js";

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
  /** Run against the scripted client instead of the API. Costs nothing. */
  dryRun: boolean;
  /** Re-run cells that already have a result on disk. */
  force: boolean;
  maxTokens?: number;
  eagerInputStreaming?: boolean;
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

/** Scores already on disk, keyed by run id, so a sweep can resume. */
export function loadExistingScores(paths: SweepPaths): Map<string, RunScore> {
  const map = new Map<string, RunScore>();
  if (!existsSync(paths.scoresFile)) return map;
  for (const line of readFileSync(paths.scoresFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const score = JSON.parse(line) as RunScore;
      map.set(score.runId, score);
    } catch {
      // A truncated final line is what an interrupted sweep leaves behind.
      // Skipping it re-runs one cell, which is the cheap and correct repair.
    }
  }
  return map;
}

export interface SweepProgress {
  onCellStart?(cell: Cell, index: number, total: number): void;
  onCellDone?(score: RunScore, index: number, total: number): void;
  onCellSkipped?(cell: Cell, index: number, total: number): void;
  onEvent?(cell: Cell, event: AgentEvent): void;
}

/** A trivial "do nothing" script, for `--dry-run` wiring checks. */
const dryRunScript = fixedScript([{ text: "Dry run: no changes made." }]);

export async function runSweep(config: SweepConfig, progress: SweepProgress = {}): Promise<RunScore[]> {
  const paths = sweepPaths(config.outDir);
  ensureDirs(paths);
  writeFileSync(paths.configFile, JSON.stringify({ ...config, startedAt: new Date().toISOString() }, null, 2));

  const cells = expandMatrix(config);
  const existing = config.force ? new Map<string, RunScore>() : loadExistingScores(paths);
  const client = config.dryRun ? undefined : new Anthropic();
  const results: RunScore[] = [];
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
      const score = await runCell(cell, config, paths, client, (event) => progress.onEvent?.(cell, event));
      results.push(score);
      // Appended as each cell finishes, so an interrupted sweep keeps its work.
      appendFileSync(paths.scoresFile, `${JSON.stringify(score)}\n`);
      progress.onCellDone?.(score, i, cells.length);
    }
  };

  const workers = Array.from({ length: Math.max(1, config.concurrency) }, worker);
  await Promise.all(workers);
  return results;
}

async function runCell(
  cell: Cell,
  config: SweepConfig,
  paths: SweepPaths,
  client: Anthropic | undefined,
  onEvent: (event: AgentEvent) => void,
): Promise<RunScore> {
  const run: RunResult = await runAgent({
    runId: cell.runId,
    task: cell.task,
    surface: getSurface(cell.surface),
    feedback: createFeedbackChannel(cell.feedback),
    model: cell.model,
    ...(config.effort ? { effort: config.effort } : {}),
    ...(config.maxTokens ? { maxTokens: config.maxTokens } : {}),
    ...(config.eagerInputStreaming ? { eagerInputStreaming: true } : {}),
    ...(config.dryRun ? { client: createScriptedClient(dryRunScript) } : client ? { client } : {}),
    onEvent,
  });

  const judge =
    config.judge && !config.dryRun
      ? await judgeRun({
          brief: cell.task.brief,
          criteria: cell.task.judgeCriteria,
          finalDoc: run.finalDoc,
          initialDoc: run.initialDoc,
          model: config.judgeModel,
          ...(client ? { client } : {}),
        })
      : undefined;

  const score = scoreRun(run, cell.task, judge);

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
  );

  writeFileSync(join(paths.renders, `${cell.runId}.svg`), renderSvg(run.finalDoc));
  writeFileSync(join(paths.renders, `${cell.runId}.png`), rasterize(run.finalDoc, { pixelWidth: 540 }));

  return score;
}

export const DEFAULT_SWEEP: Omit<SweepConfig, "outDir" | "taskIds"> = {
  surfaces: ["coordinate", "relational", "document"],
  feedback: ["none", "structured", "screenshot", "both"],
  models: ["claude-opus-5"],
  repeats: 3,
  concurrency: 4,
  judge: true,
  judgeModel: DEFAULT_JUDGE_MODEL,
  dryRun: false,
  force: false,
};
