/**
 * The cross-provider agent loop, on the Vercel AI SDK.
 *
 * Deliberately a near-copy of `src/agent/loop.ts` in structure: same turn
 * budget, same feedback attachment, same stop reasons, same `RunResult`. The
 * two loops exist for different jobs — the native one has prompt caching and
 * Anthropic's own knobs and carries the confirmatory grid, this one runs every
 * provider through one code path for the generality check — and the closer
 * they are, the less the harness contributes to a cross-model comparison.
 *
 * Tools are declared *without* an `execute`, so `generateText` returns tool
 * calls rather than running them and the loop keeps the same explicit control
 * it has on the native path: it executes against the session itself, records
 * every rejection, and decides what feedback rides back.
 */

import { generateText, jsonSchema, tool, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import type { Doc } from "../doc/types.js";
import { DocSession } from "../doc/session.js";
import { toolInputSchema } from "../doc/schema.js";
import { executeToolCall } from "../surfaces/execute.js";
import type { ToolSurface } from "../surfaces/types.js";
import type { Task } from "../tasks/types.js";
import type { FeedbackBlock, FeedbackChannel } from "../feedback/index.js";
import { renderSvg } from "../render/svg.js";
import { addUsage, ZERO_USAGE, type Effort, type TokenUsage } from "./models.js";
import { noopSink, type AgentEvent, type EventSink, type StopReason } from "./events.js";
import { initialUserBlocks, systemPrompt } from "./prompt.js";
import { PRICING, reasoningFor, resolveModel, type ResolvedModel } from "./providers.js";
import type { RunResult, TurnRecord } from "./loop.js";

export interface AiSdkRunConfig {
  runId: string;
  task: Task;
  surface: ToolSurface;
  surfaceProvider?: () => ToolSurface;
  feedback: FeedbackChannel;
  /** `provider:modelId`, e.g. `anthropic:claude-opus-5`. */
  model: string;
  effort?: Effort;
  maxTurns?: number;
  maxTokens?: number;
  /** Injected for tests. Bypasses provider resolution entirely. */
  languageModel?: LanguageModel;
  onEvent?: EventSink;
  signal?: AbortSignal;
}

const DEFAULT_MAX_TOKENS = 16_000;

/** Every surface tool, declared with no executor so the loop keeps control. */
function buildToolSet(surface: ToolSurface): ToolSet {
  const tools: ToolSet = {};
  for (const def of surface.tools) {
    tools[def.name] = tool({
      description: def.description,
      // The same JSON Schema the native path sends, generated from the same
      // Zod definition — so the model sees an identical contract either way.
      inputSchema: jsonSchema(toolInputSchema(def.schema) as Parameters<typeof jsonSchema>[0]),
    });
  }
  return tools;
}

type UserContentPart =
  | { type: "text"; text: string }
  | { type: "file"; mediaType: string; data: { type: "data"; data: string } };

/**
 * A `file` part rather than the older `image` part: the SDK deprecated
 * `image` in favour of `file` with an explicit media type, and providers
 * resolve images from the media type either way.
 */
function toUserContent(blocks: FeedbackBlock[]): UserContentPart[] {
  return blocks.map((b) =>
    b.type === "text"
      ? ({ type: "text", text: b.text } as const)
      : ({ type: "file", mediaType: b.mediaType, data: { type: "data", data: b.png.toString("base64") } } as const),
  );
}

type ToolOutputContent = Array<
  | { type: "text"; text: string }
  | { type: "file"; mediaType: string; data: { type: "data"; data: string } }
>;

function toToolOutputContent(message: string, blocks: FeedbackBlock[]): ToolOutputContent {
  const out: ToolOutputContent = [{ type: "text", text: message }];
  for (const block of blocks) {
    if (block.type === "text") out.push({ type: "text", text: block.text });
    else out.push({ type: "file", mediaType: block.mediaType, data: { type: "data", data: block.png.toString("base64") } });
  }
  return out;
}

/** Elide base64 payloads so a saved transcript stays a readable size. */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(obj)) {
      if ((key === "image" || key === "data") && typeof v === "string" && v.length > 256) {
        out[key] = `<${v.length} base64 chars elided>`;
      } else {
        out[key] = redact(v);
      }
    }
    return out;
  }
  return value;
}

export async function runAgentViaAiSdk(config: AiSdkRunConfig): Promise<RunResult> {
  const startedAt = Date.now();
  const emit: EventSink = config.onEvent ?? noopSink;
  const maxTurns = config.maxTurns ?? config.task.maxTurns;
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const effort = config.effort ?? "high";

  let resolved: ResolvedModel | null = null;
  let languageModel: LanguageModel;
  if (config.languageModel) {
    languageModel = config.languageModel;
  } else {
    resolved = resolveModel(config.model);
    languageModel = resolved.model;
  }

  const initialDoc = config.task.initial();
  const session = new DocSession(initialDoc);
  let surface = config.surface;
  let tools = buildToolSet(surface);
  const surfacesUsed: string[] = [surface.id];

  emit({
    type: "run_start",
    runId: config.runId,
    taskId: config.task.id,
    surface: surface.id,
    feedback: config.feedback.mode,
    model: config.model,
    brief: config.task.brief,
    doc: initialDoc,
  });

  const messages: ModelMessage[] = [
    { role: "user", content: toUserContent(initialUserBlocks(config.task, initialDoc, config.feedback)) as never },
  ];

  let usage: TokenUsage = { ...ZERO_USAGE };
  const turnRecords: TurnRecord[] = [];
  const toolUsage: Record<string, { ok: number; failed: number }> = {};
  let stopReason: StopReason = "max_turns";
  let error: string | undefined;
  let turn = 0;

  try {
    for (turn = 1; turn <= maxTurns; turn++) {
      if (config.signal?.aborted) {
        stopReason = "aborted";
        break;
      }
      emit({ type: "turn_start", turn });
      const turnStarted = Date.now();

      const requested = config.surfaceProvider?.();
      if (requested && requested.id !== surface.id) {
        const from = surface.id;
        surface = requested;
        tools = buildToolSet(surface);
        surfacesUsed.push(surface.id);
        messages.push({ role: "system", content: switchNotice(surface) });
        emit({ type: "surface_switch", turn, from, to: surface.id });
      }

      const result = await generateText({
        model: languageModel,
        system: systemPrompt(surface),
        messages,
        tools,
        maxOutputTokens: maxTokens,
        // One provider-neutral scale, mapped per provider by the SDK rather
        // than by a mapping invented here. See `src/agent/providers.ts`.
        reasoning: reasoningFor(effort),
        // A system message may appear mid-conversation, to announce a surface
        // switch as an operator instruction rather than as user speech.
        allowSystemInMessages: true,
        ...(config.signal ? { abortSignal: config.signal } : {}),
      });

      const turnUsage: TokenUsage = {
        // `inputTokens` is the total; `noCacheTokens` is the part actually
        // billed at full rate, which is what the native path reports.
        input: result.usage.inputTokenDetails?.noCacheTokens ?? result.usage.inputTokens ?? 0,
        output: result.usage.outputTokens ?? 0,
        cacheRead: result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
        cacheWrite: result.usage.inputTokenDetails?.cacheWriteTokens ?? 0,
      };
      usage = addUsage(usage, turnUsage);

      if (result.reasoningText) emit({ type: "thinking", turn, text: result.reasoningText });
      if (result.text) emit({ type: "text", turn, text: result.text });

      const record = (toolCalls: number): void => {
        turnRecords.push({
          turn,
          usage: turnUsage,
          stopReason: result.finishReason,
          toolCalls,
          ms: Date.now() - turnStarted,
        });
      };

      // A filtered turn can cut a tool call off mid-input, so its tools never run.
      if (result.finishReason === "content-filter") {
        stopReason = "refusal";
        error = `Model declined the request (finishReason: content-filter).`;
        emit({ type: "error", message: error, fatal: true });
        record(0);
        break;
      }

      if (result.finishReason === "length") {
        stopReason = "max_tokens";
        error = `Turn ${turn} hit the output limit (${maxTokens}) before finishing.`;
        emit({ type: "error", message: error, fatal: true });
        record(result.toolCalls.length);
        break;
      }

      if (result.finishReason === "error") {
        stopReason = "api_error";
        error = `Turn ${turn} ended with finishReason 'error'.`;
        emit({ type: "error", message: error, fatal: true });
        record(0);
        break;
      }

      if (result.toolCalls.length === 0) {
        stopReason = "completed";
        record(0);
        emit({ type: "turn_end", turn, usage: turnUsage, stopReason: result.finishReason });
        break;
      }

      messages.push(...(result.responseMessages as ModelMessage[]));

      const results: {
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        output: { type: "error-text"; value: string } | { type: "content"; value: ToolOutputContent };
        ok: boolean;
        /** Kept so feedback can be folded in without re-deriving it from `output`. */
        message: string;
      }[] = [];

      for (const call of result.toolCalls) {
        const input = (call as { input?: unknown }).input ?? {};
        emit({ type: "tool_call", turn, seq: session.actions.length + 1, tool: call.toolName, input });
        const outcome = executeToolCall(session, surface, call.toolName, input);

        const counter = (toolUsage[call.toolName] ??= { ok: 0, failed: 0 });
        if (outcome.ok) counter.ok++;
        else counter.failed++;

        emit({
          type: "tool_result",
          turn,
          seq: outcome.record.seq,
          tool: call.toolName,
          ok: outcome.ok,
          message: outcome.message,
          touched: outcome.touched,
        });
        if (outcome.ok) {
          emit({ type: "doc_update", turn, seq: outcome.record.seq, doc: session.doc, svg: renderSvg(session.doc) });
        }

        results.push({
          type: "tool-result",
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          // `error-text` is this SDK's equivalent of Anthropic's `is_error`,
          // so a rejected call reads the same way on both paths.
          output: outcome.ok
            ? { type: "content", value: [{ type: "text", text: outcome.message }] }
            : { type: "error-text", value: outcome.message },
          ok: outcome.ok,
          message: outcome.message,
        });
      }

      const feedbackBlocks = config.feedback.after(session.doc);
      if (feedbackBlocks.length > 0) {
        emit({
          type: "feedback",
          turn,
          mode: config.feedback.mode,
          hasImage: feedbackBlocks.some((b) => b.type === "image"),
          text: feedbackBlocks.find((b): b is Extract<FeedbackBlock, { type: "text" }> => b.type === "text")?.text,
        });
      }

      // Feedback rides on the last successful result. An `error-text` output
      // carries no content array, so when every call this turn failed it goes
      // in a following user message instead — the only place the two loops
      // structurally differ, and only in a turn where nothing changed.
      let attached = false;
      if (feedbackBlocks.length > 0) {
        for (let i = results.length - 1; i >= 0; i--) {
          const candidate = results[i]!;
          if (!candidate.ok) continue;
          candidate.output = { type: "content", value: toToolOutputContent(candidate.message, feedbackBlocks) };
          attached = true;
          break;
        }
      }

      messages.push({
        role: "tool",
        content: results.map(({ ok: _ok, message: _message, ...part }) => part) as never,
      });
      if (feedbackBlocks.length > 0 && !attached) {
        messages.push({ role: "user", content: toUserContent(feedbackBlocks) as never });
      }

      record(result.toolCalls.length);
      emit({ type: "turn_end", turn, usage: turnUsage, stopReason: result.finishReason });
    }
  } catch (err) {
    stopReason = config.signal?.aborted ? "aborted" : "api_error";
    error = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message: error, fatal: true });
  }

  // Pricing comes from the spec, not from model resolution: a dry run or a
  // test injects its own language model but still names a real model, and
  // reporting that as unpriced would be misleading.
  const pricing = resolved?.pricing ?? PRICING[config.model] ?? null;
  const costUsd = pricing
    ? (usage.input * pricing.inputPerMTok +
        usage.output * pricing.outputPerMTok +
        usage.cacheWrite * pricing.inputPerMTok * pricing.cacheWriteMultiplier +
        usage.cacheRead * pricing.inputPerMTok * pricing.cacheReadMultiplier) *
      1e-6
    : 0;

  const result: RunResult = {
    runId: config.runId,
    taskId: config.task.id,
    surfaceId: config.surface.id,
    surfacesUsed,
    feedbackMode: config.feedback.mode,
    model: config.model,
    effort,
    stopReason,
    ...(error ? { error } : {}),
    turns: Math.min(turn, maxTurns),
    turnRecords,
    toolCalls: session.actions.length,
    failedToolCalls: session.failedActions,
    toolUsage,
    usage,
    costUsd,
    pricingKnown: pricing !== null,
    runner: "aisdk",
    wallMs: Date.now() - startedAt,
    initialDoc,
    finalDoc: session.doc,
    session,
    transcript: redact(messages) as unknown[],
  };

  emit({
    type: "run_end",
    runId: config.runId,
    reason: stopReason,
    turns: result.turns,
    usage,
    costUsd: result.costUsd,
  });
  return result;
}

function switchNotice(surface: ToolSurface): string {
  return [
    `Your tools have been replaced. From now on you have the ${surface.title.toLowerCase()} tool set.`,
    "",
    surface.briefing,
    "",
    "The document is unchanged. Carry on from where you are with the tools you now have.",
  ].join("\n");
}

/** Never used to name a document; exported so the runner can label a sweep. */
export function describeModelSpec(spec: string): string {
  return spec;
}

export type { Doc };
