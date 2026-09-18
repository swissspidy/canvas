/**
 * A scripted stand-in for a real model.
 *
 * It exists so the loop itself can be tested — feedback attachment, tool
 * dispatch, usage accounting, every stop reason — without spending money or
 * depending on a sampled model that will not repeat. The real loop runs
 * unchanged against it; only the model is swapped.
 *
 * It is the SDK's own mock model underneath, so it is a `LanguageModel` like
 * any other: the same object serves the tests, `--dry-run` wiring checks and
 * the live page's replay mode, and none of them needs a second code path
 * through the loop. `doGenerateCalls` records every request, so a test can
 * assert on what the model would have seen — that the no-feedback condition
 * really sent no images, for instance.
 */

import { MockLanguageModelV4 } from "ai/test";
import type { TokenUsage } from "./models.js";

export interface ScriptedToolCall {
  name: string;
  input: unknown;
}

/** How a scripted turn ends, on the SDK's provider-neutral scale. */
export type ScriptedFinish = "stop" | "tool-calls" | "length" | "content-filter" | "error" | "other";

export interface ScriptedTurn {
  /** Assistant prose for this turn. */
  text?: string;
  /** Tool calls to issue. An empty or absent list ends the run. */
  tools?: ScriptedToolCall[];
  /** Defaults to `tool-calls` when this turn calls tools, `stop` otherwise. */
  finish?: ScriptedFinish;
  usage?: Partial<TokenUsage>;
  /** Throw instead of responding, to exercise the transport error path. */
  throws?: Error;
}

/** Decide the next turn. Turn numbers are 1-based. */
export type ScriptedPolicy = (turn: number) => ScriptedTurn;

export function fixedScript(turns: ScriptedTurn[]): ScriptedPolicy {
  return (turn) => turns[turn - 1] ?? { text: "Done." };
}

const DEFAULT_USAGE: TokenUsage = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 };

export interface ScriptedModelOptions {
  provider?: string;
  modelId?: string;
}

export function createScriptedModel(
  policy: ScriptedPolicy,
  options: ScriptedModelOptions = {},
): MockLanguageModelV4 {
  let turn = 0;
  return new MockLanguageModelV4({
    provider: options.provider ?? "scripted",
    modelId: options.modelId ?? "scripted",
    doGenerate: async () => {
      const spec = policy(++turn);
      if (spec.throws) throw spec.throws;

      const content = [
        ...(spec.text ? [{ type: "text" as const, text: spec.text }] : []),
        ...(spec.tools ?? []).map((call, i) => ({
          type: "tool-call" as const,
          toolCallId: `call_${turn}_${i}`,
          toolName: call.name,
          input: JSON.stringify(call.input),
        })),
      ];

      const usage = { ...DEFAULT_USAGE, ...spec.usage };
      const finish = spec.finish ?? ((spec.tools?.length ?? 0) > 0 ? "tool-calls" : "stop");

      return {
        content,
        finishReason: { unified: finish, raw: finish },
        usage: {
          inputTokens: {
            total: usage.input + usage.cacheRead + usage.cacheWrite,
            noCache: usage.input,
            cacheRead: usage.cacheRead,
            cacheWrite: usage.cacheWrite,
          },
          outputTokens: { total: usage.output, text: usage.output, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

/**
 * What a dry run does on each surface.
 *
 * `--dry-run` is advertised as the full pipeline with the model swapped out,
 * and it used to answer once and call nothing — which meant the one command
 * anyone runs before spending money never touched tool dispatch, argument
 * validation, the feedback channel, the conversation growing across turns, or
 * a document that differs from the one the task started with. It checked that
 * the matrix expanded and that files could be written. Everything a wiring
 * check exists to catch sat behind the first tool call.
 *
 * So each surface gets a short script in its own vocabulary: one call that
 * should succeed, one that should be rejected, and a sign-off. The rejection
 * is deliberate — a surface whose error path is broken is exactly the kind of
 * thing worth finding for free rather than at three cents a cell — and it
 * makes the dry run's `failureRate` non-zero by construction, so a report
 * built from one is obviously a rehearsal rather than a result.
 *
 * Positions are chosen to be legal on any task, and to sit inside the widest
 * margin any check asks for, so the rehearsal does not manufacture a margin
 * failure that reads like a finding. Nothing refers to an element id, which
 * varies by task.
 */
const DRY_RUN_SCRIPTS: Record<string, ScriptedTurn[]> = {
  coordinate: [
    {
      text: "Dry run: adding a probe element.",
      tools: [{ name: "create", input: { type: "rect", x: 100, y: 100, width: 10, height: 10, style: { fill: "#808080" } } }],
    },
    {
      text: "Dry run: exercising the rejection path.",
      tools: [{ name: "move", input: { id: "__no_such_element__", x: 0, y: 0 } }],
    },
    { text: "Dry run: no real work attempted." },
  ],
  relational: [
    {
      text: "Dry run: adding a probe element.",
      tools: [
        {
          name: "create",
          input: { type: "rect", width: 10, height: 10, relation: "canvas_center", style: { fill: "#808080" } },
        },
      ],
    },
    {
      text: "Dry run: exercising the rejection path.",
      tools: [{ name: "place", input: { id: "__no_such_element__", relation: "canvas_center" } }],
    },
    { text: "Dry run: no real work attempted." },
  ],
  document: [
    { text: "Dry run: reading the document.", tools: [{ name: "read_document", input: {} }] },
    {
      text: "Dry run: exercising the rejection path.",
      tools: [{ name: "write_document", input: { document: { elements: [] } } }],
    },
    { text: "Dry run: no real work attempted." },
  ],
  // Both vocabularies in one run, which is the only thing this surface adds.
  hybrid: [
    {
      text: "Dry run: adding a probe element with coordinates.",
      tools: [{ name: "create", input: { type: "rect", x: 100, y: 100, width: 10, height: 10, style: { fill: "#808080" } } }],
    },
    {
      text: "Dry run: exercising the rejection path.",
      tools: [{ name: "place", input: { id: "__no_such_element__", relation: "canvas_center" } }],
    },
    { text: "Dry run: no real work attempted." },
  ],
};

/**
 * The `--dry-run` stand-in, in the vocabulary of the surface it is standing in
 * for. An unrecognised surface falls back to answering once and calling
 * nothing, which is what every surface used to do.
 */
export function dryRunModel(surfaceId?: string): MockLanguageModelV4 {
  const script = (surfaceId === undefined ? undefined : DRY_RUN_SCRIPTS[surfaceId]) ?? [
    { text: "Dry run: no changes made." },
  ];
  return createScriptedModel(fixedScript(script), { provider: "dry-run", modelId: "dry-run" });
}
