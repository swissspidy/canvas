/**
 * The structured feedback channel: `Doc -> text the model can read`.
 *
 * Two levels, and the split matters for the experiment:
 *
 *   "geometry"  — facts that are in the document, plus the one fact that is
 *                 not observable from it (whether text fits its box, which
 *                 depends on font metrics the agent has no access to).
 *   "analysis"  — geometry plus *derived* relations: overlaps, out-of-bounds,
 *                 contrast, alignment groups.
 *
 * Analysis is relational computation done on the agent's behalf. Handing it to
 * a coordinate-surface agent narrows the very gap this study is trying to
 * measure, so it is a separate switch rather than something baked into
 * "structured feedback". `docs/PREREGISTRATION.md` treats the geometry-only
 * variants as the confound control for the headline feedback comparison.
 */

import type { Doc, Element } from "../doc/types.js";
import { aabb, outOfBoundsArea, round } from "../doc/geometry.js";
import { occlusions } from "../doc/occlusion.js";
import { layoutTextElement } from "../text/layout.js";
import { getAsset } from "../doc/assets.js";
import { contrastRatio, effectiveBackdrop } from "../eval/color.js";

export type DescribeLevel = "geometry" | "analysis";

export interface DescribeOptions {
  level?: DescribeLevel;
  /** Cap on the characters of an element's text that get echoed back. */
  maxTextChars?: number;
}

function fmt(n: number): string {
  return String(round(n, 1));
}

function styleSummary(el: Element): string {
  const s = el.style;
  const bits: string[] = [];
  if (s.fill) bits.push(`fill=${s.fill}`);
  if (s.color) bits.push(`color=${s.color}`);
  if (s.fontSize !== undefined) bits.push(`fontSize=${fmt(s.fontSize)}`);
  if (s.fontWeight) bits.push(s.fontWeight);
  if (s.align) bits.push(`align=${s.align}`);
  if (s.valign) bits.push(`valign=${s.valign}`);
  if (s.lineHeight !== undefined) bits.push(`lineHeight=${s.lineHeight}`);
  if (s.padding) bits.push(`padding=${fmt(s.padding)}`);
  if (s.radius) bits.push(`radius=${fmt(s.radius)}`);
  if (s.opacity !== undefined && s.opacity < 1) bits.push(`opacity=${s.opacity}`);
  if (s.strokeColor) bits.push(`stroke=${s.strokeColor}/${fmt(s.strokeWidth ?? 1)}`);
  if (s.objectFit) bits.push(`objectFit=${s.objectFit}`);
  return bits.length ? bits.join(" ") : "(no style set)";
}

function elementBlock(el: Element, maxTextChars: number): string[] {
  const lines: string[] = [];
  const head = [`[${el.id}] ${el.type}`];
  if (el.type === "image") {
    const asset = getAsset(el.src);
    head.push(`src=${el.src ?? "(unset)"}`);
    if (asset) head.push(`— ${asset.label}, intrinsic ${asset.width}x${asset.height}`);
  }
  lines.push(head.join(" "));
  lines.push(
    `  box x=${fmt(el.x)} y=${fmt(el.y)} w=${fmt(el.width)} h=${fmt(el.height)}` +
      ` rotation=${fmt(el.rotation)} z=${el.z}`,
  );
  lines.push(`  style ${styleSummary(el)}`);

  if (el.type === "text") {
    const raw = el.text ?? "";
    const shown = raw.length > maxTextChars ? `${raw.slice(0, maxTextChars)}…` : raw;
    lines.push(`  text ${JSON.stringify(shown)}`);
    const layout = layoutTextElement(el);
    if (layout.clipped) {
      const parts: string[] = [];
      if (layout.overflowY > 0.01) {
        parts.push(
          `${fmt(layout.overflowY)} units too tall` +
            ` (${layout.visibleLines} of ${layout.lines.length} lines fully visible)`,
        );
      }
      if (layout.overflowX > 0.01) parts.push(`${fmt(layout.overflowX)} units too wide`);
      lines.push(`  CLIPPED: ${parts.join("; ")}`);
    } else {
      const slackY = layout.contentBox.height - layout.blockHeight;
      lines.push(
        `  fits: ${layout.lines.length} line(s), ${fmt(layout.blockHeight)} units tall,` +
          ` ${fmt(slackY)} units of vertical slack`,
      );
    }
  }
  return lines;
}

/** Derived relations. Kept out of the geometry-only description on purpose. */
function analysisNotes(doc: Doc): string[] {
  const notes: string[] = [];
  const canvas = { x: 0, y: 0, width: doc.width, height: doc.height };

  // Occlusion, not raw overlap: a headline on a card is not a defect, a rect
  // dropped on top of that headline is. See `src/doc/occlusion.ts`.
  //
  // Reported for text, because covering text destroys the only thing it
  // carries. A rect or image partly covered is ordinary composition — a
  // caption over a photo, a headline on a card — so those are reported only
  // when the element has been buried outright.
  const byId = new Map(doc.elements.map((el) => [el.id, el]));
  for (const occ of occlusions(doc)) {
    if (occ.hiddenArea <= 0.5) continue;
    const el = byId.get(occ.id)!;
    if (el.type === "text") {
      notes.push(
        `${occ.id}'s text is ${fmt(occ.hiddenFraction * 100)}% covered by ${occ.occludedBy.join(", ")}` +
          ` (painted above it), hiding ${fmt(occ.hiddenArea)} sq units of glyphs`,
      );
    } else if (occ.hiddenFraction >= 0.9) {
      notes.push(
        `${occ.id} is ${fmt(occ.hiddenFraction * 100)}% covered by ${occ.occludedBy.join(", ")}` +
          ` — effectively invisible`,
      );
    }
  }

  for (const el of doc.elements) {
    const out = outOfBoundsArea(el, canvas);
    if (out <= 0.5) continue;
    const box = aabb(el);
    const sides: string[] = [];
    if (box.x < -0.01) sides.push(`${fmt(-box.x)} past the left edge`);
    if (box.y < -0.01) sides.push(`${fmt(-box.y)} past the top edge`);
    if (box.x + box.width > doc.width + 0.01) sides.push(`${fmt(box.x + box.width - doc.width)} past the right edge`);
    if (box.y + box.height > doc.height + 0.01) sides.push(`${fmt(box.y + box.height - doc.height)} past the bottom edge`);
    notes.push(`${el.id} extends outside the canvas: ${sides.join(", ")}`);
  }

  for (const el of doc.elements) {
    if (el.type !== "text" || !el.text) continue;
    const backdrop = effectiveBackdrop(doc, el);
    const ratio = contrastRatio(el.style.color ?? "#111111", backdrop);
    if (ratio < 4.5) {
      notes.push(
        `${el.id} text contrast is ${ratio.toFixed(2)}:1 against ${backdrop}` +
          ` (below the 4.5:1 readability threshold)`,
      );
    }
  }

  const alignments = alignmentGroups(doc);
  for (const note of alignments) notes.push(note);

  return notes;
}

/**
 * Edges that several elements already share. Useful — an agent nudging one
 * element usually wants to know what it was lined up with — but easy to
 * drown in, so only the largest few groups are reported.
 */
const MAX_ALIGNMENT_NOTES = 4;

function alignmentGroups(doc: Doc): string[] {
  if (doc.elements.length < 2) return [];
  const found: { size: number; note: string }[] = [];
  const edges: { name: string; value: (el: Element) => number }[] = [
    { name: "left edges", value: (el) => aabb(el).x },
    { name: "right edges", value: (el) => aabb(el).x + aabb(el).width },
    { name: "horizontal centers", value: (el) => aabb(el).x + aabb(el).width / 2 },
    { name: "top edges", value: (el) => aabb(el).y },
    { name: "bottom edges", value: (el) => aabb(el).y + aabb(el).height },
  ];
  for (const edge of edges) {
    const buckets = new Map<number, string[]>();
    for (const el of doc.elements) {
      const key = Math.round(edge.value(el) * 2) / 2;
      buckets.set(key, [...(buckets.get(key) ?? []), el.id]);
    }
    for (const [key, ids] of buckets) {
      if (ids.length < 2) continue;
      found.push({ size: ids.length, note: `${ids.join(", ")} share ${edge.name} at ${fmt(key)}` });
    }
  }
  return found
    .sort((a, b) => b.size - a.size || a.note.localeCompare(b.note))
    .slice(0, MAX_ALIGNMENT_NOTES)
    .map((f) => f.note);
}

export function describeDoc(doc: Doc, opts: DescribeOptions = {}): string {
  const level = opts.level ?? "analysis";
  const maxTextChars = opts.maxTextChars ?? 240;
  const out: string[] = [];

  out.push(`Canvas ${fmt(doc.width)}x${fmt(doc.height)}, background ${doc.background}.`);
  if (doc.elements.length === 0) {
    out.push("The document has no elements.");
    return out.join("\n");
  }

  out.push(`${doc.elements.length} element(s), listed back to front (first painted first):`);
  out.push("");
  for (const el of doc.elements) {
    out.push(...elementBlock(el, maxTextChars));
    out.push("");
  }

  if (level === "analysis") {
    const notes = analysisNotes(doc);
    out.push("Layout notes:");
    if (notes.length === 0) out.push("  (no overlaps, nothing out of bounds, no low-contrast text)");
    else for (const note of notes) out.push(`  - ${note}`);
  }

  return out.join("\n").trimEnd();
}
