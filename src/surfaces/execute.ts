/**
 * Running one tool call against a session.
 *
 * Every failure mode produces a message in the same shape, whichever surface
 * raised it: what went wrong, then how to recover. Error quality is a real
 * lever on agent performance, so it is held constant rather than left to
 * whatever each tool happened to throw.
 */

import type { DocSession } from "../doc/session.js";
import type { ActionRecord } from "../doc/session.js";
import { ToolError } from "../doc/ops.js";
import { formatIssues } from "../doc/schema.js";
import { findTool, type ToolSurface } from "./types.js";
import { z } from "zod";

export interface ExecuteResult {
  ok: boolean;
  /** Exactly what goes back to the model as the tool result. */
  message: string;
  touched: string[];
  record: ActionRecord;
}

export function executeToolCall(
  session: DocSession,
  surface: ToolSurface,
  name: string,
  rawInput: unknown,
): ExecuteResult {
  const started = Date.now();

  const finish = (ok: boolean, message: string, touched: string[]): ExecuteResult => {
    const record = session.record({
      tool: name,
      input: rawInput,
      ok,
      message,
      touched,
      durationMs: Date.now() - started,
    });
    return { ok, message, touched, record };
  };

  const tool = findTool(surface, name);
  if (!tool) {
    return finish(
      false,
      `There is no tool called '${name}'. Available tools: ${surface.tools.map((t) => t.name).join(", ")}.`,
      [],
    );
  }

  const parsed = tool.schema.safeParse(rawInput);
  if (!parsed.success) {
    const issues = formatIssues(parsed.error as z.ZodError);
    return finish(
      false,
      `Invalid arguments for '${name}':\n${issues.map((i) => `  - ${i}`).join("\n")}\n` +
        `Nothing was changed. Correct the arguments and call it again.`,
      [],
    );
  }

  try {
    const outcome = tool.run({ session, doc: session.doc }, parsed.data);
    session.commit(outcome.doc);
    return finish(true, outcome.message, outcome.touched);
  } catch (err) {
    if (err instanceof ToolError) {
      return finish(false, `${err.toModelString()}\nNothing was changed.`, []);
    }
    // A bug in a tool is not the agent's fault, but it still has to be told
    // something actionable, and the run has to record that it happened.
    const detail = err instanceof Error ? err.message : String(err);
    return finish(false, `'${name}' failed unexpectedly: ${detail}\nNothing was changed.`, []);
  }
}
