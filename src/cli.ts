#!/usr/bin/env node
/**
 * Command line entry point.
 *
 * `npm run cli -- <command> [options]`
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TASKS, getTask, resolveTasks } from "./tasks/index.js";
import { SURFACES, getSurface } from "./surfaces/index.js";
import { FEEDBACK_MODES, feedbackLabel, type FeedbackMode } from "./feedback/index.js";
import {
  DEFAULT_MODEL,
  MODEL_SWEEP,
  PROVIDER_ENV,
  getModel,
  hasCredentials,
  parseEffort,
  parseModelSpec,
} from "./agent/models.js";
import { DEFAULT_SWEEP, loadExistingScores, runSweep, sweepPaths, expandMatrix, type SweepConfig } from "./runner/run.js";
import { buildReport, buildReportJson } from "./runner/report.js";
import { renderStandaloneSvg } from "./render/svg.js";
import { rasterize } from "./render/raster.js";
import { describeDoc } from "./render/describe.js";
import { scoreDocument } from "./eval/score.js";
import { buildRatingSheet, computeAgreement, sampleForRating } from "./eval/human.js";
import type { SurfaceId } from "./surfaces/types.js";
import type { RunScore } from "./eval/score.js";

interface Args {
  command: string;
  flags: Record<string, string | boolean>;
  positional: string[];
}

function parseArgs(argv: string[]): Args {
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split("=", 2);
      if (inline !== undefined) flags[key!] = inline;
      else if (rest[i + 1] && !rest[i + 1]!.startsWith("--")) flags[key!] = rest[++i]!;
      else flags[key!] = true;
    } else {
      positional.push(arg);
    }
  }
  return { command, flags, positional };
}

const str = (flags: Args["flags"], key: string, fallback: string): string =>
  typeof flags[key] === "string" ? (flags[key] as string) : fallback;
const num = (flags: Args["flags"], key: string, fallback: number): number => {
  const raw = flags[key];
  if (typeof raw !== "string") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const bool = (flags: Args["flags"], key: string, fallback = false): boolean =>
  key in flags ? flags[key] !== "false" : fallback;
const list = (flags: Args["flags"], key: string, fallback: string[]): string[] => {
  const raw = flags[key];
  if (typeof raw !== "string") return fallback;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
};

const HELP = `
canvas-agent-bench — does an agent lay out a document better with coordinates or with relations?

Commands
  tasks                       List the task set.
  surfaces                    List the tool surfaces and their tools.
  show <taskId>               Print a task's brief, starting state and baseline score.
  render <taskId> [--out X]   Render a task's starting document to PNG and SVG.
  run [options]               Run a sweep.
  report --dir <sweepDir>     Rebuild the report from an existing sweep.
  sample --dir <sweepDir>     Draw a stratified subset and write a human rating sheet.
  agreement --dir <sweepDir>  Compare human ratings against the judge.

Cross-provider runs
  --models 'anthropic:claude-opus-5,google:<id>,openai:<id>'
  Every model runs through one loop on the Vercel AI SDK, so a difference
  between two models is not a difference between two harnesses. Prices live
  in MODELS in src/agent/models.ts; an unpriced model still runs, with cost
  reported as unknown rather than silently wrong.

Run options
  --tasks <sel>       Task selector: 'all', a family, an id, or a comma list. Default: all
  --surfaces <list>   Default: ${DEFAULT_SWEEP.surfaces.join(",")}
  --feedback <list>   Default: ${DEFAULT_SWEEP.feedback.join(",")}
  --models <list>     Provider-qualified ids. Default: ${DEFAULT_MODEL}
                      (--models sweep = ${MODEL_SWEEP.join(",")};
                      for the cross-provider check pass explicit ids: google:<id>,openai:<id>)
  --repeats <n>       Repeats per cell. Default: ${DEFAULT_SWEEP.repeats}
  --effort <level>    low|medium|high|xhigh|max. Default: high
  --concurrency <n>   Default: ${DEFAULT_SWEEP.concurrency}
  --out <dir>         Output directory. Default: runs/<timestamp>
  --no-judge          Skip the LLM judge; deterministic checks only.
  --judge-model <id>  Default: ${DEFAULT_SWEEP.judgeModel}
  --dry-run           Expand and wire the matrix with a scripted model; no API calls, no cost.
  --force             Re-run cells that already have a result on disk.
  --estimate          Print the matrix size and stop.
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case "tasks":
      return cmdTasks();
    case "surfaces":
      return cmdSurfaces();
    case "show":
      return cmdShow(args);
    case "render":
      return cmdRender(args);
    case "run":
      return cmdRun(args);
    case "report":
      return cmdReport(args);
    case "sample":
      return cmdSample(args);
    case "agreement":
      return cmdAgreement(args);
    default:
      console.log(HELP.trim());
      if (args.command !== "help") process.exitCode = 1;
  }
}

function cmdTasks(): void {
  const byFamily = new Map<string, typeof TASKS>();
  for (const task of TASKS) {
    byFamily.set(task.family, [...(byFamily.get(task.family) ?? []), task]);
  }
  for (const [family, tasks] of byFamily) {
    console.log(`\n${family} (${tasks.length})`);
    for (const task of tasks) console.log(`  ${task.id.padEnd(32)} ${task.title}`);
  }
  console.log(`\n${TASKS.length} tasks total.`);
}

function cmdSurfaces(): void {
  for (const surface of Object.values(SURFACES)) {
    console.log(`\n${surface.id} — ${surface.title}`);
    console.log(`  ${surface.briefing.replace(/\s+/g, " ").slice(0, 160)}…`);
    console.log(`  tools: ${surface.tools.map((t) => t.name).join(", ")}`);
  }
  console.log(`\nFeedback conditions: ${FEEDBACK_MODES.map((m) => `${m} (${feedbackLabel(m)})`).join(", ")}`);
}

function cmdShow(args: Args): void {
  const task = getTask(args.positional[0] ?? "");
  const doc = task.initial();
  const { score, results } = scoreDocument(doc, task);
  console.log(`# ${task.title}  [${task.id}, family: ${task.family}]\n`);
  console.log(task.brief);
  console.log(`\n# Starting document\n`);
  console.log(describeDoc(doc));
  console.log(`\n# Baseline score: ${(score * 100).toFixed(1)}%\n`);
  for (const r of results) {
    console.log(`  ${r.passed ? "ok  " : "FAIL"} ${(r.score * 100).toFixed(0).padStart(3)}%  ${r.label}`);
    console.log(`        ${r.detail}`);
  }
  console.log(`\n# Judge criteria\n`);
  for (const c of task.judgeCriteria) console.log(`  - ${c}`);
}

function cmdRender(args: Args): void {
  const task = getTask(args.positional[0] ?? "");
  const outDir = str(args.flags, "out", "renders");
  mkdirSync(outDir, { recursive: true });
  const doc = task.initial();
  const svgPath = join(outDir, `${task.id}.svg`);
  const pngPath = join(outDir, `${task.id}.png`);
  // Standalone: a file opened outside the page cannot reach its stylesheets.
  writeFileSync(svgPath, renderStandaloneSvg(doc));
  writeFileSync(pngPath, rasterize(doc, { pixelWidth: num(args.flags, "width", 540) }));
  console.log(`Wrote ${svgPath}\nWrote ${pngPath}`);
}

/**
 * Flags that used to mean something.
 *
 * The parser puts any `--flag` it sees into the bag, so a retired one would
 * otherwise be a silent no-op — and a sweep that quietly ignores a setting
 * someone thought they had passed is a sweep whose results mean something
 * other than what they think.
 */
const RETIRED_FLAGS: Record<string, string> = {
  runner: "there is one agent loop now, on the AI SDK. Drop the flag; models are named provider:model-id.",
  "eager-input": "eager input streaming was an Anthropic-only knob, and went with the native loop.",
};

/**
 * Everything that has to hold for a model before a sweep starts spending.
 *
 * The spec is always parsed — a typo should not wait for the first request —
 * while credentials are only required of a run that will actually make one.
 */
function checkModel(spec: string, label: string, live: boolean): void {
  const { provider } = parseModelSpec(spec);
  if (!getModel(spec).priced) {
    console.warn(
      `Note: no pricing for ${label} '${spec}', so its cost is reported as unknown. ` +
        `Add it to MODELS in src/agent/models.ts to include it in cost comparisons.`,
    );
  }
  if (live && !hasCredentials(provider)) {
    throw new Error(
      `No credentials for provider '${provider}', needed for ${label} '${spec}'. ` +
        `Set ${PROVIDER_ENV[provider]}.`,
    );
  }
}

function buildSweepConfig(args: Args): SweepConfig {
  for (const [flag, why] of Object.entries(RETIRED_FLAGS)) {
    if (flag in args.flags) throw new Error(`--${flag} no longer exists: ${why}`);
  }

  const tasks = resolveTasks(str(args.flags, "tasks", "all"));
  const models =
    str(args.flags, "models", DEFAULT_MODEL) === "sweep"
      ? MODEL_SWEEP
      : list(args.flags, "models", [DEFAULT_MODEL]);
  const surfaces = list(args.flags, "surfaces", DEFAULT_SWEEP.surfaces) as SurfaceId[];
  const feedback = list(args.flags, "feedback", DEFAULT_SWEEP.feedback) as FeedbackMode[];

  for (const s of surfaces) getSurface(s);
  for (const f of feedback) {
    if (!FEEDBACK_MODES.includes(f)) {
      throw new Error(`Unknown feedback mode '${f}'. Known: ${FEEDBACK_MODES.join(", ")}`);
    }
  }
  const dryRun = bool(args.flags, "dry-run");
  const judge = !bool(args.flags, "no-judge");
  const judgeModel = str(args.flags, "judge-model", DEFAULT_SWEEP.judgeModel);

  for (const m of models) checkModel(m, "model", !dryRun);
  // The judge is called once per cell, *after* that cell's agent turns. An
  // unparseable spec or a missing key for its provider would therefore surface
  // only once every cell had been paid for, as a failed judgement on every run
  // in the sweep. It costs nothing to find out now.
  if (judge) checkModel(judgeModel, "judge model", !dryRun);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return {
    ...DEFAULT_SWEEP,
    outDir: str(args.flags, "out", join("runs", stamp)),
    taskIds: tasks.map((t) => t.id),
    surfaces,
    feedback,
    models,
    repeats: num(args.flags, "repeats", DEFAULT_SWEEP.repeats),
    concurrency: num(args.flags, "concurrency", DEFAULT_SWEEP.concurrency),
    judge,
    judgeModel,
    dryRun,
    force: bool(args.flags, "force"),
    // Cast rather than parsed, a typo'd --effort reached the API and failed the
    // whole sweep on its first request.
    ...(typeof args.flags.effort === "string" ? { effort: parseEffort(args.flags.effort) } : {}),
    ...(args.flags["max-tokens"] ? { maxTokens: num(args.flags, "max-tokens", 16000) } : {}),
  };
}

async function cmdRun(args: Args): Promise<void> {
  const config = buildSweepConfig(args);
  const cells = expandMatrix(config);

  console.log(
    `Matrix: ${config.taskIds.length} tasks x ${config.surfaces.length} surfaces x ` +
      `${config.feedback.length} feedback x ${config.models.length} models x ${config.repeats} repeats ` +
      `= ${cells.length} runs.`,
  );
  if (bool(args.flags, "estimate")) {
    console.log(`Judge: ${config.judge ? `${config.judgeModel}, one call per run` : "disabled"}.`);
    console.log("Each run is a multi-turn agent loop, so expect a few API calls per cell.");
    console.log("Run without --estimate to start.");
    return;
  }

  console.log(`Models: ${config.models.join(", ")}`);
  console.log(`Output: ${config.outDir}${config.dryRun ? "  (dry run — no API calls)" : ""}\n`);
  const started = Date.now();

  const scores = await runSweep(config, {
    onCellSkipped: (cell, i, total) => {
      console.log(`[${i + 1}/${total}] skip  ${cell.runId} (already done)`);
    },
    onCellDone: (score, i, total) => {
      const flag = score.error ? ` !! ${score.stopReason}` : "";
      console.log(
        `[${i + 1}/${total}] ${score.runId}  composite ${(score.composite * 100).toFixed(1)}%  ` +
          `(checks ${(score.constraintScore * 100).toFixed(0)}%` +
          `${score.judgeCriteriaScore !== null ? `, judge ${(score.judgeCriteriaScore * 100).toFixed(0)}%` : ""})  ` +
          `${score.efficiency.turns} turns  $${score.efficiency.costUsd.toFixed(4)}${flag}`,
      );
    },
  });

  writeReport(config.outDir, scores);
  const totalCost = scores.reduce((s, r) => s + r.efficiency.costUsd, 0);
  console.log(
    `\nDone in ${((Date.now() - started) / 1000).toFixed(0)}s. ` +
      `${scores.length} runs, $${totalCost.toFixed(2)} total.`,
  );
  console.log(`Report: ${join(config.outDir, "report.md")}`);
}

function readScores(dir: string): RunScore[] {
  const paths = sweepPaths(dir);
  if (!existsSync(paths.scoresFile)) throw new Error(`No scores at ${paths.scoresFile}`);
  return [...loadExistingScores(paths).values()];
}

function writeReport(dir: string, scores: RunScore[]): void {
  const markdown = buildReport(scores, { title: "Coordinate vs relational vs document-as-code" });
  writeFileSync(join(dir, "report.md"), `${markdown}\n`);
  writeFileSync(join(dir, "report.json"), JSON.stringify(buildReportJson(scores), null, 2));
}

function cmdReport(args: Args): void {
  const dir = str(args.flags, "dir", "");
  if (!dir) throw new Error("Pass --dir <sweepDir>");
  const scores = readScores(dir);
  writeReport(dir, scores);
  console.log(buildReport(scores, { title: "Coordinate vs relational vs document-as-code" }));
}

function cmdSample(args: Args): void {
  const dir = str(args.flags, "dir", "");
  if (!dir) throw new Error("Pass --dir <sweepDir>");
  const scores = readScores(dir);
  const sample = sampleForRating(scores, num(args.flags, "n", 40));
  const sheetPath = join(dir, "rating-sheet.html");
  const manifestPath = join(dir, "rating-manifest.json");
  writeFileSync(sheetPath, buildRatingSheet(sample, dir));
  writeFileSync(manifestPath, JSON.stringify(sample, null, 2));
  console.log(`Sampled ${sample.length} runs.`);
  console.log(`Open ${sheetPath} to rate them; it exports ratings as JSON.`);
  console.log(`Then: npm run cli -- agreement --dir ${dir} --ratings <exported.json>`);
}

function cmdAgreement(args: Args): void {
  const dir = str(args.flags, "dir", "");
  const ratingsPath = str(args.flags, "ratings", join(dir, "human-ratings.json"));
  if (!dir) throw new Error("Pass --dir <sweepDir>");
  if (!existsSync(ratingsPath)) throw new Error(`No ratings at ${ratingsPath}. Run 'sample' first.`);
  const scores = readScores(dir);
  const ratings = JSON.parse(readFileSync(ratingsPath, "utf8")) as Record<string, number>;
  const agreement = computeAgreement(scores, ratings);
  console.log(JSON.stringify(agreement, null, 2));
  writeFileSync(join(dir, "agreement.json"), JSON.stringify(agreement, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
