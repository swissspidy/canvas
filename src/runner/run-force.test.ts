import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Setting the old scores aside is a rename, and a rename can fail where the
// write of a file beside it does not (directory permissions). Simulated here,
// in a file of its own so no other test sees the mock.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: vi.fn(() => {
      throw new Error("EPERM: operation not permitted, rename (simulated)");
    }),
    // Only the lone newline that repairs a cut-off last line fails.
    appendFileSync: vi.fn((path: Parameters<typeof actual.appendFileSync>[0], data: string, ...rest: unknown[]) => {
      if (data === "\n") throw new Error("ENOSPC: no space left on device, write (simulated)");
      return (actual.appendFileSync as (...a: unknown[]) => void)(path, data, ...rest);
    }),
  };
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SWEEP, runSweep, sweepPaths, type SweepConfig } from "./run.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "canvas-force-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const config = (over: Partial<SweepConfig> = {}): SweepConfig => ({
  ...DEFAULT_SWEEP,
  outDir: dir,
  taskIds: ["fit.long-headline"],
  surfaces: ["coordinate"],
  feedback: ["none"],
  repeats: 1,
  concurrency: 1,
  judge: false,
  dryRun: true,
  ...over,
});

describe("--force when the old scores cannot be set aside", () => {
  it("fails before writing the new settings, so the old fingerprint still guards the old rows", async () => {
    await runSweep(config({ turnBudget: 1 }));
    const before = readFileSync(sweepPaths(dir).configFile, "utf8");

    await expect(runSweep(config({ turnBudget: 5, force: true }))).rejects.toThrow(/simulated/);

    expect(readFileSync(sweepPaths(dir).configFile, "utf8")).toBe(before);
    expect(JSON.parse(before).turnBudget).toBe(1);
  });
});

describe("a cut-off scores file whose newline cannot be written", () => {
  it("stops the sweep before any cell runs, so no score is glued to the fragment", async () => {
    await runSweep(config());
    const { scoresFile } = sweepPaths(dir);
    const cut = readFileSync(scoresFile, "utf8").replace(/\n$/, "").slice(0, -5);
    writeFileSync(scoresFile, cut);

    await expect(runSweep(config({ repeats: 2 }))).rejects.toThrow(/ENOSPC/);
    expect(readFileSync(scoresFile, "utf8")).toBe(cut);
  });
});
