import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SWEEP,
  completedScores,
  expandMatrix,
  loadExistingScores,
  runSweep,
  sweepPaths,
  type SweepConfig,
} from "./run.js";
import { SURFACE_IDS } from "../surfaces/types.js";
import { setRasterizer } from "../render/rasterizer.js";
import { rasterize } from "../render/raster.js";
import type { RunScore } from "../eval/score.js";

/**
 * What happens to a sweep when something outside the agent loop goes wrong.
 *
 * The agent loop has always turned a failed request into a scored run. What it
 * could not do is speak for the code around it — the judge's rasterizer, the
 * renders written per cell, the disk they go to — and a sweep is thousands of
 * calls against a rate-limited API, so "something other than the model ended
 * this run" is the normal case rather than the exotic one.
 *
 * Three rules follow, and the order matters because they pull against each
 * other. Nothing that goes wrong beside a cell may stop the sweep. A cell that
 * failed before it had a score is not a result, so it is retried rather than
 * cached. And a score that *was* computed is kept whatever happens to the
 * files afterwards — otherwise the cure for a lost render is paying for the
 * run a second time.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "canvas-sweep-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function config(over: Partial<SweepConfig> = {}): SweepConfig {
  return {
    ...DEFAULT_SWEEP,
    outDir: dir,
    taskIds: ["fit.long-headline", "fit.two-column"],
    surfaces: ["coordinate", "document"],
    feedback: ["none"],
    repeats: 1,
    concurrency: 2,
    judge: false,
    dryRun: true,
    ...over,
  };
}

/**
 * Make `runCell` throw for named cells, by leaving a directory where its PNG
 * has to be written. Standing in for the real ways a cell falls over outside
 * the loop — a full disk, a rasterizer that dies on one document — without
 * reaching into the runner to inject a failure it would not otherwise have.
 */
function sabotage(runIds: string[]): void {
  const paths = sweepPaths(dir);
  mkdirSync(paths.renders, { recursive: true });
  for (const runId of runIds) mkdirSync(join(paths.renders, `${runId}.png`), { recursive: true });
}

/**
 * A render that will not write is not a reason to throw away a paid-for score.
 *
 * The first version of this file asserted the opposite — that a sabotaged PNG
 * left the cell scored against its starting document — which encoded the bug
 * rather than the rule. The agent had already run: discarding its score loses
 * the work *and* marks the cell for a re-run, so the money goes twice.
 */
describe("a cell whose artifacts cannot be written", () => {
  it("keeps the score the run actually earned", async () => {
    const cfg = config();
    const doomed = expandMatrix(cfg)[0]!.runId;
    sabotage([doomed]);

    const scores = await runSweep(cfg);
    const spoiled = scores.find((s) => s.runId === doomed)!;
    const intact = scores.find((s) => s.runId !== doomed && s.taskId === spoiled.taskId)!;

    expect(spoiled.stopReason).toBe("completed");
    // The dry run's script does the same work on every surface for a given
    // task, so a lost render is the only difference between these two.
    expect(spoiled.efficiency.turns).toBe(intact.efficiency.turns);
    expect(spoiled.efficiency.toolCalls).toBeGreaterThan(0);
    expect(spoiled.efficiency.costUsd).toBeGreaterThan(0);
  });

  it("counts as finished, so the cell is not paid for twice", async () => {
    const cfg = config();
    const doomed = expandMatrix(cfg)[0]!.runId;
    sabotage([doomed]);
    await runSweep(cfg);

    expect(completedScores(sweepPaths(dir)).has(doomed)).toBe(true);

    const ran: string[] = [];
    await runSweep(cfg, { onCellDone: (score) => ran.push(score.runId) });
    expect(ran).not.toContain(doomed);
  });

  it("says so, rather than failing quietly", async () => {
    const cfg = config();
    const doomed = expandMatrix(cfg)[0]!.runId;
    sabotage([doomed]);

    const warnings: string[] = [];
    await runSweep(cfg, { onWarnings: (messages) => warnings.push(...messages) });

    expect(warnings.some((w) => w.includes(doomed) && /PNG/.test(w))).toBe(true);
  });

  it("writes the artifacts it still can", async () => {
    const cfg = config();
    const doomed = expandMatrix(cfg)[0]!.runId;
    sabotage([doomed]);
    await runSweep(cfg);

    // Only the PNG was blocked, so the transcript and the SVG are still there —
    // a cell that kept its record is in far better shape than one that lost
    // everything because the last write failed.
    const paths = sweepPaths(dir);
    expect(existsSync(join(paths.runs, `${doomed}.json`))).toBe(true);
    expect(existsSync(join(paths.renders, `${doomed}.svg`))).toBe(true);
  });
});

describe("a cell that fails before it has a score", () => {
  /** Break the feedback channel, which `runCell` builds before `runAgent`. */
  const unbuildable = (): SweepConfig => config({ feedback: ["screenshot"] });

  it("does not take the rest of the sweep with it", async () => {
    const cfg = unbuildable();
    const cells = expandMatrix(cfg);
    setRasterizer(null);
    try {
      const scores = await runSweep(cfg);
      // The whole matrix came back. One bad cell used to reject `Promise.all`
      // and abandon whatever every other worker had in flight, paid for and
      // unrecorded.
      expect(scores).toHaveLength(cells.length);
      expect(scores.every((s) => s.stopReason === "api_error")).toBe(true);
      expect(scores[0]!.error).toMatch(/rasterizer/);
    } finally {
      setRasterizer(rasterize);
    }
  });

  it("is scored against the starting document, because no turn was taken", async () => {
    const cfg = unbuildable();
    setRasterizer(null);
    try {
      const score = (await runSweep(cfg))[0]!;
      expect(score.normalizedScore).toBe(0);
      expect(score.constraintScore).toBeCloseTo(score.baselineScore, 9);
      expect(score.efficiency.turns).toBe(0);
      expect(score.efficiency.costUsd).toBe(0);
    } finally {
      setRasterizer(rasterize);
    }
  });

  it("is retried on the next pass instead of being cached as done", async () => {
    const cfg = unbuildable();
    setRasterizer(null);
    try {
      await runSweep(cfg);
    } finally {
      setRasterizer(rasterize);
    }

    const skipped: string[] = [];
    const ran: string[] = [];
    const second = await runSweep(cfg, {
      onCellSkipped: (cell) => skipped.push(cell.runId),
      onCellDone: (score) => ran.push(score.runId),
    });

    expect(ran).toHaveLength(expandMatrix(cfg).length);
    expect(skipped).toHaveLength(0);
    expect(second.every((s) => s.stopReason === "completed")).toBe(true);
  });

  it("stays on disk, so nothing that was paid for is thrown away", async () => {
    const cfg = unbuildable();
    setRasterizer(null);
    try {
      await runSweep(cfg);
    } finally {
      setRasterizer(rasterize);
    }

    const paths = sweepPaths(dir);
    const runId = expandMatrix(cfg)[0]!.runId;
    // Recorded either way...
    expect(loadExistingScores(paths).has(runId)).toBe(true);
    // ...but not counted as finished.
    expect(completedScores(paths).has(runId)).toBe(false);
  });
});

describe("completedScores", () => {
  const row = (over: Partial<RunScore>): string =>
    `${JSON.stringify({ runId: "r", stopReason: "completed", ...over })}\n`;

  it("keeps every outcome the agent is responsible for", () => {
    const paths = sweepPaths(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      paths.scoresFile,
      row({ runId: "a", stopReason: "completed" }) +
        // Budget exhaustion and refusals are results — `docs/PREREGISTRATION.md`
        // §5 scores them on what they left behind and reports the rates.
        row({ runId: "b", stopReason: "max_turns" }) +
        row({ runId: "c", stopReason: "max_tokens" }) +
        row({ runId: "d", stopReason: "refusal" }) +
        row({ runId: "e", stopReason: "api_error" }) +
        row({ runId: "f", stopReason: "aborted" }),
    );

    expect([...completedScores(paths).keys()].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("lets a successful retry supersede the failure it replaced", () => {
    const paths = sweepPaths(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      paths.scoresFile,
      row({ runId: "a", stopReason: "api_error" }) + row({ runId: "a", stopReason: "completed" }),
    );
    expect(completedScores(paths).get("a")?.stopReason).toBe("completed");
  });

  it("does not resurrect a cell whose retry failed again", () => {
    const paths = sweepPaths(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      paths.scoresFile,
      row({ runId: "a", stopReason: "completed" }) + row({ runId: "a", stopReason: "api_error" }),
    );
    expect(completedScores(paths).has("a")).toBe(false);
  });
});

/**
 * `scores.jsonl` is the resume log, so a disk that has stopped accepting it is
 * genuinely bad news — but it is bad news for the sweep's recoverability, not
 * a reason to abandon the cells still in flight and lose their spend too.
 */
describe("a scores file that cannot be written", () => {
  it("does not abort the sweep, and says what was lost", async () => {
    const cfg = config();
    const paths = sweepPaths(dir);

    // Break the append *after* `runSweep` has read the file, by swapping it
    // for a directory as the first cell starts. Doing it up front would break
    // the resume read instead, which is a different failure with its own rule.
    let broken = false;
    const warnings: string[] = [];
    const scores = await runSweep(cfg, {
      onCellStart: () => {
        if (broken) return;
        broken = true;
        rmSync(paths.scoresFile, { force: true });
        mkdirSync(paths.scoresFile, { recursive: true });
      },
      onWarnings: (messages) => warnings.push(...messages),
    });

    // Every cell ran and is in the returned results, which is what the caller
    // writes its report from. Only the resume log was lost.
    expect(scores).toHaveLength(expandMatrix(cfg).length);
    expect(scores.every((s) => s.stopReason === "completed")).toBe(true);
    expect(warnings).toHaveLength(scores.length);
    expect(warnings[0]).toMatch(/resuming will not find it/);
  });

  it("refuses to start when an existing scores file cannot be read", async () => {
    const cfg = config();
    const paths = sweepPaths(dir);
    mkdirSync(paths.scoresFile, { recursive: true });

    // Fatal on purpose: nothing has run yet, so stopping costs nothing, while
    // carrying on would silently re-bill for every finished cell.
    await expect(runSweep(cfg)).rejects.toThrow(/could not be read/);
    await expect(runSweep(cfg)).rejects.toThrow(/re-bill/);
  });
});

describe("the sweep's own artifacts", () => {
  it("writes a report even when every cell failed", async () => {
    const cfg = config({ feedback: ["screenshot"] });
    setRasterizer(null);
    let scores;
    try {
      scores = await runSweep(cfg);
    } finally {
      setRasterizer(rasterize);
    }
    expect(scores.every((s) => s.stopReason === "api_error")).toBe(true);
    // Nothing threw, so the caller still gets to write its report — and the
    // scores file still holds every attempt.
    const lines = readFileSync(sweepPaths(dir).scoresFile, "utf8").trim().split("\n");
    expect(lines).toHaveLength(scores.length);
  });
});

/**
 * `--dry-run` is the command anyone runs before spending money, so what it
 * fails to touch is what a sweep discovers at three cents a cell.
 */
describe("the dry run", () => {
  it("reaches a tool call on every surface", async () => {
    const cfg = config({ surfaces: [...SURFACE_IDS], taskIds: ["fit.long-headline"], feedback: ["none"] });
    const scores = await runSweep(cfg);

    expect(scores).toHaveLength(SURFACE_IDS.length);
    for (const s of scores) {
      expect(s.stopReason, s.surfaceId).toBe("completed");
      // One that works and one that is rejected, in this surface's own
      // vocabulary — so dispatch, validation and the error path all run.
      expect(s.efficiency.toolCalls, s.surfaceId).toBeGreaterThan(1);
      expect(s.efficiency.failedToolCalls, s.surfaceId).toBeGreaterThan(0);
      expect(Object.keys(s.toolUsage).length, s.surfaceId).toBeGreaterThan(1);
      // More than one turn, so the conversation actually grows.
      expect(s.efficiency.turns, s.surfaceId).toBeGreaterThan(1);
    }
  });

  it("carries feedback in the conditions that have it", async () => {
    const cfg = config({
      surfaces: ["coordinate"],
      taskIds: ["fit.long-headline"],
      feedback: ["none", "screenshot"],
    });
    await runSweep(cfg);

    const read = (runId: string) =>
      JSON.stringify(JSON.parse(readFileSync(join(sweepPaths(dir).runs, `${runId}.json`), "utf8")));
    const cells = expandMatrix(cfg);
    expect(read(cells[0]!.runId)).not.toContain("base64 chars elided");
    expect(read(cells[1]!.runId)).toContain("base64 chars elided");
  });
});
