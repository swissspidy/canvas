/**
 * The pairwise judge.
 *
 * An absolute rating saturates: shown one competent page at a time, a judge
 * gives most of them a 4 or a 5, and the pages the deterministic checks can no
 * longer separate end up a few points apart on the judge too. Shown two pages
 * made from the same brief and asked which is the better design, it has to
 * choose — and a choice between two passing pages is exactly the comparison a
 * saturated benchmark has left.
 *
 * Every pair is judged twice, once in each order, because a model asked to
 * pick between A and B favours one position often enough to matter. A page
 * wins the pair only if it wins both orders; a split is a tie. Position bias
 * therefore costs ties, never a wrong winner.
 *
 * Blinded the same way as the absolute judge: the prompt carries the brief and
 * the images, never the surface, feedback condition, model, turns or cost.
 */

import { generateObject, NoObjectGeneratedError, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";
import type { Doc } from "../doc/types.js";
import { rasterize } from "../render/raster.js";
import { costUsd, getModel, MAX_RETRIES, resolveLanguageModel, tokenUsage, ZERO_USAGE, addUsage, type TokenUsage } from "../agent/models.js";
import { DEFAULT_JUDGE_MODEL, JUDGE_SCREENSHOT_WIDTH, scaleNote } from "./judge.js";

export const PAIRWISE_SYSTEM = [
  "You are comparing two finished visual documents made from the same brief.",
  "",
  "You will be shown the brief, the starting layout when there was one, and two results labelled",
  "First and Second. Decide which is the better design for that brief: the one you would rather ship.",
  "",
  "Weigh explicit requirements of the brief first, then the craft a careful designer would check —",
  "hierarchy, spacing and alignment, line breaks, contrast, and how well the page uses the canvas.",
  "Judge only what you can see; you know nothing about how either was made.",
  "",
  "Name the differences that decide it before giving a verdict. Answer \"tie\" only when you would",
  "genuinely be as happy shipping either one — not to avoid choosing between two good pages.",
].join("\n");

const zVerdict = z.object({
  differences: z.string().max(800).describe("The visible differences that decide it, in two or three sentences."),
  better: z.enum(["first", "second", "tie"]),
});

export type PairWinner = "a" | "b" | "tie";

export interface PairResult {
  winner: PairWinner;
  /** The verdict in each order: [a shown first, b shown first]. */
  verdicts: [string, string];
  reasons: [string, string];
  model: string;
  usage: TokenUsage;
  costUsd: number;
  pricingKnown: boolean;
  error?: string;
}

export interface PairInput {
  brief: string;
  initialDoc?: Doc;
  a: Doc;
  b: Doc;
  model?: string;
  /** Injected for tests. */
  languageModel?: LanguageModel;
}

type Content = Extract<ModelMessage, { role: "user" }>["content"];

function image(doc: Doc) {
  return {
    type: "file" as const,
    mediaType: "image/png",
    data: { type: "data" as const, data: rasterize(doc, { pixelWidth: JUDGE_SCREENSHOT_WIDTH }).toString("base64") },
  };
}

function content(input: PairInput, first: Doc, second: Doc): Content {
  const parts: Content = [{ type: "text", text: `# Brief\n\n${input.brief}\n\n${scaleNote(first)}` }];
  if ((input.initialDoc?.elements.length ?? 0) > 0 && input.initialDoc) {
    parts.push({ type: "text", text: "\n# Starting layout" }, image(input.initialDoc));
  }
  parts.push({ type: "text", text: "\n# First" }, image(first));
  parts.push({ type: "text", text: "\n# Second" }, image(second));
  parts.push({ type: "text", text: "\nWhich is the better design for this brief?" });
  return parts;
}

/** Combine the two orders: a page wins only if it wins both. */
export function combineOrders(aFirst: string, bFirst: string): PairWinner {
  const aWins = aFirst === "first" && bFirst === "second";
  const bWins = aFirst === "second" && bFirst === "first";
  return aWins ? "a" : bWins ? "b" : "tie";
}

export async function judgePair(input: PairInput): Promise<PairResult> {
  const model = input.model ?? DEFAULT_JUDGE_MODEL;
  const spec = getModel(model);
  let usage: TokenUsage = { ...ZERO_USAGE };

  const ask = async (first: Doc, second: Doc) => {
    try {
      const response = await generateObject({
        model: input.languageModel ?? resolveLanguageModel(model),
        schema: zVerdict,
        maxOutputTokens: 4000,
        maxRetries: MAX_RETRIES,
        instructions: {
          role: "system",
          content: PAIRWISE_SYSTEM,
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        },
        messages: [{ role: "user", content: content(input, first, second) }],
      });
      usage = addUsage(usage, tokenUsage(response.usage));
      return response.object;
    } catch (err) {
      if (NoObjectGeneratedError.isInstance(err) && err.usage) usage = addUsage(usage, tokenUsage(err.usage));
      throw err;
    }
  };

  try {
    const aFirst = await ask(input.a, input.b);
    const bFirst = await ask(input.b, input.a);
    return {
      winner: combineOrders(aFirst.better, bFirst.better),
      verdicts: [aFirst.better, bFirst.better],
      reasons: [aFirst.differences, bFirst.differences],
      model,
      usage,
      costUsd: costUsd(usage, spec),
      pricingKnown: spec.priced,
    };
  } catch (err) {
    return {
      winner: "tie",
      verdicts: ["", ""],
      reasons: ["", ""],
      model,
      usage,
      costUsd: costUsd(usage, spec),
      pricingKnown: spec.priced,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** The fields pair drawing needs from a scored run. */
export interface PairCandidate {
  runId: string;
  taskId: string;
  group: string;
}

export interface Pair {
  id: string;
  taskId: string;
  a: PairCandidate;
  b: PairCandidate;
}

/**
 * Draw up to `perTask` pairs per task, each between runs from different
 * groups (two models, two surfaces — whatever `group` names). Seeded, so the
 * same sweep and settings draw the same pairs and a resumed comparison skips
 * the ones already judged. Which run is `a` is random, so neither group sits
 * in one position more than chance puts it there.
 */
export function drawPairs(candidates: PairCandidate[], perTask: number, rng: () => number): Pair[] {
  const byTask = new Map<string, PairCandidate[]>();
  for (const c of candidates) byTask.set(c.taskId, [...(byTask.get(c.taskId) ?? []), c]);

  const pairs: Pair[] = [];
  for (const [taskId, runs] of [...byTask].sort(([x], [y]) => x.localeCompare(y))) {
    const possible: [PairCandidate, PairCandidate][] = [];
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        if (runs[i]!.group !== runs[j]!.group) possible.push([runs[i]!, runs[j]!]);
      }
    }
    // Fisher-Yates, then take the first `perTask`.
    for (let i = possible.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [possible[i], possible[j]] = [possible[j]!, possible[i]!];
    }
    for (const [x, y] of possible.slice(0, perTask)) {
      const [a, b] = rng() < 0.5 ? [x, y] : [y, x];
      pairs.push({ id: `${a.runId}~${b.runId}`, taskId, a, b });
    }
  }
  return pairs;
}

export interface GroupRecord {
  group: string;
  wins: number;
  losses: number;
  ties: number;
  /** (wins + ties / 2) / comparisons. */
  winRate: number;
}

/** Win, loss and tie counts per group, best first. Pairs that errored are left out. */
export function tallyPairs(results: { a: string; b: string; winner: PairWinner; error?: string }[]): GroupRecord[] {
  const records = new Map<string, GroupRecord>();
  const get = (group: string) => {
    let r = records.get(group);
    if (!r) records.set(group, (r = { group, wins: 0, losses: 0, ties: 0, winRate: 0 }));
    return r;
  };
  for (const p of results) {
    if (p.error) continue;
    const a = get(p.a);
    const b = get(p.b);
    if (p.winner === "a") {
      a.wins++;
      b.losses++;
    } else if (p.winner === "b") {
      b.wins++;
      a.losses++;
    } else {
      a.ties++;
      b.ties++;
    }
  }
  for (const r of records.values()) {
    const n = r.wins + r.losses + r.ties;
    r.winRate = n ? (r.wins + r.ties / 2) / n : 0;
  }
  return [...records.values()].sort((x, y) => y.winRate - x.winRate);
}
