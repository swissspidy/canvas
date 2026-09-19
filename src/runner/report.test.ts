import { describe, expect, it } from "vitest";
import { buildReport, buildReportJson, clusterBootstrapCI, pairedDifference, signFlipTest } from "./report.js";
import type { RunScore } from "../eval/score.js";
import { fingerprintConflicts, runFingerprint } from "./run.js";

function score(partial: Partial<RunScore> & { taskId: string; surfaceId: string }): RunScore {
  return {
    runId: `${partial.taskId}-${partial.surfaceId}-${Math.random()}`,
    taskFamily: "repair",
    feedbackMode: "none",
    model: "anthropic:claude-opus-5",
    stopReason: "completed",
    constraintScore: 0.8,
    checkResults: [],
    judgeCriteriaScore: 0.6,
    judgeOverallScore: 0.6,
    judgeSummary: "",
    composite: 0.72,
    baselineScore: 0.6,
    normalizedScore: 0.5,
    efficiency: {
      turns: 4,
      toolCalls: 6,
      failedToolCalls: 1,
      failureRate: 1 / 6,
      inputTokens: 1000,
      outputTokens: 400,
      totalTokens: 1400,
      costUsd: 0.02,
      pricingKnown: true,
      wallMs: 5000,
    },
    toolUsage: { create: { ok: 3, failed: 0 }, move: { ok: 2, failed: 1 } },
    ...partial,
  };
}

/** Five tasks, three repeats each, with a surface effect of exactly +0.2. */
function syntheticScores(surfaceEffect = 0.2): RunScore[] {
  const out: RunScore[] = [];
  for (let t = 0; t < 5; t++) {
    const difficulty = t * 0.08;
    for (const surface of ["coordinate", "relational"]) {
      for (let r = 0; r < 3; r++) {
        out.push(
          score({
            taskId: `task-${t}`,
            surfaceId: surface,
            normalizedScore: 0.3 + difficulty + (surface === "relational" ? surfaceEffect : 0),
          }),
        );
      }
    }
  }
  return out;
}

describe("clusterBootstrapCI", () => {
  it("reports the observed mean and brackets it", () => {
    const scores = syntheticScores();
    const interval = clusterBootstrapCI(scores, (s) => s.normalizedScore);
    expect(interval.low).toBeLessThanOrEqual(interval.mean);
    expect(interval.high).toBeGreaterThanOrEqual(interval.mean);
    expect(interval.n).toBe(scores.length);
  });

  it("is wider than the naive bootstrap, because repeats are not independent", () => {
    // Every run within a task is identical here, so resampling runs pretends
    // there are 15 observations when there are really 5.
    const scores = syntheticScores(0);
    const clustered = clusterBootstrapCI(scores, (s) => s.normalizedScore);
    const naive = clusterBootstrapCI(scores, (s) => s.normalizedScore, (s) => s.runId);
    expect(clustered.high - clustered.low).toBeGreaterThan(naive.high - naive.low);
  });

  it("collapses to a point for a single cluster", () => {
    const one = clusterBootstrapCI([score({ taskId: "t", surfaceId: "coordinate" })], (s) => s.normalizedScore);
    expect(one.low).toBe(one.high);
  });

  it("is reproducible", () => {
    const scores = syntheticScores();
    expect(clusterBootstrapCI(scores, (s) => s.normalizedScore)).toEqual(
      clusterBootstrapCI(scores, (s) => s.normalizedScore),
    );
  });
});

describe("every reported interval is task-clustered", () => {
  // Repeats within a task disagree; task means are all identical. A clustered
  // bootstrap therefore collapses to a point, and a run-level one does not —
  // so a zero-width interval here is proof the clustering is being applied.
  const scores: RunScore[] = [];
  for (let t = 0; t < 5; t++) {
    for (const surface of ["coordinate", "relational"]) {
      for (const offset of [-0.2, 0, 0.2]) {
        scores.push(
          score({
            taskId: `task-${t}`,
            surfaceId: surface,
            feedbackMode: offset === 0 ? "none" : "structured",
            normalizedScore: 0.5 + offset,
            composite: 0.5 + offset,
            constraintScore: 0.5 + offset,
            judgeCriteriaScore: 0.5 + offset,
          }),
        );
      }
    }
  }

  it("clusters improvement, composite, constraint and judge alike", () => {
    const json = buildReportJson(scores) as {
      aggregates: Record<string, Record<string, Record<string, { low: number; high: number } | null>>>;
    };
    // `feedback` splits the offsets apart, so only look at dimensions where
    // each group still holds a whole task.
    for (const dimension of ["surface", "task", "model"]) {
      for (const group of Object.values(json.aggregates[dimension]!)) {
        for (const key of ["improvement", "composite", "constraint", "judge"]) {
          const interval = group[key];
          expect(interval, `${dimension}.${key}`).not.toBeUndefined();
          if (interval) expect(interval.high - interval.low, `${dimension}.${key}`).toBeCloseTo(0, 9);
        }
      }
    }
  });
});

describe("pairedDifference", () => {
  it("recovers a planted effect and calls it resolved", () => {
    const diff = pairedDifference(syntheticScores(0.2), (s) => s.surfaceId, "relational", "coordinate");
    expect(diff.difference).toBeCloseTo(0.2, 6);
    expect(diff.pairs).toBe(5);
    expect(diff.resolved).toBe(true);
    expect(diff.low).toBeGreaterThan(0);
  });

  it("reports the sign of the comparison as asked", () => {
    const diff = pairedDifference(syntheticScores(0.2), (s) => s.surfaceId, "coordinate", "relational");
    expect(diff.difference).toBeCloseTo(-0.2, 6);
    expect(diff.resolved).toBe(true);
  });

  it("does not resolve a zero effect", () => {
    const diff = pairedDifference(syntheticScores(0), (s) => s.surfaceId, "relational", "coordinate");
    expect(diff.difference).toBeCloseTo(0, 9);
    expect(diff.resolved).toBe(false);
  });

  it("pairs only tasks present in both conditions", () => {
    const scores = [
      score({ taskId: "shared", surfaceId: "coordinate", normalizedScore: 0.4 }),
      score({ taskId: "shared", surfaceId: "relational", normalizedScore: 0.6 }),
      score({ taskId: "coordinate-only", surfaceId: "coordinate", normalizedScore: 0.9 }),
    ];
    const diff = pairedDifference(scores, (s) => s.surfaceId, "relational", "coordinate");
    expect(diff.pairs).toBe(1);
    expect(diff.difference).toBeCloseTo(0.2, 9);
  });

  it("never claims a resolved difference from a single task", () => {
    const scores = [
      score({ taskId: "only", surfaceId: "coordinate", normalizedScore: 0 }),
      score({ taskId: "only", surfaceId: "relational", normalizedScore: 1 }),
    ];
    expect(pairedDifference(scores, (s) => s.surfaceId, "relational", "coordinate").resolved).toBe(false);
  });

  it("keeps the bootstrap rule by default and switches only when asked", () => {
    const scores = syntheticScores(0.2);
    expect(pairedDifference(scores, (s) => s.surfaceId, "relational", "coordinate").method).toBe("bootstrap");

    // Five tasks. The bootstrap resolves it; the sign-flip test cannot, because
    // 2/2^5 = 0.0625 is the smallest p five pairs can produce. Both are looking
    // at the same effect, and only one of them is a 95% test at this size.
    const permuted = pairedDifference(
      scores, (s) => s.surfaceId, "relational", "coordinate", (s) => s.normalizedScore, 2000, 20260916, "permutation",
    );
    expect(permuted.pairs).toBe(5);
    expect(permuted.floorP).toBeCloseTo(0.0625, 9);
    expect(permuted.pValue).toBeCloseTo(0.0625, 9);
    expect(permuted.resolved).toBe(false);
    // The size of the difference is still reported; only the verdict changed.
    expect(permuted.difference).toBeCloseTo(0.2, 6);
  });
});

/**
 * The test behind `docs/PREREGISTRATION.md` §4's small breakdowns. The headline
 * comparison pools 23 tasks and the bootstrap is fine there; the family and
 * rotation breakdowns run on two to seven, and this is what can be said at
 * those sizes without overclaiming.
 */
describe("signFlipTest", () => {
  it("enumerates every sign assignment at small cluster counts", () => {
    // Six deltas, all positive: only the observed assignment and its mirror are
    // as extreme, so p is exactly 2/64.
    const result = signFlipTest([3, 4, 5, 6, 7, 8]);
    expect(result.exact).toBe(true);
    expect(result.p).toBeCloseTo(2 / 64, 9);
    expect(result.floorP).toBeCloseTo(2 / 64, 9);
  });

  it("states a floor that says when a breakdown cannot resolve anything", () => {
    // The whole point. Two tasks cannot produce a p below 0.5 and five cannot
    // get below 0.0625, so neither can clear 0.05 however large the effect is.
    // Six is the smallest breakdown that can.
    for (const [pairs, floor] of [[2, 0.5], [3, 0.25], [4, 0.125], [5, 0.0625], [6, 0.03125]] as const) {
      const deltas = Array.from({ length: pairs }, (_, i) => 100 + i);
      const result = signFlipTest(deltas);
      expect(result.floorP).toBeCloseTo(floor, 9);
      // An overwhelming effect still cannot beat the floor.
      expect(result.p).toBeCloseTo(floor, 9);
      expect(result.p <= 0.05).toBe(pairs >= 6);
    }
  });

  it("does not care which way the deltas point", () => {
    const up = signFlipTest([2, 3, 4, 5, 6, 7]);
    const down = signFlipTest([-2, -3, -4, -5, -6, -7]);
    expect(down.p).toBeCloseTo(up.p, 9);
  });

  it("gives a mixed set of deltas no more credit than it earns", () => {
    // Three up, three down, near-cancelling: the observed mean sits in the
    // middle of its own null distribution.
    const result = signFlipTest([5, -4, 6, -5, 4, -6]);
    expect(result.p).toBeGreaterThan(0.5);
    expect(result.exact).toBe(true);
  });

  it("samples rather than enumerating once 2^k stops being worth it", () => {
    const deltas = Array.from({ length: 20 }, (_, i) => i + 1);
    const result = signFlipTest(deltas);
    expect(result.exact).toBe(false);
    // Sampled p is bounded away from zero: no finite sample proves impossibility.
    expect(result.p).toBeGreaterThan(0);
    expect(result.p).toBeLessThan(0.01);
  });

  it("returns a flat verdict on deltas that are all zero", () => {
    expect(signFlipTest([0, 0, 0, 0]).p).toBe(1);
  });

  it("has nothing to say about an empty comparison", () => {
    expect(signFlipTest([])).toMatchObject({ p: 1, floorP: 1, exact: true });
  });
});

describe("buildReport", () => {
  const scores = [
    ...syntheticScores(0.2),
    ...syntheticScores(0.2).map((s) => ({ ...s, feedbackMode: "both", runId: `${s.runId}-b` })),
  ];

  it("says so when there is nothing to report", () => {
    expect(buildReport([])).toMatch(/No runs/);
  });

  it("renders every section", () => {
    const md = buildReport(scores);
    expect(md).toContain("## By tool surface");
    expect(md).toContain("### Cost of a point");
    expect(md).toContain("## By feedback condition");
    expect(md).toContain("## Surface x feedback");
    expect(md).toContain("### Paired differences");
    expect(md).toContain("## Tool use");
    expect(md).toContain("## How runs ended");
  });

  it("states the spread comparison that answers the interaction question", () => {
    expect(buildReport(scores)).toMatch(/Spread across surfaces: .* Spread across feedback conditions:/);
  });

  it("omits single-level sections", () => {
    const md = buildReport(syntheticScores(0.2));
    expect(md).not.toContain("## By feedback condition");
    expect(md).not.toContain("## By model");
    // One model is not a leaderboard; the surface table already is one.
    expect(md).not.toContain("## Leaderboard");
    expect(md).not.toContain("## Every cell");
  });

  it("ranks models, and every cell, once the sweep is cross-model", () => {
    // Two models, one clearly stronger, across two surfaces and two feedback
    // conditions: the smallest sweep that is actually a leaderboard.
    const crossModel = [
      ...scores,
      ...scores.map((s) => ({
        ...s,
        runId: `${s.runId}-m2`,
        model: "google:gemini-3.8-flash",
        normalizedScore: s.normalizedScore - 0.15,
        efficiency: { ...s.efficiency, costUsd: 0.002 },
      })),
    ];
    const md = buildReport(crossModel);

    expect(md).toContain("## Leaderboard");
    expect(md).toContain("## Model x feedback");
    expect(md).toContain("## Every cell");

    const leaderboard = md.slice(md.indexOf("## Leaderboard"), md.indexOf("## By tool surface"));
    const order = [...leaderboard.matchAll(/^\| \d+ \| (\S+) \|/gm)].map((m) => m[1]);
    expect(order).toEqual(["anthropic:claude-opus-5", "google:gemini-3.8-flash"]);
    // The best cell names a surface and a feedback condition, not just one.
    expect(leaderboard).toMatch(/relational\/(none|both)/);

    // Every model x surface x feedback combination gets a row.
    const cells = md.slice(md.indexOf("## Every cell"));
    expect([...cells.matchAll(/^\| \d+ \|/gm)]).toHaveLength(2 * 2 * 2);
  });

  /**
   * A sweep does not have to be square: run ids encode the cell, so an
   * interrupted sweep resumes and a widened one runs only what is new. Ranking
   * a model scored on the easy tasks against one scored on all of them
   * compares the task sets rather than the models.
   */
  it("ranks only on the cells every model has, and says what it left out", () => {
    const full = syntheticScores(0.2).map((s) => ({ ...s, model: "model-a" }));
    // The second model only ever reached the two easiest tasks. Its raw mean
    // is higher for that reason alone.
    const partial = syntheticScores(0.2)
      .filter((s) => s.taskId === "task-0" || s.taskId === "task-1")
      .map((s) => ({ ...s, runId: `${s.runId}-b`, model: "model-b" }));

    const md = buildReport([...full, ...partial]);
    const section = md.slice(md.indexOf("## Leaderboard"), md.indexOf("## By tool surface"));

    expect(section).toMatch(/Ranked on the 4 task x surface x feedback combination\(s\)/);
    // 42 runs in all; the 24 inside the shared four cells are what rank.
    expect(section).toMatch(/18 run\(s\) outside that common grid are left out/);

    // Both models are now measured on the same two tasks, so the surface
    // effect they share leaves them level rather than ranked by coverage.
    const means = [...section.matchAll(/^\| \d+ \| (\S+) \| ([\d.]+) /gm)].map((m) => [m[1], Number(m[2])]);
    expect(means).toHaveLength(2);
    expect(Math.abs((means[0]![1] as number) - (means[1]![1] as number))).toBeLessThan(0.001);
  });

  it("says so when no cell is shared, rather than ranking anyway", () => {
    const a = syntheticScores(0.2)
      .filter((s) => s.taskId === "task-0")
      .map((s) => ({ ...s, model: "model-a" }));
    const b = syntheticScores(0.2)
      .filter((s) => s.taskId === "task-1")
      .map((s) => ({ ...s, runId: `${s.runId}-b`, model: "model-b" }));
    const md = buildReport([...a, ...b]);
    expect(md).toMatch(/No task, surface and feedback combination has a run from every model/);
  });

  // Repeats are not evidence: a cell carrying eight runs must not outweigh one
  // carrying three inside a task's mean. The extra runs below score exactly
  // what their cell already scored, so nothing but the *count* changes — and a
  // raw row average would still drag the task mean toward the fuller cell.
  it("gives each cell one vote whatever its repeat count", () => {
    const base = syntheticScores(0.2).map((s) => ({ ...s, model: "model-a" }));
    const oneCell = base.filter((s) => s.taskId === "task-0" && s.surfaceId === "coordinate");
    const lopsided = [
      ...base,
      ...oneCell.map((s, i) => ({ ...s, runId: `extra-${i}` })),
      ...oneCell.map((s, i) => ({ ...s, runId: `extra2-${i}` })),
    ];
    const meanOf = (rows: typeof base) => {
      const md = buildReport([...rows, ...rows.map((s) => ({ ...s, runId: `${s.runId}-m2`, model: "model-b" }))]);
      const section = md.slice(md.indexOf("## Leaderboard"), md.indexOf("## By tool surface"));
      return Number([...section.matchAll(/^\| 1 \| \S+ \| ([\d.]+) /gm)][0]![1]);
    };
    expect(meanOf(lopsided)).toBeCloseTo(meanOf(base), 6);
  });

  it("produces machine-readable aggregates keyed by every dimension", () => {
    const json = buildReportJson(scores) as {
      runs: number;
      aggregates: Record<string, Record<string, { n: number; improvement: { mean: number } }>>;
    };
    expect(json.runs).toBe(scores.length);
    expect(Object.keys(json.aggregates)).toContain("surfaceByFeedback");
    // The full grid, so a plot can slice it without re-reading scores.jsonl.
    expect(Object.keys(json.aggregates)).toContain("modelByFeedback");
    expect(Object.keys(json.aggregates.cell!)).toContain("anthropic:claude-opus-5|relational|both");
    expect(json.aggregates.surface!.relational!.improvement.mean).toBeGreaterThan(
      json.aggregates.surface!.coordinate!.improvement.mean,
    );
  });
});

/**
 * The check results were computed for every run and never read. This is the
 * section that reads them, and what it has to get right is the sort: a check
 * every surface fails equally is a hard task, and a check one surface fails
 * alone is the reason one surface won.
 */
describe("the per-check breakdown", () => {
  const check = (id: string, label: string, s: number) => ({
    id,
    label,
    weight: 1,
    score: s,
    detail: "",
    passed: s >= 0.999,
  });

  /** `margin` separates the surfaces; `contrast` fails for everyone equally. */
  function withChecks(): RunScore[] {
    const rows: RunScore[] = [];
    for (let t = 0; t < 3; t++) {
      for (const [surface, margin] of [
        ["coordinate", 0.2],
        ["relational", 0.9],
      ] as const) {
        rows.push(
          score({
            taskId: `task-${t}`,
            surfaceId: surface,
            checkResults: [
              check("margin", "Elements keep a 24 unit margin", margin),
              check("contrast", "Text contrast is at least 4.5:1", 0.5),
              check("preserved", "Existing elements are kept", 1),
            ],
          }),
        );
      }
    }
    return rows;
  }

  it("puts the check that separates the surfaces first", () => {
    const md = buildReport(withChecks());
    const section = md.slice(md.indexOf("## Which constraints separated the surfaces"));
    expect(section.indexOf("| margin ")).toBeLessThan(section.indexOf("| contrast "));
    expect(section).toMatch(/\| margin \|.*\| 70\.0pt \|/);
  });

  // A check nothing fails is measuring a defect nobody introduced, which is
  // what the baseline is for. A table of them buries the ones doing work.
  it("leaves out a check every run passed", () => {
    const section = buildReport(withChecks());
    expect(section).not.toMatch(/\| preserved \|/);
  });

  it("says so plainly when nothing failed at all", () => {
    const clean = withChecks().map((s) => ({
      ...s,
      checkResults: s.checkResults.map((r) => ({ ...r, score: 1, passed: true })),
    }));
    expect(buildReport(clean)).toMatch(/Every check passed in every run/);
  });

  it("carries the same numbers into the JSON, cut three ways", () => {
    const json = buildReportJson(withChecks()) as {
      aggregates: {
        check: Record<
          string,
          {
            mean: number;
            bySurface: Record<string, { mean: number }>;
            byFeedback: unknown;
            byModel: unknown;
            byFamily: unknown;
            byTask: unknown;
          }
        >;
      };
    };
    const margin = json.aggregates.check.margin!;
    expect(margin.mean).toBeCloseTo(0.55, 6);
    expect(margin.bySurface.coordinate!.mean).toBeCloseTo(0.2, 6);
    expect(margin.bySurface.relational!.mean).toBeCloseTo(0.9, 6);
    expect(Object.keys(margin.byTask as object)).toHaveLength(3);
    // Cut the same ways the run-level aggregates are, so a plot does not have
    // to fall back to scores.jsonl to ask "which model failed this".
    for (const cut of ["byFeedback", "byModel", "byFamily"] as const) {
      const rows = margin[cut] as Record<string, { n: number; mean: number; passRate: number }>;
      expect(Object.keys(rows).length, cut).toBeGreaterThan(0);
      for (const row of Object.values(rows)) {
        expect(row.n).toBeGreaterThan(0);
        expect(row.mean).toBeGreaterThanOrEqual(0);
        expect(row.passRate).toBeGreaterThanOrEqual(0);
      }
    }
  });

  // A surface that never met a check has no score for it, and reporting the
  // range over the surfaces that did would call an absence a difference.
  it("does not report a spread when a surface never saw the check", () => {
    const rows = withChecks();
    const onlyCoordinate = rows.map((s) =>
      s.surfaceId === "relational" ? { ...s, checkResults: s.checkResults.filter((r) => r.id !== "margin") } : s,
    );
    const md = buildReport(onlyCoordinate);
    const line = md.split("\n").find((l) => l.startsWith("| margin "))!;
    expect(line).toMatch(/\| — \|$/);
  });

  // "The surfaces scored this identically" and "one surface never met this"
  // are different facts, and a dash for both hid the first behind the second —
  // in the column the table is sorted by.
  it("tells an agreed check apart from an incomparable one", () => {
    const md = buildReport(withChecks());
    const contrast = md.split("\n").find((l) => l.startsWith("| contrast "))!;
    expect(contrast).toMatch(/\| 0\.0pt \|$/);

    const partial = withChecks().map((s) =>
      s.surfaceId === "relational" ? { ...s, checkResults: s.checkResults.filter((r) => r.id !== "contrast") } : s,
    );
    const line = buildReport(partial).split("\n").find((l) => l.startsWith("| contrast "))!;
    expect(line).toMatch(/\| — \|$/);
  });

  // An incomparable spread is the row with the least to say about the
  // surfaces, so it sorts last rather than as a zero.
  it("sorts an incomparable check below one the surfaces agreed on", () => {
    const partial = withChecks().map((s) =>
      s.surfaceId === "relational" ? { ...s, checkResults: s.checkResults.filter((r) => r.id !== "margin") } : s,
    );
    const md = buildReport(partial);
    const section = md.slice(md.indexOf("## Which constraints separated the surfaces"));
    expect(section.indexOf("| contrast ")).toBeLessThan(section.indexOf("| margin "));
  });
});

describe("resume fingerprint", () => {
  const base = {
    outDir: "runs/x",
    taskIds: ["a"],
    surfaces: ["coordinate" as const],
    feedback: ["none" as const],
    models: ["anthropic:claude-opus-5"],
    repeats: 1,
    concurrency: 1,
    judge: true,
    judgeModel: "anthropic:claude-opus-5",
    dryRun: false,
    force: false,
  };

  it("ignores changes the run id already encodes", () => {
    // Adding a task or a repeat gives new ids, so the finished cells are still
    // comparable and the sweep should extend rather than refuse.
    const extended = {
      ...base,
      taskIds: ["a", "b"],
      repeats: 3,
      models: ["anthropic:claude-opus-5", "anthropic:claude-sonnet-5"],
    };
    expect(fingerprintConflicts(runFingerprint(base), runFingerprint(extended))).toEqual([]);
  });

  // The two agent loops were collapsed into one. A directory holding runs from
  // the retired native loop must not quietly accept runs from this one.
  it("refuses to resume a sweep made under the retired native loop", () => {
    const previous = runFingerprint({ ...base, runner: "anthropic" } as never);
    const conflicts = fingerprintConflicts(previous, runFingerprint(base));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain("harness");
  });

  it("names the settings a run id does not encode", () => {
    for (const changed of [
      { effort: "low" as const },
      { maxTokens: 4000 },
      { judge: false },
      { judgeModel: "anthropic:claude-sonnet-5" },
      { dryRun: true },
    ]) {
      const conflicts = fingerprintConflicts(runFingerprint(base), runFingerprint({ ...base, ...changed }));
      expect(conflicts, JSON.stringify(changed)).toHaveLength(1);
      expect(conflicts[0]).toContain(Object.keys(changed)[0]!);
    }
  });
});

/**
 * A run that never reached a model is not an observation of anything.
 *
 * It is the failure mode a real sweep produces most of: 828 cells against a
 * rate-limited API, three repeats each, and a handful of 429s is the normal
 * afternoon. Pooled in at the baseline they read as runs that improved
 * nothing, and they land wherever the rate limiter happened to fall rather
 * than where the surfaces differ — so they would quietly penalise whichever
 * surface was unlucky.
 */
describe("harness failures in the report", () => {
  const mixed = (): RunScore[] => [
    ...syntheticScores(0.2),
    score({ taskId: "task-0", surfaceId: "coordinate", stopReason: "api_error", normalizedScore: 0, error: "overloaded_error" }),
    score({ taskId: "task-1", surfaceId: "coordinate", stopReason: "api_error", normalizedScore: 0, error: "overloaded_error" }),
    score({ taskId: "task-2", surfaceId: "relational", stopReason: "aborted", normalizedScore: 0 }),
  ];

  it("leaves them out of the aggregates", () => {
    const clean = syntheticScores(0.2);
    const withFailures = mixed();
    // The three extra rows change nothing, because they are not counted.
    expect(buildReport(withFailures)).toContain("| coordinate |");
    const a = buildReport(clean).slice(buildReport(clean).indexOf("## By tool surface"));
    const b = buildReport(withFailures).slice(buildReport(withFailures).indexOf("## By tool surface"));
    expect(b.slice(0, b.indexOf("## How runs ended"))).toBe(a.slice(0, a.indexOf("## How runs ended")));
  });

  it("counts them at the top, so the hole in the grid is visible", () => {
    const md = buildReport(mixed());
    expect(md).toContain("3 further run(s) were cut off by the harness");
    expect(md).toContain("not cached as done");
    // Excluded for being incomplete, not for having achieved nothing — a
    // truncated run can carry real progress, which is the reason to drop it
    // rather than a reason to keep it.
    expect(md).toContain("not for having achieved nothing");
    // The run count is of the usable runs, not of the rows on disk.
    expect(md).toContain(`${syntheticScores(0.2).length} runs —`);
  });

  it("still shows them in the stop-reason table, where attrition belongs", () => {
    const section = buildReport(mixed()).slice(buildReport(mixed()).indexOf("## How runs ended"));
    expect(section).toContain("api_error");
    expect(section).toContain("aborted");
    // Percentages there are over every run for that surface, failures included.
    expect(section).toContain("| n |");
  });

  it("keeps max_turns as an outcome rather than a failure", () => {
    const withBudgetExhaustion = [
      ...syntheticScores(0.2),
      score({ taskId: "task-0", surfaceId: "coordinate", stopReason: "max_turns", normalizedScore: 0.1 }),
    ];
    const md = buildReport(withBudgetExhaustion);
    expect(md).not.toContain("cut off by the harness");
    expect(md).toContain("max_turns");
  });

  it("refuses to invent a comparison when every run failed", () => {
    const md = buildReport([
      score({ taskId: "t", surfaceId: "coordinate", stopReason: "api_error", error: "API key is invalid." }),
      score({ taskId: "t", surfaceId: "relational", stopReason: "api_error", error: "API key is invalid." }),
    ]);
    expect(md).toContain("ended by the harness rather than finished by the model");
    expect(md).toContain("API key is invalid.");
    expect(md).not.toContain("## By tool surface");
  });

  it("reports the count in the JSON, so a plot can show the attrition", () => {
    const json = buildReportJson(mixed()) as {
      runs: number;
      recorded: number;
      harnessFailures: { n: number; bySurface: Record<string, number>; byStopReason: Record<string, number> };
    };
    expect(json.runs).toBe(syntheticScores(0.2).length);
    expect(json.recorded).toBe(json.runs + 3);
    expect(json.harnessFailures.n).toBe(3);
    expect(json.harnessFailures.bySurface).toEqual({ coordinate: 2, relational: 1 });
    expect(json.harnessFailures.byStopReason).toEqual({ api_error: 2, aborted: 1 });
  });
});
