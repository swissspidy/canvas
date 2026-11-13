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
  };
});

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
