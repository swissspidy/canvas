/**
 * Aggregation and reporting.
 *
 * Bootstrap confidence intervals rather than bare means, because the cells are
 * small: eighteen tasks times a handful of repeats is not enough to read a
 * two-point difference as a result. If the intervals for two surfaces overlap,
 * the report says so rather than ranking them.
 *
 * The bootstrap is seeded, so the same scores always produce the same
 * intervals. A report that shifts slightly every time it is regenerated
 * invites exactly the kind of re-rolling this study should not do.
 */

import type { RunScore } from "../eval/score.js";
import { feedbackLabel, type FeedbackMode } from "../feedback/index.js";

export const BOOTSTRAP_ITERATIONS = 2000;
export const BOOTSTRAP_SEED = 20260916;

/** Deterministic PRNG so reports are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

export interface Interval {
  mean: number;
  low: number;
  high: number;
  n: number;
  sd: number;
}

/**
 * Percentile bootstrap of the mean, resampling the values it is given.
 *
 * Only correct when those values are already independent — one per task, as in
 * `pairedDifference`'s per-task deltas. Handing it a list of *runs* treats
 * three repeats of one task as three independent observations and returns an
 * interval that is too narrow. Anything reported over runs goes through
 * `clusterBootstrapCI`, which is what `docs/PREREGISTRATION.md` specifies.
 */
export function bootstrapCI(values: number[], iterations = BOOTSTRAP_ITERATIONS, alpha = 0.05): Interval {
  const n = values.length;
  const m = mean(values);
  if (n === 0) return { mean: 0, low: 0, high: 0, n: 0, sd: 0 };
  if (n === 1) return { mean: m, low: m, high: m, n, sd: 0 };

  const rand = mulberry32(BOOTSTRAP_SEED + n);
  const means: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += values[Math.floor(rand() * n)]!;
    means[i] = sum / n;
  }
  means.sort((a, b) => a - b);
  const lowIdx = Math.floor((alpha / 2) * iterations);
  const highIdx = Math.min(iterations - 1, Math.ceil((1 - alpha / 2) * iterations) - 1);
  return { mean: m, low: means[lowIdx]!, high: means[highIdx]!, n, sd: stdev(values) };
}

/**
 * Bootstrap that resamples *tasks*, not runs.
 *
 * Runs within a task are not independent observations: three repeats of
 * "fix this overlapping layout" share a starting document, a difficulty and a
 * set of checks. Resampling individual runs treats them as if they were
 * independent and returns an interval that is too narrow — it would make a
 * difference look resolved when the evidence is really eighteen tasks, not
 * six hundred runs. So the cluster is the task, exactly as
 * `docs/PREREGISTRATION.md` specifies for the headline comparisons.
 */
export function clusterBootstrapCI(
  items: RunScore[],
  valueOf: (item: RunScore) => number,
  clusterOf: (item: RunScore) => string = (s) => s.taskId,
  iterations = BOOTSTRAP_ITERATIONS,
  alpha = 0.05,
): Interval {
  const clusters = [...groupBy(items, clusterOf).values()].map((rows) => mean(rows.map(valueOf)));
  const k = clusters.length;
  const observed = mean(items.map(valueOf));
  if (k === 0) return { mean: 0, low: 0, high: 0, n: 0, sd: 0 };
  if (k === 1) return { mean: observed, low: observed, high: observed, n: items.length, sd: 0 };

  const rand = mulberry32(BOOTSTRAP_SEED + k * 7919);
  const means: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < k; j++) sum += clusters[Math.floor(rand() * k)]!;
    means[i] = sum / k;
  }
  means.sort((a, b) => a - b);
  const lowIdx = Math.floor((alpha / 2) * iterations);
  const highIdx = Math.min(iterations - 1, Math.ceil((1 - alpha / 2) * iterations) - 1);
  return { mean: observed, low: means[lowIdx]!, high: means[highIdx]!, n: items.length, sd: stdev(clusters) };
}

/**
 * Paired difference between two conditions, matched within task.
 *
 * Tasks differ enormously in difficulty, and every condition sees every task,
 * so pairing removes that variance instead of letting it swamp the comparison.
 * An interval that excludes zero is what `docs/PREREGISTRATION.md` counts as a
 * resolved difference.
 */
export interface PairedDifference {
  a: string;
  b: string;
  /** Mean of (a - b) across tasks. */
  difference: number;
  low: number;
  high: number;
  /** Tasks where both conditions have at least one run. */
  pairs: number;
  resolved: boolean;
}

export function pairedDifference(
  scores: RunScore[],
  condition: (s: RunScore) => string,
  a: string,
  b: string,
  valueOf: (s: RunScore) => number = (s) => s.normalizedScore,
  iterations = BOOTSTRAP_ITERATIONS,
): PairedDifference {
  const perTask = new Map<string, { a: number[]; b: number[] }>();
  for (const score of scores) {
    const side = condition(score);
    if (side !== a && side !== b) continue;
    const bucket = perTask.get(score.taskId) ?? { a: [], b: [] };
    (side === a ? bucket.a : bucket.b).push(valueOf(score));
    perTask.set(score.taskId, bucket);
  }

  const deltas: number[] = [];
  for (const { a: left, b: right } of perTask.values()) {
    if (left.length === 0 || right.length === 0) continue;
    deltas.push(mean(left) - mean(right));
  }

  const interval = bootstrapCI(deltas, iterations);
  return {
    a,
    b,
    difference: interval.mean,
    low: interval.low,
    high: interval.high,
    pairs: deltas.length,
    resolved: deltas.length > 1 && (interval.low > 0 || interval.high < 0),
  };
}

export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}`;
const ci = (i: Interval) => `${pct(i.mean)} [${pct(i.low)}–${pct(i.high)}]`;
const usd = (v: number) => `$${v.toFixed(4)}`;

function table(headers: string[], rows: string[][]): string {
  const sep = headers.map(() => "---");
  return [
    `| ${headers.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

export interface ReportOptions {
  title?: string;
  /** Emit the surface x feedback interaction table. Needs >1 feedback mode. */
  includeInteraction?: boolean;
}

export function buildReport(scores: RunScore[], opts: ReportOptions = {}): string {
  if (scores.length === 0) return "# No runs\n\nNothing to report.";

  const surfaces = [...new Set(scores.map((s) => s.surfaceId))].sort();
  const feedbacks = [...new Set(scores.map((s) => s.feedbackMode))];
  const models = [...new Set(scores.map((s) => s.model))].sort();
  const families = [...new Set(scores.map((s) => s.taskFamily))].sort();

  const out: string[] = [];
  out.push(`# ${opts.title ?? "Surface comparison"}`);
  out.push("");
  out.push(
    `${scores.length} runs — ${surfaces.length} surface(s), ${feedbacks.length} feedback condition(s), ` +
      `${models.length} model(s), ${new Set(scores.map((s) => s.taskId)).size} task(s).`,
  );
  const runners = [...new Set(scores.map((s) => s.runner))];
  if (runners.length > 1) {
    out.push("");
    out.push(
      `**Mixed harnesses: ${runners.join(" and ")}.** Runs from different loops are not directly comparable — ` +
        `split them before reading any difference as a model effect.`,
    );
  } else {
    out.push("");
    out.push(`Harness: \`${runners[0]}\` loop.`);
  }
  out.push("");
  out.push(
    "Scores are percentages with a bootstrapped 95% interval. Overlapping intervals mean the " +
      "difference is not resolved at this sample size.",
  );
  out.push("");
  out.push(
    "**Improvement** is the headline metric: the share of available constraint headroom a run closed, " +
      "where 0% is leaving the document exactly as it was found and 100% is satisfying every check. " +
      "Raw scores start around " +
      `${pct(mean(scores.map((s) => s.baselineScore)))}% on these tasks, so improvement resolves differences ` +
      "that the raw scale flattens. A negative value means the run made the document worse.",
  );
  out.push("");

  // --- headline: by surface ---
  out.push("## By tool surface");
  out.push("");
  out.push(
    table(
      ["Surface", "Improvement", "Composite", "Constraints", "Judge", "Turns", "Tool calls", "Failed calls", "Cost/run", "n"],
      surfaces.map((surface) => {
        const rows = scores.filter((s) => s.surfaceId === surface);
        const judged = rows.filter((s) => s.judgeCriteriaScore !== null);
        return [
          surface,
          ci(clusterBootstrapCI(rows, (s) => s.normalizedScore)),
          ci(clusterBootstrapCI(rows, (s) => s.composite)),
          ci(clusterBootstrapCI(rows, (s) => s.constraintScore)),
          judged.length ? ci(clusterBootstrapCI(judged, (s) => s.judgeCriteriaScore!)) : "—",
          mean(rows.map((s) => s.efficiency.turns)).toFixed(1),
          mean(rows.map((s) => s.efficiency.toolCalls)).toFixed(1),
          `${pct(mean(rows.map((s) => s.efficiency.failureRate)))}%`,
          usd(mean(rows.map((s) => s.efficiency.costUsd))),
          String(rows.length),
        ];
      }),
    ),
  );
  out.push("");
  const unpriced = [...new Set(scores.filter((s) => !s.efficiency.pricingKnown).map((s) => s.model))];
  if (unpriced.length > 0) {
    out.push(
      `> Cost is unknown for ${unpriced.join(", ")} — no pricing entry, so those runs are costed at zero ` +
        `and every cost figure that includes them understates the true spend. Add them to PRICING in ` +
        `\`src/agent/providers.ts\`.`,
    );
    out.push("");
  }
  out.push("### Cost of a point");
  out.push("");
  out.push(
    "Improvement per dollar. A surface that wins on quality while costing several times as much has not " +
      "obviously won, and this is where document-as-code's few-turns-many-tokens profile shows up.",
  );
  out.push("");
  out.push(
    table(
      ["Surface", "Improvement", "Cost/run", "Improvement per $", "Tokens/run"],
      surfaces.map((surface) => {
        const rows = scores.filter((s) => s.surfaceId === surface);
        const improvement = mean(rows.map((s) => s.normalizedScore));
        const cost = mean(rows.map((s) => s.efficiency.costUsd));
        return [
          surface,
          `${pct(improvement)}`,
          usd(cost),
          cost > 0 ? pct(improvement / cost) : "—",
          Math.round(mean(rows.map((s) => s.efficiency.totalTokens))).toLocaleString("en-US"),
        ];
      }),
    ),
  );
  out.push("");

  // --- feedback ---
  if (feedbacks.length > 1) {
    out.push("## By feedback condition");
    out.push("");
    out.push(
      table(
        ["Feedback", "Improvement", "Composite", "Constraints", "Judge", "Turns", "Cost/run", "n"],
        feedbacks.map((feedback) => {
          const rows = scores.filter((s) => s.feedbackMode === feedback);
          const judged = rows.filter((s) => s.judgeCriteriaScore !== null);
          return [
            feedbackLabel(feedback as FeedbackMode),
            ci(clusterBootstrapCI(rows, (s) => s.normalizedScore)),
            ci(clusterBootstrapCI(rows, (s) => s.composite)),
            ci(clusterBootstrapCI(rows, (s) => s.constraintScore)),
            judged.length ? ci(clusterBootstrapCI(judged, (s) => s.judgeCriteriaScore!)) : "—",
            mean(rows.map((s) => s.efficiency.turns)).toFixed(1),
            usd(mean(rows.map((s) => s.efficiency.costUsd))),
            String(rows.length),
          ];
        }),
      ),
    );
    out.push("");
  }

  // --- the interaction, which is the question that actually matters ---
  if (opts.includeInteraction !== false && feedbacks.length > 1 && surfaces.length > 1) {
    out.push("## Surface x feedback");
    out.push("");
    out.push(
      "Improvement. If the spread down a column exceeds the spread across a row, feedback matters more " +
        "than the tool surface — which is the interaction this study exists to measure.",
    );
    out.push("");
    out.push(
      table(
        ["Feedback", ...surfaces],
        feedbacks.map((feedback) => [
          feedbackLabel(feedback as FeedbackMode),
          ...surfaces.map((surface) => {
            const rows = scores.filter((s) => s.feedbackMode === feedback && s.surfaceId === surface);
            return rows.length ? ci(clusterBootstrapCI(rows, (r) => r.normalizedScore)) : "—";
          }),
        ]),
      ),
    );
    out.push("");
    out.push(spreadComparison(scores, surfaces, feedbacks));
    out.push("");
    out.push(pairedSection(scores, surfaces, feedbacks));
    out.push("");
  }

  // --- by family ---
  if (families.length > 1) {
    out.push("## By task family");
    out.push("");
    out.push("Improvement. The `fit` and `arrange` families are where relational operations should help most.");
    out.push("");
    out.push(
      table(
        ["Family", ...surfaces],
        families.map((family) => [
          family,
          ...surfaces.map((surface) => {
            const rows = scores.filter((s) => s.taskFamily === family && s.surfaceId === surface);
            return rows.length ? ci(clusterBootstrapCI(rows, (r) => r.normalizedScore)) : "—";
          }),
        ]),
      ),
    );
    out.push("");
  }

  // --- by model ---
  if (models.length > 1) {
    out.push("## By model");
    out.push("");
    out.push(
      table(
        ["Model", ...surfaces, "Cost/run"],
        models.map((model) => [
          model,
          ...surfaces.map((surface) => {
            const rows = scores.filter((s) => s.model === model && s.surfaceId === surface);
            return rows.length ? ci(clusterBootstrapCI(rows, (r) => r.normalizedScore)) : "—";
          }),
          usd(mean(scores.filter((s) => s.model === model).map((s) => s.efficiency.costUsd))),
        ]),
      ),
    );
    out.push("");
  }

  // --- what agents reached for ---
  const toolRows = toolUsageRows(scores);
  if (toolRows.length > 0) {
    out.push("## Tool use");
    out.push("");
    out.push("Calls per run, and how often each call was rejected.");
    out.push("");
    out.push(table(["Surface", "Tool", "Calls/run", "Rejected"], toolRows));
    out.push("");
  }

  // --- how runs ended ---
  out.push("## How runs ended");
  out.push("");
  const stopReasons = [...new Set(scores.map((s) => s.stopReason))].sort();
  out.push(
    table(
      ["Surface", ...stopReasons],
      surfaces.map((surface) => {
        const rows = scores.filter((s) => s.surfaceId === surface);
        return [
          surface,
          ...stopReasons.map((reason) => {
            const n = rows.filter((r) => r.stopReason === reason).length;
            return n ? `${n} (${pct(n / rows.length)}%)` : "—";
          }),
        ];
      }),
    ),
  );
  out.push("");

  return out.join("\n");
}

/**
 * Every pairwise comparison, paired within task. This is the pre-registered
 * decision rule made visible: an interval that excludes zero is a resolved
 * difference, anything else is not, however suggestive the means look.
 */
function pairedSection(scores: RunScore[], surfaces: string[], feedbacks: string[]): string {
  const rows: string[][] = [];

  const add = (label: string, diff: ReturnType<typeof pairedDifference>) => {
    rows.push([
      label,
      `${diff.a} vs ${diff.b}`,
      `${diff.difference >= 0 ? "+" : ""}${pct(diff.difference)}`,
      `[${pct(diff.low)}–${pct(diff.high)}]`,
      String(diff.pairs),
      diff.resolved ? "resolved" : "not resolved",
    ]);
  };

  for (let i = 0; i < surfaces.length; i++) {
    for (let j = i + 1; j < surfaces.length; j++) {
      add("surface", pairedDifference(scores, (s) => s.surfaceId, surfaces[i]!, surfaces[j]!));
    }
  }
  for (let i = 0; i < feedbacks.length; i++) {
    for (let j = i + 1; j < feedbacks.length; j++) {
      add("feedback", pairedDifference(scores, (s) => s.feedbackMode, feedbacks[i]!, feedbacks[j]!));
    }
  }

  return [
    "### Paired differences",
    "",
    "Matched within task, since every condition sees every task and tasks differ wildly in difficulty.",
    "A difference is resolved only when its interval excludes zero.",
    "",
    table(["Axis", "Comparison", "Difference", "95% interval", "Tasks", "Verdict"], rows),
  ].join("\n");
}

/**
 * The headline comparison in one line: does changing the feedback move the
 * score more than changing the tool surface?
 */
function spreadComparison(scores: RunScore[], surfaces: string[], feedbacks: string[]): string {
  const surfaceMeans = surfaces.map((s) => mean(scores.filter((r) => r.surfaceId === s).map((r) => r.normalizedScore)));
  const feedbackMeans = feedbacks.map((f) => mean(scores.filter((r) => r.feedbackMode === f).map((r) => r.normalizedScore)));
  const surfaceSpread = Math.max(...surfaceMeans) - Math.min(...surfaceMeans);
  const feedbackSpread = Math.max(...feedbackMeans) - Math.min(...feedbackMeans);
  const verdict =
    Math.abs(surfaceSpread - feedbackSpread) < 0.02
      ? "The two effects are comparable at this sample size."
      : feedbackSpread > surfaceSpread
        ? "Feedback moves the score more than the tool surface does."
        : "The tool surface moves the score more than feedback does.";
  return `Spread across surfaces: ${pct(surfaceSpread)} points. Spread across feedback conditions: ${pct(feedbackSpread)} points. ${verdict}`;
}

function toolUsageRows(scores: RunScore[]): string[][] {
  const rows: string[][] = [];
  for (const [surface, group] of groupBy(scores, (s) => s.surfaceId)) {
    const totals = new Map<string, { ok: number; failed: number }>();
    for (const score of group) {
      for (const [tool, counts] of Object.entries(score.toolUsage)) {
        const acc = totals.get(tool) ?? { ok: 0, failed: 0 };
        acc.ok += counts.ok;
        acc.failed += counts.failed;
        totals.set(tool, acc);
      }
    }
    const sorted = [...totals.entries()].sort((a, b) => b[1].ok + b[1].failed - (a[1].ok + a[1].failed));
    for (const [tool, counts] of sorted) {
      const calls = counts.ok + counts.failed;
      rows.push([
        surface,
        tool,
        (calls / group.length).toFixed(2),
        calls ? `${pct(counts.failed / calls)}%` : "—",
      ]);
    }
  }
  return rows;
}

/** Machine-readable aggregates, for plotting outside this repo. */
export function buildReportJson(scores: RunScore[]): unknown {
  const dimensions = {
    surface: (s: RunScore) => s.surfaceId,
    feedback: (s: RunScore) => s.feedbackMode,
    model: (s: RunScore) => s.model,
    family: (s: RunScore) => s.taskFamily,
    task: (s: RunScore) => s.taskId,
    surfaceByFeedback: (s: RunScore) => `${s.surfaceId}|${s.feedbackMode}`,
    surfaceByFamily: (s: RunScore) => `${s.surfaceId}|${s.taskFamily}`,
    surfaceByModel: (s: RunScore) => `${s.surfaceId}|${s.model}`,
  };

  const aggregates: Record<string, Record<string, unknown>> = {};
  for (const [name, key] of Object.entries(dimensions)) {
    const byKey: Record<string, unknown> = {};
    for (const [group, rows] of groupBy(scores, key)) {
      const judged = rows.filter((r) => r.judgeCriteriaScore !== null);
      byKey[group] = {
        n: rows.length,
        improvement: clusterBootstrapCI(rows, (r) => r.normalizedScore),
        baseline: mean(rows.map((r) => r.baselineScore)),
        composite: clusterBootstrapCI(rows, (r) => r.composite),
        constraint: clusterBootstrapCI(rows, (r) => r.constraintScore),
        judge: judged.length ? clusterBootstrapCI(judged, (r) => r.judgeCriteriaScore!) : null,
        turns: mean(rows.map((r) => r.efficiency.turns)),
        toolCalls: mean(rows.map((r) => r.efficiency.toolCalls)),
        failureRate: mean(rows.map((r) => r.efficiency.failureRate)),
        costUsd: mean(rows.map((r) => r.efficiency.costUsd)),
        totalTokens: mean(rows.map((r) => r.efficiency.totalTokens)),
      };
    }
    aggregates[name] = byKey;
  }

  return {
    generatedAt: new Date().toISOString(),
    runs: scores.length,
    bootstrap: { iterations: BOOTSTRAP_ITERATIONS, seed: BOOTSTRAP_SEED },
    aggregates,
  };
}
