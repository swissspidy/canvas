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
import type { RunScore } from "./score.js";
import type { Doc } from "../doc/types.js";

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
    });
    expect(judged.composite).toBeCloseTo(CONSTRAINT_WEIGHT * bare.constraintScore + JUDGE_WEIGHT * 1, 9);
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

  it("shows the judge the brief, the before and the after — and nothing about the run", async () => {
    const { model } = await judge(fullMarks(3));
    const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt);
    expect(prompt).toContain(task.brief.slice(0, 40));
    // Before and after, as images rather than as a description.
    expect(prompt.match(/"type":"file"/g)).toHaveLength(2);
    // Nothing that would tell it which condition produced this.
    expect(prompt).not.toMatch(/coordinate|relational|feedback|screenshot condition|turns/i);
  });

  // The schema cannot enforce "copy each criterion verbatim", and a mean taken
  // over the wrong set is 40% of a composite that looks fine.
  it("keeps itself out of the score when it grades a different set of criteria", async () => {
    const { result } = await judge({
      criteria: [{ criterion: task.judgeCriteria[0]!, score: 5, reason: "because" }],
      overall: 5,
      summary: "Short.",
    });
    expect(result.error).toMatch(/scored 1 criteria/);
    expect(result.criteriaScore).toBe(0);
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
