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

export type EventSink = (event: AgentEvent) => void;

export const noopSink: EventSink = () => {};
