/**
 * Time: what a page looks like at a moment while its entrance animations play.
 *
 * An animation never changes the document. The element's x, y and style are
 * where it comes to rest, and `frameAt` derives every earlier moment from
 * them. So a page with animations is still a page: every static check scores
 * its last frame without knowing animations exist, and the motion checks ask
 * questions of the frames in between.
 *
 * Pure, like the rest of `src/doc`: no Node, no clock. A frame is an ordinary
 * `Doc`, which is what lets the renderer, the occlusion geometry and the
 * checks all work on one without learning about time.
 */

import type { Animation, Doc, Element, FlySide, Rect } from "./types.js";
import { aabb } from "./geometry.js";

/** How far through its animation an element is at `t`: 0 before it starts, 1 once it has landed. */
export function progressAt(a: Animation, t: number): number {
  if (t <= a.delay) return 0;
  if (t >= a.delay + a.duration) return 1;
  return (t - a.delay) / a.duration;
}

/** The unit vector pointing from an element's resting place towards the side it flies in from. */
function sideVector(side: FlySide): { dx: number; dy: number } {
  switch (side) {
    case "left":
      return { dx: -1, dy: 0 };
    case "right":
      return { dx: 1, dy: 0 };
    case "top":
      return { dx: 0, dy: -1 };
    case "bottom":
      return { dx: 0, dy: 1 };
  }
}

/** An element as it is drawn at `t`, with its animation consumed. */
export function elementAt(el: Element, t: number): Element {
  const { animation, ...rest } = el;
  if (!animation) return rest;
  const p = progressAt(animation, t);
  // At rest an element is exactly the one stored, not a copy with its
  // opacity spelled out as 1.
  if (p >= 1) return rest;
  if (animation.effect === "fade") {
    return { ...rest, style: { ...rest.style, opacity: (rest.style.opacity ?? 1) * p } };
  }
  const { dx, dy } = sideVector(animation.from ?? "left");
  const away = (animation.distance ?? 0) * (1 - p);
  return { ...rest, x: rest.x + dx * away, y: rest.y + dy * away };
}

/** The page as it stands `t` milliseconds after it opens: a static document. */
export function frameAt(doc: Doc, t: number): Doc {
  return { ...doc, elements: doc.elements.map((el) => elementAt(el, t)) };
}

/** When the last animation ends; 0 for a page with none. */
export function animationEnd(doc: Doc): number {
  return Math.max(0, ...doc.elements.map((el) => (el.animation ? el.animation.delay + el.animation.duration : 0)));
}

/**
 * The moments a motion check looks at: every `step` milliseconds from 0 to
 * the end, plus each animation's own start and end, so a short animation
 * between two samples is never missed.
 */
export function sampleTimes(doc: Doc, step = 20): number[] {
  const end = animationEnd(doc);
  const times = new Set<number>();
  for (let t = 0; t <= end; t += step) times.add(t);
  times.add(end);
  for (const el of doc.elements) {
    if (!el.animation) continue;
    times.add(el.animation.delay);
    times.add(el.animation.delay + el.animation.duration);
  }
  return [...times].sort((a, b) => a - b);
}

/**
 * The shortest fly distance that starts an element entirely off the canvas,
 * measured on its visible (rotated) box. Rounded up, so it never leaves a
 * sliver showing.
 */
export function offscreenDistance(doc: Doc, el: Element, side: FlySide): number {
  const box: Rect = aabb(el);
  const d =
    side === "left"
      ? box.x + box.width
      : side === "right"
        ? doc.width - box.x
        : side === "top"
          ? box.y + box.height
          : doc.height - box.y;
  return Math.max(0, Math.ceil(d));
}
