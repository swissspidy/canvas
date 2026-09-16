/**
 * Surface 1 — coordinate primitives.
 *
 * `create`, `move`, `resize`, `set_style`, `delete`. Every position and size
 * is an absolute number the agent worked out itself. No tool computes
 * geometry on its behalf: centring something means knowing the canvas width,
 * the element width, and doing the subtraction.
 *
 * Note on the five primitives: rotation rides on `move` (it is placement) and
 * paint order and text content ride on `set_style` (they are neither position
 * nor size). They have to live somewhere — a surface missing them would be
 * strictly less powerful than the other two, and the comparison would measure
 * that gap instead of the thing under study.
 */

import { z } from "zod";
import { patchElement, requireElement } from "../doc/ops.js";
import { round } from "../doc/geometry.js";
import type { ToolDef, ToolSurface } from "./types.js";
import {
  buildElement,
  commitNew,
  deleteTool,
  setStyleTool,
  zCreateContent,
  zElementId,
} from "./common.js";

const zCreateInput = z.strictObject({
  ...zCreateContent,
  x: z.number().describe("Left edge of the element, in canvas units."),
  y: z.number().describe("Top edge of the element, in canvas units."),
  width: z.number().min(1),
  height: z.number().min(1),
  rotation: z.number().min(-360).max(360).optional().describe("Clockwise degrees about the element's center."),
});

const createTool: ToolDef<z.infer<typeof zCreateInput>> = {
  name: "create",
  description: "Add a new element at an explicit position and size.",
  schema: zCreateInput,
  run(ctx, input) {
    const el = buildElement(ctx, input, {
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      rotation: input.rotation,
    });
    return commitNew(ctx, el);
  },
};

const zMoveInput = z.strictObject({
  id: zElementId,
  x: z.number().describe("New left edge."),
  y: z.number().describe("New top edge."),
  rotation: z
    .number()
    .min(-360)
    .max(360)
    .optional()
    .describe("New rotation in clockwise degrees. Left unchanged if omitted."),
});

const moveTool: ToolDef<z.infer<typeof zMoveInput>> = {
  name: "move",
  description:
    "Move an element so its top-left corner sits at (x, y). Coordinates are absolute, not relative to where it is now.",
  schema: zMoveInput,
  run(ctx, input) {
    requireElement(ctx.doc, input.id);
    const patch: { x: number; y: number; rotation?: number } = { x: input.x, y: input.y };
    if (input.rotation !== undefined) patch.rotation = input.rotation;
    const doc = patchElement(ctx.doc, input.id, patch);
    const el = requireElement(doc, input.id);
    return {
      doc,
      message:
        `Moved ${input.id} to x=${round(el.x, 1)} y=${round(el.y, 1)}` +
        (input.rotation !== undefined ? `, rotation=${round(el.rotation, 1)}` : "") +
        ".",
      touched: [input.id],
    };
  },
};

const zResizeInput = z.strictObject({
  id: zElementId,
  width: z.number().min(1).describe("New width."),
  height: z.number().min(1).describe("New height."),
});

const resizeTool: ToolDef<z.infer<typeof zResizeInput>> = {
  name: "resize",
  description:
    "Set an element's width and height. The top-left corner stays where it is, so the element grows right and down.",
  schema: zResizeInput,
  run(ctx, input) {
    requireElement(ctx.doc, input.id);
    const doc = patchElement(ctx.doc, input.id, { width: input.width, height: input.height });
    const el = requireElement(doc, input.id);
    return {
      doc,
      message: `Resized ${input.id} to ${round(el.width, 1)}x${round(el.height, 1)}.`,
      touched: [input.id],
    };
  },
};

export const coordinateSurface: ToolSurface = {
  id: "coordinate",
  title: "Coordinate primitives",
  briefing: [
    "You edit the document with coordinate primitives. Positions and sizes are absolute numbers",
    "in canvas units, measured from the top-left corner of the canvas: x runs right, y runs down.",
    "An element's x and y are its top-left corner before rotation; rotation turns it about its center.",
    "Nothing computes geometry for you — work out the numbers yourself and pass them in.",
  ].join(" "),
  tools: [createTool, moveTool, resizeTool, setStyleTool, deleteTool],
};
