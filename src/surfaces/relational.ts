/**
 * Surface 2 — relational operations.
 *
 * The agent states intent and the renderer computes geometry. There is no way
 * to pass an x or a y: an element is placed *relative to* another element or
 * to the canvas, aligned *with* a group, sized *to fit* something. If the
 * hypothesis behind this project is right, this is where the arithmetic errors
 * go away; if it is wrong, this is where the agent finds itself unable to
 * express what it wants.
 *
 * Everything works in *visual* bounding boxes, so "below" means below on
 * screen even for a rotated element. Placing by the unrotated box would make
 * `place` lie whenever rotation is in play.
 *
 * One deviation from the original five (`align`, `distribute`, `place_below`,
 * `fit_within`, `avoid_overlap`): `place_below(target, gap)` is generalized to
 * `place(id, relation, target, gap)` with `below` among the relations. A
 * surface that could place things below but not beside them would lose on
 * expressiveness rather than on the question being asked. `fit_within` is
 * split into `fit_text` (text against its box) and `fit_within` (a box inside
 * another box), because those are two different operations wearing one name.
 */

import { z } from "zod";
import { aabb, round } from "../doc/geometry.js";
import { patchElement, requireElement, requireElements, ToolError } from "../doc/ops.js";
import type { Doc, Element, Rect } from "../doc/types.js";
import { largestFittingFontSize, layoutTextElement, DEFAULT_FONT_SIZE } from "../text/layout.js";
import type { ToolDef, ToolSurface } from "./types.js";
import {
  buildElement,
  commitNew,
  deleteTool,
  setStyleTool,
  zCreateContent,
  zElementId,
} from "./common.js";

// --- shared helpers --------------------------------------------------------

/** Move an element so its *visual* bounding box lands at (x, y). */
function moveAabbTo(doc: Doc, el: Element, x: number, y: number): Doc {
  const box = aabb(el);
  return patchElement(doc, el.id, { x: el.x + (x - box.x), y: el.y + (y - box.y) });
}

function groupBounds(els: Element[]): Rect {
  const boxes = els.map(aabb);
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function canvasRect(doc: Doc): Rect {
  return { x: 0, y: 0, width: doc.width, height: doc.height };
}

/** Resolve a reference that may be the canvas or an element id. */
function resolveContainer(doc: Doc, ref: string): Rect {
  if (ref === "canvas") return canvasRect(doc);
  return aabb(requireElement(doc, ref));
}

const zAlignAcross = z
  .enum(["start", "center", "end"])
  .optional()
  .describe("Cross-axis alignment. 'start' is left or top, 'end' is right or bottom. Default 'center'.");

function crossPosition(
  mode: "start" | "center" | "end",
  containerStart: number,
  containerSize: number,
  size: number,
): number {
  if (mode === "start") return containerStart;
  if (mode === "end") return containerStart + containerSize - size;
  return containerStart + (containerSize - size) / 2;
}

// --- place -----------------------------------------------------------------

const TARGET_RELATIONS = ["below", "above", "left_of", "right_of", "centered_on", "cover"] as const;
const CANVAS_RELATIONS = [
  "canvas_center",
  "canvas_top",
  "canvas_bottom",
  "canvas_left",
  "canvas_right",
  "canvas_top_left",
  "canvas_top_right",
  "canvas_bottom_left",
  "canvas_bottom_right",
  "fill_canvas",
] as const;
const ALL_RELATIONS = [...TARGET_RELATIONS, ...CANVAS_RELATIONS] as const;
type Relation = (typeof ALL_RELATIONS)[number];

const zPlacement = {
  relation: z.enum(ALL_RELATIONS).describe(
    "Where to put it. 'below', 'above', 'left_of', 'right_of', 'centered_on' and 'cover' need a target. " +
      "The 'canvas_*' relations and 'fill_canvas' do not.",
  ),
  target: zElementId.optional().describe("The element to place relative to. Required for target relations."),
  gap: z.number().min(0).optional().describe("Distance from the target, in canvas units. Default 0."),
  margin: z.number().min(0).optional().describe("Distance from the canvas edge for canvas_* relations. Default 0."),
  align: zAlignAcross,
} as const;

interface PlacementArgs {
  relation: Relation;
  target?: string;
  gap?: number;
  margin?: number;
  align?: "start" | "center" | "end";
}

/**
 * Compute where a box of `size` should land. Returns the target bounding-box
 * position, or a full replacement box for `cover` and `fill_canvas`.
 */
function computePlacement(
  doc: Doc,
  size: { width: number; height: number },
  args: PlacementArgs,
  selfId?: string,
): { x: number; y: number; width?: number; height?: number; label: string } {
  const gap = args.gap ?? 0;
  const margin = args.margin ?? 0;
  const align = args.align ?? "center";
  const canvas = canvasRect(doc);

  const needsTarget = (TARGET_RELATIONS as readonly string[]).includes(args.relation);
  if (needsTarget && !args.target) {
    throw new ToolError(
      `Relation '${args.relation}' needs a 'target' element.`,
      `Target-relative relations: ${TARGET_RELATIONS.join(", ")}`,
    );
  }
  if (needsTarget && args.target === selfId) {
    throw new ToolError(`Cannot place ${selfId} relative to itself.`);
  }

  if (needsTarget) {
    const t = aabb(requireElement(doc, args.target!));
    switch (args.relation) {
      case "below":
        return {
          x: crossPosition(align, t.x, t.width, size.width),
          y: t.y + t.height + gap,
          label: `below ${args.target} with a ${round(gap, 1)} unit gap`,
        };
      case "above":
        return {
          x: crossPosition(align, t.x, t.width, size.width),
          y: t.y - gap - size.height,
          label: `above ${args.target} with a ${round(gap, 1)} unit gap`,
        };
      case "left_of":
        return {
          x: t.x - gap - size.width,
          y: crossPosition(align, t.y, t.height, size.height),
          label: `left of ${args.target} with a ${round(gap, 1)} unit gap`,
        };
      case "right_of":
        return {
          x: t.x + t.width + gap,
          y: crossPosition(align, t.y, t.height, size.height),
          label: `right of ${args.target} with a ${round(gap, 1)} unit gap`,
        };
      case "centered_on":
        return {
          x: t.x + (t.width - size.width) / 2,
          y: t.y + (t.height - size.height) / 2,
          label: `centered on ${args.target}`,
        };
      case "cover":
        return { x: t.x, y: t.y, width: t.width, height: t.height, label: `covering ${args.target}` };
    }
  }

  const inner: Rect = {
    x: canvas.x + margin,
    y: canvas.y + margin,
    width: Math.max(0, canvas.width - margin * 2),
    height: Math.max(0, canvas.height - margin * 2),
  };

  switch (args.relation) {
    case "fill_canvas":
      return { x: inner.x, y: inner.y, width: inner.width, height: inner.height, label: "filling the canvas" };
    case "canvas_center":
      return {
        x: canvas.x + (canvas.width - size.width) / 2,
        y: canvas.y + (canvas.height - size.height) / 2,
        label: "centered on the canvas",
      };
    case "canvas_top":
      return { x: crossPosition(align, inner.x, inner.width, size.width), y: inner.y, label: "at the top of the canvas" };
    case "canvas_bottom":
      return {
        x: crossPosition(align, inner.x, inner.width, size.width),
        y: inner.y + inner.height - size.height,
        label: "at the bottom of the canvas",
      };
    case "canvas_left":
      return { x: inner.x, y: crossPosition(align, inner.y, inner.height, size.height), label: "at the left of the canvas" };
    case "canvas_right":
      return {
        x: inner.x + inner.width - size.width,
        y: crossPosition(align, inner.y, inner.height, size.height),
        label: "at the right of the canvas",
      };
    case "canvas_top_left":
      return { x: inner.x, y: inner.y, label: "in the top-left corner" };
    case "canvas_top_right":
      return { x: inner.x + inner.width - size.width, y: inner.y, label: "in the top-right corner" };
    case "canvas_bottom_left":
      return { x: inner.x, y: inner.y + inner.height - size.height, label: "in the bottom-left corner" };
    case "canvas_bottom_right":
      return {
        x: inner.x + inner.width - size.width,
        y: inner.y + inner.height - size.height,
        label: "in the bottom-right corner",
      };
    default:
      throw new ToolError(`Unknown relation '${args.relation}'.`);
  }
}

const zCreateInput = z.strictObject({
  ...zCreateContent,
  width: z.number().min(1).describe("Width in canvas units. Ignored for 'cover' and 'fill_canvas'."),
  height: z.number().min(1).describe("Height in canvas units. Ignored for 'cover' and 'fill_canvas'."),
  rotation: z.number().min(-360).max(360).optional(),
  ...zPlacement,
});

const createTool: ToolDef<z.infer<typeof zCreateInput>> = {
  name: "create",
  description: "Add a new element, placed relative to another element or to the canvas.",
  schema: zCreateInput,
  run(ctx, input) {
    const rotation = input.rotation ?? 0;
    // Every relation here is defined on the painted bounding box — that is what
    // `place` computes against, and "below this, with a 50 unit gap" has to
    // mean the same thing whether the element arrives rotated or is rotated
    // afterwards. A rotated box is wider than its declared width, and its
    // x/y stay the *unrotated* top-left, so both ends need converting.
    const painted = aabb({ x: 0, y: 0, width: input.width, height: input.height, rotation });
    const placement = computePlacement(ctx.doc, { width: painted.width, height: painted.height }, input);

    // `cover` and `fill_canvas` dictate the box outright, so they land
    // axis-aligned — the same thing `place` does with a placement that carries
    // a size.
    const sized = placement.width !== undefined && placement.height !== undefined;
    const el = buildElement(ctx, input, {
      x: placement.x - (sized ? 0 : painted.x),
      y: placement.y - (sized ? 0 : painted.y),
      width: placement.width ?? input.width,
      height: placement.height ?? input.height,
      rotation: sized ? 0 : rotation,
    });
    const outcome = commitNew(ctx, el);
    return { ...outcome, message: `${outcome.message.replace(/\.$/, "")} — placed ${placement.label}.` };
  },
};

const zPlaceInput = z.strictObject({
  id: zElementId,
  rotation: z
    .number()
    .min(-360)
    .max(360)
    .optional()
    .describe("Set the element's rotation before placing it, in clockwise degrees. Left unchanged if omitted."),
  ...zPlacement,
});

const placeTool: ToolDef<z.infer<typeof zPlaceInput>> = {
  name: "place",
  description:
    "Move an element relative to another element or to the canvas, optionally setting its rotation at the same " +
    "time. Positions are computed for you from the target's current bounding box.",
  schema: zPlaceInput,
  run(ctx, input) {
    const el = requireElement(ctx.doc, input.id);
    let doc = ctx.doc;
    let subject = el;
    // Rotation first, placement second, and in that order because a rotated
    // box is wider and taller than its declared size. `create` already worked
    // this way; placing first and rotating afterwards would put the element
    // where its *unrotated* box belonged and then swing it out of position.
    if (input.rotation !== undefined && input.rotation !== el.rotation) {
      doc = patchElement(doc, el.id, { rotation: input.rotation });
      subject = requireElement(doc, el.id);
    }
    const box = aabb(subject);
    const placement = computePlacement(doc, box, input, input.id);

    if (placement.width !== undefined && placement.height !== undefined) {
      // `cover` and `fill_canvas` dictate the box outright, so they land
      // axis-aligned and any rotation asked for is dropped — the same thing
      // `create` does with a placement that carries a size.
      doc = patchElement(doc, el.id, { width: placement.width, height: placement.height, rotation: 0 });
      doc = moveAabbTo(doc, requireElement(doc, el.id), placement.x, placement.y);
    } else {
      doc = moveAabbTo(doc, subject, placement.x, placement.y);
    }
    const after = requireElement(doc, input.id);
    return {
      doc,
      message: `Placed ${input.id} ${placement.label}. It now sits at x=${round(after.x, 1)} y=${round(after.y, 1)}, ${round(after.width, 1)}x${round(after.height, 1)}.`,
      touched: [input.id],
    };
  },
};

// --- rotate ----------------------------------------------------------------

const zRotateInput = z.strictObject({
  ids: z.array(zElementId).min(1).describe("Elements to rotate. Each turns about its own center, so nothing moves."),
  degrees: z
    .number()
    .min(-360)
    .max(360)
    .optional()
    .describe("The angle to set, in clockwise degrees. An absolute angle, not a change to the current one."),
  to: zElementId.optional().describe("Copy this element's angle instead of naming one."),
});

/**
 * Set the angle of one or more elements.
 *
 * This surface could place a rotated element and could create one, and could
 * not rotate an element that already existed: `place` took no angle and
 * `set_style` is appearance, text and paint order. So "straighten these four"
 * was unreachable here and a `move` away on the coordinate surface — a
 * difference in raw *power* between two surfaces whose whole comparison
 * assumes they differ only in vocabulary. `docs/PREREGISTRATION.md` §8 lists
 * that parity as a controlled confound, and `surfaces.test.ts` now tests it on
 * rotation as well as on placement.
 *
 * Group-shaped and angle-relative, because that is this surface's vocabulary:
 * `to` copies another element's angle the way `align` lines up on another
 * element's edge. A designer straightening a knocked-about card says "put
 * these back upright", not "set each of these four to zero".
 */
const rotateTool: ToolDef<z.infer<typeof zRotateInput>> = {
  name: "rotate",
  description:
    "Set the rotation of one or more elements, either to an angle or to match another element's. Each element " +
    "turns about its own center, so nothing moves.",
  schema: zRotateInput,
  run(ctx, input) {
    if ((input.degrees === undefined) === (input.to === undefined)) {
      throw new ToolError(
        "Rotate needs exactly one of 'degrees' or 'to'.",
        "Pass 'degrees' for an angle, or 'to' with the id of an element whose angle to copy.",
      );
    }
    const angle = input.degrees ?? requireElement(ctx.doc, input.to!).rotation;
    // Resolve every id before changing anything, so a typo in the third id
    // does not leave the first two rotated.
    requireElements(ctx.doc, input.ids);
    let doc = ctx.doc;
    for (const id of input.ids) doc = patchElement(doc, id, { rotation: angle });
    const source = input.to ? ` to match ${input.to}` : "";
    return {
      doc,
      message: `Rotated ${input.ids.join(", ")} to ${round(angle, 1)} degrees${source}. Centers are unchanged.`,
      touched: [...input.ids],
    };
  },
};

// --- align -----------------------------------------------------------------

const ALIGN_EDGES = ["left", "right", "top", "bottom", "horizontal_center", "vertical_center"] as const;

const zAlignInput = z.strictObject({
  ids: z.array(zElementId).min(1).describe("Elements to align."),
  edge: z.enum(ALIGN_EDGES).describe("Which edge or axis to line up."),
  to: z
    .string()
    .optional()
    .describe(
      "What to align to: 'selection' (the combined bounding box of ids, the default), 'canvas', or an element id.",
    ),
});

const alignTool: ToolDef<z.infer<typeof zAlignInput>> = {
  name: "align",
  description: "Line elements up on a shared edge or axis.",
  schema: zAlignInput,
  run(ctx, input) {
    const els = requireElements(ctx.doc, input.ids);
    const to = input.to ?? "selection";
    const reference = to === "selection" ? groupBounds(els) : resolveContainer(ctx.doc, to);

    let doc = ctx.doc;
    let value = 0;
    for (const id of input.ids) {
      const el = requireElement(doc, id);
      const box = aabb(el);
      switch (input.edge) {
        case "left":
          value = reference.x;
          doc = moveAabbTo(doc, el, value, box.y);
          break;
        case "right":
          value = reference.x + reference.width;
          doc = moveAabbTo(doc, el, value - box.width, box.y);
          break;
        case "top":
          value = reference.y;
          doc = moveAabbTo(doc, el, box.x, value);
          break;
        case "bottom":
          value = reference.y + reference.height;
          doc = moveAabbTo(doc, el, box.x, value - box.height);
          break;
        case "horizontal_center":
          value = reference.x + reference.width / 2;
          doc = moveAabbTo(doc, el, value - box.width / 2, box.y);
          break;
        case "vertical_center":
          value = reference.y + reference.height / 2;
          doc = moveAabbTo(doc, el, box.x, value - box.height / 2);
          break;
      }
    }
    return {
      doc,
      message: `Aligned ${input.ids.join(", ")} on ${input.edge.replace("_", " ")} at ${round(value, 1)} (relative to ${to}).`,
      touched: [...input.ids],
    };
  },
};

// --- distribute ------------------------------------------------------------

const zDistributeInput = z.strictObject({
  ids: z.array(zElementId).min(2).describe("Elements to space out."),
  axis: z.enum(["horizontal", "vertical"]),
  spacing: z
    .number()
    .optional()
    .describe(
      "Gap to leave between neighbours. If omitted, gaps are equalized within the space the elements already span.",
    ),
});

const distributeTool: ToolDef<z.infer<typeof zDistributeInput>> = {
  name: "distribute",
  description:
    "Space elements evenly along an axis, in their current order. With 'spacing', every gap becomes that size; " +
    "without it, the outermost two stay put and the gaps between are equalized.",
  schema: zDistributeInput,
  run(ctx, input) {
    const els = requireElements(ctx.doc, input.ids);
    const horizontal = input.axis === "horizontal";
    const sorted = [...els].sort((a, b) => (horizontal ? aabb(a).x - aabb(b).x : aabb(a).y - aabb(b).y));
    const sizes = sorted.map((el) => (horizontal ? aabb(el).width : aabb(el).height));
    const totalSize = sizes.reduce((s, v) => s + v, 0);

    let gap: number;
    let start: number;
    if (input.spacing !== undefined) {
      gap = input.spacing;
      const firstBox = aabb(sorted[0]!);
      start = horizontal ? firstBox.x : firstBox.y;
    } else {
      const bounds = groupBounds(sorted);
      const extent = horizontal ? bounds.width : bounds.height;
      gap = sorted.length > 1 ? (extent - totalSize) / (sorted.length - 1) : 0;
      start = horizontal ? bounds.x : bounds.y;
    }

    let doc = ctx.doc;
    let cursor = start;
    for (let i = 0; i < sorted.length; i++) {
      const el = requireElement(doc, sorted[i]!.id);
      const box = aabb(el);
      doc = horizontal ? moveAabbTo(doc, el, cursor, box.y) : moveAabbTo(doc, el, box.x, cursor);
      cursor += sizes[i]! + gap;
    }

    const note = gap < 0 ? ` The elements do not fit in that span, so they now overlap by ${round(-gap, 1)} units each.` : "";
    return {
      doc,
      message: `Distributed ${sorted.map((e) => e.id).join(", ")} ${input.axis}ly with a ${round(gap, 1)} unit gap.${note}`,
      touched: sorted.map((e) => e.id),
    };
  },
};

// --- fit_text --------------------------------------------------------------

const zFitTextInput = z.strictObject({
  id: zElementId,
  mode: z
    .enum(["shrink_to_fit", "grow_to_fit", "grow_box"])
    .describe(
      "'shrink_to_fit' reduces the font size only if the text currently overflows. " +
        "'grow_to_fit' sets the largest font size that fits, growing or shrinking as needed. " +
        "'grow_box' keeps the font size and makes the element taller until the text fits.",
    ),
  min_font_size: z.number().min(4).max(400).optional().describe("Lower bound when changing font size. Default 8."),
  max_font_size: z.number().min(4).max(400).optional().describe("Upper bound when changing font size. Default 400."),
});

const fitTextTool: ToolDef<z.infer<typeof zFitTextInput>> = {
  name: "fit_text",
  description: "Reconcile a text element with its box, by changing the font size or the box height.",
  schema: zFitTextInput,
  run(ctx, input) {
    const el = requireElement(ctx.doc, input.id);
    if (el.type !== "text") throw new ToolError(`${input.id} is a ${el.type} element, not text.`);

    const before = layoutTextElement(el);
    if (input.mode === "grow_box") {
      const needed = before.blockHeight + (el.style.padding ?? 0) * 2;
      if (before.overflowX > 0.01) {
        throw new ToolError(
          `${input.id} has a word too wide for its box, so making it taller will not help.`,
          "Widen the element or reduce the font size instead.",
        );
      }
      const doc = patchElement(ctx.doc, input.id, { height: Math.max(el.height, needed) });
      return {
        doc,
        message: `Grew ${input.id} to ${round(Math.max(el.height, needed), 1)} units tall so its ${before.lines.length} line(s) fit.`,
        touched: [input.id],
      };
    }

    const min = input.min_font_size ?? 8;
    const max = input.max_font_size ?? 400;
    if (input.mode === "shrink_to_fit" && !before.clipped) {
      return { doc: ctx.doc, message: `${input.id} already fits its box; font size left at ${before.fontSize}.`, touched: [] };
    }
    const size = largestFittingFontSize(el, min, input.mode === "shrink_to_fit" ? Math.min(max, before.fontSize) : max);
    if (size === null) {
      throw new ToolError(
        `No font size between ${min} and ${max} lets ${input.id}'s text fit its ${round(el.width, 1)}x${round(el.height, 1)} box.`,
        "Make the element bigger, shorten the text, or lower min_font_size.",
      );
    }
    const doc = patchElement(ctx.doc, input.id, { style: { ...el.style, fontSize: size } });
    const after = layoutTextElement(requireElement(doc, input.id));
    return {
      doc,
      message: `Set ${input.id} to font size ${size} (was ${before.fontSize ?? DEFAULT_FONT_SIZE}); it now wraps to ${after.lines.length} line(s) and fits.`,
      touched: [input.id],
    };
  },
};

// --- fit_within ------------------------------------------------------------

const zFitWithinInput = z.strictObject({
  id: zElementId,
  container: z.string().describe("'canvas' or the id of the element to fit inside."),
  margin: z.number().min(0).optional().describe("Space to leave inside the container. Default 0."),
});

const fitWithinTool: ToolDef<z.infer<typeof zFitWithinInput>> = {
  name: "fit_within",
  description:
    "Scale an element down, keeping its aspect ratio, until it fits inside the canvas or another element, then " +
    "center it there. An element that already fits is only re-centered.",
  schema: zFitWithinInput,
  run(ctx, input) {
    const el = requireElement(ctx.doc, input.id);
    if (input.container === input.id) throw new ToolError(`Cannot fit ${input.id} within itself.`);
    const container = resolveContainer(ctx.doc, input.container);
    const margin = input.margin ?? 0;
    const availW = Math.max(1, container.width - margin * 2);
    const availH = Math.max(1, container.height - margin * 2);

    const box = aabb(el);
    const scale = Math.min(1, availW / box.width, availH / box.height);
    let doc = ctx.doc;
    if (scale < 1) {
      doc = patchElement(doc, input.id, {
        width: Math.max(1, el.width * scale),
        height: Math.max(1, el.height * scale),
      });
    }
    const scaled = aabb(requireElement(doc, input.id));
    doc = moveAabbTo(
      doc,
      requireElement(doc, input.id),
      container.x + margin + (availW - scaled.width) / 2,
      container.y + margin + (availH - scaled.height) / 2,
    );
    const after = requireElement(doc, input.id);
    return {
      doc,
      message:
        scale < 1
          ? `Scaled ${input.id} to ${Math.round(scale * 100)}% (${round(after.width, 1)}x${round(after.height, 1)}) and centered it inside ${input.container}.`
          : `${input.id} already fitted inside ${input.container}; centered it there.`,
      touched: [input.id],
    };
  },
};

// --- avoid_overlap ---------------------------------------------------------

const MAX_SEPARATION_ITERATIONS = 200;

const zAvoidOverlapInput = z.strictObject({
  ids: z.array(zElementId).min(2).describe("Elements to push apart. Only these move, and only relative to each other."),
  padding: z.number().min(0).optional().describe("Clear space to leave between them. Default 0."),
  keep_in_canvas: z.boolean().optional().describe("Keep every element inside the canvas while separating. Default true."),
});

const avoidOverlapTool: ToolDef<z.infer<typeof zAvoidOverlapInput>> = {
  name: "avoid_overlap",
  description:
    "Nudge elements apart until none of them overlaps another, moving each the smallest distance that works.",
  schema: zAvoidOverlapInput,
  run(ctx, input) {
    requireElements(ctx.doc, input.ids);
    const padding = input.padding ?? 0;
    const keepIn = input.keep_in_canvas !== false;

    // Work on bounding boxes: separating rotated shapes exactly would need a
    // full SAT solve, and "not touching on screen" is what is being asked for.
    const boxes = new Map<string, Rect>();
    for (const id of input.ids) boxes.set(id, aabb(requireElement(ctx.doc, id)));

    let iterations = 0;
    let moved = false;
    for (; iterations < MAX_SEPARATION_ITERATIONS; iterations++) {
      let collided = false;
      for (let i = 0; i < input.ids.length; i++) {
        for (let j = i + 1; j < input.ids.length; j++) {
          const a = boxes.get(input.ids[i]!)!;
          const b = boxes.get(input.ids[j]!)!;
          const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) + padding;
          const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) + padding;
          if (overlapX <= 0 || overlapY <= 0) continue;

          collided = true;
          moved = true;
          // Push along the axis needing the smaller correction.
          if (overlapX < overlapY) {
            const dir = a.x + a.width / 2 <= b.x + b.width / 2 ? -1 : 1;
            a.x += (dir * overlapX) / 2;
            b.x -= (dir * overlapX) / 2;
          } else {
            const dir = a.y + a.height / 2 <= b.y + b.height / 2 ? -1 : 1;
            a.y += (dir * overlapY) / 2;
            b.y -= (dir * overlapY) / 2;
          }
          if (keepIn) {
            clampToCanvas(a, ctx.doc);
            clampToCanvas(b, ctx.doc);
          }
        }
      }
      if (!collided) break;
    }

    let doc = ctx.doc;
    for (const id of input.ids) {
      const box = boxes.get(id)!;
      doc = moveAabbTo(doc, requireElement(doc, id), box.x, box.y);
    }

    const stillOverlapping = countOverlappingPairs(boxes, input.ids, padding);
    const converged = stillOverlapping === 0;
    const message = !moved
      ? `${input.ids.join(", ")} already had no overlaps; nothing moved.`
      : converged
        ? `Separated ${input.ids.join(", ")} with ${round(padding, 1)} units of clearance.`
        : `Moved ${input.ids.join(", ")} apart as far as the canvas allows; ${stillOverlapping} pair(s) still overlap. ` +
          `There is not enough room at their current sizes.`;

    return { doc, message, touched: [...input.ids] };
  },
};

function clampToCanvas(box: Rect, doc: Doc): void {
  box.x = Math.max(0, Math.min(box.x, doc.width - box.width));
  box.y = Math.max(0, Math.min(box.y, doc.height - box.height));
}

function countOverlappingPairs(boxes: Map<string, Rect>, ids: string[], padding: number): number {
  let n = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = boxes.get(ids[i]!)!;
      const b = boxes.get(ids[j]!)!;
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) + padding;
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) + padding;
      if (ox > 0.01 && oy > 0.01) n++;
    }
  }
  return n;
}

export const relationalTools = [
  createTool,
  placeTool,
  rotateTool,
  alignTool,
  distributeTool,
  fitTextTool,
  fitWithinTool,
  avoidOverlapTool,
];

export const relationalSurface: ToolSurface = {
  id: "relational",
  title: "Relational operations",
  briefing: [
    "You edit the document by describing relationships, not coordinates. There is no tool that takes an x or a y:",
    "you say what an element should be placed relative to, what it should line up with, or what it should fit inside,",
    "and the exact geometry is computed for you. Relations work on what is visible on screen, so an element's",
    "rotation is already accounted for, and rotating one turns it about its own center without moving it.",
    "Each tool reports the numbers it worked out, so you can see where things landed.",
  ].join(" "),
  tools: [...relationalTools, setStyleTool, deleteTool],
};
