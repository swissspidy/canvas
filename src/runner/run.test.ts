import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import type { RunScore } from "../eval/score.js";

/**
 * What happens to a sweep when something outside the agent loop goes wrong.
 *
 * The agent loop has always turned a failed request into a scored run. What it
 * could not do is speak for the code around it — the judge's rasterizer, the
 * renders written per cell, the disk they go to — and a sweep is thousands of
 * calls against a rate-limited API, so "the transport had a bad minute" is the
 * normal case rather than the exotic one. These tests pin the two rules that
 * follow from it: a harness failure never stops the sweep, and it never
 * becomes a result.
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

function unsabotage(runIds: string[]): void {
  const paths = sweepPaths(dir);
  for (const runId of runIds) rmSync(join(paths.renders, `${runId}.png`), { recursive: true, force: true });
}

describe("a cell that fails outside the agent loop", () => {
  it("does not take the rest of the sweep with it", async () => {
    const cfg = config();
    const cells = expandMatrix(cfg);
    const doomed = cells.slice(0, 2).map((c) => c.runId);
    sabotage(doomed);

    const scores = await runSweep(cfg);

    // The whole matrix came back, not just the cells that ran before the throw.
    expect(scores).toHaveLength(cells.length);
    const failed = scores.filter((s) => s.stopReason === "api_error");
    expect(failed.map((s) => s.runId).sort()).toEqual([...doomed].sort());
    expect(failed[0]!.error).toMatch(/EISDIR/);
    // The other two are untouched, which is the point: one bad cell used to
    // reject `Promise.all` and abandon whatever every other worker had in
    // flight, paid for and unrecorded.
    expect(scores.filter((s) => s.stopReason === "completed")).toHaveLength(2);
  });

  it("is scored against the starting document rather than left half-written", async () => {
    const cfg = config();
    const doomed = expandMatrix(cfg)[0]!.runId;
    sabotage([doomed]);

    const score = (await runSweep(cfg)).find((s) => s.runId === doomed)!;
    expect(score.normalizedScore).toBe(0);
    expect(score.constraintScore).toBeCloseTo(score.baselineScore, 9);
    expect(score.efficiency.turns).toBe(0);
    expect(score.efficiency.costUsd).toBe(0);
  });

  it("is retried on the next pass instead of being cached as done", async () => {
    const cfg = config();
    const doomed = expandMatrix(cfg).slice(0, 2).map((c) => c.runId);
    sabotage(doomed);
    await runSweep(cfg);

    unsabotage(doomed);
    const skipped: string[] = [];
    const ran: string[] = [];
    const second = await runSweep(cfg, {
      onCellSkipped: (cell) => skipped.push(cell.runId),
      onCellDone: (score) => ran.push(score.runId),
    });

    // Exactly the failures re-ran; the finished cells were not paid for twice.
    expect(ran.sort()).toEqual([...doomed].sort());
    expect(skipped).toHaveLength(2);
    expect(second.every((s) => s.stopReason === "completed")).toBe(true);
  });

  it("stays on disk, so nothing that was paid for is thrown away", async () => {
    const cfg = config();
    const doomed = expandMatrix(cfg)[0]!.runId;
    sabotage([doomed]);
    await runSweep(cfg);

    const paths = sweepPaths(dir);
    // Recorded either way...
    expect(loadExistingScores(paths).has(doomed)).toBe(true);
    // ...but not counted as finished.
    expect(completedScores(paths).has(doomed)).toBe(false);
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

describe("the sweep's own artifacts", () => {
  it("writes a report even when every cell failed", async () => {
    const cfg = config();
    sabotage(expandMatrix(cfg).map((c) => c.runId));
    const scores = await runSweep(cfg);
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
