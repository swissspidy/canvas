import { describe, expect, it } from "vitest";
import { baselineFor, normalize, scoreDocument, scoreRun, CONSTRAINT_WEIGHT, JUDGE_WEIGHT } from "./score.js";
import { computeAgreement, pearson, sampleForRating, spearman } from "./human.js";
import { alignCriteria, judgeRun, toUnit } from "./judge.js";
import { bootstrapCI, mean, stdev } from "../runner/report.js";
import { getTask, TASKS } from "../tasks/index.js";
import { runAgent } from "../agent/loop.js";
import { createScriptedModel, fixedScript } from "../agent/scripted.js";
import { MockLanguageModelV4 } from "ai/test";
import { coordinateSurface, relationalSurface } from "../surfaces/index.js";
import { createFeedbackChannel } from "../feedback/index.js";
import { contrastRatio, effectiveBackdrop, parseColor, relativeLuminance } from "./color.js";
import {
  colorRoles,
  coverage,
  fontSizeAtLeast,
  marginAtLeast,
  minContrast,
  noTextOcclusion,
  notCovered,
  paintOrder,
  rotationWithin,
  sameFontSize,
  sameRotation,
  styleUnchanged,
  textOnFilledShape,
  typeHierarchy,
  usesPalette,
  verticalOrder,
  withText,
} from "./checks.js";
import { describeDoc } from "../render/describe.js";
import type { RunScore } from "./score.js";
import type { Doc, Element } from "../doc/types.js";

describe("colour", () => {
  it("parses the hex forms", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#ff0000")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("#00000080")?.a).toBeCloseTo(0.502, 2);
    expect(parseColor("transparent")?.a).toBe(0);
    expect(parseColor("rebeccapurple")).toBeNull();
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 6);
    // Symmetric.
    expect(contrastRatio("#123456", "#abcdef")).toBeCloseTo(contrastRatio("#abcdef", "#123456"), 9);
  });

  it("composites a translucent foreground before measuring", () => {
    // Nearly transparent black on white should stay close to white.
    expect(contrastRatio("#00000010", "#ffffff")).toBeLessThan(1.5);
  });

  it("orders luminance the way eyes do", () => {
    expect(relativeLuminance(parseColor("#ffffff")!)).toBeGreaterThan(relativeLuminance(parseColor("#808080")!));
    expect(relativeLuminance(parseColor("#808080")!)).toBeGreaterThan(relativeLuminance(parseColor("#000000")!));
  });

  it("treats a text element's own fill as its backdrop", () => {
    const doc: Doc = {
      width: 500,
      height: 500,
      background: "#ffffff",
      elements: [
        {
          id: "chip",
          type: "text",
          x: 10,
          y: 10,
          width: 200,
          height: 60,
          rotation: 0,
          z: 0,
          text: "Sale",
          style: { fill: "#c0392b", color: "#ffffff" },
        },
      ],
    };
    expect(effectiveBackdrop(doc, doc.elements[0]!)).toBe("#c0392b");
    expect(contrastRatio("#ffffff", effectiveBackdrop(doc, doc.elements[0]!))).toBeGreaterThan(4.5);
  });

  it("falls through a transparent element to what is beneath it", () => {
    const doc: Doc = {
      width: 500,
      height: 500,
      background: "#ffffff",
      elements: [
        { id: "panel", type: "rect", x: 0, y: 0, width: 500, height: 500, rotation: 0, z: 0, style: { fill: "#101010" } },
        {
          id: "label",
          type: "text",
          x: 100,
          y: 100,
          width: 200,
          height: 60,
          rotation: 0,
          z: 1,
          text: "Hi",
          style: { color: "#ffffff" },
        },
      ],
    };
    expect(effectiveBackdrop(doc, doc.elements[1]!)).toBe("#101010");
  });

  // A scrim over a photo is the standard way to make a headline legible.
  // Compositing it onto the page background instead of onto what it actually
  // sits on reports the contrast of a layout nobody is looking at.
  it("composites a translucent scrim onto the layer below it, not onto the page", () => {
    const rect = (id: string, z: number, fill: string, opacity?: number) => ({
      id,
      type: "rect" as const,
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      rotation: 0,
      z,
      style: { fill, ...(opacity === undefined ? {} : { opacity }) },
    });
    const label = {
      id: "label",
      type: "text" as const,
      x: 100,
      y: 100,
      width: 200,
      height: 60,
      rotation: 0,
      z: 2,
      text: "Hi",
      style: { color: "#ffffff" },
    };
    const doc: Doc = {
      width: 500,
      height: 500,
      background: "#ffffff",
      elements: [rect("photo", 0, "#000000"), rect("scrim", 1, "#ffffff80"), label],
    };
    // 50% white over black is mid grey. Over the *page* it would have been
    // white, and the white label would have scored a contrast ratio of 1.
    const backdrop = effectiveBackdrop(doc, label);
    expect(parseColor(backdrop)!.r).toBeGreaterThan(100);
    expect(parseColor(backdrop)!.r).toBeLessThan(155);
    expect(contrastRatio("#ffffff", backdrop)).toBeGreaterThan(3);

    // The same fill expressed as element opacity resolves identically.
    const viaOpacity: Doc = {
      ...doc,
      elements: [rect("photo", 0, "#000000"), rect("scrim", 1, "#ffffff", 0.5), label],
    };
    expect(effectiveBackdrop(viaOpacity, label)).toBe(backdrop);
  });

  it("stops at the first opaque layer", () => {
    const doc: Doc = {
      width: 500,
      height: 500,
      background: "#ffffff",
      elements: [
        { id: "a", type: "rect", x: 0, y: 0, width: 500, height: 500, rotation: 0, z: 0, style: { fill: "#ff0000" } },
        { id: "b", type: "rect", x: 0, y: 0, width: 500, height: 500, rotation: 0, z: 1, style: { fill: "#0000ff" } },
        {
          id: "t",
          type: "text",
          x: 100,
          y: 100,
          width: 200,
          height: 60,
          rotation: 0,
          z: 2,
          text: "Hi",
          style: { color: "#ffffff" },
        },
      ],
    };
    expect(effectiveBackdrop(doc, doc.elements[2]!)).toBe("#0000ff");
  });

  // A rotated card's bounding box claims up to twice the area it paints.
  it("asks whether a rotated card really covers the text, not its bounding box", () => {
    const card = {
      id: "card",
      type: "rect" as const,
      x: 200,
      y: 200,
      width: 100,
      height: 100,
      rotation: 45,
      z: 0,
      style: { fill: "#101010" },
    };
    const label = (x: number, y: number) => ({
      id: "label",
      type: "text" as const,
      x,
      y,
      width: 20,
      height: 20,
      rotation: 0,
      z: 1,
      text: "Hi",
      style: { color: "#ffffff" },
    });
    const at = (x: number, y: number): Doc => ({
      width: 500,
      height: 500,
      background: "#ffffff",
      elements: [card, label(x, y)],
    });
    // Centred on the card: covered.
    expect(effectiveBackdrop(at(240, 240), at(240, 240).elements[1]!)).toBe("#101010");
    // In the bounding box's top-left corner, well outside the diamond.
    expect(effectiveBackdrop(at(160, 160), at(160, 160).elements[1]!)).toBe("#ffffff");
  });

  it("sees the grey the renderer paints for a rect with no declared fill", () => {
    const doc: Doc = {
      width: 500,
      height: 500,
      background: "#ffffff",
      elements: [
        { id: "plate", type: "rect", x: 0, y: 0, width: 500, height: 500, rotation: 0, z: 0, style: {} },
        {
          id: "t",
          type: "text",
          x: 100,
          y: 100,
          width: 200,
          height: 60,
          rotation: 0,
          z: 1,
          text: "Hi",
          style: { color: "#ffffff" },
        },
      ],
    };
    expect(effectiveBackdrop(doc, doc.elements[1]!)).toBe("#cccccc");
  });
});

describe("baseline normalization", () => {
  it("puts 'changed nothing' at zero and 'satisfied everything' at one", () => {
    expect(normalize(0.7, 0.7)).toBe(0);
    expect(normalize(1, 0.7)).toBe(1);
    expect(normalize(0.85, 0.7)).toBeCloseTo(0.5, 6);
  });

  it("goes negative when a run makes the document worse", () => {
    expect(normalize(0.5, 0.7)).toBeLessThan(0);
  });

  it("caches a stable baseline per task", () => {
    for (const task of TASKS) {
      const baseline = baselineFor(task);
      expect(baseline).toBe(baselineFor(task));
      expect(baseline).toBeGreaterThanOrEqual(0);
      expect(baseline).toBeLessThan(1);
    }
  });
});

describe("scoring a run", () => {
  const task = getTask("arrange.ragged-column");

  async function runScripted(turns: Parameters<typeof fixedScript>[0], surface = coordinateSurface) {
    const run = await runAgent({
      runId: "score-test",
      task,
      surface,
      feedback: createFeedbackChannel("none"),
      model: "anthropic:claude-opus-5",
      languageModel: createScriptedModel(fixedScript(turns)),
    });
    return run;
  }

  it("scores a no-op run at the baseline, with zero improvement", async () => {
    const run = await runScripted([{ text: "Nothing to do." }]);
    const score = scoreRun(run, task);
    expect(score.constraintScore).toBeCloseTo(score.baselineScore, 9);
    expect(score.normalizedScore).toBeCloseTo(0, 9);
  });

  it("rewards a run that actually fixes the layout", async () => {
    const run = await runScripted(
      [
        { tools: [{ name: "align", input: { ids: ["r1", "r2", "r3", "r4", "r5"], edge: "left" } }] },
        { tools: [{ name: "distribute", input: { ids: ["r1", "r2", "r3", "r4", "r5"], axis: "vertical", spacing: 30 } }] },
        { text: "Aligned and spaced." },
      ],
      relationalSurface,
    );
    const score = scoreRun(run, task);
    expect(score.normalizedScore).toBeGreaterThan(0.5);
    expect(score.constraintScore).toBeGreaterThan(score.baselineScore);
  });

  it("penalizes a run that makes things worse", async () => {
    const run = await runScripted([
      { tools: [{ name: "move", input: { id: "r1", x: -900, y: -900 } }] },
      { text: "Oops." },
    ]);
    const score = scoreRun(run, task);
    expect(score.normalizedScore).toBeLessThan(0);
  });

  it("blends the judge in at the pre-registered weight", async () => {
    const run = await runScripted([{ text: "done" }]);
    const bare = scoreRun(run, task);
    const judged = scoreRun(run, task, {
      criteriaScore: 1,
      overallScore: 1,
      judgement: { criteria: [], overall: 5, summary: "" },
      model: "judge",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      pricingKnown: true,
    });
    expect(judged.composite).toBeCloseTo(CONSTRAINT_WEIGHT * bare.constraintScore + JUDGE_WEIGHT * 1, 9);
  });

  /**
   * `costUsd` is the agent's spend plus the judge's, so `pricingKnown` has to
   * cover both. A `--judge-model` newer than the price table used to
   * contribute a confident $0 to every run in the sweep while the run still
   * claimed its cost was known — the same silent-zero the model table guards
   * against, one level up.
   */
  it("reports cost as unknown when the judge model is unpriced", async () => {
    const run = await runScripted([{ text: "done" }]);
    const judged = (pricingKnown: boolean) =>
      scoreRun(run, task, {
        criteriaScore: 0.8,
        overallScore: 0.8,
        judgement: { criteria: [], overall: 4, summary: "" },
        model: "judge",
        usage: { input: 2000, output: 300, cacheRead: 0, cacheWrite: 0 },
        costUsd: 0,
        pricingKnown,
      });

    expect(judged(true).efficiency.pricingKnown).toBe(true);
    expect(judged(false).efficiency.pricingKnown).toBe(false);
    // An unjudged run is priced on the agent alone, as before.
    expect(scoreRun(run, task).efficiency.pricingKnown).toBe(true);
  });

  it("falls back to the constraint score when the judge errored", async () => {
    const run = await runScripted([{ text: "done" }]);
    const score = scoreRun(run, task, {
      criteriaScore: 0,
      overallScore: 0,
      judgement: { criteria: [], overall: 1, summary: "" },
      model: "judge",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
      pricingKnown: true,
      error: "timeout",
    });
    expect(score.composite).toBeCloseTo(score.constraintScore, 9);
    expect(score.judgeCriteriaScore).toBeNull();
    expect(score.judgeError).toBe("timeout");
  });

  it("scores an incomplete run on what it left behind", async () => {
    // Lines the rows up but never gets to the spacing, then runs out of turns.
    const script = Array.from({ length: 40 }, () => ({
      tools: [{ name: "align" as const, input: { ids: ["r1", "r2", "r3", "r4", "r5"], edge: "left" } }],
    }));
    const run = await runScripted(script, relationalSurface);
    expect(run.stopReason).toBe("max_turns");
    const score = scoreRun(run, task);
    // Half the job earns part of the credit, rather than being zeroed out for
    // not finishing — the difference between "crashed" and "nearly there" is
    // exactly what distinguishes surfaces.
    expect(score.normalizedScore).toBeGreaterThan(0);
    expect(score.normalizedScore).toBeLessThan(1);
  });

  it("gives a partial fix less credit than a complete one", async () => {
    const alignOnly = await runScripted(
      [
        { tools: [{ name: "align", input: { ids: ["r1", "r2", "r3", "r4", "r5"], edge: "left" } }] },
        { text: "Aligned." },
      ],
      relationalSurface,
    );
    const alignAndSpace = await runScripted(
      [
        { tools: [{ name: "align", input: { ids: ["r1", "r2", "r3", "r4", "r5"], edge: "left" } }] },
        { tools: [{ name: "distribute", input: { ids: ["r1", "r2", "r3", "r4", "r5"], axis: "vertical", spacing: 30 } }] },
        { text: "Aligned and spaced." },
      ],
      relationalSurface,
    );
    expect(scoreRun(alignAndSpace, task).normalizedScore).toBeGreaterThan(
      scoreRun(alignOnly, task).normalizedScore,
    );
  });
});

describe("judge score mapping", () => {
  it("maps the 1..5 scale onto 0..1", () => {
    expect(toUnit(1)).toBe(0);
    expect(toUnit(3)).toBe(0.5);
    expect(toUnit(5)).toBe(1);
  });
});

describe("statistics", () => {
  it("means and deviations", () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBe(0);
    expect(stdev([2, 2, 2])).toBe(0);
    expect(stdev([1])).toBe(0);
  });

  it("brackets the mean and is reproducible", () => {
    const values = [0.1, 0.4, 0.5, 0.55, 0.6, 0.9];
    const a = bootstrapCI(values);
    const b = bootstrapCI(values);
    expect(a).toEqual(b);
    expect(a.low).toBeLessThanOrEqual(a.mean);
    expect(a.high).toBeGreaterThanOrEqual(a.mean);
    expect(a.n).toBe(6);
  });

  it("collapses to a point for a single observation", () => {
    const one = bootstrapCI([0.42]);
    expect(one.low).toBe(0.42);
    expect(one.high).toBe(0.42);
  });

  it("narrows as the sample grows", () => {
    const small = bootstrapCI([0.2, 0.8]);
    const large = bootstrapCI(Array.from({ length: 200 }, (_, i) => (i % 2 ? 0.2 : 0.8)));
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it("correlates", () => {
    expect(pearson([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1, 9);
    expect(pearson([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 9);
    expect(spearman([1, 2, 3, 4], [1, 4, 9, 16])).toBeCloseTo(1, 9);
    // Constant input has no variance to correlate.
    expect(pearson([1, 1, 1], [1, 2, 3])).toBe(0);
  });
});

function fakeScore(partial: Partial<RunScore>): RunScore {
  return {
    runId: "r",
    taskId: "arrange.ragged-column",
    taskFamily: "arrange",
    surfaceId: "coordinate",
    feedbackMode: "none",
    model: "anthropic:claude-opus-5",
    stopReason: "completed",
    constraintScore: 0.8,
    checkResults: [],
    judgeCriteriaScore: 0.5,
    judgeOverallScore: 0.5,
    judgeSummary: "",
    composite: 0.7,
    baselineScore: 0.6,
    normalizedScore: 0.5,
    efficiency: {
      turns: 3,
      toolCalls: 4,
      failedToolCalls: 0,
      failureRate: 0,
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costUsd: 0.01,
      pricingKnown: true,
      wallMs: 100,
    },
    toolUsage: {},
    ...partial,
  };
}

describe("human validation subset", () => {
  const scores: RunScore[] = [];
  for (const surface of ["coordinate", "relational", "document"]) {
    for (const feedback of ["none", "structured", "screenshot", "both"]) {
      for (let i = 0; i < 5; i++) {
        scores.push(
          fakeScore({
            runId: `${surface}-${feedback}-${i}`,
            surfaceId: surface,
            feedbackMode: feedback,
            judgeOverallScore: i / 4,
          }),
        );
      }
    }
  }

  it("spreads the sample across every condition", () => {
    const sample = sampleForRating(scores, 24);
    expect(sample).toHaveLength(24);
    const conditions = new Set(sample.map((s) => `${s.surfaceId}|${s.feedbackMode}`));
    // Twelve conditions, 24 slots: every condition should appear.
    expect(conditions.size).toBe(12);
  });

  it("is deterministic", () => {
    expect(sampleForRating(scores, 12).map((s) => s.runId)).toEqual(
      sampleForRating(scores, 12).map((s) => s.runId),
    );
  });

  it("never asks for more than exists", () => {
    expect(sampleForRating(scores, 1000)).toHaveLength(scores.length);
    expect(sampleForRating([], 10)).toEqual([]);
  });

  it("reports perfect agreement when the ratings match the judge", () => {
    const subset = scores.slice(0, 20);
    const ratings = Object.fromEntries(subset.map((s) => [s.runId, Math.round(s.judgeOverallScore! * 4 + 1)]));
    const report = computeAgreement(subset, ratings);
    expect(report.n).toBe(20);
    expect(report.exactAgreement).toBe(1);
    expect(report.meanAbsoluteError).toBeCloseTo(0, 9);
    expect(report.spearman).toBeCloseTo(1, 6);
  });

  it("reports disagreement, and breaks it down by surface", () => {
    const subset = scores.slice(0, 20);
    const ratings = Object.fromEntries(subset.map((s) => [s.runId, 1]));
    const report = computeAgreement(subset, ratings);
    expect(report.meanAbsoluteError).toBeGreaterThan(0);
    expect(Object.keys(report.bySurface).length).toBeGreaterThan(0);
  });

  it("ignores ratings for runs it does not know", () => {
    const report = computeAgreement(scores.slice(0, 5), { "not-a-run": 3 });
    expect(report.n).toBe(0);
    expect(report.note).toMatch(/directional/);
  });
});

describe("scoreDocument", () => {
  it("returns one result per check and a weighted score", () => {
    const task = getTask("fit.long-headline");
    const { score, results } = scoreDocument(task.initial(), task);
    expect(results.length).toBeGreaterThan(4);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
    // The clipped headline should be exactly what is failing.
    const clipping = results.find((r) => r.id === "no_text_clipping" && r.weight > 1);
    expect(clipping?.passed).toBe(false);
    expect(clipping?.detail).toMatch(/headline/);
  });
});

/**
 * The judge goes through the same SDK the agent loop does, so it can be driven
 * by a model that answers with a fixed judgement and never leaves the process.
 */
function judgeModel(judgement: unknown): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: "judge",
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(judgement) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 100, text: 100, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

describe("the judge", () => {
  const task = getTask("arrange.ragged-column");
  const fullMarks = (score: number) => ({
    criteria: task.judgeCriteria.map((criterion) => ({ criterion, score, reason: "because" })),
    overall: score,
    summary: "A summary.",
  });

  async function judge(judgement: unknown, model = judgeModel(judgement)) {
    const result = await judgeRun({
      brief: task.brief,
      criteria: task.judgeCriteria,
      finalDoc: task.initial(),
      initialDoc: task.initial(),
      model: "anthropic:claude-opus-5",
      languageModel: model,
    });
    return { result, model };
  }

  it("maps a judgement onto the 0..1 scales and prices the call", async () => {
    const { result } = await judge(fullMarks(4));
    expect(result.error).toBeUndefined();
    // 4 of 5 is three quarters of the way up a 1..5 scale.
    expect(result.criteriaScore).toBeCloseTo(0.75, 9);
    expect(result.overallScore).toBeCloseTo(0.75, 9);
    expect(result.usage.input).toBe(1000);
    expect(result.costUsd).toBeCloseTo((1000 * 5 + 100 * 25) / 1e6, 9);
  });

  // A live Opus judge appended a row it called "overall" to `criteria` on four
  // of five tasks, duplicating the separate `overall` field. Every one of those
  // judgements was paid for and then discarded on the count. The mocked model
  // always returns the right set, so only the prompt can head this off.
  it("asks for exactly the criteria it was given, and says where the overall rating goes", async () => {
    const { model } = await judge(fullMarks(3));
    const call = model.doGenerateCalls[0]!;
    const prompt = JSON.stringify(call.prompt);
    expect(prompt).toContain(`Return exactly ${task.judgeCriteria.length} entries`);
    expect(prompt).toContain("none of your own");
    expect(prompt).toMatch(/overall rating goes in the separate `overall` field/);

  });

  it("shows the judge the brief, the before and the after — and nothing about the run", async () => {
    const { model } = await judge(fullMarks(3));
    const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt);
    expect(prompt).toContain(task.brief.slice(0, 40));
    // Before and after, as images rather than as a description.
    expect(prompt.match(/"type":"file"/g)).toHaveLength(2);
    // Nothing that would tell it which condition produced this.
    expect(prompt).not.toMatch(/coordinate|relational|feedback|screenshot condition|turns/i);
  });

  // A mean taken over the wrong set is 40% of a composite that looks fine, and
  // two different things can produce one. The pinned count stops a short answer
  // from parsing at all; the alignment catches what a count cannot see — a
  // right-sized set that names the wrong criteria. Both keep the judge out.
  it("keeps itself out of the score when it grades a different set of criteria", async () => {
    const short = await judge({
      criteria: [{ criterion: task.judgeCriteria[0]!, score: 5, reason: "because" }],
      overall: 5,
      summary: "Short.",
    });
    expect(short.result.error).toBeTruthy();
    expect(short.result.criteriaScore).toBe(0);

    // The right number of entries, all naming the first criterion: one scored
    // repeatedly and the rest never scored. Only the alignment sees this.
    const duplicated = await judge({
      criteria: task.judgeCriteria.map(() => ({ criterion: task.judgeCriteria[0]!, score: 5, reason: "because" })),
      overall: 5,
      summary: "Short.",
    });
    expect(duplicated.result.error).toMatch(/more than once/);
    expect(duplicated.result.criteriaScore).toBe(0);
  });

  it("reports a model that answers with nothing usable as a failed judgement", async () => {
    const { result } = await judge(null, judgeModel({ not: "a judgement" }));
    expect(result.error).toBeTruthy();
    expect(result.criteriaScore).toBe(0);
  });
});

describe("judge criterion alignment", () => {
  const asked = ["Is it legible?", "Is the hierarchy clear?", "Does it read as a poster?"];
  const entry = (criterion: string, score: number) => ({ criterion, score });

  it("drops a trailing 'overall' row rather than discarding the judgement over it", () => {
    // The live failure: every requested criterion scored verbatim, plus the
    // overall rating repeated as a criterion. The mean is over the asked set.
    const aligned = alignCriteria(asked, [...asked.map((c, i) => entry(c, i + 3)), entry("Overall", 1)]);
    expect(aligned).toEqual({ scores: [3, 4, 5] });
  });

  it("never drops an 'overall' row that the task actually asked about", () => {
    // The drop exists for a row nobody asked for. Where "Overall" is itself a
    // criterion, the duplicate is a real ambiguity and the judgement is refused
    // rather than quietly resolved in one of the two possible directions.
    const withOverall = [...asked, "Overall"];
    const aligned = alignCriteria(withOverall, [...withOverall.map((c) => entry(c, 4)), entry("Overall", 2)]);
    expect(aligned).toMatchObject({ error: expect.stringContaining("scored 5 criteria") });
  });

  it("drops a wholly blank trailing row", () => {
    // Observed live: criterion "", reason "", score 1. It scores nothing.
    const blank = { criterion: "", score: 1, reason: "" };
    const aligned = alignCriteria(asked, [...asked.map((c, i) => entry(c, i + 3)), blank]);
    expect(aligned).toEqual({ scores: [3, 4, 5] });

    // An entry with no reason at all is the same thing: nothing was said.
    expect(alignCriteria(asked, [...asked.map((c, i) => entry(c, i + 3)), entry("", 1)])).toEqual({
      scores: [3, 4, 5],
    });

    // The score is not what makes it filler. A row naming nothing and
    // explaining nothing carries no signal whatever number it arrived with.
    expect(
      alignCriteria(asked, [...asked.map((c, i) => entry(c, i + 3)), { criterion: "", score: 4, reason: "  " }]),
    ).toEqual({ scores: [3, 4, 5] });
  });

  it("refuses an unnamed row that actually judged something", () => {
    // No criterion name but a written reason: this row assessed *something* and
    // failed to say what, so there is no honest slot for it. Dropping it would
    // silently discard a real judgement and score the run on the rest.
    const judged = { criterion: "", score: 2, reason: "The type is far too tight against the edge." };
    expect(alignCriteria(asked, [...asked.map((c, i) => entry(c, i + 3)), judged])).toMatchObject({
      error: expect.stringContaining("scored 4 criteria"),
    });
  });

  it("still refuses an extra row that is not the overall rating", () => {
    expect(alignCriteria(asked, [...asked.map((c) => entry(c, 5)), entry("Bonus", 5)])).toMatchObject({
      error: expect.stringContaining("scored 4 criteria"),
    });
  });

  it("lines up verbatim criteria in any order", () => {
    const aligned = alignCriteria(asked, [entry(asked[2]!, 5), entry(asked[0]!, 3), entry(asked[1]!, 4)]);
    expect(aligned).toEqual({ scores: [3, 4, 5] });
  });

  it("ignores case, punctuation and whitespace drift", () => {
    const aligned = alignCriteria(asked, [
      entry("is it legible", 3),
      entry("Is  the   hierarchy clear?", 4),
      entry("DOES IT READ AS A POSTER?", 5),
    ]);
    expect(aligned).toEqual({ scores: [3, 4, 5] });
  });

  it("falls back to position when the judge paraphrases", () => {
    const aligned = alignCriteria(asked, [entry("Legibility", 3), entry("Hierarchy", 4), entry("Poster-ness", 5)]);
    expect(aligned).toEqual({ scores: [3, 4, 5] });
  });

  // Each of these changes what the mean is a mean *of*, and the judge is 40%
  // of the composite — so none of them may quietly produce a number.
  it("refuses a short, long, empty or duplicated set", () => {
    expect(alignCriteria(asked, [entry(asked[0]!, 5), entry(asked[1]!, 5)])).toMatchObject({
      error: expect.stringContaining("2 criteria"),
    });
    expect(alignCriteria(asked, [...asked.map((c) => entry(c, 5)), entry("Bonus", 5)])).toMatchObject({
      error: expect.stringContaining("4 criteria"),
    });
    expect(alignCriteria(asked, [])).toMatchObject({ error: expect.stringContaining("no criterion scores") });
    expect(alignCriteria([], [])).toMatchObject({ error: expect.stringContaining("No criteria") });
    expect(
      alignCriteria(asked, [entry(asked[0]!, 5), entry(asked[0]!, 5), entry(asked[1]!, 1)]),
    ).toMatchObject({ error: expect.stringContaining("more than once") });
  });
});

describe("the margin check", () => {
  function poster(...elements: Element[]): Doc {
    return { width: 1000, height: 1000, background: "#ffffff", elements };
  }
  const el = (partial: Partial<Element> & { id: string }): Element => ({
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    z: 0,
    style: {},
    ...partial,
  });

  // The bug this check had for its whole life: centring a headline by giving
  // it a full-width box and `align: center` is the obvious way to do it, and
  // it scored zero every time, because the *box* touches both edges even
  // though the letters sit 400 units from either one.
  it("measures the glyphs of a centred headline, not its full-width box", () => {
    const headline = el({
      id: "title",
      type: "text",
      text: "Ridgeline",
      x: 0,
      y: 400,
      width: 1000,
      height: 120,
      style: { fontSize: 64, align: "center" },
    });
    const outcome = marginAtLeast(24).run(poster(headline));
    expect(outcome.score).toBe(1);
    expect(outcome.detail).toMatch(/Smallest margin/);
  });

  it("still catches glyphs that really do crowd the edge", () => {
    const headline = el({
      id: "title",
      type: "text",
      text: "Ridgeline",
      x: 0,
      y: 400,
      width: 1000,
      height: 120,
      style: { fontSize: 64, align: "left" },
    });
    const outcome = marginAtLeast(24).run(poster(headline));
    expect(outcome.score).toBeLessThan(0.3);
    expect(outcome.detail).toMatch(/title/);
  });

  // A band that runs the width of the canvas is a bleed, which is a decision.
  // An element that merely happens to touch one edge is not.
  it("exempts a full-width band but not an element that just touches an edge", () => {
    const band = el({ id: "scrim", x: 0, y: 600, width: 1000, height: 400, style: { fill: "#000000" } });
    expect(marginAtLeast(24).run(poster(band)).score).toBe(1);

    const stray = el({ id: "chip", x: 0, y: 600, width: 200, height: 80, style: { fill: "#000000" } });
    expect(marginAtLeast(24).run(poster(stray)).score).toBe(0);
  });

  it("ignores an element that paints nothing", () => {
    const ghost = el({ id: "ghost", x: 0, y: 0, width: 200, height: 80, style: { fill: "transparent" } });
    const inset = el({ id: "card", x: 300, y: 300, width: 200, height: 80, style: { fill: "#000000" } });
    const outcome = marginAtLeast(24).run(poster(ghost, inset));
    expect(outcome.score).toBe(1);
    expect(outcome.detail).not.toMatch(/ghost/);
  });

  // An outline is too thin to hide anything and perfectly visible against an
  // edge, so it is paint here even though it is not an occluder.
  it("counts an unfilled but stroked box", () => {
    const outline = el({
      id: "frame",
      x: 0,
      y: 300,
      width: 200,
      height: 80,
      style: { fill: "transparent", strokeColor: "#000000", strokeWidth: 2 },
    });
    const outcome = marginAtLeast(24).run(poster(outline));
    expect(outcome.score).toBe(0);
    expect(outcome.detail).toMatch(/frame/);
  });
});

/**
 * The checks added to close the loopholes the task suite found. Each one is
 * here because something scored well without doing the work: text shrunk out
 * of legibility, a caption grown over the photograph it captions, a palette
 * applied to the wrong elements, a stacking order fixed by fading a layer out.
 */
describe("the checks that close a loophole", () => {
  const doc = (...elements: Element[]): Doc => ({
    width: 1000,
    height: 1000,
    background: "#ffffff",
    elements,
  });
  const el = (partial: Partial<Element> & { id: string }): Element => ({
    type: "rect",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    rotation: 0,
    z: 0,
    style: {},
    ...partial,
  });
  const copy = (id: string, text: string, style: Element["style"], box: Partial<Element> = {}): Element =>
    el({ id, type: "text", text, width: 600, height: 200, style, ...box });

  describe("a legible type floor", () => {
    it("passes text at the floor and grades what falls below it", () => {
      const ok = fontSizeAtLeast(24).run(doc(copy("body", "Notes on repair", { fontSize: 24 })));
      expect(ok.score).toBe(1);

      // Graded in between: 21 against a floor of 24 is half a failure, and 23
      // is a rounding error rather than a violation.
      const small = fontSizeAtLeast(24).run(doc(copy("body", "Notes on repair", { fontSize: 21 })));
      expect(small.score).toBeCloseTo(0.5, 6);
      expect(small.detail).toMatch(/body/);
      expect(fontSizeAtLeast(24).run(doc(copy("body", "Notes", { fontSize: 23 }))).score).toBeGreaterThan(0.8);

      // A quarter below the floor bottoms out. The narrowness is deliberate:
      // the cheap path in the `fit` family is to undershoot a stated floor by
      // a couple of units and fit the box that way, and a gentle grade made
      // that nearly as good as finding the room.
      expect(fontSizeAtLeast(24).run(doc(copy("body", "Notes", { fontSize: 18 }))).score).toBe(0);
      expect(fontSizeAtLeast(24).run(doc(copy("body", "Notes", { fontSize: 9 }))).score).toBe(0);
    });

    // A vacuous pass here would pay a blank canvas for respecting a floor it
    // never reached, on tasks whose briefs all ask for copy.
    it("fails a page with no visible text at all", () => {
      expect(fontSizeAtLeast(24).run(doc()).score).toBe(0);
      const ghost = copy("ghost", "Invisible", { fontSize: 40, opacity: 0 });
      expect(fontSizeAtLeast(24).run(doc(ghost)).score).toBe(0);
    });
  });

  it("asks whether a group shares one size, not whether each one fits", () => {
    const three = (a: number, b: number, c: number) =>
      doc(
        copy("one", "First", { fontSize: a }, { y: 0 }),
        copy("two", "Second", { fontSize: b }, { y: 300 }),
        copy("three", "Third", { fontSize: c }, { y: 600 }),
      );
    expect(sameFontSize(["one", "two", "three"]).run(three(36, 36, 36)).score).toBe(1);
    expect(sameFontSize(["one", "two", "three"]).run(three(40, 30, 38)).score).toBeLessThan(0.5);
  });

  describe("occlusion of things that are not text", () => {
    it("reports a photograph buried under a panel, which the text check cannot", () => {
      const photo = el({ id: "photo", type: "image", src: "photo/city", x: 0, y: 0, width: 600, height: 400, z: 0 });
      const panel = el({ id: "panel", x: 0, y: 0, width: 600, height: 400, z: 1, style: { fill: "#ffffff" } });
      expect(notCovered(["photo"]).run(doc(photo)).score).toBe(1);
      expect(notCovered(["photo"]).run(doc(photo, panel)).score).toBe(0);
    });

    it("counts a photograph nobody can see as no photograph at all", () => {
      const ghost = el({ id: "photo", type: "image", src: "photo/city", width: 600, height: 400, style: { opacity: 0 } });
      const outcome = notCovered(["photo"]).run(doc(ghost));
      expect(outcome.score).toBe(0);
      expect(outcome.detail).toMatch(/No visible/);
    });
  });

  it("reads the reading order off what each element paints", () => {
    const stacked = doc(
      copy("title", "Field Notes", { fontSize: 60 }, { y: 0, height: 120 }),
      copy("body", "Six weeks in the valley.", { fontSize: 30 }, { y: 200, height: 200 }),
    );
    expect(verticalOrder(["title", "body"]).run(stacked).score).toBe(1);
    expect(verticalOrder(["body", "title"]).run(stacked).score).toBe(0);
  });

  describe("stacking order", () => {
    const photo = el({ id: "photo", type: "image", src: "photo/city", width: 1000, height: 1000, z: 0 });
    const scrim = el({ id: "scrim", width: 1000, height: 1000, z: 1, style: { fill: "#00000099" } });
    const title = copy("title", "After the Last Train", { fontSize: 60, color: "#ffffff" }, { z: 2 });

    it("reads the order the renderer paints", () => {
      expect(paintOrder(["photo", "scrim", "title"]).run(doc(photo, scrim, title)).score).toBe(1);
      expect(paintOrder(["photo", "scrim", "title"]).run(doc(title, scrim, photo)).score).toBe(0);
    });

    // The point of having it at all: occlusion is the symptom, and fading the
    // photograph out cures the symptom while leaving the stacking wrong.
    it("is not satisfied by making the layer on top invisible", () => {
      const buried = doc(title, { ...photo, z: 2 });
      expect(noTextOcclusion().run(buried).score).toBe(0);

      const faded = doc(title, { ...photo, z: 2, style: { opacity: 0 } });
      expect(noTextOcclusion().run(faded).score).toBe(1);
      // Nothing covers the title any more, and the photograph is still on top
      // of it, which is the thing the brief asks to have fixed.
      expect(paintOrder(["photo", "title"]).run(faded).score).toBe(0);
    });
  });

  it("holds an element's appearance, including which asset it points at", () => {
    const before = doc(el({ id: "photo", type: "image", src: "photo/city", style: { opacity: 1, radius: 8 } }));
    expect(styleUnchanged(before, ["photo"]).run(before).score).toBe(1);

    const dimmed = doc(el({ id: "photo", type: "image", src: "photo/city", style: { opacity: 0.1, radius: 8 } }));
    expect(styleUnchanged(before, ["photo"]).run(dimmed).score).toBeLessThan(1);

    const swapped = doc(el({ id: "photo", type: "image", src: "photo/mountains", style: { opacity: 1, radius: 8 } }));
    const outcome = styleUnchanged(before, ["photo"]).run(swapped);
    expect(outcome.score).toBeLessThan(1);
    expect(outcome.detail).toMatch(/src/);
  });

  it("scores the colour assignment the brief spells out, not just the palette", () => {
    const roles = colorRoles(
      [
        { ids: ["panel"], prop: "fill", color: "#1e1e33" },
        { ids: ["heading"], prop: "color", color: "#f4f1ea" },
      ],
      1,
      { background: "#12121f" },
    );
    const assigned: Doc = {
      ...doc(
        el({ id: "panel", style: { fill: "#1e1e33" } }),
        copy("heading", "Ridge Roast", { color: "#f4f1ea" }),
      ),
      background: "#12121f",
    };
    expect(roles.run(assigned).score).toBe(1);

    // Every colour below is on the same palette, and every one is in the
    // wrong place.
    const scrambled: Doc = {
      ...doc(
        el({ id: "panel", style: { fill: "#f4f1ea" } }),
        copy("heading", "Ridge Roast", { color: "#1e1e33" }),
      ),
      background: "#12121f",
    };
    const outcome = roles.run(scrambled);
    expect(outcome.score).toBeCloseTo(1 / 3, 6);
    expect(outcome.detail).toMatch(/panel fill is #f4f1ea/);
  });

  it("counts an off-palette colour once, however many elements share it", () => {
    const one = usesPalette(["#12121f", "#ffffff"]).run(
      doc(copy("a", "One", { color: "#ff0000" })),
    );
    const many = usesPalette(["#12121f", "#ffffff"]).run(
      doc(
        copy("a", "One", { color: "#ff0000" }),
        copy("b", "Two", { color: "#ff0000" }, { y: 300 }),
        copy("c", "Three", { color: "#ff0000" }, { y: 600 }),
      ),
    );
    expect(one.score).toBe(many.score);
    expect(one.detail).toMatch(/#ff0000/);
  });

  it("wants something filled under a label before it calls it a button", () => {
    const label = copy("label", "Add to basket", { fontSize: 34 }, { x: 100, y: 100, width: 300, height: 100, z: 1 });
    const shape = el({ id: "button", x: 100, y: 100, width: 300, height: 100, z: 0, style: { fill: "#d94f3d" } });
    const beside = el({ id: "button", x: 500, y: 100, width: 300, height: 100, z: 0, style: { fill: "#d94f3d" } });
    const above = el({ id: "button", x: 100, y: 100, width: 300, height: 100, z: 2, style: { fill: "#d94f3d" } });

    expect(textOnFilledShape("Add to basket").run(doc(shape, label)).score).toBe(1);
    expect(textOnFilledShape("Add to basket").run(doc(beside, label)).score).toBe(0);
    // One element rather than two: a text block with a fill paints the same
    // button, and scoring that as no button would push an agent into the
    // arrangement that trips `noOverlap`.
    const filledLabel = { ...label, style: { ...label.style, fill: "#d94f3d" } };
    expect(textOnFilledShape("Add to basket").run(doc(filledLabel)).score).toBe(1);
    // Painted over the label rather than under it is not a button either.
    expect(textOnFilledShape("Add to basket").run(doc(label, above)).score).toBe(0);
    expect(textOnFilledShape("Add to basket").run(doc(label)).score).toBe(0);
  });

  it("finds copy by its wording, whatever the element was called", () => {
    const d = doc(copy("whatever_the_agent_called_it", "Ridgeline\nFestival", { fontSize: 90 }));
    // Normalized on whitespace, so a hard line break inside the phrase matches.
    expect(d.elements.filter(withText("Ridgeline Festival"))).toHaveLength(1);
    expect(d.elements.filter(withText("Alpine Meadow"))).toHaveLength(0);
  });

  it("will not find copy in an element nobody can see", () => {
    const d = doc(copy("ghost", "Ridgeline Festival", { fontSize: 90, opacity: 0.01 }));
    expect(d.elements.filter(withText("Ridgeline Festival"))).toHaveLength(0);
  });

  describe("rotation", () => {
    const tilted = (rotation: number) => el({ id: "ribbon", width: 600, height: 120, rotation });

    it("grades how far off the angle is", () => {
      expect(rotationWithin(["ribbon"], -14).run(doc(tilted(-14))).score).toBe(1);
      expect(rotationWithin(["ribbon"], -14).run(doc(tilted(-12))).score).toBeGreaterThan(0.7);
      expect(rotationWithin(["ribbon"], -14).run(doc(tilted(0))).score).toBe(0);
    });

    // The document normalizes angles into (-180, 180], and a check that
    // disagreed with that arithmetic at the wrap point would be wrong once, in
    // one run, and never explained.
    it("measures the short way round, so 359 and -1 are one degree apart", () => {
      const outcome = rotationWithin(["ribbon"], 359).run(doc(tilted(0)));
      expect(outcome.score).toBe(1);
      expect(rotationWithin(["ribbon"], -179).run(doc(tilted(179))).score).toBeGreaterThan(0.7);
    });

    it("asks whether a group agrees, without naming the angle", () => {
      const pair = (a: number, b: number) =>
        doc(el({ id: "ribbon", rotation: a }), el({ id: "label", x: 400, rotation: b }));
      expect(sameRotation(["ribbon", "label"]).run(pair(-14, -14)).score).toBe(1);
      expect(sameRotation(["ribbon", "label"]).run(pair(-14, 0)).score).toBe(0);
    });
  });

  // A tilted label on an upright rect is not a ribbon, and their bounding
  // boxes overlap just as happily either way.
  it("wants the shape under a tilted label turned with it", () => {
    const label = copy("label", "HALF PRICE", { fontSize: 60 }, { x: 100, y: 100, width: 600, height: 120, z: 1, rotation: -14 });
    const turned = el({ id: "ribbon", x: 100, y: 100, width: 600, height: 120, z: 0, rotation: -14, style: { fill: "#a8352a" } });
    const upright = el({ id: "ribbon", x: 100, y: 100, width: 600, height: 120, z: 0, rotation: 0, style: { fill: "#a8352a" } });

    expect(textOnFilledShape("HALF PRICE", 1, { rotationWithin: 3 }).run(doc(turned, label)).score).toBe(1);
    expect(textOnFilledShape("HALF PRICE", 1, { rotationWithin: 3 }).run(doc(upright, label)).score).toBe(0);
    // Without the option it is the same check it always was.
    expect(textOnFilledShape("HALF PRICE").run(doc(upright, label)).score).toBeGreaterThan(0);
  });

  describe("the type hierarchy check", () => {
    // A newline is a hard line break, so the whole brief fits in one element —
    // at one size, which is no hierarchy. This used to score full marks.
    it("scores a single block holding every line at zero", () => {
      const everything = copy("all", "Ridgeline Festival\nSeptember 12-14\nTickets at ridgeline.fm", { fontSize: 60 });
      const outcome = typeHierarchy(2).run(doc(everything));
      expect(outcome.score).toBe(0);
      expect(outcome.detail).toMatch(/no hierarchy/i);
    });

    it("scores two elements on the ratio between them", () => {
      const title = copy("title", "Ridgeline Festival", { fontSize: 120 }, { y: 0 });
      const foot = copy("foot", "Tickets at ridgeline.fm", { fontSize: 40 }, { y: 400 });
      expect(typeHierarchy(2).run(doc(title, foot)).score).toBe(1);
      expect(typeHierarchy(4).run(doc(title, foot)).score).toBeLessThan(1);
    });
  });
});

describe("contrast and the element's own opacity", () => {
  it("reads the colour that lands on the page, not the one declared", () => {
    const page = (opacity: number): Doc => ({
      width: 500,
      height: 500,
      background: "#ffffff",
      elements: [
        {
          id: "copy",
          type: "text",
          x: 50,
          y: 50,
          width: 400,
          height: 100,
          rotation: 0,
          z: 0,
          text: "Ridgeline",
          style: { fontSize: 40, color: "#000000", opacity },
        },
      ],
    });
    // Black on white, which is 21:1 — as long as it is actually painted.
    expect(minContrast(4.5).run(page(1)).score).toBe(1);

    // At 20% it is grey on white, about 1.6:1. The check read `style.color`
    // and scored this 21:1 too, because the opacity never reached it.
    const faint = minContrast(4.5).run(page(0.2));
    expect(faint.score).toBeLessThan(0.3);
    expect(faint.detail).toMatch(/copy/);

    // Below the visibility threshold it is not text on a page at all: it drops
    // out of this check, and out of `containsText` with it, so there is
    // nothing left to score and nothing to gain.
    expect(minContrast(4.5).run(page(0.03)).detail).toMatch(/No text elements/);
  });
});

describe("the occlusion check", () => {
  const doc = (...elements: Element[]): Doc => ({
    width: 1000,
    height: 1000,
    background: "#ffffff",
    elements,
  });

  // A line of capitals inks about 0.69em; its line box runs 1.12em, from the
  // ascender to the descender. A rule tucked into that empty band passes
  // between the letters and the ones below without touching either.
  it("does not report a rule laid in the empty band under a line of capitals", () => {
    const heading: Element = {
      id: "heading",
      type: "text",
      text: "RIDGELINE",
      x: 100,
      y: 100,
      width: 800,
      height: 200,
      rotation: 0,
      z: 0,
      style: { fontSize: 100, valign: "top" },
    };
    // The baseline sits at y=201; capitals reach up to y=132 and stop there,
    // while the line box runs on to y=222.
    const rule: Element = {
      id: "rule",
      type: "rect",
      x: 100,
      y: 206,
      width: 800,
      height: 8,
      rotation: 0,
      z: 1,
      style: { fill: "#000000" },
    };
    expect(noTextOcclusion().run(doc(heading, rule)).score).toBe(1);
  });

  /**
   * Text nobody can see is neither covered nor covering. `inkPolygons` is pure
   * geometry, so invisible text used to arrive here carrying real ink: under a
   * shape it read as a total failure, and anywhere else it padded the
   * denominator.
   *
   * The dilution case is graded rather than saturated on purpose. The
   * cross-task property test in `tasks.test.ts` missed this because every
   * occlusion in a task's starting document is already far past the check's
   * budget, where diluting a 70% failure to 45% still scores zero.
   */
  describe("text that paints nothing", () => {
    const headline = (id: string, y: number, style: Element["style"] = {}): Element => ({
      id,
      type: "text",
      text: "Ridgeline Festival",
      x: 100,
      y,
      width: 800,
      height: 120,
      rotation: 0,
      z: 0,
      style: { fontSize: 60, ...style },
    });
    // Clips the first word only, so the check lands inside its grading ramp
    // (8% of the glyph area, against a budget of 15%) rather than bottoming
    // out — which is the whole point: a saturated score hides dilution.
    const nick: Element = {
      id: "nick",
      type: "rect",
      x: 100,
      y: 140,
      width: 70,
      height: 40,
      rotation: 0,
      z: 5,
      style: { fill: "#000000" },
    };

    it("does not dilute a real occlusion failure", () => {
      const real = [headline("headline", 100), nick];
      const before = noTextOcclusion().run(doc(...real));
      expect(before.score).toBeGreaterThan(0);
      expect(before.score).toBeLessThan(1);

      for (const hidden of [{ opacity: 0 }, { color: "transparent" }] as Element["style"][]) {
        const ghosts = [1, 2, 3].map((i) => headline(`ghost${i}`, 300 + i * 130, hidden));
        expect(noTextOcclusion().run(doc(...real, ...ghosts)).score, JSON.stringify(hidden)).toBeCloseTo(
          before.score,
          10,
        );
      }
    });

    it("is not itself reported as covered", () => {
      const outcome = noTextOcclusion().run(doc(headline("ghost", 100, { opacity: 0 }), { ...nick, y: 100, width: 800, height: 120 }));
      expect(outcome.score).toBe(1);
      expect(outcome.detail).not.toMatch(/ghost/);
    });

    // The structured feedback channel is one of the variables under study, so
    // what it tells a model has to be true.
    it("is not reported as covered to the model either", () => {
      const d = doc(headline("ghost", 100, { opacity: 0 }), { ...nick, y: 100, width: 800, height: 120 });
      expect(describeDoc(d, { level: "analysis" })).not.toMatch(/ghost's text is/);
      // A visible one in the same place still is.
      const visible = doc(headline("real", 100), { ...nick, y: 100, width: 800, height: 120 });
      expect(describeDoc(visible, { level: "analysis" })).toMatch(/real's text is .* covered by nick/);
    });
  });

  it("still reports a rule laid across the letters themselves", () => {
    const heading: Element = {
      id: "heading",
      type: "text",
      text: "RIDGELINE",
      x: 100,
      y: 100,
      width: 800,
      height: 200,
      rotation: 0,
      z: 0,
      style: { fontSize: 100, valign: "top" },
    };
    const bar: Element = {
      id: "bar",
      type: "rect",
      x: 100,
      y: 150,
      width: 800,
      height: 40,
      rotation: 0,
      z: 1,
      style: { fill: "#000000" },
    };
    const outcome = noTextOcclusion().run(doc(heading, bar));
    expect(outcome.score).toBe(0);
    expect(outcome.detail).toMatch(/heading/);
  });
});

describe("the coverage check", () => {
  const W = 1000;
  const H = 1000;
  const page = (...elements: Element[]): Doc => ({
    width: W,
    height: H,
    background: "#ffffff",
    elements,
  });
  const box = (id: string, x: number, y: number, width: number, height: number): Element => ({
    id,
    type: "rect",
    x,
    y,
    width,
    height,
    rotation: 0,
    z: 0,
    style: { fill: "#334455" },
  });
  const background = (): Element => ({ ...box("bg", 0, 0, W, H), type: "image", src: "photo/mountains" });

  // A composed page, a bare one and one with everything in a corner — all
  // behind the same full-bleed photo. Measuring the photo, the check called
  // them identical, and called all three over-packed.
  const composed = () => [box("band", 0, 600, W, 400), box("headline", 100, 200, 800, 200)];
  const bare = () => [box("scrap", 20, 20, 120, 60)];

  it("looks past a full-canvas background at what is composed on top of it", () => {
    const outcome = coverage(0.3, 0.98).run(page(background(), ...composed()));
    expect(outcome.score).toBe(1);
    expect(outcome.detail).toMatch(/excluding 1 full-canvas element/);
  });

  it("tells a composed page from a bare one behind the same background", () => {
    const good = coverage(0.3, 0.98).run(page(background(), ...composed()));
    const empty = coverage(0.3, 0.98).run(page(background(), ...bare()));
    expect(good.score).toBe(1);
    expect(empty.score).toBeLessThan(0.3);
    // The distinction the check exists to draw, and could not draw before.
    expect(good.score).toBeGreaterThan(empty.score);
  });

  // The brief asks for a background image. Bleeding it used to score worse
  // than insetting it, which paid a run to ignore the instruction.
  it("does not reward insetting a background that the brief wants bled", () => {
    const bled = coverage(0.3, 0.98).run(page(background(), ...composed()));
    const inset = coverage(0.3, 0.98).run(
      page({ ...background(), x: 24, y: 24, width: W - 48, height: H - 48 }, ...composed()),
    );
    expect(bled.score).toBeGreaterThanOrEqual(inset.score);
  });

  // Narrower than `marginAtLeast`'s bleed rule on purpose: a band across the
  // lower third really does fill that third.
  it("still counts a full-width band that does not cover the canvas", () => {
    const withBand = coverage(0.3, 0.98).run(page(box("band", 0, 600, W, 400)));
    expect(withBand.detail).not.toMatch(/excluding/);
    expect(withBand.score).toBe(1);
  });

  it("scores a page that is nothing but a background as bare", () => {
    expect(coverage(0.3, 0.98).run(page(background())).score).toBeLessThan(0.3);
  });

  it("leaves a page with no full-canvas element alone", () => {
    const outcome = coverage(0.3, 0.98).run(page(...composed()));
    expect(outcome.detail).not.toMatch(/excluding/);
    expect(outcome.score).toBe(1);
  });

  // One element nobody can see was the cheapest possible way to look composed
  // without composing anything: it took a bare page from failing this check to
  // passing it outright.
  it("cannot be padded with an element that paints nothing", () => {
    const ghost = (id: string, style: Element["style"]): Element => ({
      ...box(id, 40, 40, W - 80, H - 80),
      style,
    });
    const before = coverage(0.3, 0.98).run(page(background(), ...bare()));
    for (const style of [
      { fill: "transparent" },
      { fill: "#33445500" },
      { fill: "#334455", opacity: 0 },
    ] as Element["style"][]) {
      const after = coverage(0.3, 0.98).run(page(background(), ...bare(), ghost("pad", style)));
      expect(after.score, JSON.stringify(style)).toBe(before.score);
      expect(after.detail).toMatch(/1 invisible/);
    }
  });

  // The other half of that: an outline is faint, not absent.
  it("still counts a box that is only a stroke", () => {
    const outline: Element = {
      ...box("frame", 100, 100, 800, 800),
      style: { fill: "transparent", strokeColor: "#000000", strokeWidth: 2 },
    };
    const outcome = coverage(0.3, 0.98).run(page(outline));
    expect(outcome.detail).not.toMatch(/invisible/);
    expect(outcome.score).toBe(1);
  });

  it("names both exclusions apart, and counts them", () => {
    const ghost: Element = { ...box("pad", 40, 40, 100, 100), style: { fill: "transparent" } };
    const outcome = coverage(0.3, 0.98).run(
      page(background(), ...composed(), ghost, { ...ghost, id: "pad2" }),
    );
    expect(outcome.detail).toMatch(/excluding 1 full-canvas and 2 invisible elements/);
  });
});
