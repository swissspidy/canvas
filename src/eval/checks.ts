/**
 * Deterministic checks.
 *
 * These are cheap, they never disagree with themselves, and they carry the
 * load in the analysis — the judge is there for intent, which cannot be
 * measured this way, not to grade geometry.
 *
 * Every check returns a graded 0..1 score rather than a pass/fail bit. With
 * ~20 tasks and a handful of repeats per cell, binary scoring throws away most
 * of the signal: "the layout is 8 units out of bounds" and "half the poster is
 * off the canvas" are not the same failure, and a study this small cannot
 * afford to treat them as one.
 */

import type { Doc, Element, ElementType, Rect } from "../doc/types.js";
import { aabb, outOfBoundsArea, round } from "../doc/geometry.js";
import { occlusionOf, paintedPolygons } from "../doc/occlusion.js";
import { layoutTextElement } from "../text/layout.js";
import { assetAspect } from "../doc/assets.js";
import { contrastRatio, effectiveBackdrop, parseColor, relativeLuminance } from "./color.js";

export interface CheckOutcome {
  /** 0..1, where 1 is fully satisfied. */
  score: number;
  detail: string;
}

export interface Check {
  id: string;
  label: string;
  weight: number;
  run(doc: Doc): CheckOutcome;
}

export interface CheckResult extends CheckOutcome {
  id: string;
  label: string;
  weight: number;
  passed: boolean;
}

/** A check counts as passed at this score. Used for reporting, not for scoring. */
export const PASS_THRESHOLD = 0.999;

export type Selector = string[] | ((el: Element) => boolean);

export function select(doc: Doc, selector: Selector): Element[] {
  if (Array.isArray(selector)) {
    return selector.map((id) => doc.elements.find((e) => e.id === id)).filter((e): e is Element => !!e);
  }
  return doc.elements.filter(selector);
}

export const isText = (el: Element) => el.type === "text";
export const isImage = (el: Element) => el.type === "image";

/**
 * Turn a defect size into a score. `tolerance` is the amount treated as
 * negligible; `budget` is where the score bottoms out.
 */
function gradeDefect(amount: number, tolerance: number, budget: number): number {
  if (amount <= tolerance) return 1;
  if (amount >= budget) return 0;
  return 1 - (amount - tolerance) / (budget - tolerance);
}

function check(id: string, label: string, weight: number, run: (doc: Doc) => CheckOutcome): Check {
  return { id, label, weight, run };
}

// --- universal checks ------------------------------------------------------

/** Text hidden behind something painted above it. */
export function noTextOcclusion(weight = 1): Check {
  return check("no_text_occlusion", "Text is not covered by anything above it", weight, (doc) => {
    const texts = doc.elements.filter(isText);
    if (texts.length === 0) return { score: 1, detail: "No text elements." };
    const worst: string[] = [];
    let totalHidden = 0;
    let totalInk = 0;
    for (const el of texts) {
      const occ = occlusionOf(doc, el);
      totalHidden += occ.hiddenArea;
      totalInk += occ.inkArea;
      if (occ.hiddenFraction > 0.01) {
        worst.push(`${el.id} ${Math.round(occ.hiddenFraction * 100)}% covered by ${occ.occludedBy.join(", ")}`);
      }
    }
    const fraction = totalInk > 0 ? totalHidden / totalInk : 0;
    return {
      // 15% of all glyph area hidden is a thoroughly broken layout.
      score: gradeDefect(fraction, 0.002, 0.15),
      detail: worst.length ? worst.join("; ") : "No text is covered.",
    };
  });
}

/** Elements hanging off the canvas. */
export function inBounds(weight = 1, selector?: Selector): Check {
  return check("in_bounds", "Everything stays on the canvas", weight, (doc) => {
    const els = selector ? select(doc, selector) : doc.elements;
    if (els.length === 0) return { score: 1, detail: "Nothing to check." };
    const canvas = { x: 0, y: 0, width: doc.width, height: doc.height };
    const canvasArea = doc.width * doc.height;
    let total = 0;
    const offenders: string[] = [];
    for (const el of els) {
      const out = outOfBoundsArea(el, canvas);
      if (out > 0.5) {
        total += out;
        offenders.push(`${el.id} (${round(out)} sq units out)`);
      }
    }
    return {
      // 5% of the canvas worth of overhang is a total failure.
      score: gradeDefect(total / canvasArea, 0.0001, 0.05),
      detail: offenders.length ? `Off-canvas: ${offenders.join(", ")}` : "Everything is inside the canvas.",
    };
  });
}

/** Text that does not fit the box it was put in. */
export function noTextClipping(weight = 1, selector?: Selector): Check {
  return check("no_text_clipping", "No text is clipped by its own box", weight, (doc) => {
    const els = (selector ? select(doc, selector) : doc.elements).filter(isText);
    if (els.length === 0) return { score: 1, detail: "No text elements." };
    const offenders: string[] = [];
    let hiddenLines = 0;
    let totalLines = 0;
    for (const el of els) {
      const layout = layoutTextElement(el);
      totalLines += layout.lines.length;
      const hidden = layout.lines.length - layout.visibleLines;
      if (layout.clipped) {
        hiddenLines += Math.max(hidden, layout.overflowX > 0.01 ? 1 : 0);
        offenders.push(
          `${el.id} (${hidden} of ${layout.lines.length} lines hidden` +
            (layout.overflowX > 0.01 ? `, ${round(layout.overflowX)} units too wide` : "") +
            ")",
        );
      }
    }
    return {
      score: gradeDefect(totalLines > 0 ? hiddenLines / totalLines : 0, 0, 0.5),
      detail: offenders.length ? `Clipped: ${offenders.join(", ")}` : "All text fits its box.",
    };
  });
}

/** WCAG contrast for every text element against what is behind it. */
export function minContrast(ratio = 4.5, weight = 1, selector?: Selector): Check {
  return check("contrast", `Text contrast is at least ${ratio}:1`, weight, (doc) => {
    const els = (selector ? select(doc, selector) : doc.elements).filter((el) => isText(el) && !!el.text);
    if (els.length === 0) return { score: 1, detail: "No text elements." };
    const offenders: string[] = [];
    let worst = 21;
    for (const el of els) {
      const backdrop = effectiveBackdrop(doc, el);
      const r = contrastRatio(el.style.color ?? "#111111", backdrop);
      worst = Math.min(worst, r);
      if (r < ratio) offenders.push(`${el.id} ${r.toFixed(2)}:1 on ${backdrop}`);
    }
    // 1:1 is invisible text; score ramps from there up to the threshold.
    const score = worst >= ratio ? 1 : Math.max(0, (worst - 1) / (ratio - 1));
    return {
      score,
      detail: offenders.length ? `Below ${ratio}:1 — ${offenders.join(", ")}` : `Worst contrast ${worst.toFixed(2)}:1.`,
    };
  });
}

// --- composition checks ----------------------------------------------------

export function elementCount(opts: { min?: number; max?: number; selector?: Selector; label?: string }, weight = 1): Check {
  const { min = 0, max = Infinity, selector } = opts;
  return check("element_count", opts.label ?? `Between ${min} and ${max} elements`, weight, (doc) => {
    const n = (selector ? select(doc, selector) : doc.elements).length;
    if (n >= min && n <= max) return { score: 1, detail: `${n} element(s).` };
    const distance = n < min ? min - n : n - max;
    return { score: gradeDefect(distance, 0, Math.max(2, min || 2)), detail: `${n} element(s); wanted ${min}..${max}.` };
  });
}

/**
 * Per-type element budgets: "no images, and at most one decorative shape".
 *
 * `elementCount` bounds the total, which a brief that names a *kind* of
 * element is not asking about — five elements can be two lines of text and
 * three photographs.
 */
export function typeBudget(limits: Partial<Record<ElementType, number>>, weight = 1, label?: string): Check {
  const entries = Object.entries(limits) as [ElementType, number][];
  const described = entries.map(([type, max]) => (max === 0 ? `no ${type}s` : `at most ${max} ${type}(s)`)).join(", ");
  return check("type_budget", label ?? `Uses ${described}`, weight, (doc) => {
    const over: string[] = [];
    let excess = 0;
    for (const [type, max] of entries) {
      const n = doc.elements.filter((el) => el.type === type).length;
      if (n <= max) continue;
      excess += n - max;
      over.push(`${n} ${type}(s), wanted at most ${max}`);
    }
    return {
      score: gradeDefect(excess, 0, Math.max(2, entries.length)),
      detail: over.length ? over.join("; ") : `Within budget (${described}).`,
    };
  });
}

/**
 * Copy that must survive verbatim: "keep all of the copy exactly as it is".
 *
 * `containsText` asks whether a phrase appears *somewhere*, which a brief
 * forbidding a rewrite is not asking. It also cannot notice copy that was
 * shortened rather than removed — and shortening body text is the cheapest way
 * to satisfy an occlusion or margin check without doing the layout work.
 */
export function textUnchanged(reference: Doc, selector: Selector, weight = 1): Check {
  const expected = select(reference, selector)
    .filter(isText)
    .map((el) => [el.id, el.text ?? ""] as const);
  return check("text_unchanged", "The copy is untouched", weight, (doc) => {
    if (expected.length === 0) return { score: 1, detail: "No copy to hold." };
    const changed: string[] = [];
    for (const [id, before] of expected) {
      const after = doc.elements.find((e) => e.id === id);
      // A deleted element is `preservesElements`' finding, not this one.
      if (!after) continue;
      if ((after.text ?? "") !== before) changed.push(id);
    }
    return {
      score: (expected.length - changed.length) / expected.length,
      detail: changed.length ? `Rewritten: ${changed.join(", ")}` : "All copy is verbatim.",
    };
  });
}

/** Required copy is present somewhere in the document, case-insensitively. */
export function containsText(phrases: string[], weight = 1): Check {
  return check("contains_text", "Required copy is present", weight, (doc) => {
    const haystack = doc.elements
      .filter(isText)
      .map((el) => (el.text ?? "").toLowerCase().replace(/\s+/g, " "))
      .join("   ");
    const missing = phrases.filter((p) => !haystack.includes(p.toLowerCase().replace(/\s+/g, " ")));
    return {
      score: phrases.length ? (phrases.length - missing.length) / phrases.length : 1,
      detail: missing.length ? `Missing: ${missing.map((m) => JSON.stringify(m)).join(", ")}` : "All required copy present.",
    };
  });
}

/** Elements share an edge within a tolerance. */
export function alignedOn(
  edge: "left" | "right" | "top" | "bottom" | "hcenter" | "vcenter",
  selector: Selector,
  tolerance = 2,
  weight = 1,
): Check {
  const value = (el: Element): number => {
    const b = aabb(el);
    switch (edge) {
      case "left":
        return b.x;
      case "right":
        return b.x + b.width;
      case "top":
        return b.y;
      case "bottom":
        return b.y + b.height;
      case "hcenter":
        return b.x + b.width / 2;
      case "vcenter":
        return b.y + b.height / 2;
    }
  };
  return check("aligned", `Elements share a ${edge} edge`, weight, (doc) => {
    const els = select(doc, selector);
    if (els.length < 2) return { score: els.length === 1 ? 1 : 0, detail: `${els.length} matching element(s).` };
    const values = els.map(value);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const spread = Math.max(...values.map((v) => Math.abs(v - mean)));
    return {
      score: gradeDefect(spread, tolerance, tolerance + 40),
      detail: `${edge} edges span ${round(spread * 2)} units (${els.map((e) => e.id).join(", ")}).`,
    };
  });
}

/** Gaps between consecutive elements along an axis are equal. */
export function evenlySpaced(axis: "horizontal" | "vertical", selector: Selector, tolerance = 2, weight = 1): Check {
  return check("evenly_spaced", `Elements are evenly spaced ${axis}ly`, weight, (doc) => {
    const els = select(doc, selector);
    if (els.length < 3) return { score: els.length >= 1 ? 1 : 0, detail: `${els.length} matching element(s).` };
    const boxes = els
      .map(aabb)
      .sort((a, b) => (axis === "horizontal" ? a.x - b.x : a.y - b.y));
    const gaps: number[] = [];
    for (let i = 1; i < boxes.length; i++) {
      const prev = boxes[i - 1]!;
      const cur = boxes[i]!;
      gaps.push(axis === "horizontal" ? cur.x - (prev.x + prev.width) : cur.y - (prev.y + prev.height));
    }
    const mean = gaps.reduce((s, v) => s + v, 0) / gaps.length;
    const spread = Math.max(...gaps.map((g) => Math.abs(g - mean)));
    return {
      score: gradeDefect(spread, tolerance, tolerance + 40),
      detail: `Gaps ${gaps.map((g) => round(g)).join(", ")} (mean ${round(mean)}).`,
    };
  });
}

/**
 * Nothing crowds the canvas edge.
 *
 * Measured on what each element *paints*, not on the box it was declared in.
 * The two differ most for the single most natural way to centre a headline:
 * a full-width text box with `align: center`. Its glyphs sit in the middle of
 * the canvas with hundreds of units of air either side, and its box touches
 * both edges — so a box-measured check scored a perfectly composed poster at
 * zero, and did it on every task that asked for a margin. The box is a layout
 * frame; a reader sees the letters.
 *
 * `paintedPolygons` also settles what a text element's fill means here: a text
 * block with an opaque background really does paint its whole box, so that box
 * is measured, while an unfilled one is measured on its glyphs alone.
 */
export function marginAtLeast(margin: number, weight = 1, selector?: Selector): Check {
  return check("margin", `Elements keep a ${margin} unit margin`, weight, (doc) => {
    const els = selector ? select(doc, selector) : doc.elements;
    let worst = Infinity;
    const offenders: string[] = [];
    let measured = 0;
    for (const el of els) {
      const painted = paintedBounds(el);
      // Paints nothing, so it crowds nothing.
      if (!painted) continue;
      // Running from one side of the canvas to the other is a bleed — a
      // background, a banner, a full-width rule — and bleeding is a decision,
      // not a crowded edge.
      if (bleeds(painted, doc)) continue;
      measured++;
      const m = Math.min(
        painted.x,
        painted.y,
        doc.width - (painted.x + painted.width),
        doc.height - (painted.y + painted.height),
      );
      worst = Math.min(worst, m);
      if (m < margin) offenders.push(`${el.id} (${round(m)})`);
    }
    if (measured === 0) return { score: 1, detail: "Nothing to check." };
    return {
      score: gradeDefect(Math.max(0, margin - worst), 0, margin),
      detail: offenders.length ? `Tight margins: ${offenders.join(", ")}` : `Smallest margin ${round(worst)} units.`,
    };
  });
}

/** The axis-aligned box around everything an element paints, or null if nothing. */
function paintedBounds(el: Element): Rect | null {
  const points = paintedPolygons(el).flat();
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Painted edge to edge on either axis: a deliberate full-bleed surface. */
function bleeds(b: Rect, doc: Doc): boolean {
  const spansWidth = b.x <= 1 && b.x + b.width >= doc.width - 1;
  const spansHeight = b.y <= 1 && b.y + b.height >= doc.height - 1;
  return spansWidth || spansHeight;
}

/** An image keeps its intrinsic aspect ratio, within a tolerance. */
export function aspectPreserved(selector: Selector, tolerance = 0.08, weight = 1): Check {
  return check("aspect", "Images are not stretched", weight, (doc) => {
    const els = select(doc, selector).filter(isImage);
    if (els.length === 0) return { score: 1, detail: "No image elements." };
    const offenders: string[] = [];
    let worst = 0;
    for (const el of els) {
      // `objectFit: cover` crops rather than stretches, so the box ratio is free.
      if ((el.style.objectFit ?? "cover") === "cover") continue;
      const asset = el.src ? assetAspect(el.src) : undefined;
      if (!asset) continue;
      const boxRatio = el.width / el.height;
      const rel = Math.abs(boxRatio - asset) / asset;
      worst = Math.max(worst, rel);
      if (rel > tolerance) offenders.push(`${el.id} (${(rel * 100).toFixed(0)}% off)`);
    }
    return {
      score: gradeDefect(worst, tolerance, tolerance + 0.5),
      detail: offenders.length ? `Distorted: ${offenders.join(", ")}` : "No stretched images.",
    };
  });
}

/** A visual hierarchy exists: these ids are in strictly decreasing font size. */
export function fontSizeOrder(ids: string[], weight = 1): Check {
  return check("hierarchy", "Type sizes establish a hierarchy", weight, (doc) => {
    const sizes = ids.map((id) => {
      const el = doc.elements.find((e) => e.id === id);
      return el ? (el.style.fontSize ?? 32) : null;
    });
    if (sizes.some((s) => s === null)) {
      return { score: 0, detail: `Missing element(s): ${ids.filter((_, i) => sizes[i] === null).join(", ")}` };
    }
    let satisfied = 0;
    for (let i = 1; i < sizes.length; i++) if ((sizes[i - 1] as number) > (sizes[i] as number)) satisfied++;
    const pairs = Math.max(1, sizes.length - 1);
    return {
      score: satisfied / pairs,
      detail: `Sizes ${sizes.join(" > ")} — ${satisfied} of ${pairs} step(s) decrease.`,
    };
  });
}

/**
 * A type hierarchy exists without naming ids — the check compose tasks need,
 * since the agent invents its own ids there.
 */
export function typeHierarchy(minRatio = 1.6, weight = 1): Check {
  return check("type_hierarchy", `Largest text is at least ${minRatio}x the smallest`, weight, (doc) => {
    const sizes = doc.elements.filter((el) => isText(el) && !!el.text).map((el) => el.style.fontSize ?? 32);
    if (sizes.length < 2) return { score: sizes.length === 1 ? 1 : 0, detail: `${sizes.length} text element(s).` };
    const ratio = Math.max(...sizes) / Math.min(...sizes);
    return {
      score: ratio >= minRatio ? 1 : Math.max(0, (ratio - 1) / (minRatio - 1)),
      detail: `Sizes ${[...new Set(sizes)].sort((a, b) => b - a).join(", ")} — ratio ${ratio.toFixed(2)}x.`,
    };
  });
}

/**
 * The canvas is neither bare nor packed. A crude proxy for "this looks like a
 * composed page", using bounding-box coverage without double-counting overlap.
 *
 * Two kinds of element are left out of the union, both for the same reason:
 * they answer a different question from the one being asked.
 *
 * **A background that covers the whole canvas.** It saturates the grid by
 * itself, and once it has, nothing else in the document can move the number:
 * a composed poster, one with a single line of type in a corner, and one with
 * every element crammed into a 260x90 box all measured 100% and scored the
 * same. The check was reading the background and nothing else — on a task
 * whose brief asks for a background image. Worse than useless, in fact: with
 * the band topping out below 100%, bleeding the background as the brief asks
 * scored *lower* than insetting it a few units, so the check paid a run to
 * ignore the instruction. Excluded, the same three documents measure 55%, 4%
 * and 2% — the distinction this check exists to draw.
 *
 * **Anything that paints nothing**, by `paintedPolygons`: a rect with a
 * transparent fill and no stroke, anything at zero opacity. Counting those
 * made "does this look composed" answerable with one element nobody can see.
 * A bare page scoring 25% on this check went to 100% — and 15 points of
 * normalized improvement on the task — for a single invisible rect, which is
 * the cheapest possible way to look composed without composing anything.
 *
 * What is *not* narrowed is the area: a visible element still contributes its
 * whole box, not its ink. A block of type occupies its box on the page, and
 * the question here is how much of the page has something on it. That is also
 * why the full-canvas exemption is narrower than `marginAtLeast`'s — there,
 * anything running edge to edge on either axis is a bleed, because the
 * question is whether an element crowds an edge; here a full-width band across
 * the lower third crowds no edge but does fill that third.
 */
export function coverage(min = 0.25, max = 0.95, weight = 1): Check {
  return check("coverage", `Between ${Math.round(min * 100)}% and ${Math.round(max * 100)}% of the canvas is used`, weight, (doc) => {
    if (doc.elements.length === 0) return { score: 0, detail: "Empty canvas." };
    // Union area via a coarse occupancy grid: exact polygon union is overkill
    // for a sanity check, and a 60x60 grid resolves to under 2% of the canvas.
    const cols = 60;
    const rows = 60;
    const cellW = doc.width / cols;
    const cellH = doc.height / rows;
    const grid = new Uint8Array(cols * rows);
    let filling = 0;
    let invisible = 0;
    for (const el of doc.elements) {
      if (fillsCanvas(el, doc)) {
        filling++;
        continue;
      }
      // The same definition of "paints something" the margin check uses, so
      // an element cannot be invisible to one and solid to the other.
      if (paintedPolygons(el).length === 0) {
        invisible++;
        continue;
      }
      const b = aabb(el);
      const c0 = Math.max(0, Math.floor(b.x / cellW));
      const c1 = Math.min(cols - 1, Math.ceil((b.x + b.width) / cellW) - 1);
      const r0 = Math.max(0, Math.floor(b.y / cellH));
      const r1 = Math.min(rows - 1, Math.ceil((b.y + b.height) / cellH) - 1);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) grid[r * cols + c] = 1;
    }
    const used = grid.reduce((s: number, v: number) => s + v, 0) / (cols * rows);
    const note = exclusionNote(filling, invisible);
    if (used >= min && used <= max) return { score: 1, detail: `${Math.round(used * 100)}% covered${note}.` };
    const distance = used < min ? min - used : used - max;
    return {
      score: gradeDefect(distance, 0, 0.35),
      detail: `${Math.round(used * 100)}% covered${note}; wanted ${Math.round(min * 100)}..${Math.round(max * 100)}%.`,
    };
  });
}

/** Covers the canvas outright — a background, rather than a composed element. */
function fillsCanvas(el: Element, doc: Doc): boolean {
  const b = aabb(el);
  return b.x <= 1 && b.y <= 1 && b.width >= doc.width - 1 && b.height >= doc.height - 1;
}

/**
 * Why the number is lower than the page looks.
 *
 * Said out loud, because "55% covered" against a poster that visibly fills
 * every inch of its canvas is otherwise a puzzle for whoever reads the report.
 */
function exclusionNote(filling: number, invisible: number): string {
  const parts: string[] = [];
  if (filling > 0) parts.push(`${filling} full-canvas`);
  if (invisible > 0) parts.push(`${invisible} invisible`);
  if (parts.length === 0) return "";
  return ` (excluding ${parts.join(" and ")} ${filling + invisible === 1 ? "element" : "elements"})`;
}

/** At least one image element is present, optionally from a specific set. */
export function usesImage(keys?: string[], weight = 1): Check {
  return check("uses_image", keys ? `Uses one of: ${keys.join(", ")}` : "Uses an image", weight, (doc) => {
    const images = doc.elements.filter(isImage);
    if (images.length === 0) return { score: 0, detail: "No image elements." };
    if (!keys) return { score: 1, detail: `${images.length} image(s).` };
    const matching = images.filter((el) => el.src && keys.includes(el.src));
    return {
      score: matching.length > 0 ? 1 : 0,
      detail: matching.length ? `Uses ${matching.map((e) => e.src).join(", ")}.` : `Uses ${images.map((e) => e.src).join(", ")} instead.`,
    };
  });
}

/**
 * Large painted surfaces are no lighter than `maxLuminance`.
 *
 * Contrast alone cannot tell a dark theme from a light one — inverting both
 * sides of every pair keeps the ratio identical — so a dark-mode task needs a
 * check that looks at absolute lightness. Only surfaces big enough to set the
 * mood count; a small accent chip is not the theme.
 */
export function surfacesNoLighterThan(maxLuminance = 0.15, weight = 1, minAreaFraction = 0.15): Check {
  return check("surface_luminance", `Backgrounds are no lighter than ${maxLuminance}`, weight, (doc) => {
    const canvasArea = doc.width * doc.height;
    const surfaces: { id: string; color: string }[] = [{ id: "canvas", color: doc.background }];
    for (const el of doc.elements) {
      if (el.type !== "rect" || !el.style.fill || el.style.fill === "transparent") continue;
      const b = aabb(el);
      if ((b.width * b.height) / canvasArea >= minAreaFraction) surfaces.push({ id: el.id, color: el.style.fill });
    }
    const offenders: string[] = [];
    let worst = 0;
    for (const s of surfaces) {
      const parsed = parseColor(s.color);
      if (!parsed) continue;
      const lum = relativeLuminance(parsed);
      worst = Math.max(worst, lum);
      if (lum > maxLuminance) offenders.push(`${s.id} (${lum.toFixed(2)})`);
    }
    return {
      score: gradeDefect(Math.max(0, worst - maxLuminance), 0, 0.5),
      detail: offenders.length
        ? `Too light: ${offenders.join(", ")}`
        : `Lightest large surface ${worst.toFixed(2)}.`,
    };
  });
}

/** Text is at least `minLuminance` light — the other half of a dark theme. */
export function textNoDarkerThan(minLuminance = 0.35, weight = 1, selector?: Selector): Check {
  return check("text_luminance", `Text is at least ${minLuminance} light`, weight, (doc) => {
    const els = (selector ? select(doc, selector) : doc.elements).filter((el) => isText(el) && !!el.text);
    if (els.length === 0) return { score: 1, detail: "No text elements." };
    const offenders: string[] = [];
    let satisfied = 0;
    for (const el of els) {
      const parsed = parseColor(el.style.color ?? "#111111");
      const lum = parsed ? relativeLuminance(parsed) : 0;
      if (lum >= minLuminance) satisfied++;
      else offenders.push(`${el.id} (${lum.toFixed(2)})`);
    }
    return {
      score: satisfied / els.length,
      detail: offenders.length ? `Too dark: ${offenders.join(", ")}` : "All text is light.",
    };
  });
}

/** Every text element uses one of the given colors (a palette restyle). */
export function usesPalette(colors: string[], weight = 1, selector?: Selector): Check {
  const wanted = new Set(colors.map((c) => c.toLowerCase()));
  return check("palette", `Colors come from the given palette`, weight, (doc) => {
    const els = selector ? select(doc, selector) : doc.elements;
    const used: string[] = [];
    for (const el of els) {
      if (el.style.color) used.push(el.style.color.toLowerCase());
      if (el.style.fill) used.push(el.style.fill.toLowerCase());
    }
    used.push(doc.background.toLowerCase());
    const offPalette = [...new Set(used)].filter((c) => c !== "transparent" && !wanted.has(c));
    return {
      score: used.length ? (used.length - used.filter((c) => c !== "transparent" && !wanted.has(c)).length) / used.length : 0,
      detail: offPalette.length ? `Off-palette: ${offPalette.join(", ")}` : "All colors are on-palette.",
    };
  });
}

/** Elements that must survive the edit, unchanged in content. */
export function preservesElements(ids: string[], weight = 1): Check {
  return check("preserved", "Existing elements are kept", weight, (doc) => {
    const missing = ids.filter((id) => !doc.elements.some((e) => e.id === id));
    return {
      score: ids.length ? (ids.length - missing.length) / ids.length : 1,
      detail: missing.length ? `Deleted: ${missing.join(", ")}` : "All kept.",
    };
  });
}

/**
 * Geometry that must not change: "restyle this, do not move or resize
 * anything", or "reorder these, do not resize them".
 *
 * Keeping the *ids* is a different claim from keeping the *boxes*, and the
 * tasks that say "do not move anything" were only checking the former, plus a
 * loose `inRegion` on one element. A run that restyled correctly and also
 * nudged everything 40 units left scored the same as one that did as it was
 * told, which is not a distinction the judge can be relied on to draw either.
 *
 * `tolerance` is in canvas units and applies to each of x, y, width, height
 * independently; rotation is compared in degrees on the same scale. Scoring is
 * graded on the worst offender, so a small drift is not the same failure as a
 * relayout.
 */
export type GeometryField = "x" | "y" | "width" | "height" | "rotation";

const ALL_GEOMETRY: GeometryField[] = ["x", "y", "width", "height", "rotation"];

export function geometryUnchanged(
  reference: Doc,
  selector: Selector,
  weight = 1,
  opts: { fields?: GeometryField[]; tolerance?: number; budget?: number } = {},
): Check {
  const fields = opts.fields ?? ALL_GEOMETRY;
  const tolerance = opts.tolerance ?? 1;
  const budget = opts.budget ?? 40;
  const expected = new Map(select(reference, selector).map((el) => [el.id, el]));
  const sizeOnly = fields.every((f) => f === "width" || f === "height");
  const label = sizeOnly ? "Nothing has been resized" : "Nothing has been moved or resized";

  return check(sizeOnly ? "size_unchanged" : "geometry_unchanged", label, weight, (doc) => {
    if (expected.size === 0) return { score: 1, detail: "Nothing to hold still." };
    const drifts: string[] = [];
    let worst = 0;
    for (const [id, before] of expected) {
      const after = doc.elements.find((e) => e.id === id);
      // A deleted element is `preservesElements`' finding, not this one.
      if (!after) continue;
      const deltas = fields.map((f) => [f, Math.abs(after[f] - before[f])] as const);
      const moved = Math.max(...deltas.map(([, v]) => v));
      if (moved <= tolerance) continue;
      worst = Math.max(worst, moved);
      const which = deltas
        .filter(([, v]) => v > tolerance)
        .map(([k, v]) => `${k} by ${round(v)}`)
        .join(", ");
      drifts.push(`${id}: ${which}`);
    }
    return {
      score: gradeDefect(worst, tolerance, budget),
      detail: drifts.length ? drifts.join("; ") : `${sizeOnly ? "Sizes are" : "Geometry is"} untouched.`,
    };
  });
}

/**
 * The gap at each end of a row or column matches the other.
 *
 * `evenlySpaced` measures only the gaps *between* elements, so a row with
 * perfect inner gaps shoved hard against the left edge scores full marks —
 * which is not what "space them evenly across the canvas, with equal margins
 * at the far left and far right" asks for.
 */
export function outerMarginsBalanced(
  axis: "horizontal" | "vertical",
  selector: Selector,
  tolerance = 2,
  weight = 1,
): Check {
  return check("outer_margins", `Outer margins match on the ${axis} axis`, weight, (doc) => {
    const els = select(doc, selector);
    if (els.length === 0) return { score: 0, detail: "No matching elements." };
    const boxes = els.map(aabb);
    const extent = axis === "horizontal" ? doc.width : doc.height;
    const starts = boxes.map((b) => (axis === "horizontal" ? b.x : b.y));
    const ends = boxes.map((b) => (axis === "horizontal" ? b.x + b.width : b.y + b.height));
    const leading = Math.min(...starts);
    const trailing = extent - Math.max(...ends);
    const skew = Math.abs(leading - trailing);
    return {
      score: gradeDefect(skew, tolerance, tolerance + 80),
      detail: `Margins ${round(leading)} and ${round(trailing)} (off by ${round(skew)}).`,
    };
  });
}

/** An element's center sits inside a fractional region of the canvas. */
export function inRegion(
  selector: Selector,
  region: { x0: number; y0: number; x1: number; y1: number },
  weight = 1,
  label = "Element sits in the expected region",
): Check {
  return check("in_region", label, weight, (doc) => {
    const els = select(doc, selector);
    if (els.length === 0) return { score: 0, detail: "No matching element." };
    let inside = 0;
    const misses: string[] = [];
    for (const el of els) {
      const b = aabb(el);
      const cx = (b.x + b.width / 2) / doc.width;
      const cy = (b.y + b.height / 2) / doc.height;
      if (cx >= region.x0 && cx <= region.x1 && cy >= region.y0 && cy <= region.y1) inside++;
      else misses.push(`${el.id} at (${cx.toFixed(2)}, ${cy.toFixed(2)})`);
    }
    return {
      score: inside / els.length,
      detail: misses.length ? `Outside the region: ${misses.join(", ")}` : "In the expected region.",
    };
  });
}

/** Run a check list and produce a weighted constraint score. */
export function runChecks(doc: Doc, checks: Check[]): { results: CheckResult[]; score: number } {
  const results: CheckResult[] = checks.map((c) => {
    const outcome = c.run(doc);
    const score = Math.max(0, Math.min(1, outcome.score));
    return { ...outcome, score, id: c.id, label: c.label, weight: c.weight, passed: score >= PASS_THRESHOLD };
  });
  const totalWeight = results.reduce((s, r) => s + r.weight, 0);
  const score = totalWeight > 0 ? results.reduce((s, r) => s + r.score * r.weight, 0) / totalWeight : 0;
  return { results, score };
}

/** The checks every task carries, whatever else it asks for. */
export function universalChecks(): Check[] {
  return [noTextOcclusion(1), inBounds(1), noTextClipping(1), minContrast(4.5, 1)];
}
