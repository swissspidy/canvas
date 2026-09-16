/**
 * A scripted stand-in for the Anthropic client.
 *
 * It exists so the loop itself can be tested — feedback attachment, tool
 * dispatch, usage accounting, every stop reason — without spending money or
 * depending on a sampled model that will not repeat. The real loop runs
 * unchanged against it; only the transport is swapped.
 *
 * It also lets the live page demo the surface toggle with no API key, which
 * matters for the shareable artifact: anyone can open the page and watch the
 * same brief build three ways.
 */

import type Anthropic from "@anthropic-ai/sdk";

export interface ScriptedToolCall {
  name: string;
  input: unknown;
}

export interface ScriptedTurn {
  /** Assistant prose for this turn. */
  text?: string;
  /** Tool calls to issue. An empty or absent list ends the run. */
  tools?: ScriptedToolCall[];
  stopReason?: Anthropic.Message["stop_reason"];
  usage?: Partial<{ input: number; output: number; cacheRead: number; cacheWrite: number }>;
  /** Throw instead of responding, to exercise the error path. */
  throws?: Error;
}

/** Decide the next turn from the conversation so far. */
export type ScriptedPolicy = (messages: Anthropic.MessageParam[], turn: number) => ScriptedTurn;

export function fixedScript(turns: ScriptedTurn[]): ScriptedPolicy {
  return (_messages, turn) => turns[turn - 1] ?? { text: "Done." };
}

/**
 * Records every request the loop makes, so tests can assert on what the model
 * would have seen — that the no-feedback condition really sent no images, for
 * instance.
 */
export interface ScriptedClient {
  readonly requests: Anthropic.MessageStreamParams[];
  messages: {
    stream(params: Anthropic.MessageStreamParams): { finalMessage(): Promise<Anthropic.Message> };
  };
}

export function createScriptedClient(policy: ScriptedPolicy): ScriptedClient & Anthropic {
  const requests: Anthropic.MessageStreamParams[] = [];
  let turn = 0;

  const client = {
    requests,
    messages: {
      stream(params: Anthropic.MessageStreamParams) {
        requests.push(params);
        turn++;
        const spec = policy((params.messages ?? []) as Anthropic.MessageParam[], turn);
        return {
          async finalMessage(): Promise<Anthropic.Message> {
            if (spec.throws) throw spec.throws;
            const content: Anthropic.ContentBlock[] = [];
            if (spec.text) content.push({ type: "text", text: spec.text, citations: null });
            for (const [i, call] of (spec.tools ?? []).entries()) {
              content.push({
                type: "tool_use",
                id: `toolu_${turn}_${i}`,
                name: call.name,
                input: call.input as Record<string, unknown>,
                caller: { type: "direct" },
              });
            }
            const stopReason: Anthropic.Message["stop_reason"] =
              spec.stopReason ?? ((spec.tools?.length ?? 0) > 0 ? "tool_use" : "end_turn");
            return {
              id: `msg_${turn}`,
              type: "message",
              role: "assistant",
              model: String(params.model),
              content,
              stop_reason: stopReason,
              stop_sequence: null,
              usage: {
                input_tokens: spec.usage?.input ?? 100,
                output_tokens: spec.usage?.output ?? 50,
                cache_read_input_tokens: spec.usage?.cacheRead ?? 0,
                cache_creation_input_tokens: spec.usage?.cacheWrite ?? 0,
                server_tool_use: null,
                service_tier: null,
              },
            } as Anthropic.Message;
          },
        };
      },
    },
  };
  return client as unknown as ScriptedClient & Anthropic;
}
