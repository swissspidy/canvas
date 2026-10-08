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

import { passedWithin, type RunScore } from "../eval/score.js";
import { PASS_THRESHOLD } from "../eval/checks.js";
import { isHarnessFailure } from "../agent/events.js";
import { feedbackLabel, type FeedbackMode } from "../feedback/index.js";

export const BOOTSTRAP_ITERATIONS = 2000;
export const BOOTSTRAP_SEED = 20260916;

/** Deterministic PRNG so reports are reproducible. */
export function mulberry32(seed: number): () => number {
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
export function bootstrapCI(
  values: number[],
  iterations = BOOTSTRAP_ITERATIONS,
  alpha = 0.05,
  seed = BOOTSTRAP_SEED,
): Interval {
  const n = values.length;
  const m = mean(values);
  if (n === 0) return { mean: 0, low: 0, high: 0, n: 0, sd: 0 };
  if (n === 1) return { mean: m, low: m, high: m, n, sd: 0 };

  const rand = mulberry32(seed + n);
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
export function clusterBootstrapCI<T extends { taskId: string }>(
  items: T[],
  valueOf: (item: T) => number,
  clusterOf: (item: T) => string = (s) => s.taskId,
  iterations = BOOTSTRAP_ITERATIONS,
  alpha = 0.05,
  seed = BOOTSTRAP_SEED,
): Interval {
  const clusters = [...groupBy(items, clusterOf).values()].map((rows) => mean(rows.map(valueOf)));
  const k = clusters.length;
  const observed = mean(items.map(valueOf));
  if (k === 0) return { mean: 0, low: 0, high: 0, n: 0, sd: 0 };
  if (k === 1) return { mean: observed, low: observed, high: observed, n: items.length, sd: 0 };

  const rand = mulberry32(seed + k * 7919);
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
 * Exact two-sided sign-flip test over per-task deltas.
 *
 * The percentile bootstrap does not hold its nominal rate over a handful of
 * clusters. At two deltas its interval is bounded by the two observations
 * themselves, so it excludes zero whenever both happen to share a sign — which
 * is half the time under the null, not one time in twenty. `src/runner/power.ts`
 * measures it: 52.8% false positives at two tasks, 22.5% at three, 16.0% at
 * five, against 4.8% at the pooled twenty-three.
 *
 * That matters because `docs/PREREGISTRATION.md` §4 breaks the grid down by
 * family and by the two rotation tasks as *confirmatory* comparisons, and those
 * run on two to seven tasks.
 *
 * Under the null the two conditions are exchangeable within a task, so each
 * delta is as likely to have come out negative as positive. Enumerating every
 * assignment of signs gives the exact null distribution of the mean — no
 * asymptotics, no resampling, correct at every cluster count including two.
 *
 * The honesty this buys is `floorP`. With `k` deltas there are `2^k`
 * assignments and the observed one always ties with its own mirror, so no
 * arrangement of the data can produce a two-sided p below `2 / 2^k`. At two
 * tasks that floor is 0.5 and at five it is 0.0625: **those breakdowns cannot
 * return a significant result at all**, whatever the data does. A bootstrap
 * hides that behind an interval that looks like any other; this states it.
 * Six tasks is the smallest breakdown that can clear 0.05.
 */
export interface SignFlipResult {
  /** Two-sided p for the mean delta. */
  p: number;
  /** The smallest two-sided p this many pairs can produce, whatever the data. */
  floorP: number;
  /** True when every sign assignment was enumerated rather than sampled. */
  exact: boolean;
}

/** Beyond this many deltas, 2^k assignments stop being worth enumerating. */
export const SIGN_FLIP_EXHAUSTIVE_LIMIT = 12;

export function signFlipTest(deltas: number[], iterations = BOOTSTRAP_ITERATIONS, seed = BOOTSTRAP_SEED): SignFlipResult {
  const k = deltas.length;
  if (k === 0) return { p: 1, floorP: 1, exact: true };

  const floorP = Math.min(1, 2 / 2 ** k);
  const observed = Math.abs(deltas.reduce((sum, d) => sum + d, 0));

  if (k <= SIGN_FLIP_EXHAUSTIVE_LIMIT) {
    let atLeastAsExtreme = 0;
    // Bit `i` of `mask` flips the sign of delta `i`.
    for (let mask = 0; mask < 1 << k; mask++) {
      let sum = 0;
      for (let i = 0; i < k; i++) sum += (mask & (1 << i)) === 0 ? deltas[i]! : -deltas[i]!;
      // `>=` with a tolerance: the observed assignment and its mirror must both
      // count, and floating-point addition in a different order will not always
      // reproduce the observed sum to the last bit.
      if (Math.abs(sum) >= observed - 1e-9) atLeastAsExtreme++;
    }
    return { p: atLeastAsExtreme / 2 ** k, floorP, exact: true };
  }

  const rand = mulberry32(seed + k * 31);
  let atLeastAsExtreme = 0;
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < k; j++) sum += rand() < 0.5 ? deltas[j]! : -deltas[j]!;
    if (Math.abs(sum) >= observed - 1e-9) atLeastAsExtreme++;
  }
  // The +1s keep a sampled p away from zero: no finite sample proves p = 0.
  return { p: (atLeastAsExtreme + 1) / (iterations + 1), floorP, exact: false };
}

/**
 * Paired difference between two conditions, matched within task.
 *
 * Tasks differ enormously in difficulty, and every condition sees every task,
 * so pairing removes that variance instead of letting it swamp the comparison.
 * An interval that excludes zero is what `docs/PREREGISTRATION.md` counts as a
 * resolved difference.
 */
/**
 * How a paired difference decides whether it is resolved.
 *
 * `bootstrap` is the pre-registered rule and stays the default, so every
 * existing report keeps its numbers. `permutation` is for the breakdowns the
 * bootstrap cannot serve — see `signFlipTest`.
 */
export type ResolutionMethod = "bootstrap" | "permutation";

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
  method: ResolutionMethod;
  /**
   * Two-sided sign-flip p.
   *
   * Only computed when that is the rule being applied — enumerating or
   * sampling sign assignments is real work, and a bootstrap comparison has no
   * use for the number.
   */
  pValue?: number;
  /**
   * The smallest two-sided p this many pairs could produce.
   *
   * Above 0.05 the comparison cannot return a resolved result whatever the
   * data shows, and a report that does not say so is hiding the reason.
   */
  floorP: number;
}

export function pairedDifference(
  scores: RunScore[],
  condition: (s: RunScore) => string,
  a: string,
  b: string,
  valueOf: (s: RunScore) => number = (s) => s.normalizedScore,
  iterations = BOOTSTRAP_ITERATIONS,
  seed = BOOTSTRAP_SEED,
  method: ResolutionMethod = "bootstrap",
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

  const interval = bootstrapCI(deltas, iterations, 0.05, seed);
  // The sign-flip test is only run when it is the rule being applied.
  // The interval is reported either way, because it describes the *size* of
  // the difference, which a p-value does not.
  const signFlip = method === "permutation" ? signFlipTest(deltas, iterations, seed) : undefined;
  const resolved = signFlip
    ? signFlip.p <= 0.05
    : deltas.length > 1 && (interval.low > 0 || interval.high < 0);

  return {
    a,
    b,
    difference: interval.mean,
    low: interval.low,
    high: interval.high,
    pairs: deltas.length,
    resolved,
    method,
    ...(signFlip ? { pValue: signFlip.p } : {}),
    // Free to compute and meaningful under either rule: it is a property of how
    // many pairs there are, not of the test that was run on them.
    floorP: deltas.length === 0 ? 1 : Math.min(1, 2 / 2 ** deltas.length),
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

export function buildReport(allScores: RunScore[], opts: ReportOptions = {}): string {
  if (allScores.length === 0) return "# No runs\n\nNothing to report.";

  // Harness failures are held out of every aggregate below, and only of those.
  // The stop-reason table at the end still reads from `allScores`, because how
  // many cells a surface lost to something outside the run is worth seeing
  // even though it is not a score.
  const scores = allScores.filter((s) => !isHarnessFailure(s.stopReason));
  const lost = allScores.length - scores.length;

  if (scores.length === 0) {
    return [
      `# ${opts.title ?? "Surface comparison"}`,
      "",
      `All ${allScores.length} run(s) here were ended by the harness rather than finished by the model — an`,
      "API error, or an abort. There is nothing to aggregate: whatever these runs reached before they were",
      "cut off measures where that happened, not how the surfaces compare.",
      "",
      `Reasons: ${
        [...new Set(allScores.map((s) => s.error?.replace(/\s*\.\s*$/, "")).filter(Boolean))]
          .slice(0, 3)
          .join("; ") || "unrecorded"
      }.`,
      "",
      "Fix the cause and run the same command again — those cells are not cached as done, so they re-run.",
      "",
    ].join("\n");
  }

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
  out.push("");
  if (lost > 0) {
    out.push(
      `> ${lost} further run(s) were cut off by the harness — an API error or an abort — and are left out of ` +
        `every table below except **How runs ended**. Such a run is excluded for being incomplete, not for ` +
        `having achieved nothing: it may have done real work before it was cut off, and that is the ` +
        `problem — what it scores is *where* it was cut off, which moves a surface's mean in whichever ` +
        `direction the rate limiter happened to push it. They are not cached as done: re-run the same ` +
        `command to fill them in.`,
    );
    out.push("");
  }
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

  if (models.length > 1) {
    out.push(leaderboard(scores, models));
    out.push("");
  }

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
        `and every cost figure that includes them understates the true spend. Add them to MODELS in ` +
        `\`src/agent/models.ts\`.`,
    );
    out.push("");
  }
  const judgeFailures = scores.filter((s) => s.judgeError);
  if (judgeFailures.length > 0) {
    const reasons = [...new Set(judgeFailures.map((s) => s.judgeError!))].slice(0, 3);
    out.push(
      `> The judge was discarded on ${judgeFailures.length} of ${scores.length} runs ` +
        `(${pct(judgeFailures.length / scores.length)}%), which are scored on constraints alone. ` +
        `Reasons: ${reasons.join("; ")}.`,
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

  out.push(costToPassSection(scores, surfaces, feedbacks, families));
  out.push(effectivenessSection(scores, models));

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

    if (feedbacks.length > 1) {
      out.push("## Model x feedback");
      out.push("");
      out.push(
        "Improvement. A model that only pulls ahead once it can see its own work is making a different " +
          "claim from one that is ahead with no feedback at all.",
      );
      out.push("");
      out.push(
        table(
          ["Model", ...feedbacks.map((f) => feedbackLabel(f as FeedbackMode))],
          models.map((model) => [
            model,
            ...feedbacks.map((feedback) => {
              const rows = scores.filter((s) => s.model === model && s.feedbackMode === feedback);
              return rows.length ? ci(clusterBootstrapCI(rows, (r) => r.normalizedScore)) : "—";
            }),
          ]),
        ),
      );
      out.push("");
    }

    out.push(cellRanking(scores));
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

  // --- which constraints separated the surfaces ---
  out.push(checkBreakdown(scores, surfaces));
  out.push("");

  // --- how runs ended ---
  //
  // Over every run, harness failures included. This is the one table where
  // they belong: `max_turns` per surface is a pre-registered outcome
  // (`docs/PREREGISTRATION.md` §5), and a surface losing cells to the
  // harness at a different rate from its neighbours is a fact about the
  // sweep that the aggregates above deliberately cannot show.
  out.push("## How runs ended");
  out.push("");
  out.push(
    "Every run, including the harness failures held out of the tables above. `max_turns` is an outcome — a " +
      "surface that routinely runs out of turns has told us something — while `api_error` and `aborted` are " +
      "the sweep failing, not the agent.",
  );
  out.push("");
  const allSurfaces = [...new Set(allScores.map((s) => s.surfaceId))].sort();
  const stopReasons = [...new Set(allScores.map((s) => s.stopReason))].sort();
  out.push(
    table(
      ["Surface", ...stopReasons, "n"],
      allSurfaces.map((surface) => {
        const rows = allScores.filter((s) => s.surfaceId === surface);
        return [
          surface,
          ...stopReasons.map((reason) => {
            const n = rows.filter((r) => r.stopReason === reason).length;
            return n ? `${n} (${pct(n / rows.length)}%)` : "—";
          }),
          String(rows.length),
        ];
      }),
    ),
  );
  out.push("");

  return out.join("\n");
}

/**
 * The leaderboard: models ranked, with the condition each one did best under.
 *
 * Ranked on improvement rather than the composite, for the same reason the
 * rest of the report leads with it — the raw scale has a high floor and
 * flattens exactly the differences a cross-model sweep is run to find.
 *
 * The "best" and "worst" columns are the point of running the whole grid:
 * a model's headline number is an average over conditions it was never going
 * to be used in, and the spread between its best and worst cell is often
 * larger than the gap between two models' averages. Both are single cells with
 * no interval, so they are a place to look rather than a result.
 */
// --- cost to pass ---------------------------------------------------------------

/**
 * The agent's spend on a run, without the judge's call — what it cost to make
 * the page. Records written before `agentCostUsd` existed ran without a judge,
 * so their `costUsd` is the same number.
 */
export const agentCost = (s: RunScore) => s.efficiency.agentCostUsd ?? s.efficiency.costUsd;

/**
 * What a cell with no passing run divides by: half a pass, so its cost per
 * pass is twice its spend rather than infinite. Fixed in advance
 * (`docs/PREREGISTRATION.md` §13, 2026-10-07 eighth entry) and flagged
 * wherever it applies.
 */
export const ZERO_PASS_DENOMINATOR = 0.5;

/** Practically meaningful: a ratio at least this far from 1 (15% cheaper or dearer). */
export const MEANINGFUL_RATIO = 0.15;

export type PerPassMetric = "cost" | "calls";

const metricOf = (metric: PerPassMetric) => (s: RunScore) => (metric === "cost" ? agentCost(s) : s.efficiency.toolCalls);

/**
 * Spend (or tool calls) per passing run in one cell: everything the cell
 * spent, failed runs included, over the runs that passed — the expected cost
 * of one correct page.
 */
export function perPass(rows: RunScore[], metric: PerPassMetric): { value: number; zeroPass: boolean } {
  const total = rows.reduce((sum, r) => sum + metricOf(metric)(r), 0);
  const passes = rows.filter(passed).length;
  return { value: total / Math.max(passes, ZERO_PASS_DENOMINATOR), zeroPass: passes === 0 };
}

/** The cluster a cost comparison pairs within: a task, on one model. */
const costCluster = (s: RunScore) => `${s.model}|${s.taskId}`;

/** Geometric mean over clusters of per-cluster cost per pass, for one condition. */
export function geometricPerPass(rows: RunScore[], metric: PerPassMetric): { value: number; zeroPassCells: number; cells: number } {
  const cells = [...groupBy(rows, costCluster).values()].map((r) => perPass(r, metric));
  if (cells.length === 0) return { value: NaN, zeroPassCells: 0, cells: 0 };
  const logMean = cells.reduce((sum, c) => sum + Math.log(Math.max(c.value, 1e-9)), 0) / cells.length;
  return { value: Math.exp(logMean), zeroPassCells: cells.filter((c) => c.zeroPass).length, cells: cells.length };
}

export interface RatioComparison {
  a: string;
  b: string;
  /** Geometric-mean ratio a / b over paired clusters; below 1 means a is cheaper. */
  ratio: number;
  ci: [number, number];
  clusters: number;
  resolved: boolean;
  meaningful: boolean;
}

/**
 * A against B on cost (or calls) per pass, paired within task: the log of
 * each task's ratio, averaged, with a percentile interval from resampling
 * tasks. Resolved when the interval excludes a ratio of 1; practically
 * meaningful when the ratio is at least 15% from 1 as well.
 */
export function compareCostToPass(
  scores: RunScore[],
  key: (s: RunScore) => string,
  a: string,
  b: string,
  metric: PerPassMetric,
): RatioComparison {
  const byCluster = groupBy(scores, costCluster);
  const logs: number[] = [];
  for (const rows of byCluster.values()) {
    const ra = rows.filter((r) => key(r) === a);
    const rb = rows.filter((r) => key(r) === b);
    if (!ra.length || !rb.length) continue;
    logs.push(Math.log(Math.max(perPass(ra, metric).value, 1e-9)) - Math.log(Math.max(perPass(rb, metric).value, 1e-9)));
  }
  if (logs.length === 0) return { a, b, ratio: NaN, ci: [NaN, NaN], clusters: 0, resolved: false, meaningful: false };
  const rand = mulberry32(BOOTSTRAP_SEED);
  const means: number[] = [];
  for (let i = 0; i < BOOTSTRAP_ITERATIONS; i++) {
    let sum = 0;
    for (let j = 0; j < logs.length; j++) sum += logs[Math.floor(rand() * logs.length)]!;
    means.push(sum / logs.length);
  }
  means.sort((x, y) => x - y);
  const lo = Math.exp(means[Math.floor(0.025 * BOOTSTRAP_ITERATIONS)]!);
  const hi = Math.exp(means[Math.ceil(0.975 * BOOTSTRAP_ITERATIONS) - 1]!);
  const ratio = Math.exp(mean(logs));
  // One cluster cannot resolve anything, whatever its interval says.
  const resolved = logs.length > 1 && (hi < 1 || lo > 1);
  return { a, b, ratio, ci: [lo, hi], clusters: logs.length, resolved, meaningful: resolved && Math.abs(ratio - 1) >= MEANINGFUL_RATIO };
}

function costToPassSection(scores: RunScore[], surfaces: string[], feedbacks: string[], families: string[]): string {
  const money = (v: number) => (Number.isFinite(v) ? usd(v) : "—");
  const calls = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "—");
  const ratio = (c: RatioComparison) => (Number.isFinite(c.ratio) ? `${c.ratio.toFixed(2)} [${c.ci[0].toFixed(2)}–${c.ci[1].toFixed(2)}]` : "—");
  const verdict = (c: RatioComparison) => (c.meaningful ? "resolved" : c.resolved ? "resolved, under 15%" : "not resolved");
  const zeroNote = (g: { zeroPassCells: number }) => (g.zeroPassCells ? ` (${g.zeroPassCells} with no pass)` : "");
  const conditionTable = (label: string, levels: string[], key: (s: RunScore) => string, name: (l: string) => string) =>
    table(
      [label, "Cost per pass", "Calls per pass", "Pass rate", "Cells"],
      levels.map((l) => {
        const rows = scores.filter((s) => key(s) === l);
        const cost = geometricPerPass(rows, "cost");
        const call = geometricPerPass(rows, "calls");
        return [name(l), money(cost.value), calls(call.value), `${pct(rows.filter(passed).length / rows.length)}%`, `${cost.cells}${zeroNote(cost)}`];
      }),
    );
  const comparisons = (axis: string, levels: string[], key: (s: RunScore) => string, name: (l: string) => string) => {
    const rows: string[][] = [];
    for (let i = 0; i < levels.length; i++) {
      for (let j = i + 1; j < levels.length; j++) {
        const cost = compareCostToPass(scores, key, levels[i]!, levels[j]!, "cost");
        const call = compareCostToPass(scores, key, levels[i]!, levels[j]!, "calls");
        rows.push([axis, `${name(levels[i]!)} vs ${name(levels[j]!)}`, ratio(cost), verdict(cost), ratio(call), verdict(call), String(cost.clusters)]);
      }
    }
    return rows;
  };
  const spread = (levels: string[], key: (s: RunScore) => string) => {
    const values = levels.map((l) => geometricPerPass(scores.filter((s) => key(s) === l), "cost").value).filter(Number.isFinite);
    return values.length > 1 ? Math.max(...values) / Math.min(...values) : 1;
  };

  const lines = [
    "## Cost to pass",
    "",
    "The primary outcome (`docs/PREREGISTRATION.md` §13, eighth entry). **Cost per pass** is what a task cost the agent " +
      "in a condition — every run's spend, failed ones included — over the runs that passed: the expected cost of one " +
      "correct page. **Calls per pass** is the same with tool calls, which no price list moves. Both are taken per task " +
      "and combined across tasks as a geometric mean, so a cheap task and a dear one count alike. A cell with no pass " +
      `divides by ${ZERO_PASS_DENOMINATOR} and is counted. Judge calls are left out.`,
    "",
  ];
  if (surfaces.length > 1) lines.push("### By tool surface", "", conditionTable("Surface", surfaces, (s) => s.surfaceId, (l) => l), "");
  if (feedbacks.length > 1) {
    lines.push("### By feedback condition", "", conditionTable("Feedback", feedbacks, (s) => s.feedbackMode, (l) => feedbackLabel(l as FeedbackMode)), "");
  }
  if (surfaces.length > 1 && feedbacks.length > 1) {
    lines.push(
      "### Surface x feedback",
      "",
      "Cost per pass.",
      "",
      table(
        ["Feedback", ...surfaces],
        feedbacks.map((f) => [
          feedbackLabel(f as FeedbackMode),
          ...surfaces.map((sf) => money(geometricPerPass(scores.filter((s) => s.surfaceId === sf && s.feedbackMode === f), "cost").value)),
        ]),
      ),
      "",
      `Spread of cost per pass across surfaces: ${spread(surfaces, (s) => s.surfaceId).toFixed(2)}x. ` +
        `Across feedback conditions: ${spread(feedbacks, (s) => s.feedbackMode).toFixed(2)}x.`,
      "",
    );
  }
  const pairs = [
    ...(surfaces.length > 1 ? comparisons("surface", surfaces, (s) => s.surfaceId, (l) => l) : []),
    ...(feedbacks.length > 1 ? comparisons("feedback", feedbacks, (s) => s.feedbackMode, (l) => l) : []),
  ];
  if (pairs.length) {
    lines.push(
      "### Paired ratios",
      "",
      "A over B, paired within task: below 1 means A is cheaper. Resolved when the interval excludes 1; " +
        `practically meaningful when it is also at least ${MEANINGFUL_RATIO * 100}% from 1.`,
      "",
      table(["Axis", "Comparison", "Cost ratio", "Verdict", "Calls ratio", "Verdict", "Tasks"], pairs),
      "",
    );
  }
  if (surfaces.length > 1 && families.length > 1) {
    lines.push(
      "### By task family",
      "",
      "Cost per pass.",
      "",
      table(
        ["Family", ...surfaces],
        families.map((fam) => [
          fam,
          ...surfaces.map((sf) => money(geometricPerPass(scores.filter((s) => s.taskFamily === fam && s.surfaceId === sf), "cost").value)),
        ]),
      ),
      "",
    );
  }
  return lines.join("\n");
}

/** A run that satisfied every deterministic check. */
export const passed = (s: RunScore) => s.constraintScore >= PASS_THRESHOLD;

export interface Effectiveness {
  n: number;
  /** Share of runs that satisfied every check. */
  passRate: number;
  improvement: number;
  toolCalls: number;
  rejectedCalls: number;
  turns: number;
  totalTokens: number;
  costUsd: number;
  /** Total spend over the number of passing runs; null when nothing passed. */
  costPerPass: number | null;
  pricingKnown: boolean;
}

/**
 * How much it took a model to get somewhere, beside how often it got there.
 * A model that passes as often as another at a fifth of the cost has done
 * something the pass rate alone cannot show, and cost per pass is the single
 * number that carries both.
 */
export function effectiveness(rows: RunScore[]): Effectiveness {
  const cost = rows.reduce((sum, r) => sum + agentCost(r), 0);
  const passes = rows.filter(passed).length;
  return {
    n: rows.length,
    passRate: rows.length ? passes / rows.length : 0,
    improvement: mean(rows.map((r) => r.normalizedScore)),
    toolCalls: mean(rows.map((r) => r.efficiency.toolCalls)),
    rejectedCalls: mean(rows.map((r) => r.efficiency.failedToolCalls)),
    turns: mean(rows.map((r) => r.efficiency.turns)),
    totalTokens: mean(rows.map((r) => r.efficiency.totalTokens)),
    costUsd: rows.length ? cost / rows.length : 0,
    costPerPass: passes ? cost / passes : null,
    pricingKnown: rows.every((r) => r.efficiency.pricingKnown),
  };
}

/**
 * Pass rates task by task, lowest first: the spread a single pooled pass rate
 * hides. A model that clears four tasks every time and one task never reads
 * as "80%" pooled, which describes no task it was given.
 */
function passRatesByTask(rows: RunScore[]): number[] {
  return [...groupBy(rows, (r) => r.taskId).values()].map((t) => t.filter(passed).length / t.length).sort((x, y) => x - y);
}

function effectivenessSection(scores: RunScore[], models: string[]): string {
  const tasks = [...new Set(scores.map((s) => s.taskId))].sort();
  const lines = [
    "## Effectiveness",
    "",
    "A **pass** is a run that satisfied every check. Pass rates are reported **task by task** — a rate pooled " +
      "across tasks averages pages a model always finishes with pages it never does, and describes neither.",
    "",
    "### Pass rate by task",
    "",
    table(
      ["Task", ...models],
      tasks.map((task) => [
        task,
        ...models.map((model) => {
          const rows = scores.filter((s) => s.model === model && s.taskId === task);
          if (!rows.length) return "—";
          return `${Math.round((rows.filter(passed).length / rows.length) * 100)}% (${rows.filter(passed).length}/${rows.length})`;
        }),
      ]),
    ),
    "",
    "### What it took",
    "",
    "Per model, across its runs: the range of its per-task pass rates, and the cost of getting there. " +
      "**Cost per pass** is total spend over passing runs.",
    "",
    table(
      ["Model", "Runs", "Task pass rates (low · median · high)", "Tool calls/run", "Rejected/run", "Turns/run", "Tokens/run", "Cost/run", "Cost per pass"],
      models.map((model) => {
        const rows = scores.filter((s) => s.model === model);
        const e = effectiveness(rows);
        const rates = passRatesByTask(rows);
        const median = rates.length ? rates[Math.floor((rates.length - 1) / 2)]! : 0;
        const unpriced = e.pricingKnown ? "" : " *";
        return [
          model,
          String(e.n),
          rates.length ? `${Math.round(rates[0]! * 100)}% · ${Math.round(median * 100)}% · ${Math.round(rates.at(-1)! * 100)}%` : "—",
          e.toolCalls.toFixed(1),
          e.rejectedCalls.toFixed(1),
          e.turns.toFixed(1),
          Math.round(e.totalTokens).toLocaleString("en-US"),
          usd(e.costUsd) + unpriced,
          (e.costPerPass === null ? "—" : usd(e.costPerPass)) + unpriced,
        ];
      }),
    ),
  ];
  if (models.some((m) => !effectiveness(scores.filter((s) => s.model === m)).pricingKnown)) {
    lines.push("", "\\* No checked price for this model, so its cost reads as zero.");
  }
  lines.push(budgetSection(scores, models));
  if (tasks.length > 1) {
    lines.push(
      "",
      "### Tool calls and cost by task",
      "",
      table(
        ["Task", ...models],
        tasks.map((task) => [
          task,
          ...models.map((model) => {
            const rows = scores.filter((s) => s.model === model && s.taskId === task);
            if (!rows.length) return "—";
            const e = effectiveness(rows);
            return `${e.toolCalls.toFixed(0)} calls · ${usd(e.costUsd)}`;
          }),
        ]),
      ),
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** The budgets the report reads trajectories at. */
export const CALL_BUDGETS = [10, 20, 30, 50, 75, 100] as const;

/** Pass rate at each budget in `CALL_BUDGETS`, over the runs that carry a trajectory; null when none do. */
export function passRateWithinCalls(rows: RunScore[]): Record<string, number> | null {
  const traced = rows.filter((r) => r.trajectory !== undefined);
  if (traced.length === 0) return null;
  return Object.fromEntries(
    CALL_BUDGETS.map((n) => [String(n), traced.filter((r) => passedWithin(r, n)).length / traced.length]),
  );
}

/** The middle value, or null for none. */
function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Pass rate at a call budget, read off each run's trajectory.
 *
 * Where a pass rate at the end of the run saturates, the same runs stopped
 * earlier do not: two conditions that both finish at 100% can sit at 20% and
 * 70% after thirty calls. Exploratory under §11 of the pre-registration, and
 * pooled across conditions here like every other table in this section.
 */
function budgetSection(scores: RunScore[], models: string[]): string {
  const traced = scores.filter((s) => s.trajectory !== undefined);
  if (traced.length === 0) return "";
  const tasks = [...new Set(traced.map((s) => s.taskId))].sort();
  const rate = (rows: RunScore[], calls: number) =>
    `${Math.round((rows.filter((r) => passedWithin(r, calls)).length / rows.length) * 100)}%`;
  const firstPass = (rows: RunScore[]) => {
    const m = medianOf(rows.flatMap((r) => (r.firstPassCall == null ? [] : [r.firstPassCall])));
    return m === null ? "—" : String(Math.round(m));
  };
  const lines = [
    "",
    "### Pass within a call budget",
    "",
    "Whether each run would have passed had it been stopped after N tool calls — the document as it stood " +
      "then, read off the score recorded after every call. A run that finished sooner stands as it finished. " +
      "**First pass** is the median call at which a run first passed, over the runs that did.",
    "",
    table(
      ["Model", "Runs", ...CALL_BUDGETS.map((n) => `≤${n}`), "At end", "First pass"],
      models.flatMap((model) => {
        const rows = traced.filter((s) => s.model === model);
        if (!rows.length) return [];
        return [[model, String(rows.length), ...CALL_BUDGETS.map((n) => rate(rows, n)), rate(rows, Infinity), firstPass(rows)]];
      }),
    ),
  ];
  if (tasks.length > 1) {
    lines.push(
      "",
      "Median call of first pass, by task:",
      "",
      table(
        ["Task", ...models],
        tasks.map((task) => [
          task,
          ...models.map((model) => {
            const rows = traced.filter((s) => s.model === model && s.taskId === task);
            return rows.length ? `${firstPass(rows)} (${rows.filter((r) => r.firstPassCall != null).length}/${rows.length})` : "—";
          }),
        ]),
      ),
    );
  }
  if (traced.length < scores.length) {
    lines.push("", `${scores.length - traced.length} run(s) predate per-call scoring and are left out of this table.`);
  }
  return lines.join("\n");
}

function leaderboard(scores: RunScore[], models: string[]): string {
  const grid = commonGrid(scores, models);
  const aligned = scores.filter((s) => grid.has(gridKey(s)));
  const excluded = scores.length - aligned.length;

  if (aligned.length === 0) {
    return [
      "## Leaderboard",
      "",
      "No task, surface and feedback combination has a run from every model here, so there is no",
      "like-for-like comparison to rank. Finish the sweep, or report the models separately.",
    ].join("\n");
  }

  const ranked = models
    .map((model) => {
      const rows = aligned.filter((s) => s.model === model);
      const cells = [...groupBy(rows, cellKey).entries()]
        .map(([key, group]) => ({ key, value: mean(group.map((r) => r.normalizedScore)) }))
        .sort((a, b) => b.value - a.value);
      return {
        model,
        rows,
        interval: clusterBootstrapCI(perCellMeans(rows), (c) => c.value),
        cost: mean(rows.map((r) => r.efficiency.costUsd)),
        priced: rows.every((r) => r.efficiency.pricingKnown),
        best: cells[0],
        worst: cells[cells.length - 1],
      };
    })
    .sort((a, b) => b.interval.mean - a.interval.mean);

  const body = table(
    ["#", "Model", "Improvement", "Best cell", "Worst cell", "Cost/run", "Improvement per $", "n"],
    ranked.map((row, i) => [
      String(i + 1),
      row.model,
      ci(row.interval),
      row.best ? `${row.best.key} (${pct(row.best.value)})` : "—",
      row.worst && row.worst !== row.best ? `${row.worst.key} (${pct(row.worst.value)})` : "—",
      row.priced ? usd(row.cost) : "unknown",
      row.priced && row.cost > 0 ? pct(row.interval.mean / row.cost) : "—",
      String(row.rows.length),
    ]),
  );

  const out = [
    "## Leaderboard",
    "",
    "Models ranked by improvement, averaged over every surface and feedback condition in this sweep.",
    "A cell is `surface/feedback`. Overlapping intervals mean the order between two rows is not resolved.",
    "",
    body,
  ];
  if (excluded > 0) {
    out.push("");
    out.push(
      `> Ranked on the ${grid.size} task x surface x feedback combination(s) every model has runs for. ` +
        `${excluded} run(s) outside that common grid are left out, because a model scored on an easier ` +
        `subset of the tasks is not comparable with one scored on all of them. Finish the sweep to ` +
        `bring them in.`,
    );
  }
  return out.join("\n");
}

/** The condition a run was made under, with the task left out. */
const cellKey = (s: RunScore) => `${s.surfaceId}/${s.feedbackMode}`;

/** A run's place in the full grid: one condition, on one task. */
const gridKey = (s: RunScore) => `${s.taskId}|${s.surfaceId}|${s.feedbackMode}`;

/**
 * The grid cells every model has at least one run for.
 *
 * A sweep does not have to be square. Run ids encode the cell, so an
 * interrupted sweep resumes and a widened one runs only what is new — both
 * deliberate, and both able to leave one model scored on eighteen tasks and
 * another on five. Tasks differ enormously in difficulty, which is the whole
 * reason `pairedDifference` exists, so ranking those two means against each
 * other compares the task sets rather than the models. Restricting to the
 * intersection makes the leaderboard like-for-like whatever state the sweep is
 * in; on a complete one it is every cell and changes nothing.
 */
function commonGrid(scores: RunScore[], models: string[]): Set<string> {
  const perModel = models.map(
    (model) => new Set<string>(scores.filter((s) => s.model === model).map(gridKey)),
  );
  const [first, ...rest] = perModel;
  const common = new Set<string>();
  for (const key of first ?? []) {
    if (rest.every((keys) => keys.has(key))) common.add(key);
  }
  return common;
}

/**
 * One observation per grid cell, so repeats do not reweight a task's mean.
 *
 * `clusterBootstrapCI` averages every row inside a task before resampling. Fed
 * raw runs, a cell that happens to carry three repeats counts three times
 * against one that carries a single run — and after an interrupted sweep two
 * models can carry that imbalance in different places, which is the same
 * comparison problem one level down.
 */
function perCellMeans(rows: RunScore[]): { taskId: string; value: number }[] {
  return [...groupBy(rows, gridKey).values()].map((group) => ({
    taskId: group[0]!.taskId,
    value: mean(group.map((r) => r.normalizedScore)),
  }));
}

/**
 * Every (model, surface, feedback) cell, ranked.
 *
 * The grid itself, for reading down rather than across. Deliberately means
 * without intervals: one cell of a full sweep is a handful of runs over the
 * task set, and dressing that up with a bootstrap would imply a precision the
 * cell does not have. The tables above are where a difference gets resolved;
 * this is where you find the combination worth looking at.
 */
function cellRanking(scores: RunScore[]): string {
  const rows = [...groupBy(scores, (s) => `${s.model}|${cellKey(s)}`).entries()]
    .map(([key, group]) => {
      const [model, cell] = key.split("|") as [string, string];
      return {
        model,
        cell,
        improvement: mean(group.map((r) => r.normalizedScore)),
        composite: mean(group.map((r) => r.composite)),
        turns: mean(group.map((r) => r.efficiency.turns)),
        cost: mean(group.map((r) => r.efficiency.costUsd)),
        priced: group.every((r) => r.efficiency.pricingKnown),
        n: group.length,
      };
    })
    .sort((a, b) => b.improvement - a.improvement);

  return [
    "## Every cell",
    "",
    `All ${rows.length} model x surface x feedback combinations in this sweep, best first. Means only — see`,
    "the tables above for what is resolved.",
    "",
    table(
      ["#", "Model", "Cell", "Improvement", "Composite", "Turns", "Cost/run", "n"],
      rows.map((r, i) => [
        String(i + 1),
        r.model,
        r.cell,
        pct(r.improvement),
        pct(r.composite),
        r.turns.toFixed(1),
        r.priced ? usd(r.cost) : "unknown",
        String(r.n),
      ]),
    ),
  ].join("\n");
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

/**
 * Which deterministic constraint each surface actually failed.
 *
 * The check results were being computed for every run, stored on every score,
 * written to `scores.jsonl` — and never read. So the cheapest, most
 * deterministic answer to *why* a surface won was missing from the report, and
 * `docs/PREREGISTRATION.md` §11 sent that question to reading transcripts
 * instead. A transcript tells you what an agent said it was doing; this tells
 * you what it left on the page.
 *
 * Sorted by the **spread** across surfaces rather than by how often the check
 * fails, because a check every surface fails equally is a hard task and a
 * check one surface fails alone is the finding. A check that every surface
 * satisfies is left out entirely: it is measuring a defect nobody introduced,
 * which is what a baseline is for.
 *
 * Pooled across tasks, which is the compromise this table makes. A check id
 * means the same *kind* of question everywhere (`margin` is always a margin)
 * but not the same threshold — `marginAtLeast(24)` and `marginAtLeast(64)` are
 * one row here. It is a place to look, not a result; the per-task numbers are
 * in `scores.jsonl` for anyone who wants to cut it finer.
 *
 * This is exploratory by construction and §11 says so: it is a breakdown over
 * checks that were never pre-registered one by one, so it explains a result
 * rather than establishing one.
 */
function checkBreakdown(scores: RunScore[], surfaces: string[]): string {
  const ids = [...new Set(scores.flatMap((s) => s.checkResults.map((r) => r.id)))];

  // `spread: null` is "not comparable", which is not the same fact as "the
  // surfaces agreed" and must not render the same way. Both were printing as a
  // dash, so a check the surfaces scored identically and a check one surface
  // never met were indistinguishable in the one column the table is sorted by.
  const rows: { id: string; label: string; overall: number; bySurface: (number | null)[]; spread: number | null }[] = [];
  for (const id of ids) {
    const all = scores.flatMap((s) => s.checkResults.filter((r) => r.id === id));
    if (all.length === 0) continue;
    const bySurface = surfaces.map((surface) => {
      const rowsFor = scores
        .filter((s) => s.surfaceId === surface)
        .flatMap((s) => s.checkResults.filter((r) => r.id === id));
      return rowsFor.length ? mean(rowsFor.map((r) => r.score)) : null;
    });
    const present = bySurface.filter((v): v is number => v !== null);
    rows.push({
      id,
      label: all[0]!.label,
      overall: mean(all.map((r) => r.score)),
      bySurface,
      // Only comparable when every surface met the check; a check one surface
      // never saw would otherwise report a spread that is really an absence.
      spread: present.length === surfaces.length ? Math.max(...present) - Math.min(...present) : null,
    });
  }

  // A check nothing ever fails is a check that is not doing any work in this
  // grid, and a table of them buries the ones that are.
  const interesting = rows
    .filter((r) => r.overall < 0.999)
    // An incomparable spread sorts last rather than as a zero: it is the row
    // with the least to say about the surfaces, not the row where they agreed.
    .sort((a, b) => (b.spread ?? -1) - (a.spread ?? -1) || a.overall - b.overall);
  if (interesting.length === 0) {
    return ["## Which constraints separated the surfaces", "", "Every check passed in every run.", ""].join("\n");
  }

  const out: string[] = [];
  out.push("## Which constraints separated the surfaces");
  out.push("");
  out.push(
    "Mean score per check, pooled across tasks, for every check that something failed. Sorted by the " +
      "spread between surfaces: the top of this table is where the surfaces actually differ, and a check " +
      "every surface fails equally is a hard task rather than a finding. Exploratory — these are not " +
      "pre-registered comparisons.",
  );
  out.push("");
  out.push(
    table(
      ["Check", "What it measures", "All", ...surfaces, "Spread"],
      interesting.map((r) => [
        r.id,
        r.label,
        `${pct(r.overall)}%`,
        ...r.bySurface.map((v) => (v === null ? "—" : `${pct(v)}%`)),
        r.spread === null ? "—" : `${pct(r.spread)}pt`,
      ]),
    ),
  );
  return out.join("\n");
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
export function buildReportJson(allScores: RunScore[]): unknown {
  // Same rule as the markdown report: a run whose request never came back is
  // not an observation. Counted rather than dropped silently, so a plot built
  // from this file can show the attrition instead of inheriting it.
  const scores = allScores.filter((s) => !isHarnessFailure(s.stopReason));
  const harnessFailures = allScores.filter((s) => isHarnessFailure(s.stopReason));

  const dimensions = {
    surface: (s: RunScore) => s.surfaceId,
    feedback: (s: RunScore) => s.feedbackMode,
    model: (s: RunScore) => s.model,
    family: (s: RunScore) => s.taskFamily,
    task: (s: RunScore) => s.taskId,
    surfaceByFeedback: (s: RunScore) => `${s.surfaceId}|${s.feedbackMode}`,
    surfaceByFamily: (s: RunScore) => `${s.surfaceId}|${s.taskFamily}`,
    surfaceByModel: (s: RunScore) => `${s.surfaceId}|${s.model}`,
    modelByFeedback: (s: RunScore) => `${s.model}|${s.feedbackMode}`,
    // The full grid, one entry per cell. Every other dimension here is a
    // marginal of this one, so a plot that wants to slice differently — or to
    // facet the whole leaderboard — can do it without re-reading scores.jsonl.
    cell: (s: RunScore) => `${s.model}|${s.surfaceId}|${s.feedbackMode}`,
  };

  // Per check, pooled across tasks and cut the same ways the run-level
  // aggregates are. The same numbers the report's constraint table shows, in a
  // shape a plot can read.
  //
  // Not cut by cell. The run-level `cell` dimension exists because every other
  // run-level dimension is a marginal of it, which is worth the size; a check
  // appears on a handful of tasks rather than all of them, so per check per
  // cell is a table of single-digit n at the pre-registered three repeats, and
  // `byTask` already supports any faceting someone wants to do with it.
  const checkIds = [...new Set(scores.flatMap((s) => s.checkResults.map((r) => r.id)))];
  const byCheck: Record<string, unknown> = {};
  for (const id of checkIds) {
    const all = scores.flatMap((s) => s.checkResults.filter((r) => r.id === id));
    if (all.length === 0) continue;
    const cut = (key: (s: RunScore) => string): Record<string, { n: number; mean: number; passRate: number }> => {
      const out: Record<string, { n: number; mean: number; passRate: number }> = {};
      for (const [group, rows] of groupBy(scores, key)) {
        const results = rows.flatMap((s) => s.checkResults.filter((r) => r.id === id));
        if (results.length === 0) continue;
        out[group] = {
          n: results.length,
          mean: mean(results.map((r) => r.score)),
          passRate: results.filter((r) => r.passed).length / results.length,
        };
      }
      return out;
    };
    byCheck[id] = {
      label: all[0]!.label,
      n: all.length,
      mean: mean(all.map((r) => r.score)),
      passRate: all.filter((r) => r.passed).length / all.length,
      bySurface: cut((s) => s.surfaceId),
      byFeedback: cut((s) => s.feedbackMode),
      byModel: cut((s) => s.model),
      byFamily: cut((s) => s.taskFamily),
      byTask: cut((s) => s.taskId),
    };
  }

  const aggregates: Record<string, Record<string, unknown>> = { check: byCheck };
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
        passRate: effectiveness(rows).passRate,
        rejectedCalls: effectiveness(rows).rejectedCalls,
        costPerPass: effectiveness(rows).costPerPass,
      };
    }
    aggregates[name] = byKey;
  }

  return {
    generatedAt: new Date().toISOString(),
    runs: scores.length,
    recorded: allScores.length,
    harnessFailures: {
      n: harnessFailures.length,
      bySurface: Object.fromEntries(
        [...groupBy(harnessFailures, (s) => s.surfaceId)].map(([k, v]) => [k, v.length]),
      ),
      byStopReason: Object.fromEntries(
        [...groupBy(harnessFailures, (s) => s.stopReason)].map(([k, v]) => [k, v.length]),
      ),
    },
    bootstrap: { iterations: BOOTSTRAP_ITERATIONS, seed: BOOTSTRAP_SEED },
    costToPass: {
      zeroPassDenominator: ZERO_PASS_DENOMINATOR,
      meaningfulRatio: MEANINGFUL_RATIO,
      bySurface: Object.fromEntries([...groupBy(scores, (s) => s.surfaceId)].map(([k, v]) => [k, { cost: geometricPerPass(v, "cost"), calls: geometricPerPass(v, "calls") }])),
      byFeedback: Object.fromEntries([...groupBy(scores, (s) => s.feedbackMode)].map(([k, v]) => [k, { cost: geometricPerPass(v, "cost"), calls: geometricPerPass(v, "calls") }])),
      byCell: Object.fromEntries([...groupBy(scores, (s) => `${s.model}|${s.surfaceId}|${s.feedbackMode}`)].map(([k, v]) => [k, { cost: geometricPerPass(v, "cost"), calls: geometricPerPass(v, "calls") }])),
    },
    effectiveness: {
      byModel: Object.fromEntries(
        [...groupBy(scores, (s) => s.model)].map(([k, v]) => [k, { ...effectiveness(v), passRateByTask: Object.fromEntries([...groupBy(v, (r) => r.taskId)].map(([t, rs]) => [t, rs.filter(passed).length / rs.length])), passRateWithinCalls: passRateWithinCalls(v) }]),
      ),
      byModelAndTask: Object.fromEntries([...groupBy(scores, (s) => `${s.model}|${s.taskId}`)].map(([k, v]) => [k, effectiveness(v)])),
    },
    aggregates,
  };
}
