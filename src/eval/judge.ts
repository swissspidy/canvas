/**
 * The judge.
 *
 * It scores intent — "does this read as a poster", "is the hierarchy sensible"
 * — and nothing the deterministic checks already measure. Keeping the two
 * scores independent is what makes it meaningful to report them separately,
 * and what makes a disagreement between them informative rather than noise.
 *
 * Blinded by construction: the judge prompt is built from the task and the
 * rendered result only. Surface, feedback condition, model, turn count and
 * cost never reach it. `judgeRun` takes the pieces it needs rather than a
 * `RunResult`, so leaking a condition into the prompt would take deliberate
 * effort rather than a careless spread.
 *
 * It goes through the same SDK the agent loop does, so a judge can be any
 * provider's model — useful for checking that a result does not depend on
 * being graded by a sibling of the model under test.
 */

import { generateObject, NoObjectGeneratedError, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";
import type { Doc } from "../doc/types.js";
import { rasterize } from "../render/raster.js";
import {
  costUsd,
  getModel,
  MAX_RETRIES,
  resolveLanguageModel,
  tokenUsage,
  ZERO_USAGE,
  type TokenUsage,
} from "../agent/models.js";

/**
 * Sonnet rather than Opus, on both cost and behaviour.
 *
 * A sweep is one judge call per run — 828 of them at the pre-registered size —
 * so the judge is a standing cost rather than a rounding error, and Sonnet is
 * 2.5x cheaper per token on both rails. Measured over all 23 tasks it is also
 * the better-behaved judge: it returned exactly the criteria asked for on 23 of
 * 23, twice over, where Opus appended a row of its own often enough to need
 * `alignCriteria` to drop one on about half of them.
 *
 * It also decouples the judge from the model under test. `claude-opus-5` is the
 * confirmatory model in the study, so judging with Opus had it grading its own
 * work — exactly the sibling-grading confound `--judge-model` exists to let
 * anyone check.
 */
export const DEFAULT_JUDGE_MODEL = "anthropic:claude-sonnet-5";
export const JUDGE_SCREENSHOT_WIDTH = 768;

/** 1..5 per criterion. A 5-point scale is what the human raters also use. */
const zCriterionScore = z.object({
  criterion: z.string().describe("The criterion being scored, copied verbatim."),
  score: z.number().int().min(1).max(5).describe("1 = not at all, 3 = partially, 5 = fully."),
  reason: z.string().max(400).describe("One sentence citing what in the image drove the score."),
});

const zJudgement = z.object({
  criteria: z.array(zCriterionScore),
  overall: z.number().int().min(1).max(5).describe("Overall quality as a design, 1 to 5."),
  summary: z.string().max(600).describe("Two sentences at most."),
});

export type Judgement = z.infer<typeof zJudgement>;

export interface JudgeResult {
  /** 0..1, the mean of the per-criterion scores. */
  criteriaScore: number;
  /** 0..1, the overall rating. */
  overallScore: number;
  judgement: Judgement;
  model: string;
  usage: TokenUsage;
  costUsd: number;
  /**
   * False when the judge model is absent from the pricing table, so its
   * `costUsd` is 0 and meaningless.
   *
   * Carried on the result rather than looked up by the scorer, because
   * `scoreRun` adds this cost to the agent's and has to say whether the sum is
   * known — and the scorer is one of the modules that must stay free of Node
   * and of the provider SDKs, so it cannot reach for the model registry to ask.
   */
  pricingKnown: boolean;
  error?: string;
}

export const JUDGE_SYSTEM = [
  "You are assessing a finished visual document against the brief it was made from.",
  "",
  "You will be shown the brief, the criteria to assess, and an image of the result.",
  "Where the task started from an existing layout you will also be shown the before image.",
  "",
  "Score each criterion from 1 to 5, where 1 means not at all, 3 means partially, and 5 means fully.",
  "Judge only what you can see. Do not speculate about how the document was produced, what tools were",
  "used, or how much effort it took — you have no information about any of that, and it is not relevant.",
  "",
  "Be discriminating. A layout that satisfies the brief but looks careless is not a 5. A layout that",
  "looks pleasant but ignores an explicit requirement is not a 5 either. Reserve 5 for work you would",
  "be happy to ship, and do not round up out of politeness.",
].join("\n");

export interface JudgeRunInput {
  brief: string;
  criteria: string[];
  finalDoc: Doc;
  /** Shown as a "before" image when the task started from an existing layout. */
  initialDoc?: Doc;
  model?: string;
  /** Injected for tests. Bypasses provider resolution entirely. */
  languageModel?: LanguageModel;
}

type JudgeContent = Extract<ModelMessage, { role: "user" }>["content"];

function imagePart(doc: Doc) {
  return {
    type: "file" as const,
    mediaType: "image/png",
    data: {
      type: "data" as const,
      data: rasterize(doc, { pixelWidth: JUDGE_SCREENSHOT_WIDTH }).toString("base64"),
    },
  };
}

function textPart(text: string) {
  return { type: "text" as const, text };
}

export async function judgeRun(input: JudgeRunInput): Promise<JudgeResult> {
  const model = input.model ?? DEFAULT_JUDGE_MODEL;
  const spec = getModel(model);

  const content: JudgeContent = [textPart(`# Brief given to the designer\n\n${input.brief}`)];

  const startedFromLayout = (input.initialDoc?.elements.length ?? 0) > 0;
  if (startedFromLayout && input.initialDoc) {
    content.push(textPart("\n# Before"));
    content.push(imagePart(input.initialDoc));
  }
  content.push(textPart(startedFromLayout ? "\n# After" : "\n# Result"));
  content.push(imagePart(input.finalDoc));
  content.push(
    textPart(
      `\n# Criteria\n\n${input.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\n` +
        `Return exactly ${input.criteria.length} ${input.criteria.length === 1 ? "entry" : "entries"} in \`criteria\`: ` +
        `one for each numbered criterion above and none of your own, each copying its criterion verbatim. ` +
        `The overall rating goes in the separate \`overall\` field — it is not one of the criteria.`,
    ),
  );

  try {
    const response = await generateObject({
      model: input.languageModel ?? resolveLanguageModel(model),
      schema: zJudgement,
      maxOutputTokens: 4000,
      maxRetries: MAX_RETRIES,
      instructions: {
        role: "system",
        content: JUDGE_SYSTEM,
        // Every judge call in a sweep shares this prefix.
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      messages: [{ role: "user", content }],
    });

    const usage = tokenUsage(response.usage);
    const judgement = response.object;
    const aligned = alignCriteria(input.criteria, judgement.criteria);
    if ("error" in aligned) {
      return {
        criteriaScore: 0,
        overallScore: 0,
        judgement,
        model,
        usage,
        costUsd: costUsd(usage, spec),
        pricingKnown: spec.priced,
        error: aligned.error,
      };
    }

    const mean = aligned.scores.reduce((s, v) => s + v, 0) / aligned.scores.length;
    return {
      criteriaScore: toUnit(mean),
      overallScore: toUnit(judgement.overall),
      judgement,
      model,
      usage,
      costUsd: costUsd(usage, spec),
      pricingKnown: spec.priced,
    };
  } catch (err) {
    // A call that produced no usable object still cost money, so bill what the
    // error carries rather than reporting a failed judge call as free.
    const usage = NoObjectGeneratedError.isInstance(err) && err.usage ? tokenUsage(err.usage) : { ...ZERO_USAGE };
    return {
      criteriaScore: 0,
      overallScore: 0,
      judgement: { criteria: [], overall: 1, summary: "" },
      model,
      usage,
      costUsd: costUsd(usage, spec),
      pricingKnown: spec.priced,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Map a 1..5 rating onto 0..1. */
export function toUnit(score: number): number {
  return Math.max(0, Math.min(1, (score - 1) / 4));
}

function normalizeCriterion(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[.?!]+$/, "").trim();
}

/**
 * Line the judge's returned scores up with the criteria that were asked for.
 *
 * The prompt says to copy each criterion verbatim, and the schema cannot
 * enforce that: nothing stops a model returning four of five criteria, the
 * same one twice, or a paraphrase. Any of those quietly changes what the mean
 * is a mean *of*, and `judgeCriteriaScore` is 40% of the composite — a run
 * scored against three criteria is not comparable with one scored against
 * five, and neither the score nor the report would show the difference.
 *
 * So: match on normalized text, fall back to position only when the counts
 * agree (a model that paraphrases usually keeps the order), and refuse
 * anything else. A refusal sets `error`, which keeps the judge out of the
 * composite entirely rather than blending in a number built on the wrong set.
 *
 * Two kinds of trailing row are dropped rather than refused, because neither
 * names a criterion at all and neither can be a paraphrase of one. Models
 * append them often enough to discard most of a sweep's judgements otherwise,
 * and a discard still costs what the call cost.
 *
 *   - A row named "overall": the separate `overall` field restated as though
 *     it were a criterion.
 *   - A row that is blank throughout: no criterion name and no reason. Scoring
 *     nothing and naming nothing, it belongs in no mean.
 *
 * The second is checked on the reason as well as the name, because the two
 * cases are not the same. A row with no name and no reason said nothing and can
 * be dropped. A row with no name but a written reason *judged* something and
 * failed to say what — there is no honest slot to put it in, so the judgement
 * is refused rather than quietly reduced to the rows that happen to line up.
 * The filler's score is not checked: a row that names nothing and explains
 * nothing carries no signal whatever number it came with, and the live examples
 * scoring 1 is not a rule worth hard-coding.
 *
 * Dropping either leaves a set that still lines up one-for-one with the
 * criteria requested, which is the property this function exists to guarantee.
 * Anything else that does not line up is refused exactly as before.
 */
const OVERALL_ROW = new Set(["overall", "overall rating", "overall score", "overall quality"]);

export function alignCriteria(
  requested: string[],
  entries: { criterion: string; score: number; reason?: string }[],
): { scores: number[] } | { error: string } {
  if (requested.length === 0) return { error: "No criteria were given to the judge." };
  if (entries.length === 0) return { error: "Judge returned no criterion scores." };

  // Dropped only when doing so reconciles the count, and never when the task
  // itself asked about something by that name.
  const asked = new Set(requested.map(normalizeCriterion));
  const notACriterion = (entry: { criterion: string; reason?: string }): boolean => {
    const key = normalizeCriterion(entry.criterion);
    if (asked.has(key)) return false;
    if (OVERALL_ROW.has(key)) return true;
    return key === "" && (entry.reason ?? "").trim() === "";
  };
  const returned =
    entries.length === requested.length + 1 ? entries.filter((e) => !notACriterion(e)) : entries;

  if (returned.length !== requested.length) {
    return { error: `Judge scored ${entries.length} criteria; ${requested.length} were asked for.` };
  }

  const byText = new Map<string, number[]>();
  requested.forEach((c, i) => {
    const key = normalizeCriterion(c);
    byText.set(key, [...(byText.get(key) ?? []), i]);
  });

  // `.fill` matters: `flatMap` and `forEach` skip the holes in a sparse array.
  const scores = new Array<number | undefined>(requested.length).fill(undefined);
  const unmatched: { criterion: string; score: number }[] = [];

  for (const entry of returned) {
    const key = normalizeCriterion(entry.criterion);
    const slots = byText.get(key);
    const slot = slots?.find((i) => scores[i] === undefined);
    if (slot !== undefined) {
      scores[slot] = entry.score;
      continue;
    }
    // An entry that names a criterion already scored is a duplicate, not a
    // paraphrase, and there is no honest slot left to put it in.
    if (slots) return { error: `Judge scored "${entry.criterion}" more than once.` };
    unmatched.push(entry);
  }

  // Counts already agree, so every remaining entry — a paraphrase of something
  // nobody else claimed — pairs with exactly one unfilled slot, in order.
  const openSlots = scores.flatMap((v, i) => (v === undefined ? [i] : []));
  openSlots.forEach((slot, i) => {
    const entry = unmatched[i];
    if (entry) scores[slot] = entry.score;
  });

  const missing = scores.flatMap((v, i) => (v === undefined ? [requested[i]!] : []));
  if (missing.length > 0) {
    return { error: `Judge did not score: ${missing.join("; ")}` };
  }
  return { scores: scores as number[] };
}
