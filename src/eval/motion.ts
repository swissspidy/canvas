/**
 * Checks on motion: questions about the frames between opening and rest.
 *
 * The static checks already score the last frame, because an animated
 * element's stored geometry and style are its resting state (`src/doc/motion.ts`).
 * These look at the rest of the timeline, either at the animation itself
 * (what it is set to) or at sampled frames (what it does), and grade 0..1
 * like every other check so partial work still counts.
 */

import type { Doc, Element, FlySide } from "../doc/types.js";
import { aabb } from "../doc/geometry.js";
import { animationEnd, frameAt, sampleTimes } from "../doc/motion.js";
import { noTextOcclusion, select, type Check, type CheckOutcome, type Selector } from "./checks.js";

function check(id: string, label: string, weight: number, run: (doc: Doc) => CheckOutcome): Check {
  return { id, label, weight, run };
}

export interface AnimationSpec {
  effect: "fade" | "fly";
  from?: FlySide;
  delay?: number;
  duration?: number;
}

/**
 * The selected elements animate as stated. Each stated field counts equally,
 * so a fly from the right side at the right time scores most of its marks; the
 * score is the mean over elements. `tolerance` is in milliseconds.
 */
export function animatesAs(selector: Selector, spec: AnimationSpec, weight = 1, label?: string, tolerance = 10): Check {
  return check("animates_as", label ?? `Animates as ${spec.effect}`, weight, (doc) => {
    const els = select(doc, selector);
    if (els.length === 0) return { score: 0, detail: "No such element." };
    const misses: string[] = [];
    let total = 0;
    for (const el of els) {
      const a = el.animation;
      const fields: [string, boolean][] = [["effect", a?.effect === spec.effect]];
      if (spec.from !== undefined) fields.push(["from", a?.from === spec.from]);
      if (spec.delay !== undefined) fields.push(["delay", !!a && Math.abs(a.delay - spec.delay) <= tolerance]);
      if (spec.duration !== undefined) fields.push(["duration", !!a && Math.abs(a.duration - spec.duration) <= tolerance]);
      const ok = fields.filter(([, hit]) => hit).length;
      total += ok / fields.length;
      const wrong = fields.filter(([, hit]) => !hit).map(([k]) => k);
      if (wrong.length) {
        misses.push(
          a
            ? `${el.id}: ${wrong.join(", ")} off (${a.effect}${a.from ? ` from ${a.from}` : ""}, ${a.delay}+${a.duration}ms)`
            : `${el.id}: no animation`,
        );
      }
    }
    return { score: total / els.length, detail: misses.length ? misses.join("; ") : "As stated." };
  });
}

/** The selected elements do not animate: they are there from the first frame. */
export function stillFromStart(selector: Selector, weight = 1): Check {
  return check("still_from_start", "Present from the first frame", weight, (doc) => {
    const els = select(doc, selector);
    if (els.length === 0) return { score: 1, detail: "Nothing to hold still." };
    const moving = els.filter((el) => el.animation);
    return {
      score: 1 - moving.length / els.length,
      detail: moving.length ? `Animated: ${moving.map((el) => el.id).join(", ")}` : "None animate.",
    };
  });
}

function visibleShare(el: Element, doc: Doc): number {
  const b = aabb(el);
  const w = Math.max(0, Math.min(b.x + b.width, doc.width) - Math.max(b.x, 0));
  const h = Math.max(0, Math.min(b.y + b.height, doc.height) - Math.max(b.y, 0));
  return (w * h) / Math.max(1e-9, b.width * b.height);
}

/**
 * Each selected element flies in from entirely off the canvas: in the frame at
 * its own start, no part of its visible box is on the canvas. Graded by how
 * much of it shows then; an element that does not fly at all scores 0.
 */
export function startsOffCanvas(selector: Selector, weight = 1): Check {
  return check("starts_off_canvas", "Flies in from off the canvas", weight, (doc) => {
    const els = select(doc, selector);
    if (els.length === 0) return { score: 0, detail: "No such element." };
    let total = 0;
    const showing: string[] = [];
    for (const el of els) {
      const a = el.animation;
      if (!a || a.effect !== "fly") {
        showing.push(`${el.id} does not fly`);
        continue;
      }
      const start = frameAt(doc, a.delay).elements.find((e) => e.id === el.id)!;
      const share = visibleShare(start, doc);
      total += 1 - share;
      if (share > 0.001) showing.push(`${el.id} starts ${Math.round(share * 100)}% on the canvas`);
    }
    return { score: total / els.length, detail: showing.length ? showing.join("; ") : "All start off the canvas." };
  });
}

/**
 * No text is covered at any moment, not only at rest: the static occlusion
 * check, run on every sampled frame and scored on the worst one.
 */
export function textNeverCovered(weight = 1, step = 20): Check {
  // Only ink on the canvas: text still off the page cannot be covered.
  const occlusion = noTextOcclusion(1, { onCanvasOnly: true });
  return check("text_never_covered", "No text is covered at any moment", weight, (doc) => {
    let worst: CheckOutcome & { t: number } = { score: 1, detail: "", t: 0 };
    for (const t of sampleTimes(doc, step)) {
      const r = occlusion.run(frameAt(doc, t));
      if (r.score < worst.score) worst = { ...r, t };
    }
    return worst.score >= 1
      ? { score: 1, detail: "No text is covered in any frame." }
      : { score: worst.score, detail: `At ${worst.t}ms: ${worst.detail}` };
  });
}

/**
 * One element stays within another in every frame — a label inside its button
 * while both fly in. Graded on the share of frames where it does.
 */
export function staysInside(inner: string, outer: string, weight = 1, label?: string, step = 20): Check {
  return check("stays_inside", label ?? `${inner} stays inside ${outer} throughout`, weight, (doc) => {
    if (!doc.elements.some((e) => e.id === inner) || !doc.elements.some((e) => e.id === outer)) {
      return { score: 0, detail: "Missing element." };
    }
    const times = sampleTimes(doc, step);
    const outside: number[] = [];
    for (const t of times) {
      const f = frameAt(doc, t);
      const a = aabb(f.elements.find((e) => e.id === inner)!);
      const b = aabb(f.elements.find((e) => e.id === outer)!);
      const inside = a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.width <= b.x + b.width + 1 && a.y + a.height <= b.y + b.height + 1;
      if (!inside) outside.push(t);
    }
    return {
      score: 1 - outside.length / times.length,
      detail: outside.length ? `Outside at ${outside.length} of ${times.length} moments, first at ${outside[0]}ms.` : "Inside throughout.",
    };
  });
}

/** Everything is at rest by `ms`. Graded down to 0 at a second late. */
export function atRestBy(ms: number, weight = 1): Check {
  return check("at_rest_by", `At rest by ${ms}ms`, weight, (doc) => {
    const end = animationEnd(doc);
    if (end <= ms) return { score: 1, detail: `At rest at ${end}ms.` };
    return { score: Math.max(0, 1 - (end - ms) / 1000), detail: `Still moving until ${end}ms.` };
  });
}

/**
 * Animations that start a fixed gap apart. `order: "given"` holds them to the
 * order of `ids` (the blurbs fade in top to bottom); `order: "any"` lets the
 * agent choose which goes when and checks only that the starts form an even
 * ladder, from `first` if that is stated. Graded on the share of gaps that
 * are right, plus the first start when one is set; `tolerance` in ms.
 */
export function staggered(
  ids: string[],
  gap: number,
  opts: { order: "given" | "any"; first?: number },
  weight = 1,
  label?: string,
  tolerance = 10,
): Check {
  return check("staggered", label ?? `${ids.join(", ")} start ${gap}ms apart`, weight, (doc) => {
    const delays = ids.map((id) => doc.elements.find((e) => e.id === id)?.animation?.delay);
    if (delays.some((d) => d === undefined)) {
      return { score: 0, detail: `Not animated: ${ids.filter((_, i) => delays[i] === undefined).join(", ")}` };
    }
    const starts = opts.order === "any" ? [...(delays as number[])].sort((a, b) => a - b) : (delays as number[]);
    const tests: boolean[] = [];
    for (let i = 1; i < starts.length; i++) tests.push(Math.abs(starts[i]! - starts[i - 1]! - gap) <= tolerance);
    if (opts.first !== undefined) tests.push(Math.abs(starts[0]! - opts.first) <= tolerance);
    const ok = tests.filter(Boolean).length;
    return {
      score: ok / tests.length,
      detail: ok === tests.length ? "Evenly staggered." : `Starts at ${starts.join(", ")}ms.`,
    };
  });
}
