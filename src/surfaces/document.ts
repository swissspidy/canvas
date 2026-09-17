/**
 * Surface 3 — document as code. The null hypothesis.
 *
 * No incremental editing at all: read the whole JSON, write the whole JSON.
 * If this wins, tool design is not where the leverage is, and the honest
 * write-up says so. `docs/PREREGISTRATION.md` commits to that outcome in
 * advance so it cannot quietly become a footnote.
 *
 * `read_document` is included even though the brief says "no incremental
 * tools", because it is not an editing tool — it is the only way an agent
 * under the no-feedback condition can re-check state, and withholding it would
 * make this surface lose to a missing accessor rather than to the approach.
 * How often agents actually call it is itself recorded.
 */

import { z } from "zod";
import { zDoc, DocValidationError, parseDoc, cloneDoc } from "../doc/schema.js";
import { ToolError } from "../doc/ops.js";
import type { Doc, Element } from "../doc/types.js";
import type { ToolDef, ToolSurface } from "./types.js";

const zReadInput = z.strictObject({});

const readTool: ToolDef<z.infer<typeof zReadInput>> = {
  name: "read_document",
  description: "Return the current document as JSON.",
  schema: zReadInput,
  run(ctx) {
    return {
      doc: ctx.doc,
      message: JSON.stringify(ctx.doc, null, 2),
      touched: [],
    };
  },
};

const zWriteInput = z.strictObject({
  document: zDoc.describe("The complete document. Whatever you send replaces the current one entirely."),
});

const writeTool: ToolDef<z.infer<typeof zWriteInput>> = {
  name: "write_document",
  description:
    "Replace the entire document with the JSON you supply. There is no partial update: anything you leave out is gone.",
  schema: zWriteInput,
  run(ctx, input) {
    let next: Doc;
    try {
      next = parseDoc(input.document);
    } catch (err) {
      if (err instanceof DocValidationError) {
        throw new ToolError(
          `${err.message}:\n${err.issues.map((i) => `  - ${i}`).join("\n")}`,
          "The document was not changed. Fix these and send the whole document again.",
        );
      }
      throw err;
    }

    // The canvas is fixed, and the other two surfaces have no way to change
    // it. Letting this one resize it would hand it a move nobody else has —
    // growing the page turns an out-of-bounds element in-bounds and rescales
    // every margin the checks measure, so the surfaces would stop being
    // compared on the same problem.
    if (next.width !== ctx.doc.width || next.height !== ctx.doc.height) {
      throw new ToolError(
        `The canvas is ${ctx.doc.width}x${ctx.doc.height} and cannot be resized; you sent ${next.width}x${next.height}.`,
        "The document was not changed. Send it again with the original width and height.",
      );
    }

    for (const el of next.elements) ctx.session.registerId(el.id);
    const summary = diffSummary(ctx.doc, next);
    return {
      doc: next,
      message: `Document replaced. ${summary}`,
      touched: touchedIds(ctx.doc, next),
    };
  },
};

function byId(doc: Doc): Map<string, Element> {
  return new Map(doc.elements.map((el) => [el.id, el]));
}

function touchedIds(before: Doc, after: Doc): string[] {
  const a = byId(before);
  const b = byId(after);
  const ids = new Set<string>();
  for (const [id, el] of b) {
    const prev = a.get(id);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(el)) ids.add(id);
  }
  for (const id of a.keys()) if (!b.has(id)) ids.add(id);
  return [...ids];
}

/**
 * A short account of what changed. Neutral by construction — it names ids and
 * counts, and says nothing about whether the result is any good, so this
 * surface's confirmations carry no more information than the others'.
 */
function diffSummary(before: Doc, after: Doc): string {
  const a = byId(before);
  const b = byId(after);
  const added = [...b.keys()].filter((id) => !a.has(id));
  const removed = [...a.keys()].filter((id) => !b.has(id));
  const changed = [...b.keys()].filter((id) => a.has(id) && JSON.stringify(a.get(id)) !== JSON.stringify(b.get(id)));

  const parts: string[] = [`${after.elements.length} element(s) now.`];
  if (added.length) parts.push(`Added ${added.join(", ")}.`);
  if (removed.length) parts.push(`Removed ${removed.join(", ")}.`);
  if (changed.length) parts.push(`Changed ${changed.join(", ")}.`);
  if (!added.length && !removed.length && !changed.length) parts.push("Nothing differs from the previous version.");
  if (before.width !== after.width || before.height !== after.height) {
    parts.push(`Canvas resized to ${after.width}x${after.height}.`);
  }
  if (before.background !== after.background) parts.push(`Background is now ${after.background}.`);
  return parts.join(" ");
}

export const documentSurface: ToolSurface = {
  id: "document",
  title: "Document as code",
  briefing: [
    "You edit the document by rewriting it. There are no incremental operations: `write_document` takes the",
    "complete JSON and replaces what is there, so include every element you want to keep, with all of its fields.",
    "The schema is fixed — unknown keys are rejected and the document is left untouched. The canvas width and height",
    "are fixed too: send them back unchanged. Coordinates are in canvas",
    "units from the top-left corner: x runs right, y runs down. An element's x and y are its top-left corner before",
    "rotation; rotation turns it about its center.",
  ].join(" "),
  tools: [readTool, writeTool],
};

/** Exposed for the initial-state prompt and the live page. */
export function documentJson(doc: Doc): string {
  return JSON.stringify(cloneDoc(doc), null, 2);
}
