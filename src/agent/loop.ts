/**
 * The agent loop.
 *
 * One loop, on the Vercel AI SDK, for every provider — Claude included. A
 * second hand-written Anthropic loop used to sit beside this one, and the two
 * were structural near-copies that had to be kept in step by a parity test.
 * Collapsing them removes the drift risk and, more importantly, removes an
 * ambiguity from the results: a difference between two models can no longer be
 * a difference between two harnesses.
 *
 * A manual loop rather than the SDK's own tool runner, for three reasons this
 * study actually needs: every tool result has to carry feedback blocks chosen
 * by a channel the runner knows nothing about; every turn's usage has to be
 * recorded separately for the cost analysis; and a refused or truncated turn
 * has to be recorded as an outcome rather than swallowed. So tools are
 * declared *without* an `execute`: `generateText` returns tool calls, and this
 * loop executes them against the session itself, records every rejection, and
 * decides what feedback rides back.
 *
 * Deliberately *not* used:
 *
 *   - Schema-enforced ("strict") tool calling. It would make malformed tool
 *     calls impossible, and how often a surface provokes a malformed call is
 *     one of the things being measured. Inputs are validated against the same
 *     Zod schema instead, and rejections are recorded.
 *   - Automatic retries on a refusal or a filtered turn. Silently re-running a
 *     refused turn would corrupt the model variable. A refusal ends the run
 *     and is reported as one.
 */

import {
  generateText,
  jsonSchema,
  tool,
  type LanguageModel,
  type ModelMessage,
  type SystemModelMessage,
  type ToolSet,
} from "ai";
import type { Doc } from "../doc/types.js";
import { DocSession } from "../doc/session.js";
import { toolInputSchema } from "../doc/schema.js";
import { executeToolCall } from "../surfaces/execute.js";
import type { ToolSurface } from "../surfaces/types.js";
import type { Task } from "../tasks/types.js";
import type { FeedbackBlock, FeedbackChannel } from "../feedback/index.js";
import { renderSvg } from "../render/svg.js";
import { toBase64 } from "../render/rasterizer.js";
import {
  addUsage,
  costUsd,
  getModel,
  reasoningFor,
  resolveLanguageModel,
  tokenUsage,
  ZERO_USAGE,
  type Effort,
  type TokenUsage,
} from "./models.js";
import { noopSink, type EventSink, type StopReason } from "./events.js";
import { initialUserBlocks, systemPrompt } from "./prompt.js";

export interface RunConfig {
  runId: string;
  task: Task;
  surface: ToolSurface;
  /**
   * Consulted at the start of every turn. Returning a different surface swaps
   * the tool list mid-run, keeping the document and the conversation — this is
   * what the live page's surface toggle drives, and it is the demo worth
   * sharing: the same brief, the same half-built layout, a different
   * vocabulary from here on.
   *
   * It costs a prompt-cache miss, because tools render before the system
   * prompt. That is unavoidable and is not worth working around for a demo.
   */
  surfaceProvider?: () => ToolSurface;
  feedback: FeedbackChannel;
  /** `provider:modelId`, e.g. `anthropic:claude-opus-5`. */
  model: string;
  effort?: Effort;
  /** Overrides the task's own budget when set. */
  maxTurns?: number;
  maxTokens?: number;
  /**
   * Run against this model instead of resolving `model` to a provider. A
   * replay, a dry run and a test all need a model that never reaches the
   * network; `model` still names what is being stood in for.
   */
  languageModel?: LanguageModel;
  onEvent?: EventSink;
  signal?: AbortSignal;
}

export interface TurnRecord {
  turn: number;
  usage: TokenUsage;
  stopReason: string | null;
  toolCalls: number;
  ms: number;
}

export interface RunResult {
  runId: string;
  taskId: string;
  surfaceId: string;
  /** Every surface the run used, in order. Longer than one after a toggle. */
  surfacesUsed: string[];
  feedbackMode: string;
  model: string;
  effort: Effort | null;
  stopReason: StopReason;
  error?: string;
  turns: number;
  turnRecords: TurnRecord[];
  toolCalls: number;
  failedToolCalls: number;
  /** Per-tool call counts — which operations the agent actually reached for. */
  toolUsage: Record<string, { ok: number; failed: number }>;
  usage: TokenUsage;
  costUsd: number;
  /** False when the model is absent from the pricing table; cost is then 0 and meaningless. */
  pricingKnown: boolean;
  wallMs: number;
  initialDoc: Doc;
  finalDoc: Doc;
  session: DocSession;
  /** Transcript with image payloads replaced by placeholders. */
  transcript: unknown[];
}

const DEFAULT_MAX_TOKENS = 16_000;

/** Every surface tool, declared with no executor so the loop keeps control. */
function buildToolSet(surface: ToolSurface): ToolSet {
  const tools: ToolSet = {};
  for (const def of surface.tools) {
    tools[def.name] = tool({
      description: def.description,
      // Generated from the same Zod definition the validator uses, so the
      // contract the model sees is the contract its input is checked against.
      inputSchema: jsonSchema(toolInputSchema(def.schema) as Parameters<typeof jsonSchema>[0]),
    });
  }
  return tools;
}

/**
 * The instructions for a surface.
 *
 * The briefing is stable for every run on a surface and tools render ahead of
 * the system block, so a cache breakpoint here caches the whole prefix across
 * a sweep. `providerOptions` is namespaced, so providers that have no such
 * knob simply never read it.
 */
function instructionsFor(surface: ToolSurface): SystemModelMessage {
  return {
    role: "system",
    content: systemPrompt(surface),
    providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
  };
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "file"; mediaType: string; data: { type: "data"; data: string } };

/**
 * Feedback blocks as model content.
 *
 * A `file` part rather than the older `image` part: the SDK deprecated `image`
 * in favour of `file` with an explicit media type, and providers resolve
 * images from the media type either way.
 */
function toContentParts(blocks: FeedbackBlock[]): ContentPart[] {
  return blocks.map((b) =>
    b.type === "text"
      ? ({ type: "text", text: b.text } as const)
      : ({ type: "file", mediaType: b.mediaType, data: { type: "data", data: toBase64(b.png) } } as const),
  );
}

/** Elide base64 payloads so a saved transcript stays a readable size. */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const isPayload = (key === "image" || key === "data") && typeof v === "string" && v.length > 256;
      out[key] = isPayload ? `<${(v as string).length} base64 chars elided>` : redact(v);
    }
    return out;
  }
  return value;
}

/** The last call in a turn that succeeded, which is the one that can carry feedback. */
function lastSuccessful<T extends { ok: boolean }>(results: T[]): T | undefined {
  for (let i = results.length - 1; i >= 0; i--) {
    const candidate = results[i]!;
    if (candidate.ok) return candidate;
  }
  return undefined;
}

export async function runAgent(config: RunConfig): Promise<RunResult> {
  const startedAt = Date.now();
  const emit: EventSink = config.onEvent ?? noopSink;
  const maxTurns = config.maxTurns ?? config.task.maxTurns;
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const effort = config.effort ?? "high";
  const spec = getModel(config.model);
  const languageModel = config.languageModel ?? resolveLanguageModel(config.model);

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
    { role: "user", content: toContentParts(await initialUserBlocks(config.task, initialDoc, config.feedback)) },
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
        messages.push({ role: "user", content: switchNoticeText(surface) });
        emit({ type: "surface_switch", turn, from, to: surface.id });
      }

      const result = await generateText({
        model: languageModel,
        instructions: instructionsFor(surface),
        messages,
        tools,
        maxOutputTokens: maxTokens,
        // One provider-neutral scale, mapped per provider by the SDK rather
        // than by a mapping invented here. See `src/agent/models.ts`.
        reasoning: reasoningFor(effort),
        ...(config.signal ? { abortSignal: config.signal } : {}),
      });

      const turnUsage = tokenUsage(result.usage);
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
        error = "Model declined the request (finishReason: content-filter).";
        emit({ type: "error", message: error, fatal: true });
        record(0);
        break;
      }

      // Truncated output usually means a half-written tool input. Running it
      // would corrupt the document with something the model never finished
      // saying, so the run ends here and is recorded as truncated.
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
        output: { type: "error-text"; value: string } | { type: "content"; value: ContentPart[] };
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
          // `error-text` is how this SDK marks a failed call, so a rejection
          // reads as a rejection rather than as a result that says "no".
          output: outcome.ok
            ? { type: "content", value: [{ type: "text", text: outcome.message }] }
            : { type: "error-text", value: outcome.message },
          ok: outcome.ok,
          message: outcome.message,
        });
      }

      // Feedback describes the state after *all* of this turn's calls, so it
      // attaches once, to the last result that can carry it.
      const feedbackBlocks = await config.feedback.after(session.doc);
      if (feedbackBlocks.length > 0) {
        emit({
          type: "feedback",
          turn,
          mode: config.feedback.mode,
          hasImage: feedbackBlocks.some((b) => b.type === "image"),
          text: feedbackBlocks.find((b): b is Extract<FeedbackBlock, { type: "text" }> => b.type === "text")?.text,
        });
      }

      // An `error-text` output carries no content array, so when every call
      // this turn failed the feedback follows in a user message instead. That
      // costs one extra message, in exactly the turns where nothing changed.
      const carrier = feedbackBlocks.length > 0 ? lastSuccessful(results) : undefined;
      if (carrier) {
        carrier.output = {
          type: "content",
          value: [{ type: "text", text: carrier.message }, ...toContentParts(feedbackBlocks)],
        };
      }

      messages.push({
        role: "tool",
        content: results.map(({ ok: _ok, message: _message, ...part }) => part),
      });
      if (feedbackBlocks.length > 0 && !carrier) {
        messages.push({ role: "user", content: toContentParts(feedbackBlocks) });
      }

      record(result.toolCalls.length);
      emit({ type: "turn_end", turn, usage: turnUsage, stopReason: result.finishReason });
    }
  } catch (err) {
    stopReason = config.signal?.aborted ? "aborted" : "api_error";
    error = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message: error, fatal: true });
  }

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
    // Priced from the table, not from what was actually called: a dry run or a
    // test injects its own model but still names a real one, and reporting
    // that as unpriced would be misleading.
    costUsd: costUsd(usage, spec),
    pricingKnown: spec.priced,
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

/**
 * Tell the model its tools just changed.
 *
 * It goes in as a plain user turn rather than a mid-conversation system
 * message: across the providers this loop talks to, such a message is
 * accepted, ignored or rejected depending on who is receiving it, and the
 * surface switch is the one manipulation this study performs in front of every
 * model. One path, no provider-specific behaviour on the axis being measured.
 * The text labels itself as an operator notice to keep it distinct from the
 * brief.
 */
export function switchNoticeText(surface: ToolSurface): string {
  return [
    `[operator notice] Your tools have been replaced. From now on you have the ${surface.title.toLowerCase()} tool set.`,
    "",
    surface.briefing,
    "",
    "The document is unchanged. Carry on from where you are with the tools you now have.",
  ].join("\n");
}
