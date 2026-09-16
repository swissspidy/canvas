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
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Doc } from "../doc/types.js";
import { rasterize } from "../render/raster.js";
import { addUsage, costUsd, getModel, ZERO_USAGE, type TokenUsage } from "../agent/models.js";

export const DEFAULT_JUDGE_MODEL = "claude-opus-5";
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
  client?: Anthropic;
}

function imageBlock(doc: Doc): Anthropic.ImageBlockParam {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: "image/png",
      data: rasterize(doc, { pixelWidth: JUDGE_SCREENSHOT_WIDTH }).toString("base64"),
    },
  };
}

export async function judgeRun(input: JudgeRunInput): Promise<JudgeResult> {
  const client = input.client ?? new Anthropic();
  const model = input.model ?? DEFAULT_JUDGE_MODEL;
  const spec = getModel(model);

  const content: Anthropic.ContentBlockParam[] = [
    { type: "text", text: `# Brief given to the designer\n\n${input.brief}` },
  ];

  const startedFromLayout = (input.initialDoc?.elements.length ?? 0) > 0;
  if (startedFromLayout && input.initialDoc) {
    content.push({ type: "text", text: "\n# Before" });
    content.push(imageBlock(input.initialDoc));
  }
  content.push({ type: "text", text: startedFromLayout ? "\n# After" : "\n# Result" });
  content.push(imageBlock(input.finalDoc));
  content.push({
    type: "text",
    text: `\n# Criteria\n\n${input.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nScore every criterion, then give an overall rating.`,
  });

  try {
    const response = await client.messages.parse({
      model,
      max_tokens: 4000,
      system: [{ type: "text", text: JUDGE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(zJudgement) },
    });

    const usage = addUsage(ZERO_USAGE, {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    });

    const judgement = response.parsed_output;
    if (!judgement) {
      return {
        criteriaScore: 0,
        overallScore: 0,
        judgement: { criteria: [], overall: 1, summary: "" },
        model,
        usage,
        costUsd: costUsd(usage, spec),
        error: "Judge returned no parseable judgement.",
      };
    }

    const scores = judgement.criteria.map((c) => c.score);
    const mean = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : 1;
    return {
      criteriaScore: toUnit(mean),
      overallScore: toUnit(judgement.overall),
      judgement,
      model,
      usage,
      costUsd: costUsd(usage, spec),
    };
  } catch (err) {
    return {
      criteriaScore: 0,
      overallScore: 0,
      judgement: { criteria: [], overall: 1, summary: "" },
      model,
      usage: { ...ZERO_USAGE },
      costUsd: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Map a 1..5 rating onto 0..1. */
export function toUnit(score: number): number {
  return Math.max(0, Math.min(1, (score - 1) / 4));
}
