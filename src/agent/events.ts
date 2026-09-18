/**
 * Events emitted while an agent works.
 *
 * The live page consumes these over SSE and the runner records them, so the
 * same stream drives both the demo and the transcripts. Nothing here is
 * specific to a surface — a viewer watching the toggle flip mid-session sees
 * the same event shapes either way.
 */

import type { Doc } from "../doc/types.js";
import type { SurfaceId } from "../surfaces/types.js";
import type { FeedbackMode } from "../feedback/index.js";
import type { TokenUsage } from "./models.js";

export type AgentEvent =
  | { type: "run_start"; runId: string; taskId: string; surface: SurfaceId; feedback: FeedbackMode; model: string; brief: string; doc: Doc }
  | { type: "turn_start"; turn: number }
  | { type: "thinking"; turn: number; text: string }
  | { type: "text"; turn: number; text: string }
  | { type: "tool_call"; turn: number; seq: number; tool: string; input: unknown }
  | { type: "tool_result"; turn: number; seq: number; tool: string; ok: boolean; message: string; touched: string[] }
  | { type: "doc_update"; turn: number; seq: number; doc: Doc; svg: string }
  | { type: "feedback"; turn: number; mode: FeedbackMode; hasImage: boolean; text?: string }
  | { type: "surface_switch"; turn: number; from: SurfaceId; to: SurfaceId }
  | { type: "turn_end"; turn: number; usage: TokenUsage; stopReason: string | null }
  | { type: "run_end"; runId: string; reason: StopReason; turns: number; usage: TokenUsage; costUsd: number }
  | { type: "error"; message: string; fatal: boolean };

export type StopReason =
  | "completed"
  | "max_turns"
  | "max_tokens"
  | "refusal"
  | "api_error"
  | "aborted";

/**
 * Stop reasons that are the harness failing rather than the agent finishing.
 *
 * The distinction decides two things, and getting it wrong is expensive in
 * both directions. `max_turns`, `max_tokens` and `refusal` are *outcomes*: the
 * model was handed a surface and a budget and that is what it did with them,
 * so they are scored on the document left behind and pooled into the results
 * exactly as `docs/PREREGISTRATION.md` §5 says. `api_error` and `aborted` are
 * not outcomes at all — a 529 from an overloaded endpoint, an expired key, a
 * dropped socket, a Ctrl-C.
 *
 * The run is cut off wherever the transport happened to fail, which may be
 * before the first turn or four turns into useful work, so the document it
 * leaves behind is real but arbitrary: its score measures how far the agent
 * had got when the endpoint fell over. That is a fact about the endpoint. Pool
 * it in and the cells that collided with a rate limit move their surface's
 * mean by however much they had done at the time — down if they died early,
 * and, just as wrongly, up if they died late on an easy task.
 *
 * So a harness failure is never cached as a finished cell (the sweep retries
 * it on the next pass) and never enters an aggregate (the report counts them
 * separately and says so). They stay in `scores.jsonl` and in the report's
 * stop-reason table, because an attrition rate that differs by surface is
 * itself worth seeing.
 */
export const HARNESS_FAILURES: readonly StopReason[] = ["api_error", "aborted"];

export function isHarnessFailure(reason: string): boolean {
  return (HARNESS_FAILURES as readonly string[]).includes(reason);
}

export type EventSink = (event: AgentEvent) => void;

export const noopSink: EventSink = () => {};
