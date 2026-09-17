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

/** A model that answers once and calls nothing — the `--dry-run` stand-in. */
export function dryRunModel(): MockLanguageModelV4 {
  return createScriptedModel(fixedScript([{ text: "Dry run: no changes made." }]), {
    provider: "dry-run",
    modelId: "dry-run",
  });
}
