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
 *   - For text, ink is the bounding box of the glyphs each laid-out line
 *     actually draws, clipped to the element box (text already clipped away by
 *     its own box is a text overflow problem, counted separately). Not the
 *     line box: that runs from the ascender to the descender whether or not
 *     the line has an ascender or a descender in it, and a row of capitals
 *     leaves a third of it blank. Counting that blank band as ink reported
 *     headlines as covered by things that pass through the air above and
 *     below the letters.
 *   - For images and rects, ink is the whole box.
 *
 * A card behind a headline occludes nothing, because it is painted below. A
 * rect dropped on top of a headline occludes it, because it is painted above.
 * That matches what a reader sees.
 */

import type { Doc, Element, Point, Polygon, Rect } from "./types.js";
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
    let box: Rect;
    if (line.ink) {
      box = line.ink;
    } else if (layout.inkMeasured) {
      // Measured, and the line draws nothing: whitespace only.
      continue;
    } else {
      // A face whose outlines this project cannot bound. Fall back to the line
      // box, which is what this check used before glyph bounds were read: too
      // generous, never too tight.
      box = {
        x: line.x,
        y: line.baseline - layout.ascent,
        width: line.width,
        height: layout.ascent + layout.descent,
      };
    }
    if (box.width <= 0 || box.height <= 0) continue;
    // Text is painted clipped to its own box, so ink outside the box is not
    // ink at all — it is overflow, which `textOverflow` in the checks counts.
    const clipped = convexClip(rectToPolygon(box), boxPoly);
    if (polygonArea(clipped) > EPS) out.push(rotatePolygon(clipped, c, el.rotation));
  }
  return out;
}

/** True for `transparent` and for any `#rrggbbaa` whose alpha is below `min`. */
function opaqueEnough(color: string, min: number): boolean {
  const s = color.trim().toLowerCase();
  if (s === "transparent") return false;
  const m = /^#[0-9a-f]{6}([0-9a-f]{2})$/.exec(s);
  return m ? parseInt(m[1]!, 16) / 255 >= min : true;
}

/**
 * What `el` paints densely enough to hide whatever is under it, as polygons in
 * canvas space. Empty when it hides nothing.
 *
 * The distinction that matters is between an element's *box* and its *ink*. A
 * headline painted over another headline hides only the glyphs it actually
 * covers; treating it as a solid rectangle would report a caption as buried
 * because a line of large type passes near it. Text therefore occludes through
 * its glyph envelope, plus its own block fill where it has one.
 */
export function occluderPolygons(el: Element, minOpacity = 0.5): Polygon[] {
  if ((el.style.opacity ?? 1) < minOpacity) return [];

  if (el.type === "image") return [corners(el)];

  if (el.type === "rect") {
    // A rect with no fill (or a transparent one) paints only its stroke.
    return opaqueEnough(el.style.fill ?? "#cccccc", minOpacity) ? [corners(el)] : [];
  }

  // A text block's fill covers the whole box, so it hides everything beneath.
  const fill = el.style.fill;
  if (fill && opaqueEnough(fill, minOpacity)) return [corners(el)];
  if (!el.text) return [];
  if (!opaqueEnough(el.style.color ?? "#111111", minOpacity)) return [];
  return inkPolygons(el);
}

/**
 * Everything an element puts on the canvas, as polygons in canvas space.
 *
 * The sibling of `occluderPolygons`, asked from the other side. That one asks
 * "what does this hide?", so it drops anything too faint to hide with; this
 * asks "what does this show?", so a half-opaque band still counts — a reader
 * sees it, and it still crowds an edge. Only a fully transparent element
 * paints nothing.
 *
 * A stroke counts, which is the other place the two differ: an outline is too
 * thin to hide much, and perfectly visible sitting against a canvas edge.
 */
export function paintedPolygons(el: Element): Polygon[] {
  if ((el.style.opacity ?? 1) <= 0) return [];

  const stroked =
    el.style.strokeColor !== undefined &&
    opaqueEnough(el.style.strokeColor, EPS) &&
    (el.style.strokeWidth ?? 1) > 0;
  const filled = el.style.fill !== undefined && opaqueEnough(el.style.fill, EPS);

  if (el.type === "image") return [corners(el)];
  // An undeclared fill is not no fill: the renderer paints a rect grey.
  if (el.type === "rect") {
    return el.style.fill === undefined || filled || stroked ? [corners(el)] : [];
  }
  // A text block's fill and its stroke are both painted on the element box,
  // which already contains every glyph — they are clipped to it.
  if (filled || stroked) return [corners(el)];
  if (!el.text || !opaqueEnough(el.style.color ?? "#111111", EPS)) return [];
  return inkPolygons(el);
}

/** Elements painted above `el` that hide any part of what is beneath them. */
export function occludersAbove(doc: Doc, el: Element, minOpacity = 0.5): Element[] {
  const index = doc.elements.findIndex((e) => e.id === el.id);
  if (index === -1) return [];
  return doc.elements.slice(index + 1).filter((other) => occluderPolygons(other, minOpacity).length > 0);
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
  const above = occludersAbove(doc, el).map((o) => ({ id: o.id, polygons: occluderPolygons(o) }));
  const clips = above.flatMap((o) => o.polygons);

  let visibleArea = 0;
  for (const piece of ink) visibleArea += visibleAreaAfterSubtracting(piece, clips);
  visibleArea = Math.min(visibleArea, inkArea);

  const occludedBy = above
    .filter((o) => o.polygons.some((c) => ink.some((p) => polygonArea(convexClip(p, c)) > EPS)))
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
