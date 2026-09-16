/**
 * Color math for the contrast check.
 *
 * Contrast is scored against the *effective backdrop*: the thing a reader
 * actually sees behind the text. Computing that exactly would mean sampling
 * rendered pixels; this takes the cheaper route of finding the topmost opaque
 * thing under the text's center. The approximation and its failure modes are
 * written up in `docs/DESIGN.md` — it is wrong for text straddling a hard edge
 * between two fills, and `docs/TASKS.md` notes which tasks avoid that case.
 */

import type { Doc, Element } from "../doc/types.js";
import { aabb, containsPoint } from "../doc/geometry.js";
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

/**
 * The color a reader perceives behind `el`: the topmost element painted below
 * it that covers its center and is not effectively transparent, falling back
 * to the canvas background.
 */
export function effectiveBackdrop(doc: Doc, el: Element): string {
  const box = aabb(el);
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // A text element paints its own fill behind its own glyphs, so that is the
  // backdrop whenever it is opaque enough to hide what is under it.
  const own = parseColor(el.style.fill ?? "transparent");
  if (own && own.a >= 0.5) {
    const base = parseColor(doc.background) ?? { r: 255, g: 255, b: 255, a: 1 };
    return toHex(own.a < 1 ? composite(own, base) : own);
  }

  // Paint order is bottom-first; walk down from just below `el`.
  const index = doc.elements.findIndex((e) => e.id === el.id);
  for (let i = (index === -1 ? doc.elements.length : index) - 1; i >= 0; i--) {
    const other = doc.elements[i]!;
    if (!containsPoint(aabb(other), center)) continue;
    if ((other.style.opacity ?? 1) < 0.5) continue;

    if (other.type === "image") {
      const avg = assetAverageColor(other);
      if (avg) return avg;
      continue;
    }
    const fill = other.style.fill;
    if (!fill) continue;
    const parsed = parseColor(fill);
    if (!parsed || parsed.a < 0.5) continue;
    return toHex(parsed.a < 1 ? composite(parsed, parseColor(doc.background) ?? { r: 255, g: 255, b: 255, a: 1 }) : parsed);
  }
  return doc.background;
}
