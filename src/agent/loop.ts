/**
 * The agent loop.
 *
 * A manual loop rather than the SDK's tool runner, for three reasons this
 * study actually needs: every tool result has to carry feedback blocks chosen
 * by a channel the runner knows nothing about; every turn's usage has to be
 * recorded separately for the cost analysis; and a refused or truncated turn
 * has to be recorded as an outcome rather than swallowed.
 *
 * Deliberately *not* used:
 *
 *   - `strict: true` on tool definitions. It would make malformed tool calls
 *     impossible, and how often a surface provokes a malformed call is one of
 *     the things being measured. Inputs are validated against the same Zod
 *     schema instead, and rejections are recorded.
 *   - Server-side refusal fallbacks. Silently re-running a refused turn on a
 *     different model would corrupt the model variable. A refusal ends the run
 *     and is reported as one.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Doc } from "../doc/types.js";
import { DocSession } from "../doc/session.js";
import { toolInputSchema } from "../doc/schema.js";
import { executeToolCall } from "../surfaces/execute.js";
import type { ToolSurface } from "../surfaces/types.js";
import type { Task } from "../tasks/types.js";
import type { FeedbackBlock, FeedbackChannel } from "../feedback/index.js";
import { renderSvg } from "../render/svg.js";
import { addUsage, costUsd, getModel, ZERO_USAGE, type Effort, type TokenUsage } from "./models.js";
import { noopSink, type AgentEvent, type EventSink, type StopReason } from "./events.js";
import { initialUserBlocks, systemPrompt } from "./prompt.js";

export interface RunConfig {
  runId: string;
  task: Task;
  surface: ToolSurface;
  feedback: FeedbackChannel;
  model: string;
  effort?: Effort;
  /** Overrides the task's own budget when set. */
  maxTurns?: number;
  maxTokens?: number;
  /**
   * Stream large tool inputs as they are generated. Off by default: the API
   * stops validating eagerly streamed input, and it is documented as
   * unreliable through some proxies. Worth turning on for document-as-code
   * runs on a direct connection.
   */
  eagerInputStreaming?: boolean;
  /** Where feedback blocks are attached. `tool_result` keeps turn counts down. */
  feedbackPlacement?: "tool_result" | "user_message";
  client?: Anthropic;
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
  wallMs: number;
  initialDoc: Doc;
  finalDoc: Doc;
  session: DocSession;
  /** Transcript with image payloads replaced by placeholders. */
  transcript: unknown[];
}

const DEFAULT_MAX_TOKENS = 16_000;

function toolDefinitions(surface: ToolSurface, eager: boolean) {
  return surface.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: toolInputSchema(tool.schema) as Anthropic.Tool["input_schema"],
    ...(eager && tool.eagerInput ? { eager_input_streaming: true } : {}),
  }));
}

/**
 * Text and image blocks only. That is exactly the subset a `tool_result` may
 * contain, which is where feedback is attached by default — so screenshots
 * ride back on the same turn as the action that produced them, rather than
 * costing an extra message.
 */
type FeedbackContentBlock = Anthropic.TextBlockParam | Anthropic.ImageBlockParam;

function toContentBlocks(blocks: FeedbackBlock[]): FeedbackContentBlock[] {
  return blocks.map((b) =>
    b.type === "text"
      ? ({ type: "text", text: b.text } as const)
      : ({
          type: "image",
          source: { type: "base64", media_type: b.mediaType, data: b.png.toString("base64") },
        } as const),
  );
}

/** Strip base64 payloads so a saved transcript stays a readable size. */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.type === "image" && obj.source && typeof obj.source === "object") {
      const source = obj.source as Record<string, unknown>;
      const data = typeof source.data === "string" ? source.data : "";
      return { type: "image", source: { ...source, data: `<${data.length} base64 chars elided>` } };
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, redact(v)]));
  }
  return value;
}

export async function runAgent(config: RunConfig): Promise<RunResult> {
  const startedAt = Date.now();
  const emit: EventSink = config.onEvent ?? noopSink;
  const client = config.client ?? new Anthropic();
  const spec = getModel(config.model);
  const effort = config.effort ?? (spec.supportsEffort ? "high" : null);
  const maxTurns = config.maxTurns ?? config.task.maxTurns;
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const placement = config.feedbackPlacement ?? "tool_result";

  const initialDoc = config.task.initial();
  const session = new DocSession(initialDoc);
  const tools = toolDefinitions(config.surface, config.eagerInputStreaming === true);

  emit({
    type: "run_start",
    runId: config.runId,
    taskId: config.task.id,
    surface: config.surface.id,
    feedback: config.feedback.mode,
    model: config.model,
    brief: config.task.brief,
    doc: initialDoc,
  });

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: toContentBlocks(initialUserBlocks(config.task, initialDoc, config.feedback)) },
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

      const request: Anthropic.MessageStreamParams = {
        model: config.model,
        max_tokens: maxTokens,
        // The surface briefing is stable for every run on this surface, so the
        // tools + system prefix caches across the whole sweep.
        system: [{ type: "text", text: systemPrompt(config.surface), cache_control: { type: "ephemeral" } }],
        tools,
        messages,
        ...(spec.thinking === "adaptive"
          ? { thinking: { type: "adaptive" as const } }
          : { thinking: { type: "enabled" as const, budget_tokens: Math.min(4000, maxTokens - 1024) } }),
        ...(effort ? { output_config: { effort } } : {}),
      };

      const stream = client.messages.stream(request, config.signal ? { signal: config.signal } : undefined);
      const message = await stream.finalMessage();

      usage = addUsage(usage, {
        input: message.usage.input_tokens,
        output: message.usage.output_tokens,
        cacheRead: message.usage.cache_read_input_tokens ?? 0,
        cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
      });

      for (const block of message.content) {
        if (block.type === "thinking" && block.thinking) emit({ type: "thinking", turn, text: block.thinking });
        if (block.type === "text" && block.text) emit({ type: "text", turn, text: block.text });
      }

      const turnUsage: TokenUsage = {
        input: message.usage.input_tokens,
        output: message.usage.output_tokens,
        cacheRead: message.usage.cache_read_input_tokens ?? 0,
        cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
      };

      // A refusal can cut a tool_use block off mid-input, so never run its tools.
      if (message.stop_reason === "refusal") {
        stopReason = "refusal";
        error = `Model declined: ${message.stop_details?.explanation ?? "no explanation given"}`;
        emit({ type: "error", message: error, fatal: true });
        turnRecords.push({ turn, usage: turnUsage, stopReason: message.stop_reason, toolCalls: 0, ms: Date.now() - turnStarted });
        break;
      }

      if (message.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: message.content });
        turnRecords.push({ turn, usage: turnUsage, stopReason: message.stop_reason, toolCalls: 0, ms: Date.now() - turnStarted });
        continue;
      }

      const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

      // Truncated output usually means a half-written tool input. Running it
      // would corrupt the document with something the model never finished
      // saying, so the run ends here and is recorded as truncated.
      if (message.stop_reason === "max_tokens") {
        stopReason = "max_tokens";
        error = `Turn ${turn} hit max_tokens (${maxTokens}) before finishing.`;
        emit({ type: "error", message: error, fatal: true });
        turnRecords.push({ turn, usage: turnUsage, stopReason: message.stop_reason, toolCalls: toolUses.length, ms: Date.now() - turnStarted });
        break;
      }

      if (toolUses.length === 0) {
        stopReason = "completed";
        turnRecords.push({ turn, usage: turnUsage, stopReason: message.stop_reason, toolCalls: 0, ms: Date.now() - turnStarted });
        emit({ type: "turn_end", turn, usage: turnUsage, stopReason: message.stop_reason });
        break;
      }

      messages.push({ role: "assistant", content: message.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        emit({ type: "tool_call", turn, seq: session.actions.length + 1, tool: use.name, input: use.input });
        const outcome = executeToolCall(session, config.surface, use.name, use.input);

        const counter = (toolUsage[use.name] ??= { ok: 0, failed: 0 });
        if (outcome.ok) counter.ok++;
        else counter.failed++;

        emit({
          type: "tool_result",
          turn,
          seq: outcome.record.seq,
          tool: use.name,
          ok: outcome.ok,
          message: outcome.message,
          touched: outcome.touched,
        });
        if (outcome.ok) {
          emit({ type: "doc_update", turn, seq: outcome.record.seq, doc: session.doc, svg: renderSvg(session.doc) });
        }

        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          is_error: !outcome.ok,
          content: [{ type: "text", text: outcome.message }],
        });
      }

      // Feedback describes the state after *all* of this turn's calls, so it
      // attaches once, to the last result.
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

      if (placement === "tool_result" && feedbackBlocks.length > 0) {
        const last = results[results.length - 1]!;
        last.content = [
          ...(Array.isArray(last.content) ? last.content : [{ type: "text" as const, text: String(last.content) }]),
          ...toContentBlocks(feedbackBlocks),
        ];
        messages.push({ role: "user", content: results });
      } else {
        messages.push({ role: "user", content: results });
        if (feedbackBlocks.length > 0) {
          messages.push({ role: "user", content: toContentBlocks(feedbackBlocks) });
        }
      }

      turnRecords.push({
        turn,
        usage: turnUsage,
        stopReason: message.stop_reason,
        toolCalls: toolUses.length,
        ms: Date.now() - turnStarted,
      });
      emit({ type: "turn_end", turn, usage: turnUsage, stopReason: message.stop_reason });
    }
  } catch (err) {
    stopReason = config.signal?.aborted ? "aborted" : "api_error";
    error = describeError(err);
    emit({ type: "error", message: error, fatal: true });
  }

  const result: RunResult = {
    runId: config.runId,
    taskId: config.task.id,
    surfaceId: config.surface.id,
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
    costUsd: costUsd(usage, spec),
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

function describeError(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return `Rate limited: ${err.message}`;
  if (err instanceof Anthropic.AuthenticationError) return `Authentication failed: ${err.message}`;
  if (err instanceof Anthropic.BadRequestError) return `Bad request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return `Connection failed: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `API error ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
