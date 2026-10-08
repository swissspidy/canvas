/**
 * Animation tools, one per vocabulary.
 *
 * Attached only for tasks that animate (`Task.motion`), so every other task
 * sends exactly the tool list it always has. Both tools reach exactly the same
 * animations, `surfaces.test.ts` proves it, and they differ in the one way the
 * surfaces are meant to: `set_animation` takes every number as a number, and
 * `animate` lets a start time and a fly distance be said as relations — "when
 * the headline lands", "from off the canvas" — and works the numbers out.
 * Document-as-code writes the same `animation` field in the JSON.
 */

import { z } from "zod";
import { ANIMATION_EFFECTS, FLY_SIDES } from "../doc/types.js";
import type { Animation, Element } from "../doc/types.js";
import { patchElement, requireElement, ToolError } from "../doc/ops.js";
import { offscreenDistance } from "../doc/motion.js";
import { round } from "../doc/geometry.js";
import { describeElementShort, zElementId } from "./common.js";
import type { ToolDef, ToolOutcome, ToolSurface } from "./types.js";
import type { Doc } from "../doc/types.js";

/** The rules every animation tool states, worded once. */
const SEMANTICS =
  "An element's position and style are where it comes to rest; the animation only says how it arrives. " +
  "fade raises its opacity from 0; fly moves it in a straight line from `distance` units out on the `from` side. " +
  "Both are linear. Before its delay an element shows its starting state: invisible for fade, displaced for fly.";

function confirm(doc: Doc, el: Element): ToolOutcome {
  const a = el.animation;
  const message = !a
    ? `${describeElementShort(el)} no longer animates.`
    : `${describeElementShort(el)} now ${a.effect === "fly" ? `flies in from the ${a.from}, ${round(a.distance ?? 0, 1)} units,` : "fades in"} ` +
      `from ${round(a.delay, 1)}ms to ${round(a.delay + a.duration, 1)}ms.`;
  return { doc, message, touched: [el.id] };
}

function apply(doc: Doc, id: string, animation: Animation | undefined): ToolOutcome {
  const next = patchElement(doc, id, { animation });
  return confirm(next, requireElement(next, id));
}

// --- set_animation: every number given -----------------------------------------

export const zSetAnimationInput = z.strictObject({
  id: zElementId,
  effect: z.enum([...ANIMATION_EFFECTS, "none"]).describe("fade, fly, or none to remove the element's animation."),
  delay: z.number().min(0).max(60000).optional().describe("Milliseconds from the moment the page opens to the start. Required unless effect is none."),
  duration: z.number().min(1).max(60000).optional().describe("Milliseconds it takes. Required unless effect is none."),
  from: z.enum(FLY_SIDES).optional().describe("fly only: the side it comes in from."),
  distance: z.number().min(0).max(20000).optional().describe("fly only: how far it travels, in canvas units."),
});

export const setAnimationTool: ToolDef<z.infer<typeof zSetAnimationInput>> = {
  name: "set_animation",
  description: `Give an element an entrance animation, replacing any it had. ${SEMANTICS}`,
  schema: zSetAnimationInput,
  run(ctx, input) {
    requireElement(ctx.doc, input.id);
    if (input.effect === "none") return apply(ctx.doc, input.id, undefined);
    if (input.delay === undefined || input.duration === undefined) {
      throw new ToolError(`A ${input.effect} animation needs both delay and duration.`);
    }
    if (input.effect === "fly" && (input.from === undefined || input.distance === undefined)) {
      throw new ToolError("A fly animation needs from and distance.");
    }
    if (input.effect === "fade" && (input.from !== undefined || input.distance !== undefined)) {
      throw new ToolError("Only a fly animation takes from and distance.");
    }
    return apply(ctx.doc, input.id, {
      effect: input.effect,
      delay: input.delay,
      duration: input.duration,
      ...(input.effect === "fly" ? { from: input.from, distance: input.distance } : {}),
    });
  },
};

// --- animate: start and distance as relations --------------------------------

const zStart = z
  .union([
    z.strictObject({ at: z.number().min(0).max(60000).describe("Milliseconds from the moment the page opens.") }),
    z.strictObject({
      after: zElementId.describe("Start when this element's animation ends (at once, if it does not animate)."),
      gap: z.number().min(0).max(60000).optional().describe("Milliseconds to wait after that. Default 0."),
    }),
    z.strictObject({
      with: zElementId.describe("Start when this element's animation starts (at once, if it does not animate)."),
      offset: z.number().min(0).max(60000).optional().describe("Milliseconds after that. Default 0."),
    }),
  ])
  .describe("When it starts: at a time, after another element's animation ends, or with another's start.");

export const zAnimateInput = z.strictObject({
  id: zElementId,
  effect: z.enum([...ANIMATION_EFFECTS, "none"]).describe("fade, fly, or none to remove the element's animation."),
  start: zStart.optional().describe("Required unless effect is none."),
  duration: z.number().min(1).max(60000).optional().describe("Milliseconds it takes. Required unless effect is none."),
  from: z.enum(FLY_SIDES).optional().describe("fly only: the side it comes in from."),
  distance: z
    .union([z.number().min(0).max(20000), z.literal("offscreen")])
    .optional()
    .describe("fly only: how far it travels, in canvas units, or 'offscreen' for exactly far enough to start entirely off the canvas."),
});

function startOf(doc: Doc, start: z.infer<typeof zStart>): number {
  if ("at" in start) return start.at;
  const ref = requireElement(doc, "after" in start ? start.after : start.with);
  const a = ref.animation;
  if ("after" in start) return (a ? a.delay + a.duration : 0) + (start.gap ?? 0);
  return (a ? a.delay : 0) + (start.offset ?? 0);
}

export const animateTool: ToolDef<z.infer<typeof zAnimateInput>> = {
  name: "animate",
  description:
    `Give an element an entrance animation, replacing any it had. Say when it starts relative to another element's ` +
    `animation, and a fly distance as 'offscreen', and the times and distance are worked out for you. ${SEMANTICS}`,
  schema: zAnimateInput,
  run(ctx, input) {
    const el = requireElement(ctx.doc, input.id);
    if (input.effect === "none") return apply(ctx.doc, input.id, undefined);
    if (input.start === undefined || input.duration === undefined) {
      throw new ToolError(`A ${input.effect} animation needs both start and duration.`);
    }
    if (input.effect === "fly" && (input.from === undefined || input.distance === undefined)) {
      throw new ToolError("A fly animation needs from and distance.");
    }
    if (input.effect === "fade" && (input.from !== undefined || input.distance !== undefined)) {
      throw new ToolError("Only a fly animation takes from and distance.");
    }
    const delay = startOf(ctx.doc, input.start);
    if (input.effect === "fade") return apply(ctx.doc, input.id, { effect: "fade", delay, duration: input.duration });
    const from = input.from!;
    const distance = input.distance === "offscreen" ? offscreenDistance(ctx.doc, el, from) : input.distance!;
    return apply(ctx.doc, input.id, { effect: "fly", delay, duration: input.duration, from, distance });
  },
};

/**
 * A surface with the animation tool its vocabulary calls for. Document-as-code
 * needs none: `animation` is a field of the document it writes.
 */
export function withMotion(surface: ToolSurface): ToolSurface {
  const tools =
    surface.id === "coordinate"
      ? [setAnimationTool]
      : surface.id === "relational"
        ? [animateTool]
        : surface.id === "hybrid"
          ? [setAnimationTool, animateTool]
          : [];
  return tools.length ? { ...surface, tools: [...surface.tools, ...tools] } : surface;
}
