/**
 * Pieces shared between surfaces.
 *
 * `create`, `set_style` and `delete` are deliberately *identical* across every
 * surface that has them — same schema, same wording, same confirmation text.
 * The surfaces are meant to differ in how elements get *arranged*, and nothing
 * else. Anything shared lives here so it cannot drift.
 */

import { z } from "zod";
import { ELEMENT_TYPES } from "../doc/types.js";
import type { Element, Style } from "../doc/types.js";
import { zStyle, zStylePatch } from "../doc/schema.js";
import { ASSET_KEYS, getAsset } from "../doc/assets.js";
import { addElement, patchElement, removeElement, requireElement, ToolError, topZ } from "../doc/ops.js";
import { round } from "../doc/geometry.js";
import type { ToolContext, ToolDef, ToolOutcome } from "./types.js";

export const zElementId = z.string().min(1).describe("Element id, e.g. 'el_3'.");

/** Content and appearance of a new element, with no placement. */
export const zCreateContent = {
  type: z.enum(ELEMENT_TYPES).describe("What kind of element to create."),
  text: z
    .string()
    .max(2000)
    .optional()
    .describe("Required for type 'text'. Use \\n for a hard line break."),
  src: z
    .string()
    .optional()
    .describe(`Required for type 'image'. One of: ${ASSET_KEYS.join(", ")}`),
  alt: z.string().max(300).optional().describe("Short description of an image."),
  z: z
    .number()
    .int()
    .optional()
    .describe("Paint order; higher is nearer the viewer. Defaults to above everything."),
  style: zStyle.optional(),
} as const;

export function describeElementShort(el: Element): string {
  const what =
    el.type === "text"
      ? `text ${JSON.stringify((el.text ?? "").slice(0, 40))}`
      : el.type === "image"
        ? `image ${el.src}`
        : "rect";
  return `${el.id} (${what})`;
}

export function geometryPhrase(el: Element): string {
  const parts = [`x=${round(el.x, 1)} y=${round(el.y, 1)}`, `${round(el.width, 1)}x${round(el.height, 1)}`];
  if (el.rotation) parts.push(`rotation=${round(el.rotation, 1)}`);
  return parts.join(", ");
}

/**
 * Build the element a `create` call asks for, minus placement. Callers supply
 * the box; every surface validates content the same way.
 */
export function buildElement(
  ctx: ToolContext,
  content: {
    type: Element["type"];
    text?: string;
    src?: string;
    alt?: string;
    z?: number;
    style?: Style;
  },
  box: { x: number; y: number; width: number; height: number; rotation?: number },
): Element {
  if (content.type === "text" && !content.text) {
    throw new ToolError("A text element needs 'text'.");
  }
  if (content.type === "image") {
    if (!content.src) throw new ToolError("An image element needs 'src'.");
    if (!getAsset(content.src)) {
      throw new ToolError(
        `Unknown asset '${content.src}'.`,
        `Available assets: ${ASSET_KEYS.join(", ")}`,
      );
    }
  }
  if (content.type !== "text" && content.text !== undefined) {
    throw new ToolError("Only text elements can carry 'text'.");
  }
  if (content.type !== "image" && content.src !== undefined) {
    throw new ToolError("Only image elements can carry 'src'.");
  }

  const el: Element = {
    id: ctx.session.allocateId(),
    type: content.type,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: box.rotation ?? 0,
    z: content.z ?? topZ(ctx.doc) + 1,
    style: content.style ?? {},
  };
  if (content.text !== undefined) el.text = content.text;
  if (content.src !== undefined) el.src = content.src;
  if (content.alt !== undefined) el.alt = content.alt;
  return el;
}

export function commitNew(ctx: ToolContext, el: Element): ToolOutcome {
  return {
    doc: addElement(ctx.doc, el),
    message: `Created ${describeElementShort(el)} at ${geometryPhrase(el)}, z=${el.z}.`,
    touched: [el.id],
  };
}

// --- set_style -------------------------------------------------------------

export const zSetStyleInput = z.strictObject({
  id: zElementId,
  style: zStylePatch.optional().describe("Style keys to change. Pass null for a key to clear it."),
  text: z.string().max(2000).optional().describe("New text content (text elements only)."),
  z: z.number().int().optional().describe("New paint order."),
});

export const setStyleTool: ToolDef<z.infer<typeof zSetStyleInput>> = {
  name: "set_style",
  description:
    "Change an element's appearance, text content, or paint order. Does not move or resize it.",
  schema: zSetStyleInput,
  run(ctx, input) {
    const el = requireElement(ctx.doc, input.id);
    if (input.text !== undefined && el.type !== "text") {
      throw new ToolError(`${input.id} is a ${el.type} element, so it has no text.`);
    }
    const patch: Parameters<typeof patchElement>[2] = {};
    if (input.style) patch.style = input.style as Style;
    if (input.text !== undefined) patch.text = input.text;
    if (input.z !== undefined) patch.z = input.z;
    if (Object.keys(patch).length === 0) {
      throw new ToolError("Nothing to change.", "Pass at least one of 'style', 'text' or 'z'.");
    }

    const changed: string[] = [];
    if (input.style) changed.push(...Object.keys(input.style));
    if (input.text !== undefined) changed.push("text");
    if (input.z !== undefined) changed.push("z");

    return {
      doc: patchElement(ctx.doc, input.id, patch),
      message: `Updated ${input.id}: ${changed.join(", ")}.`,
      touched: [input.id],
    };
  },
};

// --- delete ----------------------------------------------------------------

export const zDeleteInput = z.strictObject({ id: zElementId });

export const deleteTool: ToolDef<z.infer<typeof zDeleteInput>> = {
  name: "delete",
  description: "Remove an element from the document.",
  schema: zDeleteInput,
  run(ctx, input) {
    const el = requireElement(ctx.doc, input.id);
    return {
      doc: removeElement(ctx.doc, input.id),
      message: `Deleted ${describeElementShort(el)}.`,
      touched: [input.id],
    };
  },
};
