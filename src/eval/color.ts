/**
 * Color math for the contrast check.
 *
 * Contrast is scored against the *effective backdrop*: the thing a reader
 * actually sees behind the text. Computing that exactly would mean sampling
 * rendered pixels; this takes the cheaper route of compositing the stack of
 * layers under the text's center. The approximation and its failure modes are
 * written up in `docs/DESIGN.md` — it is wrong for text straddling a hard edge
 * between two fills, and `docs/TASKS.md` notes which tasks avoid that case.
 */

import type { Doc, Element } from "../doc/types.js";
import { center, corners, polygonContainsPoint } from "../doc/geometry.js";
import { getAsset } from "../doc/assets.js";

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (!m) return null;
  const hex = m[1]!;
  if (hex.length === 3) {
    return {
      r: parseInt(hex[0]! + hex[0]!, 16),
      g: parseInt(hex[1]! + hex[1]!, 16),
      b: parseInt(hex[2]! + hex[2]!, 16),
      a: 1,
    };
  }
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
  };
}

export function toHex({ r, g, b }: Rgba): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Source-over composite of `fg` onto an opaque `bg`. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(c: Rgba): number {
  const chan = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
}

/**
 * WCAG contrast ratio, 1..21. A translucent foreground is composited over the
 * background first, which is what a reader sees.
 */
export function contrastRatio(fg: string, bg: string): number {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) return 1;
  const opaqueBg = b.a < 1 ? composite(b, { r: 255, g: 255, b: 255, a: 1 }) : b;
  const opaqueFg = f.a < 1 ? composite(f, opaqueBg) : f;
  const l1 = relativeLuminance(opaqueFg);
  const l2 = relativeLuminance(opaqueBg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** A flat color standing in for an image asset's average tone. */
function assetAverageColor(el: Element): string | null {
  const asset = getAsset(el.src);
  if (!asset) return null;
  const from = parseColor(asset.from);
  const to = parseColor(asset.to);
  if (!from || !to) return null;
  return toHex({ r: (from.r + to.r) / 2, g: (from.g + to.g) / 2, b: (from.b + to.b) / 2, a: 1 });
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/** The flat color an element paints behind whatever sits on top of it. */
function layerColor(el: Element): Rgba | null {
  if (el.type === "image") {
    const avg = assetAverageColor(el);
    return avg ? parseColor(avg) : null;
  }
  // A rect with no declared fill still paints: the renderer defaults it to
  // #cccccc, so the scorer has to see the same grey the reader does.
  const fill = el.type === "rect" ? (el.style.fill ?? "#cccccc") : el.style.fill;
  return fill ? parseColor(fill) : null;
}

function withOpacity(c: Rgba, opacity: number | undefined): Rgba {
  const o = opacity ?? 1;
  return o >= 1 ? c : { ...c, a: c.a * Math.max(0, o) };
}

/**
 * The colour a text element's glyphs actually land in, with the element's
 * opacity folded into the alpha.
 *
 * The contrast check read `style.color` on its own, which is the colour the
 * glyphs would be painted in if the element were fully opaque. It usually is.
 * When it is not, the number was a fiction: black copy at `opacity: 0.03` on a
 * white page measured 21:1 — a perfect score for text that is not there. Since
 * the renderer multiplies the two, so does this.
 */
export function effectiveTextColor(el: Element): string {
  const parsed = parseColor(el.style.color ?? "#111111");
  if (!parsed) return el.style.color ?? "#111111";
  const withAlpha = withOpacity(parsed, el.style.opacity);
  const a = Math.round(Math.max(0, Math.min(1, withAlpha.a)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${toHex(withAlpha)}${a}`;
}

/**
 * The color a reader perceives behind `el`.
 *
 * Every layer under `el` that covers its center is composited, bottom-up, onto
 * the canvas background — stopping at the first fully opaque one, since nothing
 * below that shows through. Two things this deliberately does *not* do:
 *
 * - Treat a translucent fill as if it sat directly on `doc.background`. A 40%
 *   white scrim over a dark photo is a common way to make text legible, and
 *   compositing it onto the page background instead of onto the photo reports
 *   a contrast ratio for a layout nobody is looking at.
 * - Round an element's coverage up to its bounding box. A rotated card is asked
 *   whether it really covers the point, using its actual corners.
 *
 * It is still an approximation — one sample at the center — and it is still
 * wrong for text straddling a hard edge between two fills. `docs/DESIGN.md`
 * writes that up and `docs/TASKS.md` notes which tasks avoid the case.
 */
export function effectiveBackdrop(doc: Doc, el: Element): string {
  const point = center(el);

  // Nearest layer first. A text element's own fill is painted behind its own
  // glyphs, so it joins the stack above everything else.
  const stack: Rgba[] = [];
  const own = parseColor(el.style.fill ?? "transparent");
  if (own && own.a > 0) stack.push(withOpacity(own, el.style.opacity));

  // Paint order is bottom-first; walk down from just below `el`.
  const index = doc.elements.findIndex((e) => e.id === el.id);
  for (let i = (index === -1 ? doc.elements.length : index) - 1; i >= 0; i--) {
    const other = doc.elements[i]!;
    if (!polygonContainsPoint(corners(other), point)) continue;
    const layer = layerColor(other);
    if (!layer || layer.a <= 0) continue;
    const withAlpha = withOpacity(layer, other.style.opacity);
    if (withAlpha.a <= 0) continue;
    stack.push(withAlpha);
    if (withAlpha.a >= 1) break;
  }

  if (stack.length === 0) return doc.background;
  let out = parseColor(doc.background) ?? WHITE;
  if (out.a < 1) out = composite(out, WHITE);
  for (let i = stack.length - 1; i >= 0; i--) out = composite(stack[i]!, out);
  return toHex(out);
}
