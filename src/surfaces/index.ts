/**
 * The surface registry.
 *
 * `hybrid` is not one of the three surfaces under comparison. It exists
 * because "what if the agent has both vocabularies?" is the first question
 * anyone asks after seeing the headline result, and because it measures
 * something the three-way comparison cannot: given the choice, which
 * operations does an agent actually reach for? Tool-call counts per surface
 * are recorded for exactly this.
 */

import { coordinateSurface } from "./coordinate.js";
import { relationalSurface, relationalTools } from "./relational.js";
import { documentSurface } from "./document.js";
import { deleteTool, setBackgroundTool, setStyleTool } from "./common.js";
import type { SurfaceId, ToolSurface } from "./types.js";
import { withMotion } from "./motion.js";
import { withPaint } from "./paint.js";

const hybridSurface: ToolSurface = {
  id: "hybrid",
  title: "Coordinate and relational together",
  briefing: [
    coordinateSurface.briefing,
    "You also have relational operations that compute geometry for you: place an element relative to another or to",
    "the canvas, line elements up, space them out, fit text to its box, fit a box inside another, or push overlapping",
    "elements apart. Use whichever expresses what you want.",
  ].join(" "),
  // Coordinate's create wins the name clash: it is the one that takes explicit
  // x and y, so an agent that wants relational placement has `place` for it.
  tools: [
    ...coordinateSurface.tools,
    ...relationalTools.filter((t) => t.name !== "create"),
  ],
};

/**
 * Coordinate, plus the tools that measure: `fit_text` here, and `connect` on a
 * task that draws (`withPaint`).
 *
 * Both confirmed results credit the relational surface, and both run through
 * one tool that computes what the agent would otherwise estimate. Relational
 * differs from coordinate in its whole vocabulary, though — no x or y anywhere
 * — so those results cannot say which of the two did the work. This surface
 * keeps coordinate's vocabulary and adds only the measuring tools, so
 * coordinate against `measured` is the tool, and `measured` against relational
 * is the vocabulary. The tools are the very objects relational uses, so a
 * difference cannot come from how they were written.
 */
const measuredSurface: ToolSurface = {
  id: "measured",
  title: "Coordinate primitives, with measuring tools",
  briefing: [
    coordinateSurface.briefing,
    "Two tools measure for you instead: fit_text sets a text element's font size or box height from its text, and,",
    "where you can draw, connect draws a line between two elements that starts and ends exactly on their outlines.",
  ].join(" "),
  tools: [...coordinateSurface.tools, ...relationalTools.filter((t) => t.name === "fit_text")],
};

/**
 * `measured`, with `connect` as the only way to draw a line on a task that
 * draws (`withPaint` attaches no numeric `draw`). On Haiku 5.5 every
 * `measured` diagram run that used `connect` passed and every one that drew
 * with typed coordinates failed; this takes the second choice away, to see
 * whether the choice was the whole of the gap. Everywhere else it is
 * `measured`.
 */
const measuredStrictSurface: ToolSurface = { ...measuredSurface, id: "measured_strict" };

export const SURFACES: Record<SurfaceId, ToolSurface> = {
  coordinate: coordinateSurface,
  relational: relationalSurface,
  document: documentSurface,
  hybrid: hybridSurface,
  measured: measuredSurface,
  measured_strict: measuredStrictSurface,
};

/**
 * True for a real surface id. `in` and plain indexing both walk the prototype
 * chain, so `"toString"` and `"__proto__"` come back as surfaces — the ids here
 * arrive from an HTTP query string and a WebMCP call, not only from typed code.
 */
export function isSurfaceId(id: string): id is SurfaceId {
  return Object.hasOwn(SURFACES, id);
}

export function getSurface(id: SurfaceId): ToolSurface {
  if (!isSurfaceId(id)) throw new Error(`Unknown surface '${id}'. Known: ${Object.keys(SURFACES).join(", ")}`);
  return SURFACES[id];
}

/**
 * The surface a task runs on: the registered one, plus whatever tools the
 * task's kind calls for. The one place that decides it, so the sweep, the
 * live page and the WebMCP host cannot hand the same task different tools.
 */
export function surfaceFor(id: SurfaceId, needs: { motion?: boolean; paint?: boolean } = {}): ToolSurface {
  let surface = getSurface(id);
  if (needs.motion) surface = withMotion(surface);
  if (needs.paint) surface = withPaint(surface);
  return surface;
}

export { coordinateSurface, relationalSurface, documentSurface, hybridSurface, setStyleTool, setBackgroundTool, deleteTool };
export * from "./types.js";
