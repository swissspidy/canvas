import { describe, expect, it } from "vitest";
import { buildReport, buildReportJson, clusterBootstrapCI, pairedDifference } from "./report.js";
import type { RunScore } from "../eval/score.js";

function score(partial: Partial<RunScore> & { taskId: string; surfaceId: string }): RunScore {
  return {
    runId: `${partial.taskId}-${partial.surfaceId}-${Math.random()}`,
    taskFamily: "repair",
    feedbackMode: "none",
    model: "claude-opus-5",
    runner: "anthropic" as const,
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
  });

  it("produces machine-readable aggregates keyed by every dimension", () => {
    const json = buildReportJson(scores) as {
      runs: number;
      aggregates: Record<string, Record<string, { n: number; improvement: { mean: number } }>>;
    };
    expect(json.runs).toBe(scores.length);
    expect(Object.keys(json.aggregates)).toContain("surfaceByFeedback");
    expect(json.aggregates.surface!.relational!.improvement.mean).toBeGreaterThan(
      json.aggregates.surface!.coordinate!.improvement.mean,
    );
  });
});
