/**
 * Text layout: greedy word wrapping with exact advance widths.
 *
 * This is the only place line breaking happens. The renderer paints what this
 * produces, and the scorer measures what this produces, so "the text clipped"
 * is a fact about the document rather than about whichever engine drew it.
 *
 * Deliberately simple, and documented as such in `docs/DESIGN.md`: no
 * hyphenation, no kerning, no bidi, no shaping. Words never break mid-word —
 * a word wider than its box overflows horizontally, which is what a real
 * canvas editor does and what the `overflowX` check looks for.
 */

import type { Element, HAlign, Rect, VAlign } from "../doc/types.js";
import { getFont } from "./fonts.js";
import { measureUnits, type FontMetrics } from "./ttf.js";

export const DEFAULT_FONT_SIZE = 32;
export const DEFAULT_LINE_HEIGHT = 1.25;

export interface LaidLine {
  text: string;
  /** Painted width in canvas units. */
  width: number;
  /** Left edge of the painted run. */
  x: number;
  /** Baseline y in canvas units. */
  baseline: number;
  /** Top of this line's line box. */
  top: number;
}

export interface TextLayout {
  fontSize: number;
  /** Line box height in canvas units. */
  lineHeightPx: number;
  /** Distance from baseline to the top of the glyph envelope. */
  ascent: number;
  /** Distance from baseline to the bottom of the glyph envelope. */
  descent: number;
  lines: LaidLine[];
  /** The element box inset by `style.padding`. */
  contentBox: Rect;
  /** Total height of all line boxes. */
  blockHeight: number;
  /** Widest line. */
  maxLineWidth: number;
  /** How far the widest line exceeds the content box. 0 when it fits. */
  overflowX: number;
  /** How far the text block exceeds the content box. 0 when it fits. */
  overflowY: number;
  /** Number of lines whose box fits entirely inside the content box. */
  visibleLines: number;
  clipped: boolean;
}

export function measureText(font: FontMetrics, s: string, fontSize: number): number {
  return (measureUnits(font, s) * fontSize) / font.unitsPerEm;
}

/** Split into words while keeping the run of spaces that followed each word. */
function tokenize(paragraph: string): { word: string; trailing: string }[] {
  const out: { word: string; trailing: string }[] = [];
  const re = /(\S+)(\s*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(paragraph)) !== null) {
    out.push({ word: m[1]!, trailing: m[2]! });
  }
  return out;
}

export interface WrapOptions {
  fontSize: number;
  maxWidth: number;
  font: FontMetrics;
}

/**
 * Wrap into lines. Trailing whitespace does not count toward line width,
 * matching how browsers measure a line box.
 */
export function wrapText(text: string, opts: WrapOptions): { text: string; width: number }[] {
  const { fontSize, maxWidth, font } = opts;
  const lines: { text: string; width: number }[] = [];

  for (const paragraph of text.split("\n")) {
    const tokens = tokenize(paragraph);
    if (tokens.length === 0) {
      lines.push({ text: "", width: 0 });
      continue;
    }
    let current = "";
    let currentWidth = 0;

    for (const { word, trailing } of tokens) {
      const wordWidth = measureText(font, word, fontSize);
      if (current === "") {
        current = word;
        currentWidth = wordWidth;
        continue;
      }
      const sepWidth = measureText(font, trailing || " ", fontSize);
      if (currentWidth + sepWidth + wordWidth <= maxWidth) {
        current += (trailing || " ") + word;
        currentWidth += sepWidth + wordWidth;
      } else {
        lines.push({ text: current, width: currentWidth });
        current = word;
        currentWidth = wordWidth;
      }
    }
    lines.push({ text: current, width: currentWidth });
  }
  return lines;
}

export function contentBoxOf(el: Element): Rect {
  const pad = el.style.padding ?? 0;
  return {
    x: el.x + pad,
    y: el.y + pad,
    width: Math.max(1, el.width - pad * 2),
    height: Math.max(1, el.height - pad * 2),
  };
}

function alignX(box: Rect, lineWidth: number, align: HAlign): number {
  if (align === "center") return box.x + (box.width - lineWidth) / 2;
  if (align === "right") return box.x + box.width - lineWidth;
  return box.x;
}

function alignY(box: Rect, blockHeight: number, valign: VAlign): number {
  if (valign === "middle") return box.y + (box.height - blockHeight) / 2;
  if (valign === "bottom") return box.y + box.height - blockHeight;
  return box.y;
}

/**
 * Lay out a text element. Returns positions in the element's *unrotated*
 * coordinate frame; rotation is applied by the renderer as a transform about
 * the element center, so layout never has to think about it.
 */
export function layoutTextElement(el: Element, fontOverride?: FontMetrics): TextLayout {
  const font = fontOverride ?? getFont(el.style.fontWeight ?? "regular");
  const fontSize = el.style.fontSize ?? DEFAULT_FONT_SIZE;
  const lineHeight = el.style.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const lineHeightPx = fontSize * lineHeight;
  const box = contentBoxOf(el);

  const wrapped = wrapText(el.text ?? "", { fontSize, maxWidth: box.width, font });

  const scale = fontSize / font.unitsPerEm;
  const ascent = font.ascender * scale;
  const descent = -font.descender * scale;
  // Half-leading: distribute the difference between the line box and the text
  // box evenly above and below, the same way CSS does.
  const halfLeading = (lineHeightPx - (ascent + descent)) / 2;

  const blockHeight = wrapped.length * lineHeightPx;
  const align = el.style.align ?? "left";
  const valign = el.style.valign ?? "top";
  const blockTop = alignY(box, blockHeight, valign);

  const lines: LaidLine[] = wrapped.map((l, i) => {
    const top = blockTop + i * lineHeightPx;
    return {
      text: l.text,
      width: l.width,
      x: alignX(box, l.width, align),
      top,
      baseline: top + halfLeading + ascent,
    };
  });

  const maxLineWidth = lines.reduce((m, l) => Math.max(m, l.width), 0);
  const overflowX = Math.max(0, maxLineWidth - box.width);
  const overflowY = Math.max(0, blockHeight - box.height);
  const visibleLines = lines.filter(
    (l) => l.top >= box.y - 0.01 && l.top + lineHeightPx <= box.y + box.height + 0.01,
  ).length;

  return {
    fontSize,
    lineHeightPx,
    ascent,
    descent,
    lines,
    contentBox: box,
    blockHeight,
    maxLineWidth,
    overflowX,
    overflowY,
    visibleLines,
    clipped: overflowX > 0.01 || overflowY > 0.01,
  };
}

/**
 * Largest integer font size at which `el`'s text fits its box, searched in
 * [min, max]. Used by the relational surface's `fit_text` operation — the
 * renderer does this arithmetic so the agent does not have to.
 */
export function largestFittingFontSize(el: Element, min = 8, max = 400): number | null {
  let lo = min;
  let hi = max;
  let best: number | null = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const probe: Element = { ...el, style: { ...el.style, fontSize: mid } };
    if (!layoutTextElement(probe).clipped) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** Height the element would need for its text to fit at the current font size. */
export function requiredHeight(el: Element): number {
  const layout = layoutTextElement(el);
  return layout.blockHeight + (el.style.padding ?? 0) * 2;
}
