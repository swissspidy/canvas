/**
 * Occlusion: what is actually hidden, rather than what merely overlaps.
 *
 * Raw pairwise overlap area is the obvious metric and it is the wrong one. A
 * headline sitting on a card overlaps that card by 100%, and that is good
 * design, not a defect. Scoring raw overlap would punish every competent
 * layout and reward scattered elements — the metric would be measuring
 * "did the agent avoid stacking things", which is not what anyone means by
 * "fix this overlapping layout".
 *
 * So the defect is defined as *ink that something painted above it covers*:
 *
 *   - For text, ink is the glyph envelope of each laid-out line, clipped to
 *     the element box (text already clipped away by its own box is a text
 *     overflow problem, counted separately).
 *   - For images and rects, ink is the whole box.
 *
 * A card behind a headline occludes nothing, because it is painted below. A
 * rect dropped on top of a headline occludes it, because it is painted above.
 * That matches what a reader sees.
 */

import type { Doc, Element, Point, Polygon } from "./types.js";
import { corners, degToRad, EPS, polygonArea, visibleAreaAfterSubtracting, convexClip } from "./geometry.js";
import { layoutTextElement } from "../text/layout.js";
import { rectToPolygon, center } from "./geometry.js";

function rotatePolygon(poly: Polygon, about: Point, deg: number): Polygon {
  if (!deg) return poly;
  const theta = degToRad(deg);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return poly.map((p) => {
    const dx = p.x - about.x;
    const dy = p.y - about.y;
    return { x: about.x + dx * cos - dy * sin, y: about.y + dx * sin + dy * cos };
  });
}

/**
 * The polygons an element actually paints, in canvas space.
 * An element whose opacity is below `minOpacity` paints nothing that can
 * meaningfully hide what is under it.
 */
export function inkPolygons(el: Element): Polygon[] {
  const c = center(el);

  if (el.type !== "text") {
    return [corners(el)];
  }

  const layout = layoutTextElement(el);
  const boxPoly = rectToPolygon({ x: el.x, y: el.y, width: el.width, height: el.height });
  const out: Polygon[] = [];

  for (const line of layout.lines) {
    if (line.width <= 0 || line.text.length === 0) continue;
    const glyphBox = rectToPolygon({
      x: line.x,
      y: line.baseline - layout.ascent,
      width: line.width,
      height: layout.ascent + layout.descent,
    });
    // Text is painted clipped to its own box, so ink outside the box is not
    // ink at all — it is overflow, which `textOverflow` in the checks counts.
    const clipped = convexClip(glyphBox, boxPoly);
    if (polygonArea(clipped) > EPS) out.push(rotatePolygon(clipped, c, el.rotation));
  }
  return out;
}

/** Elements painted above `el`, opaque enough to hide what is beneath them. */
export function occludersAbove(doc: Doc, el: Element, minOpacity = 0.5): Element[] {
  const index = doc.elements.findIndex((e) => e.id === el.id);
  if (index === -1) return [];
  return doc.elements.slice(index + 1).filter((other) => {
    if ((other.style.opacity ?? 1) < minOpacity) return false;
    if (other.type === "rect") {
      // A rect with no fill (or a transparent one) paints only its stroke.
      const fill = other.style.fill ?? "#cccccc";
      if (fill === "transparent" || /^#[0-9a-fA-F]{6}00$/.test(fill)) return false;
    }
    if (other.type === "text" && !other.text) return false;
    return true;
  });
}

export interface Occlusion {
  id: string;
  /** Total painted area of this element. */
  inkArea: number;
  /** Painted area still visible after everything above it is drawn. */
  visibleArea: number;
  hiddenArea: number;
  /** 0..1 */
  hiddenFraction: number;
  /** Ids of elements above that cover part of this one. */
  occludedBy: string[];
}

export function occlusionOf(doc: Doc, el: Element): Occlusion {
  const ink = inkPolygons(el);
  const inkArea = ink.reduce((s, p) => s + polygonArea(p), 0);
  const above = occludersAbove(doc, el);
  const clips = above.map((o) => corners(o));

  let visibleArea = 0;
  for (const piece of ink) visibleArea += visibleAreaAfterSubtracting(piece, clips);
  visibleArea = Math.min(visibleArea, inkArea);

  const occludedBy = above
    .filter((o) => ink.some((p) => polygonArea(convexClip(p, corners(o))) > EPS))
    .map((o) => o.id);

  const hiddenArea = Math.max(0, inkArea - visibleArea);
  return {
    id: el.id,
    inkArea,
    visibleArea,
    hiddenArea,
    hiddenFraction: inkArea > EPS ? hiddenArea / inkArea : 0,
    occludedBy,
  };
}

export function occlusions(doc: Doc): Occlusion[] {
  return doc.elements.map((el) => occlusionOf(doc, el));
}

/** Total hidden ink across every text element. The headline overlap metric. */
export function textOcclusionArea(doc: Doc): number {
  return doc.elements
    .filter((el) => el.type === "text")
    .reduce((sum, el) => sum + occlusionOf(doc, el).hiddenArea, 0);
}

/** Total hidden ink across every element. */
export function totalOcclusionArea(doc: Doc): number {
  return occlusions(doc).reduce((sum, o) => sum + o.hiddenArea, 0);
}
