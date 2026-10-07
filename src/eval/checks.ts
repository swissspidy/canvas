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

import type { Doc, Element, ElementType, Rect, Style } from "../doc/types.js";
import { aabb, center, corners, outOfBoundsArea, polygonContainsPoint, round } from "../doc/geometry.js";
import { effectiveAlpha, occlusionOf, paintedPolygons, paintsAnything } from "../doc/occlusion.js";
import { layoutTextElement, largestFittingFontSize, largestFontSizeForLines, requiredHeight, DEFAULT_FONT_SIZE } from "../text/layout.js";
import { assetAspect } from "../doc/assets.js";
import { normalizeAngle } from "../doc/schema.js";
import {
  composite,
  contrastRatio,
  effectiveBackdrop,
  effectiveTextColor,
  parseColor,
  relativeLuminance,
  withElementOpacity,
} from "./color.js";

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

/**
 * Ids, or a predicate. A predicate also receives the document, for the few
 * selectors that have to find an element by its relation to another — the
 * shape a label sits on, in a compose task where the agent named both.
 */
export type Selector = string[] | ((el: Element, doc: Doc) => boolean);

export function select(doc: Doc, selector: Selector): Element[] {
  if (Array.isArray(selector)) {
    return selector.map((id) => doc.elements.find((e) => e.id === id)).filter((e): e is Element => !!e);
  }
  return doc.elements.filter((el) => selector(el, doc));
}

export const isText = (el: Element) => el.type === "text";
export const isImage = (el: Element) => el.type === "image";

/**
 * The same two, narrowed to what a reader can see.
 *
 * A type predicate is the only selector the compose family can use, and
 * `select` does not filter a predicate's matches — deliberately, because the
 * checks that name ids are asking about the document rather than the render.
 * That combination handed the invisible-element loophole a way back in: an
 * image at `opacity: 0` was the only match for `isImage`, so "nothing is
 * painted over the photograph" was satisfied by a document with no visible
 * photograph in it. Every compose check that selects by type selects by these.
 */
export const visibleText = (el: Element) => el.type === "text" && paintsAnything(el);
export const visibleImage = (el: Element) => el.type === "image" && paintsAnything(el);

/**
 * "The elements you named are all invisible", when that is what happened.
 *
 * Most checks here answer a question about what a reader sees, and every one
 * of them has to decide what to say when there is nothing to look at. "No text
 * elements, so nothing is unreadable" is the right answer for a task with no
 * text — and the wrong one for a task whose text was faded to nothing, where
 * it hands out a free pass for deleting the page.
 *
 * It was worth a lot. On `restyle.dark-mode`, setting every element to
 * `opacity: 0` and the canvas to a dark colour scored **92.7%**, closing 78%
 * of the available improvement, because eight checks in a row reported that
 * there was no text to find fault with. The document was a black rectangle.
 *
 * The rule: a check scoped to explicit ids, whose ids are in the document and
 * paint nothing, scores zero. Named means the brief asked about those
 * elements, so they cannot answer vacuously. A check with no selector keeps
 * the vacuous pass, because there the question really is "is there anything
 * wrong with what is on the page" — and because penalising an unselected check
 * for invisible elements would make padding a document with ghosts *lower* the
 * score, which is a different loophole pointing the other way.
 */
function allNamedAreInvisible(doc: Doc, selector: Selector | undefined): boolean {
  if (!selector || !Array.isArray(selector)) return false;
  const named = select(doc, selector);
  return named.length > 0 && named.every((el) => !paintsAnything(el));
}

/** The one wording for it, so the detail line reads the same everywhere. */
const ALL_INVISIBLE = "Every named element paints nothing.";

/** Case- and whitespace-insensitive, so copy matches however it was set. */
function normalizeCopy(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * A selector matching the visible text element that carries a phrase.
 *
 * The compose family starts near-empty, so the agent invents every id and no
 * check can name one. That used to mean composition was scored only in
 * aggregate — copy present, a hierarchy somewhere, a margin — and a brief
 * saying *where* something goes could not be scored at all. Copy is the one
 * handle those tasks do have: the brief gives the wording verbatim, so the
 * element carrying it can be found whatever it was called.
 *
 * A phrase that ends up in the same element as another one matches both, which
 * is correct rather than a limitation: a title and a footer poured into one
 * text block really are one element, and it cannot be in two places.
 */
/**
 * The smallest visible rect containing the centre of the text carrying
 * `phrase` — the shape a label sits on, which is how a reader would identify
 * the button or the ribbon. Smallest, because a card or panel behind the whole
 * layout contains the label too.
 */
export function shapeUnder(phrase: string): (el: Element, doc: Doc) => boolean {
  return (el, doc) => {
    if (el.type !== "rect" || !paintsAnything(el)) return false;
    const label = doc.elements.find(withText(phrase));
    if (!label) return false;
    const c = center(label);
    const under = doc.elements
      .filter((e) => e.type === "rect" && paintsAnything(e) && polygonContainsPoint(corners(e), c))
      .sort((a, b) => a.width * a.height - b.width * b.height);
    return under[0] === el;
  };
}

export function withText(phrase: string): (el: Element) => boolean {
  const wanted = normalizeCopy(phrase);
  return (el) => el.type === "text" && normalizeCopy(el.text ?? "").includes(wanted) && paintsAnything(el);
}

/**
 * The elements a reader can see, for the checks that ask what is *on the page*.
 *
 * The checks here split into two kinds, and the split decides whether they get
 * this filter:
 *
 * **What is on the page** — how many elements there are, whether the required
 * copy appears, whether an image was used, whether the type has a hierarchy,
 * what colours are in play. All of those were counting elements that paint
 * nothing, and every one of them was gameable for it. The worst: a poster
 * missing half its required copy and set in one size scored 100% by carrying
 * the missing phrases in a text element at `opacity: 0`. An image at
 * `opacity: 0` satisfied "use the photo/mountains asset as a background image".
 * Invisible rects bought an "at least five elements" floor.
 *
 * **What is in the document** — whether an element was kept, whether its box
 * was held still, whether anything hangs off the canvas. Those ask about the
 * document rather than the render, and most of them name their elements by id,
 * so they read every element and are deliberately left alone.
 *
 * `inBounds` is the one that could have gone either way, and stays unfiltered
 * deliberately: it can only ever *add* a penalty, so there is nothing to gain
 * by hiding an element from it — while filtering would make "bring the stray
 * elements back on canvas" satisfiable by hiding the stray instead of moving
 * it, which is a worse layout scoring better.
 *
 * Making something invisible now buys nothing anywhere, which is also why
 * `typeBudget` can stop penalising an invisible rect: it was only ever doing so
 * by the same accident, and a penalty is not needed once the reward is gone.
 */
function visible(els: Element[]): Element[] {
  return els.filter(paintsAnything);
}

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

/**
 * Text hidden behind something painted above it.
 *
 * Visible text only, and for both of the usual reasons. `inkPolygons` is pure
 * geometry — it lays out the glyphs and does not ask whether anyone can see
 * them — so invisible text arrived here carrying real ink. Under a visible
 * shape that ink read as a total occlusion failure for text nobody can see;
 * anywhere else it padded the denominator, and three invisible text elements
 * lifted a genuine 17% occlusion from 0% to 72%, with the detail line still
 * naming the element that was covered.
 */
export function noTextOcclusion(weight = 1): Check {
  return check("no_text_occlusion", "Text is not covered by anything above it", weight, (doc) => {
    const texts = visible(doc.elements).filter(isText);
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
      // 8% of all glyph area hidden is a thoroughly broken layout. It used to
      // be 15%, which left a headline with a corner under a badge scoring two
      // thirds — a defect a reader notices immediately, scored as nearly fine.
      score: gradeDefect(fraction, 0.002, 0.08),
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
      // 2% of the canvas worth of overhang is a total failure. A 1080x1350
      // poster is 1.46M square units, so that is a 130x220 block hanging over
      // the edge: nobody would call that a near miss.
      score: gradeDefect(total / canvasArea, 0.0001, 0.02),
      detail: offenders.length ? `Off-canvas: ${offenders.join(", ")}` : "Everything is inside the canvas.",
    };
  });
}

/**
 * Text that does not fit the box it was put in.
 *
 * Scored on the share of lines hidden, so an invisible text element that
 * *fits* pads the denominator and dilutes a real clipping failure — which is
 * why this one takes the visibility filter even though the neighbouring
 * `inBounds` does not. That one can only ever add a penalty; this one can
 * subtract it.
 */
export function noTextClipping(weight = 1, selector?: Selector): Check {
  return check("no_text_clipping", "No text is clipped by its own box", weight, (doc) => {
    if (allNamedAreInvisible(doc, selector)) return { score: 0, detail: ALL_INVISIBLE };
    const els = visible(selector ? select(doc, selector) : doc.elements).filter(isText);
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
      // A quarter of the lines gone is a total failure. Half of them used to
      // be, which handed a document that loses one line in four half marks.
      score: gradeDefect(totalLines > 0 ? hiddenLines / totalLines : 0, 0, 0.25),
      detail: offenders.length ? `Clipped: ${offenders.join(", ")}` : "All text fits its box.",
    };
  });
}

/** WCAG contrast for every text element against what is behind it. */
export function minContrast(ratio = 4.5, weight = 1, selector?: Selector): Check {
  return check("contrast", `Text contrast is at least ${ratio}:1`, weight, (doc) => {
    if (allNamedAreInvisible(doc, selector)) return { score: 0, detail: ALL_INVISIBLE };
    const els = visible(selector ? select(doc, selector) : doc.elements).filter(isText);
    if (els.length === 0) return { score: 1, detail: "No text elements." };
    const offenders: string[] = [];
    let worst = 21;
    for (const el of els) {
      const backdrop = effectiveBackdrop(doc, el);
      // `effectiveTextColor`, not `style.color`: a colour painted at 3%
      // opacity is not the colour a reader sees, and reading the declared one
      // scored invisible copy at 21:1.
      const r = contrastRatio(effectiveTextColor(el), backdrop);
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

/**
 * Text contrast inside a band — legible, and not glaring. A dark theme sets
 * its text a measured distance from its surface, and the same grey that is
 * 8:1 on the sheet is 6:1 on a lighter card on it: hitting the band on every
 * backdrop is colour arithmetic, not a guess from a hex code.
 */
export function contrastWithin(min: number, max: number, weight = 1, selector?: Selector): Check {
  return check("contrast_band", `Text contrast is between ${min}:1 and ${max}:1`, weight, (doc) => {
    if (allNamedAreInvisible(doc, selector)) return { score: 0, detail: ALL_INVISIBLE };
    const els = visible(selector ? select(doc, selector) : doc.elements).filter(isText);
    if (els.length === 0) return { score: 1, detail: "No text elements." };
    const offenders: string[] = [];
    let worst = 0;
    for (const el of els) {
      const backdrop = effectiveBackdrop(doc, el);
      const r = contrastRatio(effectiveTextColor(el), backdrop);
      const off = r < min ? min - r : r > max ? r - max : 0;
      worst = Math.max(worst, off);
      if (off > 0) offenders.push(`${el.id} ${r.toFixed(2)}:1 on ${backdrop}`);
    }
    return {
      score: gradeDefect(worst, 0, 2),
      detail: offenders.length ? `Outside ${min}–${max}:1 — ${offenders.join(", ")}` : "Every text is inside the band.",
    };
  });
}

// --- composition checks ----------------------------------------------------

/**
 * How many things are on the page.
 *
 * A *ceiling* is a real constraint — "use the canvas background and at most one
 * decorative shape" bounds what may be added, and no amount of copy changes the
 * answer. A *floor* is almost never one, and this is why: a newline is a hard
 * line break, so an address, a date line and a call to action can be one text
 * element or three, and the agent is told as much in the system prompt. A task
 * demanding five elements was therefore demanding a particular *split* of the
 * copy, which is not a property of a good poster and is not what any of these
 * briefs asks for. Worse, it is satisfiable by anything at all: a rect behind
 * the title, a rule nobody asked for, a second copy of the credit line.
 *
 * So floors are gone from the task set. What those tasks meant — "this should
 * look composed" — is measured by `coverage`, `typeHierarchy`, `marginAtLeast`
 * and the region checks, none of which care how the copy is divided up.
 */
export function elementCount(opts: { min?: number; max?: number; selector?: Selector; label?: string }, weight = 1): Check {
  const { min = 0, max = Infinity, selector } = opts;
  return check("element_count", opts.label ?? `Between ${min} and ${max} elements`, weight, (doc) => {
    const n = visible(selector ? select(doc, selector) : doc.elements).length;
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
      const n = visible(doc.elements).filter((el) => el.type === type).length;
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
    // Joined on a NUL, which no copy can contain, so a required phrase cannot
    // be matched across two elements. Spelled as an escape: it used to be a raw
    // NUL sitting between two spaces in the source, indistinguishable from
    // three spaces to anything reading the file — `grep` included, which
    // reported this whole file as binary.
    const haystack = visible(doc.elements)
      .filter(isText)
      .map((el) => normalizeCopy(el.text ?? ""))
      .join(" \u0000 ");
    const missing = phrases.filter((p) => !haystack.includes(normalizeCopy(p)));
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
      // 12 units of spread, not 40. On a 1080-unit canvas a 40-unit rag is
      // visible from across the room, and it was scoring half marks.
      score: gradeDefect(spread, tolerance, tolerance + 12),
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
      score: gradeDefect(spread, tolerance, tolerance + 12),
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
      return el ? (el.style.fontSize ?? DEFAULT_FONT_SIZE) : null;
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
 * Named *copy* is in decreasing font size — `fontSizeOrder` without the ids.
 *
 * The compose family cannot name ids, so "the title should dominate" was
 * scored by `typeHierarchy`, which only asks whether the largest text on the
 * page is some multiple of the smallest. A poster that sets the venue at 96
 * units and the festival's name at 40 satisfies that completely, and reads
 * exactly backwards. Keyed on the copy the brief already gives verbatim, the
 * question becomes the one the brief actually asks.
 */
export function textSizeOrder(phrases: string[], weight = 1): Check {
  return check("copy_size_order", `Type sizes fall in order: ${phrases.join(" > ")}`, weight, (doc) => {
    const sizes = phrases.map((phrase) => {
      const el = doc.elements.find(withText(phrase));
      return el ? (el.style.fontSize ?? DEFAULT_FONT_SIZE) : null;
    });
    const missing = phrases.filter((_, i) => sizes[i] === null);
    if (missing.length) {
      return { score: 0, detail: `Not found in any visible text: ${missing.map((m) => JSON.stringify(m)).join(", ")}` };
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
 *
 * A single text element scores zero, and that is the whole point of the check
 * now that a newline is a hard line break. One element can hold the title, the
 * dates and the call to action as three lines, and every one of them is then
 * set in the same size: the copy is on the page and there is no hierarchy at
 * all. That used to score *full marks* — the `length === 1` case returned 1 on
 * the grounds that one size cannot contradict itself — which paid an agent to
 * pour the entire brief into one box and stop. Font size is a per-element
 * style, so a document with a hierarchy has at least two text elements; a
 * document with one has exactly one voice.
 */
export function typeHierarchy(minRatio = 1.6, weight = 1): Check {
  return check("type_hierarchy", `Largest text is at least ${minRatio}x the smallest`, weight, (doc) => {
    const sizes = visible(doc.elements).filter(isText).map((el) => el.style.fontSize ?? DEFAULT_FONT_SIZE);
    if (sizes.length < 2) {
      return {
        score: 0,
        detail:
          sizes.length === 1
            ? "One text element, so every line is the same size: no hierarchy."
            : "No visible text elements.",
      };
    }
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
    // Painted, not present: a canvas holding three invisible rects is an empty
    // canvas, and testing the array length instead scored it above one holding
    // nothing at all.
    if (!doc.elements.some(paintsAnything)) return { score: 0, detail: "Empty canvas." };
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
      // Twenty points under the floor bottoms out. It used to be thirty-five,
      // and on that scale a festival poster covering 26% of its canvas against
      // a stated 35% kept three quarters of the check — one point of
      // improvement, on a task with fifteen checks, for leaving two thirds of
      // the page empty. The pilot renders in `docs/PREREGISTRATION.md` §13
      // are what a quarter-empty page looks like next to a composed one, and
      // the grade has to be able to tell them apart.
      score: gradeDefect(distance, 0, 0.2),
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
    const images = visible(doc.elements).filter(isImage);
    if (images.length === 0) {
      const hidden = doc.elements.filter(isImage).length;
      return {
        score: 0,
        detail: hidden ? `${hidden} image element(s), none of them visible.` : "No image elements.",
      };
    }
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
    for (const el of visible(doc.elements)) {
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

/**
 * Text is at least `minLuminance` light — the other half of a dark theme.
 *
 * Measured on the colour that lands on the page, not the one declared: a
 * translucent colour, or one inside a part-transparent element, is composited
 * onto what sits behind it first. Light text at 20% opacity over a dark sheet
 * is dark text, whatever the hex says.
 */
export function textNoDarkerThan(minLuminance = 0.35, weight = 1, selector?: Selector): Check {
  return check("text_luminance", `Text is at least ${minLuminance} light`, weight, (doc) => {
    if (allNamedAreInvisible(doc, selector)) return { score: 0, detail: ALL_INVISIBLE };
    const els = visible(selector ? select(doc, selector) : doc.elements).filter(isText);
    if (els.length === 0) return { score: 1, detail: "No text elements." };
    const offenders: string[] = [];
    let satisfied = 0;
    for (const el of els) {
      const parsed = parseColor(effectiveTextColor(el));
      const backdrop = parseColor(effectiveBackdrop(doc, el));
      const painted = parsed && backdrop && parsed.a < 1 ? composite(parsed, backdrop) : parsed;
      const lum = painted ? relativeLuminance(painted) : 0;
      if (lum >= minLuminance) satisfied++;
      else offenders.push(`${el.id} (${lum.toFixed(2)})`);
    }
    return {
      score: satisfied / els.length,
      detail: offenders.length ? `Too dark: ${offenders.join(", ")}` : "All text is light.",
    };
  });
}

/**
 * Every colour in the document comes from the given palette.
 *
 * Counted once per *distinct* colour, not once per use. Counting uses made the
 * score depend on how many elements happened to share a colour: a card whose
 * six elements are all on-palette except one stray heading scored 11/12 and
 * read as nearly right, while the same stray on a card of two elements scored
 * 2/3. The question is how many colours are wrong, and a colour is wrong once.
 *
 * Strokes count too. They are painted, they are as visible as a fill, and
 * leaving them out left a way to keep an off-palette accent on the page.
 */
export function usesPalette(colors: string[], weight = 1, selector?: Selector): Check {
  const wanted = new Set(colors.map((c) => c.toLowerCase()));
  return check("palette", `Colors come from the given palette`, weight, (doc) => {
    const els = visible(selector ? select(doc, selector) : doc.elements);
    const used = new Set<string>([doc.background.toLowerCase()]);
    for (const el of els) {
      for (const c of [el.style.color, el.style.fill, el.style.strokeColor]) {
        if (c && c.toLowerCase() !== "transparent") used.add(c.toLowerCase());
      }
    }
    const offPalette = [...used].filter((c) => !wanted.has(c));
    return {
      score: used.size ? (used.size - offPalette.length) / used.size : 0,
      detail: offPalette.length
        ? `Off-palette: ${offPalette.join(", ")} (of ${used.size} colour(s) used)`
        : `All ${used.size} colour(s) are on-palette.`,
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
      score: gradeDefect(skew, tolerance, tolerance + 30),
      detail: `Margins ${round(leading)} and ${round(trailing)} (off by ${round(skew)}).`,
    };
  });
}

/**
 * An element sits inside a fractional region of the canvas.
 *
 * By default the *center* has to land in the region, which is the right
 * question for "the footer stays at the bottom" and the wrong one for "the
 * photo occupies the upper part of the card": an image twice the height of the
 * region still centres inside it, and a caption that has grown up over the
 * photo still centres where it started. Pass `whole` for those, and the
 * element's entire box has to fit.
 */
export function inRegion(
  selector: Selector,
  region: { x0: number; y0: number; x1: number; y1: number },
  weight = 1,
  label = "Element sits in the expected region",
  opts: { whole?: boolean } = {},
): Check {
  return check("in_region", label, weight, (doc) => {
    const els = select(doc, selector);
    if (els.length === 0) return { score: 0, detail: "No matching element." };
    let inside = 0;
    const misses: string[] = [];
    for (const el of els) {
      const b = aabb(el);
      if (opts.whole) {
        const x0 = b.x / doc.width;
        const x1 = (b.x + b.width) / doc.width;
        const y0 = b.y / doc.height;
        const y1 = (b.y + b.height) / doc.height;
        // A unit of slack, in fractional terms, so a box laid exactly on the
        // boundary is not a miss.
        const slack = 1 / Math.max(doc.width, doc.height);
        if (x0 >= region.x0 - slack && x1 <= region.x1 + slack && y0 >= region.y0 - slack && y1 <= region.y1 + slack) {
          inside++;
        } else {
          misses.push(`${el.id} spans (${x0.toFixed(2)}, ${y0.toFixed(2)})-(${x1.toFixed(2)}, ${y1.toFixed(2)})`);
        }
        continue;
      }
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

// --- legibility, consistency and order -------------------------------------

/**
 * Nothing is set below a legible size.
 *
 * The `fit` family's whole difficulty is text against a box, and without this
 * check every one of its tasks had the same one-line solution: drop the font
 * size until the overflow stops. `fit.body-overflow` went from 40% to full
 * marks at `fontSize: 9` — 400 words of 9-unit type on a 1080-unit canvas,
 * which is a grey smear at any size anyone would look at it. The judge was
 * asked about it, and the judge is the measure this study trusts least.
 *
 * Every task that scores this states the floor in its brief, in units, because
 * a constraint the agent cannot see is not difficulty — it is a guessing game,
 * and it would penalise exactly the surfaces that shrink text most confidently.
 */
export function fontSizeAtLeast(min: number, weight = 1, selector?: Selector): Check {
  return check("min_font_size", `No text is smaller than ${min} units`, weight, (doc) => {
    const els = visible(selector ? select(doc, selector) : doc.elements).filter(isText);
    // Every task that scores this asks for copy, so "there is no text" is a
    // failure rather than a vacuous pass — and a vacuous pass here would pay a
    // blank canvas for respecting a floor it never reached.
    if (els.length === 0) return { score: 0, detail: "No visible text to measure." };
    const offenders: string[] = [];
    let worst = Infinity;
    for (const el of els) {
      const size = el.style.fontSize ?? DEFAULT_FONT_SIZE;
      worst = Math.min(worst, size);
      if (size < min) offenders.push(`${el.id} (${round(size)})`);
    }
    return {
      // A quarter below the floor bottoms out, and the narrowness is the
      // point. The brief states a number, so being under it is a violation
      // rather than a near miss — and the cheap path in this family is to
      // undershoot it by a little and fit. On `fit.body-overflow`, shrinking
      // to 22 against a stated floor of 24 fits the box the agent was given
      // and scored 97.4%, against 100% for finding the room: two and a half
      // points for ignoring the constraint, on a study trying to resolve
      // differences of five. Still graded, because 23 and 9 are not the same
      // failure.
      score: gradeDefect(Math.max(0, min - worst), 0, min / 4),
      detail: offenders.length ? `Too small: ${offenders.join(", ")}` : `Smallest text ${round(worst)} units.`,
    };
  });
}

/**
 * The piece of copy that carries the page is set at a stated size.
 *
 * Every ratio check in the compose family — the title is the largest type, at
 * least twice the smallest, larger than the dates — is satisfied at any scale.
 * A 60-unit title over 24-unit copy is a hierarchy, and it is also a document
 * heading on a poster-sized canvas. The first live pilot produced exactly
 * that: posters whose title was 70 units on 1080, next to ones at 140, and
 * the checks could not tell them apart while anyone looking could. So the
 * briefs now state the scale in units, as they state every other constraint,
 * and this grades it the way `fontSizeAtLeast` grades a floor — a quarter
 * under bottoms out — under its own id, so the report does not pool "is the
 * body legible" and "is the title poster-sized" into one row.
 */
export function dominantTypeAtLeast(phrase: string, min: number, weight = 1): Check {
  const inner = fontSizeAtLeast(min, weight, withText(phrase));
  return {
    ...inner,
    id: "dominant_type_size",
    label: `"${phrase}" is set at ${min} units or larger`,
  };
}

/**
 * A group of text elements is set at one size.
 *
 * "Fix all three of these" has a right answer and several wrong ones that look
 * right to every other check: shrinking each block by however much it happened
 * to overflow clears the clipping and leaves three sizes on the page, which is
 * three different fixes rather than one treatment. Only the judge could see
 * that, and this is not a judgement call.
 */
export function sameFontSize(ids: string[], weight = 1, tolerance = 0.5): Check {
  return check("same_font_size", "Related text is set at one size", weight, (doc) => {
    const els = select(doc, ids).filter(isText);
    if (els.length < 2) {
      // Missing elements are `preservesElements`' finding; with fewer than two
      // present there is no comparison left to make.
      return { score: 0, detail: `${els.length} of ${ids.length} named text element(s) present.` };
    }
    const sizes = els.map((el) => el.style.fontSize ?? DEFAULT_FONT_SIZE);
    const spread = Math.max(...sizes) - Math.min(...sizes);
    return {
      score: gradeDefect(spread, tolerance, tolerance + 10),
      detail: `Sizes ${sizes.map((n) => round(n)).join(", ")} (spread ${round(spread)}).`,
    };
  });
}

/**
 * Named elements are not painted over.
 *
 * `noTextOcclusion` asks the same question about text and only about text,
 * which leaves "make the caption fit without covering the photo" unmeasured:
 * growing the caption box up over the photograph clears the clipping, satisfies
 * every other check, and buries the image the page is about. Images and rects
 * ink their whole box, so the same occlusion machinery answers it directly.
 */
export function notCovered(selector: Selector, weight = 1, label = "Nothing is painted over these"): Check {
  return check("not_covered", label, weight, (doc) => {
    // Visible only: an element that paints nothing cannot be covered, and
    // scoring one as uncovered rewards hiding the thing that was meant to be
    // protected.
    const els = visible(select(doc, selector));
    if (els.length === 0) return { score: 0, detail: "No visible matching elements." };
    let hidden = 0;
    let ink = 0;
    const offenders: string[] = [];
    for (const el of els) {
      const occ = occlusionOf(doc, el);
      hidden += occ.hiddenArea;
      ink += occ.inkArea;
      if (occ.hiddenFraction > 0.01) {
        offenders.push(`${el.id} ${Math.round(occ.hiddenFraction * 100)}% covered by ${occ.occludedBy.join(", ")}`);
      }
    }
    return {
      score: gradeDefect(ink > 0 ? hidden / ink : 0, 0.002, 0.08),
      detail: offenders.length ? offenders.join("; ") : "Nothing is covered.",
    };
  });
}

/**
 * The named elements still read top to bottom in the order given.
 *
 * A region band — "the kicker stays in the top third" — was standing in for
 * this, and it is a loose stand-in: two elements can both sit in the top third
 * with the lower one first. This asks the question directly, on what each
 * element paints, so a full-width text box centred over its glyphs is measured
 * where the reader sees it.
 */
export function verticalOrder(ids: string[], weight = 1, opts: { tolerance?: number; budget?: number } = {}): Check {
  const tolerance = opts.tolerance ?? 0;
  const budget = opts.budget ?? 120;
  return check("vertical_order", `Reads top to bottom: ${ids.join(" then ")}`, weight, (doc) => {
    const boxes = ids.map((id) => {
      const el = doc.elements.find((e) => e.id === id);
      return el ? { id, box: paintedBounds(el) ?? aabb(el) } : null;
    });
    const present = boxes.filter((b): b is { id: string; box: Rect } => b !== null);
    if (present.length < 2) return { score: 0, detail: `${present.length} of ${ids.length} element(s) present.` };
    const scores: number[] = [];
    const wrong: string[] = [];
    for (let i = 1; i < present.length; i++) {
      const above = present[i - 1]!;
      const below = present[i]!;
      const overlap = above.box.y + above.box.height - below.box.y;
      scores.push(gradeDefect(Math.max(0, overlap), tolerance, budget));
      if (overlap > tolerance) wrong.push(`${above.id} runs ${round(overlap)} units into ${below.id}`);
    }
    return {
      score: scores.reduce((a, b) => a + b, 0) / scores.length,
      detail: wrong.length ? wrong.join("; ") : "In order, top to bottom.",
    };
  });
}

/**
 * Paint order, bottom first.
 *
 * The array *is* the paint order: `normalizeDoc` sorts by `z` with the array
 * position breaking ties, every mutation goes through it, and the renderer
 * paints the array in order. Sorting by `z` again here would be a second
 * opinion about the same question, and the two disagree on a document that has
 * not been normalized — which is how `occlusionOf`, reading array order, and
 * this, reading `z`, once reported opposite stacking for the same document.
 */
function paintOrderOf(doc: Doc): string[] {
  return doc.elements.map((el) => el.id);
}

/**
 * The named elements are painted back to front in the order given.
 *
 * The z-order task was scored entirely through occlusion, which is the
 * *symptom*. That left the symptom addressable without the cause: drop the
 * photograph's opacity and nothing is covered any more, on a task whose brief
 * asks for the layering to be fixed. This reads the stacking itself.
 */
export function paintOrder(ids: string[], weight = 1): Check {
  return check("paint_order", `Painted back to front: ${ids.join(" then ")}`, weight, (doc) => {
    const order = paintOrderOf(doc);
    const positions = ids.map((id) => order.indexOf(id));
    const missing = ids.filter((_, i) => positions[i]! < 0);
    if (missing.length) return { score: 0, detail: `Missing: ${missing.join(", ")}` };
    let satisfied = 0;
    const wrong: string[] = [];
    for (let i = 1; i < positions.length; i++) {
      if (positions[i - 1]! < positions[i]!) satisfied++;
      else wrong.push(`${ids[i - 1]} is painted after ${ids[i]}`);
    }
    const pairs = Math.max(1, ids.length - 1);
    return {
      score: satisfied / pairs,
      detail: wrong.length ? wrong.join("; ") : `Stacking order is ${ids.join(" < ")}.`,
    };
  });
}

/**
 * Appearance held still: "keep the photograph as it is".
 *
 * `geometryUnchanged` holds the box and `preservesElements` holds the id, and
 * between them they still allow the element to be recoloured, faded to 10%, or
 * pointed at a different asset — which is most of what "as it is" rules out on
 * a restyle task. An image's `src` counts as part of its appearance, because
 * swapping the photograph is not keeping it.
 */
export function styleUnchanged(
  reference: Doc,
  selector: Selector,
  weight = 1,
  opts: { keys?: (keyof Style)[] } = {},
): Check {
  const expected = select(reference, selector);
  return check("style_unchanged", "The appearance is untouched", weight, (doc) => {
    if (expected.length === 0) return { score: 1, detail: "Nothing to hold." };
    let compared = 0;
    let matched = 0;
    const changed: string[] = [];
    for (const before of expected) {
      const after = doc.elements.find((e) => e.id === before.id);
      // A deleted element is `preservesElements`' finding, not this one.
      if (!after) continue;
      const keys =
        opts.keys ?? ([...new Set([...Object.keys(before.style), ...Object.keys(after.style)])] as (keyof Style)[]);
      const drifted: string[] = [];
      for (const key of keys) {
        compared++;
        if (before.style[key] === after.style[key]) matched++;
        else drifted.push(`${key} ${String(before.style[key] ?? "unset")}→${String(after.style[key] ?? "unset")}`);
      }
      if (before.type === "image") {
        compared++;
        if (before.src === after.src) matched++;
        else drifted.push(`src ${before.src}→${after.src}`);
      }
      if (drifted.length) changed.push(`${before.id}: ${drifted.join(", ")}`);
    }
    return {
      score: compared === 0 ? 1 : matched / compared,
      detail: changed.length ? changed.join("; ") : "Styles are untouched.",
    };
  });
}

export interface ColorRole {
  ids: string[];
  prop: "color" | "fill" | "strokeColor";
  color: string;
  /** What this colour is for, quoted back in the detail line. */
  role?: string;
}

/**
 * Named elements carry the exact colours the brief assigns them.
 *
 * `usesPalette` asks whether the colours in the document are drawn from a
 * list, which a brief that says *which colour goes where* is not asking. A card
 * that paints every element in the accent red is entirely on-palette and has
 * thrown away the hierarchy the brief spells out, and only the judge could see
 * it. This is the restyle family's answer key, and it is only fair to score it
 * because the brief gives the assignment in full.
 */
export function colorRoles(roles: ColorRole[], weight = 1, opts: { background?: string } = {}): Check {
  return check("color_roles", "Colours are assigned as the brief specifies", weight, (doc) => {
    let total = 0;
    let satisfied = 0;
    const wrong: string[] = [];
    for (const role of roles) {
      for (const id of role.ids) {
        total++;
        const el = doc.elements.find((e) => e.id === id);
        if (!el) {
          wrong.push(`${id} is missing`);
          continue;
        }
        const actual = el.style[role.prop];
        if (actual && actual.toLowerCase() === role.color.toLowerCase()) satisfied++;
        else wrong.push(`${id} ${role.prop} is ${actual ?? "unset"}, wanted ${role.color}${role.role ? ` (${role.role})` : ""}`);
      }
    }
    if (opts.background !== undefined) {
      total++;
      if (doc.background.toLowerCase() === opts.background.toLowerCase()) satisfied++;
      else wrong.push(`canvas background is ${doc.background}, wanted ${opts.background}`);
    }
    return {
      score: total === 0 ? 1 : satisfied / total,
      detail: wrong.length ? wrong.join("; ") : `All ${total} colour assignment(s) match.`,
    };
  });
}

/** Overlap area of two axis-aligned rectangles. */
function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * A piece of copy sits on a filled shape — "the button label should read as a
 * button".
 *
 * Id-free, because the compose family invents its own ids, and stated in the
 * brief wherever it is scored. What it asks is the thing a reader checks: is
 * there something painted *under* these words, and does it cover them. A rect
 * beside the label, or above it, is neither.
 *
 * A text element's own fill counts, and has to: it paints the element's whole
 * box behind its glyphs, which is the same button a reader sees, in one
 * element rather than two. Insisting on a separate rect would score the
 * one-element button as no button at all — and, on a task that also asks for
 * blocks of text not to overlap, would push an agent towards the arrangement
 * that trips the other check.
 *
 * The shape is measured on its bounding box, so a rotated button is given the
 * benefit of the doubt. That is the right way round for a check whose failure
 * mode should be "no shape at all".
 */
export function textOnFilledShape(
  phrase: string,
  weight = 1,
  opts: { rotationWithin?: number } = {},
): Check {
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  return check("text_on_shape", `"${phrase}" sits on a filled shape`, weight, (doc) => {
    const order = paintOrderOf(doc);
    const labels = visible(doc.elements)
      .filter(isText)
      .filter((el) => norm(el.text ?? "").includes(norm(phrase)));
    if (labels.length === 0) return { score: 0, detail: `No visible text contains ${JSON.stringify(phrase)}.` };

    let best = 0;
    for (const label of labels) {
      // Its own fill is painted across its own box, so it covers the label by
      // construction — and turns with it, so it satisfies `rotationWithin` too.
      if (effectiveAlpha(label.style.fill ?? "transparent", label) >= 0.5) {
        best = 1;
        break;
      }
      const bounds = paintedBounds(label);
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue;
      const area = bounds.width * bounds.height;
      const labelIndex = order.indexOf(label.id);
      for (const el of doc.elements) {
        if (el.type !== "rect" || order.indexOf(el.id) >= labelIndex) continue;
        if (effectiveAlpha(el.style.fill ?? "#cccccc", el) < 0.5) continue;
        // A tilted label on an upright rect is not a ribbon, and the bounding
        // boxes overlap just as happily either way — so where a brief asks for
        // one, the shape has to be turned with it.
        if (opts.rotationWithin !== undefined && angleBetween(el.rotation, label.rotation) > opts.rotationWithin) {
          continue;
        }
        best = Math.max(best, intersectionArea(bounds, aabb(el)) / area);
      }
    }
    return {
      // Covered outright is the pass; a shape that catches half the label is
      // a shape in the wrong place, not half a button.
      score: gradeDefect(Math.max(0, 1 - best), 0.02, 0.4),
      detail:
        best <= 0
          ? `Nothing filled is painted behind "${phrase}".`
          : `The shape behind "${phrase}" covers ${Math.round(best * 100)}% of it.`,
    };
  });
}

/**
 * Elements sit at the angle the brief asks for.
 *
 * Rotation is the one transform the document model has always supported and
 * nothing ever scored. `geometryUnchanged` counts it among the fields it holds
 * still, which is the *don't* case; there was no way to say "put these back
 * upright" or "this ribbon runs at -12 degrees", so no task could ask.
 *
 * Angles are compared the short way round, so 359 and -1 are one degree apart
 * rather than 360. The document normalizes into (-180, 180], but a check that
 * silently disagreed with arithmetic at the wrap point is the kind of thing
 * that shows up once, in one run, and is never explained.
 */
export function rotationWithin(
  selector: Selector,
  degrees: number,
  weight = 1,
  opts: { tolerance?: number; budget?: number; label?: string } = {},
): Check {
  const tolerance = opts.tolerance ?? 1;
  // Ten degrees off is a total failure, and a task whose brief says "square to
  // the canvas" should pass something tighter still: at a 20-degree budget a
  // card visibly askew by six scored seven tenths.
  const budget = opts.budget ?? 10;
  const target = normalizeAngle(degrees);
  return check(
    "rotation",
    opts.label ?? `Elements sit at ${round(target, 1)} degrees`,
    weight,
    (doc) => {
      const els = select(doc, selector);
      if (els.length === 0) return { score: 0, detail: "No matching elements." };
      const offenders: string[] = [];
      const scores: number[] = [];
      for (const el of els) {
        const off = angleBetween(el.rotation, target);
        scores.push(gradeDefect(off, tolerance, budget));
        if (off > tolerance) offenders.push(`${el.id} at ${round(el.rotation, 1)} (${round(off, 1)} off)`);
      }
      return {
        score: scores.reduce((a, b) => a + b, 0) / scores.length,
        detail: offenders.length ? `Wrong angle: ${offenders.join(", ")}` : `All at ${round(target, 1)} degrees.`,
      };
    },
  );
}

/**
 * A group of elements shares one angle, whatever that angle is.
 *
 * The question "do these read as parallel", which is not the same as "are
 * these at the angle I named": a ribbon and the label on it have to agree with
 * each other, and a brief that fixes one of them is over-specifying the design.
 */
export function sameRotation(selector: Selector, weight = 1, tolerance = 1): Check {
  return check("same_rotation", "Elements share one angle", weight, (doc) => {
    const els = select(doc, selector);
    if (els.length < 2) return { score: 0, detail: `${els.length} matching element(s).` };
    // Every pair, not every element against the first. Angles do not live on a
    // line — they wrap — so the distance from a baseline is not the width of
    // the set: [0, 10, -10] measured against 0 reports 10 degrees and the same
    // three elements listed as [10, 0, -10] report 20, which made the score
    // depend on the order the ids were written in.
    let spread = 0;
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        spread = Math.max(spread, angleBetween(els[i]!.rotation, els[j]!.rotation));
      }
    }
    return {
      score: gradeDefect(spread, tolerance, tolerance + 10),
      detail: `Angles ${els.map((el) => round(el.rotation, 1)).join(", ")} (spread ${round(spread, 1)} degrees).`,
    };
  });
}

/** The short way round between two angles, in degrees: never more than 180. */
function angleBetween(a: number, b: number): number {
  return Math.abs(normalizeAngle(a - b));
}

/**
 * The elements in a group do not paint over each other.
 *
 * Distinct from `noTextOcclusion`, which asks whether text is *hidden*: two
 * blocks of copy can overlap and stay legible where their glyphs happen to
 * miss, and a column of blocks that do that is still a broken column.
 */
export function noOverlap(selector: Selector, weight = 1, label = "Elements do not overlap"): Check {
  return check("no_overlap", label, weight, (doc) => {
    const els = select(doc, selector)
      .map((el) => ({ id: el.id, box: paintedBounds(el) }))
      .filter((e): e is { id: string; box: Rect } => e.box !== null);
    if (els.length < 2) return { score: 1, detail: `${els.length} visible element(s).` };
    let overlap = 0;
    let area = 0;
    const pairs: string[] = [];
    for (const el of els) area += el.box.width * el.box.height;
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i]!;
        const b = els[j]!;
        const over = intersectionArea(a.box, b.box);
        if (over <= 0) continue;
        overlap += over;
        pairs.push(`${a.id}/${b.id} (${round(over)} sq units)`);
      }
    }
    return {
      score: gradeDefect(area > 0 ? overlap / area : 0, 0.001, 0.12),
      detail: pairs.length ? `Overlapping: ${pairs.join(", ")}` : "Nothing overlaps.",
    };
  });
}

/**
 * Something matching covers the whole canvas — the check "use it as a
 * background" needs and `usesImage` cannot make.
 *
 * `usesImage` asks whether an asset is on the page at all, so a brief saying
 * "use the photo as a background image covering the whole canvas" was
 * satisfied by a 120x90 stamp in a corner: the poster scored full marks with
 * no background at all, because `coverage` was independently happy with the
 * type. Id-free, because the compose family invents its own ids.
 *
 * Graded on the share of the canvas the best single match paints, so a
 * background inset by a few units is nearly right and one covering a third of
 * the page is not.
 */
export function coversCanvas(selector: Selector, weight = 1, label = "Something covers the whole canvas"): Check {
  return check("covers_canvas", label, weight, (doc) => {
    const els = visible(select(doc, selector));
    if (els.length === 0) return { score: 0, detail: "No visible matching elements." };
    const canvas = { x: 0, y: 0, width: doc.width, height: doc.height };
    const area = doc.width * doc.height;
    let best = 0;
    let bestId = els[0]!.id;
    for (const el of els) {
      const painted = paintedBounds(el);
      if (!painted) continue;
      const covered = intersectionArea(painted, canvas) / area;
      if (covered > best) {
        best = covered;
        bestId = el.id;
      }
    }
    return {
      score: gradeDefect(Math.max(0, 1 - best), 0.01, 0.35),
      detail: `${bestId} covers ${Math.round(best * 100)}% of the canvas.`,
    };
  });
}

/**
 * The named elements are painted at full strength.
 *
 * `styleUnchanged` can hold an opacity, but it averages it in with every other
 * style key it was given — so on a seven-element restyle, fading the entire
 * document to nothing cost seven comparisons out of fifty-six and left the
 * checks that measure the page reporting that there was nothing wrong with it.
 * A brief that says "everything stays fully opaque" is stating one constraint,
 * and it gets one check.
 *
 * An unset opacity is 1, which is the renderer's reading and the only one that
 * makes "unchanged" mean anything.
 */
export function fullyOpaque(selector: Selector, weight = 1): Check {
  return check("fully_opaque", "Nothing is faded out", weight, (doc) => {
    const els = select(doc, selector);
    if (els.length === 0) return { score: 0, detail: "No matching elements." };
    const faded: string[] = [];
    let total = 0;
    for (const el of els) {
      const opacity = Math.max(0, Math.min(1, el.style.opacity ?? 1));
      total += opacity;
      if (opacity < 1) faded.push(`${el.id} (${round(opacity, 2)})`);
    }
    return {
      score: total / els.length,
      detail: faded.length ? `Faded: ${faded.join(", ")}` : "Everything is fully opaque.",
    };
  });
}

/**
 * A filled shape is distinguishable from whatever it sits on.
 *
 * "The tag keeps its role: a filled chip with a legible label on it" is a
 * requirement about the chip, and every check on that task was about the
 * label. Setting the chip's fill to `transparent` left the label perfectly
 * readable against the sheet behind it and scored 100%: a dark-mode conversion
 * that deleted one of the elements it was asked to keep, in the only sense
 * that matters to a reader.
 *
 * `textOnFilledShape` does not close it — that one accepts any filled rect
 * painted below the label, and on this layout the full-width sheet is one.
 * This asks the narrower question: does *this* shape read as a shape.
 */
export function minFillContrast(ratio = 1.5, weight = 1, selector?: Selector): Check {
  return check("fill_contrast", `Shapes stand out from their backdrop by ${ratio}:1`, weight, (doc) => {
    const els = select(doc, selector ?? ((el) => el.type === "rect"));
    if (els.length === 0) return { score: 0, detail: "No matching elements." };
    const offenders: string[] = [];
    let worst = 21;
    for (const el of els) {
      const fill = el.style.fill;
      // An invisible shape is not a shape, and nor is one with no fill to
      // speak of: both are the failure this check exists to name.
      if (!fill || !paintsAnything(el)) {
        offenders.push(`${el.id} paints no fill`);
        worst = 1;
        continue;
      }
      const painted = withElementOpacity(fill, el);
      // Asked without its own fill. `effectiveBackdrop` puts an element's fill
      // at the top of the stack, which is right for text — the block fill is
      // painted behind the glyphs and is what they are read against — and
      // exactly wrong for a shape, where the fill *is* the thing. Left in, it
      // compares the fill with itself and every shape scores 1.00:1.
      const behind = effectiveBackdrop(doc, { ...el, style: { ...el.style, fill: undefined } });
      const r = contrastRatio(painted, behind);
      worst = Math.min(worst, r);
      if (r < ratio) offenders.push(`${el.id} ${r.toFixed(2)}:1 on its backdrop`);
    }
    return {
      score: worst >= ratio ? 1 : Math.max(0, (worst - 1) / (ratio - 1)),
      detail: offenders.length ? offenders.join(", ") : `Worst fill contrast ${worst.toFixed(2)}:1.`,
    };
  });
}

// --- task set v2: precision and measurement ---------------------------------
//
// The first task set saturated: on the strongest model nearly every run closed
// every check. These are the constraints v2 adds, and every one of them is a
// thing a designer states — a gap, a size, a measure — and every one is stated
// in the brief that is scored against it. `docs/PREREGISTRATION.md` §13.

/** The box around every matched element, or null when nothing matched. */
function unionBox(els: Element[]): Rect | null {
  if (els.length === 0) return null;
  const boxes = els.map(aabb);
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}

/** Text set on exactly `lines` lines. */
export function lineCount(selector: Selector, lines: number, weight = 1, label?: string): Check {
  return check("line_count", label ?? `Set on exactly ${lines} line(s)`, weight, (doc) => {
    if (allNamedAreInvisible(doc, selector)) return { score: 0, detail: ALL_INVISIBLE };
    const els = visible(select(doc, selector)).filter(isText);
    if (els.length === 0) return { score: 0, detail: "No matching text." };
    let worst = 0;
    const parts: string[] = [];
    for (const el of els) {
      const n = layoutTextElement(el).lines.length;
      worst = Math.max(worst, Math.abs(n - lines));
      parts.push(`${el.id} ${n}`);
    }
    // One line off is half marks; two is a different layout.
    return { score: gradeDefect(worst, 0, 2), detail: `Lines: ${parts.join(", ")} (wanted ${lines}).` };
  });
}

/**
 * Type set as large as it will go on `lines` lines at its box's width.
 *
 * Measured against the measure rather than the box, because a box can always
 * be sized to whatever the type happens to be. Above the largest such size the
 * text takes another line, which `lineCount` scores; this one scores falling
 * short of it.
 */
export function fillsMeasure(selector: Selector, lines: number, minFraction = 0.95, weight = 1, label?: string, max?: number): Check {
  return check(
    "fills_measure",
    label ?? `Set as large as it goes on ${lines} line(s)`,
    weight,
    (doc) => {
      if (allNamedAreInvisible(doc, selector)) return { score: 0, detail: ALL_INVISIBLE };
      const els = visible(select(doc, selector)).filter(isText);
      if (els.length === 0) return { score: 0, detail: "No matching text." };
      let worst = 0;
      const parts: string[] = [];
      for (const el of els) {
        const size = el.style.fontSize ?? DEFAULT_FONT_SIZE;
        // `max` caps the target: "as large as it goes, up to 44" — a short
        // name stops at the cap, a long one at its measure.
        const fit = largestFontSizeForLines(el, lines);
        const target = fit === null ? null : max === undefined ? fit : Math.min(fit, max);
        if (target === null) {
          worst = 1;
          parts.push(`${el.id} cannot fit ${lines} line(s) at this width`);
          continue;
        }
        const shortfall = Math.max(0, 1 - size / target);
        // Over the cap is as much a miss as under the measure.
        const over = max === undefined ? 0 : Math.max(0, size / max - 1);
        worst = Math.max(worst, shortfall, over);
        parts.push(`${el.id} ${round(size)} of ${target}`);
      }
      const slack = 1 - minFraction;
      return { score: gradeDefect(worst, slack, slack + 0.2), detail: `Size against the largest that fits: ${parts.join(", ")}.` };
    },
  );
}

/**
 * Every text box is no taller than its text needs, plus `slack`.
 *
 * A box that hugs its text is what makes a stated gap mean something: a 40-unit
 * gap below a box with 200 units of empty space at its foot is a 240-unit gap
 * on the page. Clipping is `noTextClipping`'s to score, so a box that is too
 * short counts as hugging here.
 */
export function hugsText(selector: Selector, slack = 8, weight = 1, label?: string): Check {
  return check("hugs_text", label ?? `Text boxes are no taller than their text plus ${slack}`, weight, (doc) => {
    if (allNamedAreInvisible(doc, selector)) return { score: 0, detail: ALL_INVISIBLE };
    const els = visible(select(doc, selector)).filter(isText);
    if (els.length === 0) return { score: 0, detail: "No matching text." };
    let worst = 0;
    const offenders: string[] = [];
    for (const el of els) {
      const extra = el.height - requiredHeight(el);
      worst = Math.max(worst, extra);
      if (extra > slack) offenders.push(`${el.id} (${round(extra)} spare)`);
    }
    return {
      score: gradeDefect(worst, slack, slack + 60),
      detail: offenders.length ? `Loose boxes: ${offenders.join(", ")}` : "Every box hugs its text.",
    };
  });
}

/**
 * The gap between two groups along an axis is a stated value.
 *
 * Measured box to box: from the bottom (or right) edge of everything `first`
 * matches to the top (or left) edge of everything `second` matches.
 */
export function gapBetween(
  first: Selector,
  second: Selector,
  axis: "vertical" | "horizontal",
  value: number,
  tolerance = 2,
  weight = 1,
  label?: string,
): Check {
  return check("gap", label ?? `A ${value} unit ${axis} gap`, weight, (doc) => {
    const a = unionBox(visible(select(doc, first)));
    const b = unionBox(visible(select(doc, second)));
    if (!a || !b) return { score: 0, detail: "An element is missing." };
    const gap = axis === "vertical" ? b.y - (a.y + a.height) : b.x - (a.x + a.width);
    return {
      score: gradeDefect(Math.abs(gap - value), tolerance, tolerance + 24),
      detail: `Gap ${round(gap)} (wanted ${value}).`,
    };
  });
}

/** Every matched element has a stated width and/or height. */
export function sizeIs(
  selector: Selector,
  size: { width?: number; height?: number },
  tolerance = 2,
  weight = 1,
  label?: string,
): Check {
  const wanted = [size.width !== undefined ? `${size.width} wide` : "", size.height !== undefined ? `${size.height} tall` : ""]
    .filter(Boolean)
    .join(", ");
  return check("size", label ?? `Sized ${wanted}`, weight, (doc) => {
    const els = select(doc, selector);
    if (els.length === 0) return { score: 0, detail: "No matching element." };
    let worst = 0;
    for (const el of els) {
      if (size.width !== undefined) worst = Math.max(worst, Math.abs(el.width - size.width));
      if (size.height !== undefined) worst = Math.max(worst, Math.abs(el.height - size.height));
    }
    return {
      score: gradeDefect(worst, tolerance, tolerance + 40),
      detail: `Worst size error ${round(worst)} units (${els.map((e) => `${e.id} ${round(e.width)}x${round(e.height)}`).join(", ")}).`,
    };
  });
}

/** An edge of the matched group sits at a stated canvas coordinate. */
export function edgeAt(
  selector: Selector,
  edge: "left" | "right" | "top" | "bottom",
  value: number,
  tolerance = 2,
  weight = 1,
  label?: string,
): Check {
  return check("edge_at", label ?? `The ${edge} edge sits at ${value}`, weight, (doc) => {
    const b = unionBox(visible(select(doc, selector)));
    if (!b) return { score: 0, detail: "No matching element." };
    const at = edge === "left" ? b.x : edge === "right" ? b.x + b.width : edge === "top" ? b.y : b.y + b.height;
    return {
      score: gradeDefect(Math.abs(at - value), tolerance, tolerance + 24),
      detail: `${edge} edge at ${round(at)} (wanted ${value}).`,
    };
  });
}

/** The matched group, taken as one block, is centred on the canvas along an axis. */
export function centeredOnCanvas(
  selector: Selector,
  axis: "horizontal" | "vertical",
  tolerance = 2,
  weight = 1,
  label?: string,
): Check {
  return check("centered", label ?? `Centred ${axis}ly on the canvas`, weight, (doc) => {
    const b = unionBox(visible(select(doc, selector)));
    if (!b) return { score: 0, detail: "No matching element." };
    const off =
      axis === "horizontal" ? b.x + b.width / 2 - doc.width / 2 : b.y + b.height / 2 - doc.height / 2;
    return {
      score: gradeDefect(Math.abs(off), tolerance, tolerance + 30),
      detail: `${round(Math.abs(off))} units off centre.`,
    };
  });
}

/**
 * Type set as large as it will go in its box — or, with `shared`, every
 * matched block at one size, as large as the tightest of them allows.
 *
 * Only meaningful where the brief pins the box, which every task using it
 * does; a box sized to its text always "fits" at the size it was sized for.
 */
export function fillsBox(selector: Selector, minFraction = 0.95, weight = 1, opts: { shared?: boolean; label?: string } = {}): Check {
  return check("fills_box", opts.label ?? "Set as large as it goes in its box", weight, (doc) => {
    if (allNamedAreInvisible(doc, selector)) return { score: 0, detail: ALL_INVISIBLE };
    const els = visible(select(doc, selector)).filter(isText);
    if (els.length === 0) return { score: 0, detail: "No matching text." };
    const targets = els.map((el) => largestFittingFontSize(el));
    if (targets.some((t) => t === null)) return { score: 0, detail: "Some text cannot fit its box at any size." };
    const shared = Math.min(...(targets as number[]));
    let worst = 0;
    const parts: string[] = [];
    els.forEach((el, i) => {
      const target = opts.shared ? shared : (targets[i] as number);
      const size = el.style.fontSize ?? DEFAULT_FONT_SIZE;
      worst = Math.max(worst, Math.max(0, 1 - size / target));
      parts.push(`${el.id} ${round(size)} of ${target}`);
    });
    const slack = 1 - minFraction;
    return { score: gradeDefect(worst, slack, slack + 0.2), detail: `Size against the largest that fits: ${parts.join(", ")}.` };
  });
}

/**
 * A column of text blocks, stacked from `top` with `gap` between them, set at
 * one size — the largest at which the whole stack still ends by `bottom`.
 *
 * The size is derived from the blocks' own measure and line height, so it is
 * the answer to the brief's rule rather than a number the brief withholds.
 */
export function columnFillsSpace(
  ids: string[],
  space: { top: number; bottom: number; gap: number },
  minFraction = 0.95,
  weight = 1,
  label?: string,
): Check {
  return check("column_fills", label ?? "The column is set as large as the space allows", weight, (doc) => {
    const els = ids.map((id) => doc.elements.find((e) => e.id === id)).filter((e): e is Element => !!e);
    if (els.length !== ids.length) return { score: 0, detail: "A block is missing." };
    const available = space.bottom - space.top - space.gap * (els.length - 1);
    const stackAt = (size: number) =>
      els.reduce((sum, el) => sum + requiredHeight({ ...el, style: { ...el.style, fontSize: size } }), 0);
    let lo = 8;
    let hi = 400;
    let best = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (stackAt(mid) <= available) {
        best = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (best === 0) return { score: 0, detail: "The blocks cannot fit the space at any size." };
    const sizes = els.map((el) => el.style.fontSize ?? DEFAULT_FONT_SIZE);
    const worst = Math.max(...sizes.map((s) => Math.max(0, 1 - s / best)));
    const slack = 1 - minFraction;
    return {
      score: gradeDefect(worst, slack, slack + 0.2),
      detail: `Sizes ${sizes.map((s) => round(s)).join(", ")}; the largest that fits is ${best}.`,
    };
  });
}

/** Each `[inner, outer]` pair is centred, on both axes, on its outer element. */
export function centeredOnEach(pairs: [string, string][], tolerance = 2, weight = 1, label?: string): Check {
  return check("centered_on", label ?? "Each label is centred on its shape", weight, (doc) => {
    let worst = 0;
    const offenders: string[] = [];
    for (const [inner, outer] of pairs) {
      const a = doc.elements.find((e) => e.id === inner);
      const b = doc.elements.find((e) => e.id === outer);
      if (!a || !b) return { score: 0, detail: `${a ? outer : inner} is missing.` };
      const ca = center(a);
      const cb = center(b);
      const off = Math.max(Math.abs(ca.x - cb.x), Math.abs(ca.y - cb.y));
      worst = Math.max(worst, off);
      if (off > tolerance) offenders.push(`${inner} ${round(off)} off ${outer}`);
    }
    return { score: gradeDefect(worst, tolerance, tolerance + 24), detail: offenders.length ? offenders.join(", ") : "All centred." };
  });
}

/**
 * Every matched element lies entirely on a shape — all four of its (rotated)
 * corners inside the shape's (rotated) outline. The shape is convex, so that
 * is the whole element.
 */
export function insideShape(selector: Selector, shapeId: string, weight = 1, label?: string): Check {
  return check("inside_shape", label ?? `Sits entirely on ${shapeId}`, weight, (doc) => {
    const shape = doc.elements.find((e) => e.id === shapeId);
    if (!shape) return { score: 0, detail: `${shapeId} is missing.` };
    const els = select(doc, selector);
    if (els.length === 0) return { score: 0, detail: "No matching element." };
    const outline = corners(shape);
    const outside: string[] = [];
    for (const el of els) {
      const out = corners(el).filter((p) => !polygonContainsPoint(outline, p)).length;
      if (out > 0) outside.push(`${el.id} (${out} corner${out === 1 ? "" : "s"} off)`);
    }
    return {
      score: (els.length - outside.length) / els.length,
      detail: outside.length ? `Off ${shapeId}: ${outside.join(", ")}` : `Everything sits on ${shapeId}.`,
    };
  });
}

/**
 * The matched group sits inside an element at stated insets — the padding of a
 * plate around the copy on it. Only the sides given are scored.
 */
export function insetWithin(
  selector: Selector,
  outerId: string,
  inset: { left?: number; top?: number; right?: number; bottom?: number },
  tolerance = 2,
  weight = 1,
  label?: string,
): Check {
  return check("inset", label ?? `Inset within ${outerId}`, weight, (doc) => {
    const outer = doc.elements.find((e) => e.id === outerId);
    const inner = unionBox(visible(select(doc, selector)));
    if (!outer || !inner) return { score: 0, detail: "An element is missing." };
    const o = aabb(outer);
    const actual = {
      left: inner.x - o.x,
      top: inner.y - o.y,
      right: o.x + o.width - (inner.x + inner.width),
      bottom: o.y + o.height - (inner.y + inner.height),
    };
    let worst = 0;
    const parts: string[] = [];
    for (const side of ["left", "top", "right", "bottom"] as const) {
      const want = inset[side];
      if (want === undefined) continue;
      worst = Math.max(worst, Math.abs(actual[side] - want));
      parts.push(`${side} ${round(actual[side])} (wanted ${want})`);
    }
    return { score: gradeDefect(worst, tolerance, tolerance + 24), detail: parts.join(", ") };
  });
}

/** An element's box keeps a stated width-to-height ratio. */
export function aspectOf(id: string, ratio: number, tolerance = 0.01, weight = 1, label?: string): Check {
  return check("box_aspect", label ?? `${id} keeps its proportions`, weight, (doc) => {
    const el = doc.elements.find((e) => e.id === id);
    if (!el) return { score: 0, detail: `${id} is missing.` };
    const off = Math.abs(el.width / el.height - ratio) / ratio;
    return { score: gradeDefect(off, tolerance, tolerance + 0.1), detail: `${id} is ${round(el.width)}x${round(el.height)}, ${(off * 100).toFixed(1)}% off.` };
  });
}

// --- prototype: constructions from shapes ------------------------------------

/** Every matched element draws a stated shape (and, for polygons and stars, a stated number of sides). */
export function shapeIs(selector: Selector, shape: NonNullable<Style["shape"]>, sides?: number, weight = 1, label?: string): Check {
  return check("shape", label ?? `Drawn as ${shape === "rect" ? "a box" : `a ${shape}`}${sides ? ` with ${sides}` : ""}`, weight, (doc) => {
    const els = visible(select(doc, selector));
    if (els.length === 0) return { score: 0, detail: "No matching element." };
    const wrong = els.filter((el) => {
      const s = el.style.shape ?? "rect";
      const n = el.style.sides ?? (s === "star" ? 5 : 6);
      return el.type !== "rect" || s !== shape || (sides !== undefined && n !== sides);
    });
    return {
      score: (els.length - wrong.length) / els.length,
      detail: wrong.length ? `Wrong shape: ${wrong.map((e) => e.id).join(", ")}` : "Right shape.",
    };
  });
}

/** A linear gradient from one stated colour to another, at a stated angle. */
export function gradientIs(selector: Selector, from: string, to: string, angle: number, weight = 1, label?: string): Check {
  return check("gradient", label ?? `A gradient from ${from} to ${to} at ${angle} degrees`, weight, (doc) => {
    const els = visible(select(doc, selector));
    if (els.length === 0) return { score: 0, detail: "No matching element." };
    const ok = els.filter(
      (el) =>
        el.style.fill?.toLowerCase() === from.toLowerCase() &&
        el.style.fillTo?.toLowerCase() === to.toLowerCase() &&
        Math.abs(normalizeAngle((el.style.gradientAngle ?? 90) - angle)) < 1,
    );
    return {
      score: ok.length / els.length,
      detail: ok.length === els.length ? "Right gradient." : `Gradient is ${els[0]!.style.fill} to ${els[0]!.style.fillTo ?? "(none)"} at ${els[0]!.style.gradientAngle ?? 90}.`,
    };
  });
}

/**
 * Elements arranged in a ring: one centred at each of `count` angles, every
 * `step` degrees from `start` (clockwise from straight up), `radius` from a
 * centre point, and — with `facing` — turned to point along their own angle.
 *
 * Matched to slots by angle rather than by id, because the agent names them.
 * Each slot takes its nearest unclaimed element; an empty slot or a spare
 * element is a miss. A ray points both ways, so `facing` accepts the angle
 * or its opposite.
 */
export function ring(
  selector: Selector,
  spec: {
    cx: number;
    cy: number;
    radius: number;
    count: number;
    start?: number;
    step: number;
    facing?: boolean;
    tolerance?: number;
    /** The copy each slot must carry, in slot order — a clock's numerals. */
    texts?: string[];
  },
  weight = 1,
  label?: string,
): Check {
  const tol = spec.tolerance ?? 3;
  return check("ring", label ?? `${spec.count} elements in a ring`, weight, (doc) => {
    const els = visible(select(doc, selector));
    const unclaimed = new Set(els);
    let worst = 0;
    const misses: string[] = [];
    for (let i = 0; i < spec.count; i++) {
      const deg = (spec.start ?? 0) + i * spec.step;
      const a = (deg * Math.PI) / 180;
      const want = { x: spec.cx + Math.sin(a) * spec.radius, y: spec.cy - Math.cos(a) * spec.radius };
      let best: Element | undefined;
      let bestD = Infinity;
      for (const el of unclaimed) {
        const c = center(el);
        const d = Math.hypot(c.x - want.x, c.y - want.y);
        if (d < bestD) {
          bestD = d;
          best = el;
        }
      }
      if (!best) {
        worst = Math.max(worst, tol + 24);
        misses.push(`nothing at ${round(deg)} degrees`);
        continue;
      }
      unclaimed.delete(best);
      let off = bestD;
      if (spec.facing) {
        const turn = Math.abs(normalizeAngle(best.rotation - deg));
        const facingOff = Math.min(turn, Math.abs(180 - turn));
        // A degree of turn counts as much as eight units of displacement: on
        // a 150-unit ray that is about where a reader sees it as crooked.
        off = Math.max(off, facingOff * 8);
      }
      const wantText = spec.texts?.[i];
      if (wantText !== undefined && normalizeCopy(best.text ?? "") !== normalizeCopy(wantText)) {
        off = tol + 24;
        misses.push(`${best.id} at ${round(deg)} degrees reads "${best.text ?? ""}", wanted "${wantText}"`);
      }
      worst = Math.max(worst, off);
      if (off > tol) misses.push(`${best.id} at ${round(deg)} degrees is ${round(off)} off`);
    }
    if (unclaimed.size > 0) {
      worst = Math.max(worst, tol + 24);
      misses.push(`spare: ${[...unclaimed].map((e) => e.id).join(", ")}`);
    }
    return { score: gradeDefect(worst, tol, tol + 24), detail: misses.length ? misses.join("; ") : "Every slot filled." };
  });
}

/** The centre of the matched group sits at a stated point. */
export function centerAt(selector: Selector, x: number, y: number, tolerance = 2, weight = 1, label?: string): Check {
  return check("center_at", label ?? `Centred at (${x}, ${y})`, weight, (doc) => {
    const b = unionBox(visible(select(doc, selector)));
    if (!b) return { score: 0, detail: "No matching element." };
    const off = Math.max(Math.abs(b.x + b.width / 2 - x), Math.abs(b.y + b.height / 2 - y));
    return { score: gradeDefect(off, tolerance, tolerance + 30), detail: `${round(off)} units from (${x}, ${y}).` };
  });
}

/**
 * The fill of one surface against the fill of the surface it sits on, as a
 * contrast ratio within a stated band — the "one step lighter" of a dark
 * theme, which nobody can judge by eye from a hex code. `"canvas"` names the
 * document background.
 */
export function fillContrastBetween(upper: string, lower: string, min: number, max: number, weight = 1, label?: string): Check {
  return check("fill_step", label ?? `${upper} against ${lower} is ${min}:1 to ${max}:1`, weight, (doc) => {
    const fillOf = (id: string) => (id === "canvas" ? doc.background : doc.elements.find((e) => e.id === id)?.style.fill);
    const a = fillOf(upper);
    const b = fillOf(lower);
    if (!a || !b) return { score: 0, detail: "A surface has no fill." };
    const ratio = contrastRatio(a, b);
    const defect = ratio < min ? min - ratio : ratio > max ? ratio - max : 0;
    return { score: gradeDefect(defect, 0, 0.5), detail: `${upper} ${a} on ${lower} ${b}: ${ratio.toFixed(2)}:1.` };
  });
}

/**
 * What an element *paints* reaches to within a stated band of two opposite
 * canvas edges.
 *
 * For a rotated element this is the trigonometry its declared box hides: a
 * banner that is to run "edge to edge, 40 units in" has to be sized from where
 * its corners land, not from its width.
 */
export function paintedReach(
  selector: Selector,
  axis: "horizontal" | "vertical",
  minMargin: number,
  maxMargin: number,
  weight = 1,
  label?: string,
): Check {
  return check(
    "painted_reach",
    label ?? `Reaches to between ${minMargin} and ${maxMargin} units of both ${axis === "horizontal" ? "side" : "top and bottom"} edges`,
    weight,
    (doc) => {
      const els = visible(select(doc, selector));
      const painted = els.map(paintedBounds).filter((b): b is Rect => !!b);
      if (painted.length === 0) return { score: 0, detail: "Nothing painted." };
      const x = Math.min(...painted.map((b) => b.x));
      const y = Math.min(...painted.map((b) => b.y));
      const r = Math.max(...painted.map((b) => b.x + b.width));
      const bt = Math.max(...painted.map((b) => b.y + b.height));
      const near = axis === "horizontal" ? [x, doc.width - r] : [y, doc.height - bt];
      const defect = Math.max(...near.map((m) => (m < minMargin ? minMargin - m : m > maxMargin ? m - maxMargin : 0)));
      return {
        score: gradeDefect(defect, 0, 40),
        detail: `Painted margins ${near.map((m) => round(m)).join(" and ")} (wanted ${minMargin}–${maxMargin}).`,
      };
    },
  );
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
