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
import { deleteTool, setStyleTool } from "./common.js";
import type { SurfaceId, ToolSurface } from "./types.js";

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

export const SURFACES: Record<SurfaceId, ToolSurface> = {
  coordinate: coordinateSurface,
  relational: relationalSurface,
  document: documentSurface,
  hybrid: hybridSurface,
};

export function getSurface(id: SurfaceId): ToolSurface {
  const surface = SURFACES[id];
  if (!surface) throw new Error(`Unknown surface '${id}'. Known: ${Object.keys(SURFACES).join(", ")}`);
  return surface;
}

export { coordinateSurface, relationalSurface, documentSurface, hybridSurface, setStyleTool, deleteTool };
export * from "./types.js";
