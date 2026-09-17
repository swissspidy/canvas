/**
 * Exposing a tool surface over WebMCP.
 *
 * The surfaces already are what WebMCP wants: a name, a description, a JSON
 * Schema and a handler. Registration is a translation, not a reimplementation,
 * and every call still goes through `executeToolCall` — the same validation,
 * the same shared error wording, the same action log. A run driven by an
 * outside harness is therefore scored by exactly the code that scores a run
 * driven by this repo's own loop.
 *
 * Two deliberate omissions:
 *
 * **The scorer is not a tool.** An agent that can call the checks can optimize
 * against the rubric, and the task stops measuring layout. The page exposes
 * scoring to a *harness* on `window.__canvasBench` instead, which the agent
 * cannot reach.
 *
 * **Feedback stays push, not pull.** The channel's text rides back on each
 * tool result, exactly as it does in the loops, so `none`, `structured` and
 * `structured_plain` mean the same thing here. Screenshots are the exception
 * and are documented below.
 */

import type { DocSession } from "../doc/session.js";
import type { ToolSurface } from "../surfaces/types.js";
import { executeToolCall } from "../surfaces/execute.js";
import { toolInputSchema } from "../doc/schema.js";
import type { FeedbackChannel } from "../feedback/index.js";
import type { Doc } from "../doc/types.js";
import type { ActionRecord } from "../doc/session.js";
import type { PolyfillToolDescriptor } from "./polyfill.js";

/** MCP-shaped tool output. */
export interface McpContent {
  content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
}

/** The subset of `WebMCP.ModelContext` registration needs. */
export interface ModelContextLike {
  registerTool(tool: PolyfillToolDescriptor, options?: { signal?: AbortSignal }): Promise<void>;
}

export interface RegisterOptions {
  /** Unregisters every tool when aborted. */
  signal?: AbortSignal;
  /**
   * Appended to each tool result, so the feedback condition is controlled by
   * the page rather than by whichever agent happens to be driving.
   */
  feedback?: FeedbackChannel;
  /** Called after every call, successful or not. Drives the page's rendering. */
  onAction?: (doc: Doc, action: ActionRecord) => void;
}

export interface RegisteredSurface {
  /** Tool names registered, in surface order. */
  names: string[];
  /** Unregisters them. */
  dispose(): void;
}

/**
 * Register every tool of `surface`, operating on `session`.
 *
 * Returns a handle whose `dispose()` unregisters them — which is how a surface
 * switch works here: dispose the old set, register the new one. The document
 * is untouched, so the toggle behaves as it does in the loops.
 */
export async function registerSurfaceTools(
  modelContext: ModelContextLike,
  session: DocSession,
  surface: ToolSurface,
  options: RegisterOptions = {},
): Promise<RegisteredSurface> {
  const controller = new AbortController();
  options.signal?.addEventListener("abort", () => controller.abort());

  for (const def of surface.tools) {
    await modelContext.registerTool(
      {
        name: def.name,
        title: def.name,
        description: def.description,
        inputSchema: toolInputSchema(def.schema),
        annotations: {
          readOnlyHint: def.name === "read_document",
          // Every other tool changes the document, but nothing here books a
          // flight or moves money: a wrong call is undone by another call.
          consequentialHint: false,
        },
        execute: (input) => {
          const outcome = executeToolCall(session, surface, def.name, input ?? {});
          options.onAction?.(session.doc, outcome.record);
          return buildResult(outcome.ok, outcome.message, options.feedback, session.doc);
        },
      },
      { signal: controller.signal },
    );
  }

  return {
    names: surface.tools.map((t) => t.name),
    dispose: () => controller.abort(),
  };
}

function buildResult(
  ok: boolean,
  message: string,
  feedback: FeedbackChannel | undefined,
  doc: Doc,
): McpContent {
  const content: McpContent["content"] = [{ type: "text", text: message }];

  if (feedback) {
    for (const block of feedback.after(doc)) {
      if (block.type === "text") {
        content.push({ type: "text", text: block.text });
      } else {
        // MCP has an image content type, but WebMCP's `executeTool` is typed
        // as returning a string, so whether an image survives the trip to the
        // model depends entirely on the host implementation. It is emitted
        // here and the page reports whether the host kept it — see
        // `docs/WEBMCP.md`. Nothing about the `screenshot` feedback condition
        // should be assumed to work over WebMCP until a host is checked.
        content.push({ type: "image", data: block.png.toString("base64"), mimeType: block.mediaType });
      }
    }
  }

  return ok ? { content } : { content, isError: true };
}
