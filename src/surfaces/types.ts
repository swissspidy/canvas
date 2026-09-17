/**
 * The tool surface interface — the independent variable of this study.
 *
 * A surface is a set of tools plus the briefing that explains them. Surfaces
 * must be matched on everything except the operations themselves: the same
 * document model underneath, the same error wording, the same briefing
 * register. If the relational surface wins because its briefing happened to be
 * better written, the study has measured prose.
 */

import type { z } from "zod";
import type { Doc } from "../doc/types.js";
import type { DocSession } from "../doc/session.js";

export const SURFACE_IDS = ["coordinate", "relational", "document", "hybrid"] as const;
export type SurfaceId = (typeof SURFACE_IDS)[number];

/** The four surfaces the headline comparison runs over. `hybrid` is an ablation. */
export const HEADLINE_SURFACES: SurfaceId[] = ["coordinate", "relational", "document"];

export interface ToolOutcome {
  doc: Doc;
  /**
   * The confirmation handed back to the model. Written in the same register
   * across surfaces: what changed, stated as fact, no advice.
   */
  message: string;
  touched: string[];
}

export interface ToolContext {
  session: DocSession;
  doc: Doc;
}

export interface ToolDef<TInput = unknown> {
  name: string;
  description: string;
  /** Validates the input and generates the JSON Schema sent to the model. */
  schema: z.ZodType<TInput>;
  run(ctx: ToolContext, input: TInput): ToolOutcome;
}

export interface ToolSurface {
  id: SurfaceId;
  title: string;
  /** One paragraph, appended to the system prompt. */
  briefing: string;
  tools: ToolDef<any>[];
}

export function findTool(surface: ToolSurface, name: string): ToolDef<any> | undefined {
  return surface.tools.find((t) => t.name === name);
}
