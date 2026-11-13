/**
 * The renderer: `Doc -> SVG`, a pure function.
 *
 * One renderer feeds everything — the screenshots the agent sees, the images
 * the judge scores, and the live page. Rendering somewhere else (a second
 * canvas implementation in the browser, say) would let the agent's feedback
 * and the scorer's ground truth drift apart, and the feedback channel is a
 * variable this study is trying to measure, not confound.
 *
 * Text is emitted one `<text>` per laid-out line with an explicit
 * `textLength`, so the painted width equals the width `src/text/layout.ts`
 * computed, whatever shaping engine the viewer uses.
 */

import type { Doc, Element } from "../doc/types.js";
import { getAsset } from "../doc/assets.js";
import { layoutTextElement } from "../text/layout.js";
import { FONT_FAMILY, getFontBytes } from "../text/font-registry.js";
import { corners, round, shapePolygons } from "../doc/geometry.js";
import { toBase64 } from "./rasterizer.js";
import { localDrawing, pathFill, pathStroke } from "../doc/path.js";

export interface RenderOptions {
  /** Clip each text element to its box, so overflow is visibly truncated. */
  clipText?: boolean;
  /** Draw a dashed outline around every element. Debug aid, never used in evals. */
  outlines?: boolean;
  /** Inline `@font-face` rules with base64 font data (for standalone SVG files). */
  fontCss?: string;
  /** Scale factor applied to width/height attrs; the viewBox is unchanged. */
  scale?: number;
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!);
}

function n(v: number): string {
  return String(round(v, 3));
}

function styleAttrs(pairs: Record<string, string | number | undefined>): string {
  return Object.entries(pairs)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}="${typeof v === "number" ? n(v) : escapeXml(String(v))}"`)
    .join(" ");
}

/** Group transform for rotation and opacity. */
function openGroup(el: Element): string {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const parts: string[] = [`data-id="${escapeXml(el.id)}"`];
  if (el.rotation) parts.push(`transform="rotate(${n(el.rotation)} ${n(cx)} ${n(cy)})"`);
  if (el.style.opacity !== undefined && el.style.opacity < 1) {
    parts.push(`opacity="${n(el.style.opacity)}"`);
  }
  return `<g ${parts.join(" ")}>`;
}

/**
 * The paint for an element's fill: the colour itself, or a reference to a
 * linear gradient from it to `fillTo` along with the `<defs>` that declare it.
 * Rects and text block fills both go through here, so the two draw the same
 * gradient that `layerColor` in eval/color.ts scores.
 */
function fillPaint(el: Element, fill: string, idx: number): { defs: string; fill: string } {
  if (!el.style.fillTo) return { defs: "", fill };
  // objectBoundingBox units, so the gradient spans the element's own box and
  // turns with it; `gradientPosition` in eval/color.ts reads the same vector.
  const a = ((el.style.gradientAngle ?? 90) * Math.PI) / 180;
  // Numbered by paint position, not by element id: an id is whatever a
  // document says it is, and one holding a space or a bracket made a
  // `url(#...)` that pointed at nothing, so the shape painted no fill at all.
  const id = `fill_${idx}`;
  return {
    defs:
      `<defs><linearGradient id="${id}" x1="${n(0.5 - Math.cos(a) / 2)}" y1="${n(0.5 - Math.sin(a) / 2)}" ` +
      `x2="${n(0.5 + Math.cos(a) / 2)}" y2="${n(0.5 + Math.sin(a) / 2)}">` +
      `<stop offset="0" stop-color="${escapeXml(fill)}" /><stop offset="1" stop-color="${escapeXml(el.style.fillTo)}" />` +
      `</linearGradient></defs>`,
    fill: `url(#${id})`,
  };
}

function renderRect(el: Element, idx: number): string {
  const { defs, fill } = fillPaint(el, el.style.fill ?? "#cccccc", idx);
  const paint = {
    fill,
    stroke: el.style.strokeColor,
    "stroke-width": el.style.strokeColor ? (el.style.strokeWidth ?? 1) : undefined,
  };
  const shape = el.style.shape ?? "rect";
  if (shape === "ellipse") {
    return defs + `<ellipse ${styleAttrs({ cx: el.x + el.width / 2, cy: el.y + el.height / 2, rx: el.width / 2, ry: el.height / 2, ...paint })} />`;
  }
  if (shape === "polygon" || shape === "star") {
    // The outline before rotation: the group transform turns it.
    const outline = shapeOutline({ ...el, rotation: 0 });
    return defs + `<polygon ${styleAttrs({ points: outline.map((p) => `${n(p.x)},${n(p.y)}`).join(" "), ...paint })} />`;
  }
  return defs + `<rect ${styleAttrs({
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    rx: el.style.radius,
    ry: el.style.radius,
    ...paint,
  })} />`;
}

/** A polygon's or a star's outline as one ring of points, for drawing. */
function shapeOutline(el: Element): { x: number; y: number }[] {
  const pieces = shapePolygons(el);
  if ((el.style.shape ?? "rect") !== "star") return pieces[0]!;
  // Interleave the tips with the inner ring: inner[i-1], tip[i], inner[i], ...
  const inner = pieces[0]!;
  const out: { x: number; y: number }[] = [];
  for (let i = 1; i < pieces.length; i++) out.push(pieces[i]![1]!, inner[i - 1]!);
  return out;
}

/**
 * Assets are procedural rather than binary: a gradient plus a simple motif.
 * Deterministic, tiny, and with honest intrinsic aspect ratios so `objectFit`
 * is a real decision rather than a no-op.
 */
function renderImage(el: Element, defs: string[], idx: number): string {
  const asset = getAsset(el.src);
  const gradId = `grad_${idx}`;
  const clipId = `clip_${idx}`;
  const from = asset?.from ?? "#bbbbbb";
  const to = asset?.to ?? "#888888";

  defs.push(
    `<linearGradient id="${gradId}" x1="0" y1="0" x2="0.4" y2="1">` +
      `<stop offset="0" stop-color="${escapeXml(from)}"/>` +
      `<stop offset="1" stop-color="${escapeXml(to)}"/>` +
      `</linearGradient>`,
  );
  defs.push(
    `<clipPath id="${clipId}"><rect ${styleAttrs({
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      rx: el.style.radius,
      ry: el.style.radius,
    })} /></clipPath>`,
  );

  // Where the asset actually lands inside the box, given its intrinsic ratio.
  const fit = el.style.objectFit ?? "cover";
  const aspect = asset ? asset.width / asset.height : el.width / el.height;
  let dw = el.width;
  let dh = el.height;
  if (fit === "cover") {
    if (el.width / el.height < aspect) dw = el.height * aspect;
    else dh = el.width / aspect;
  } else {
    if (el.width / el.height > aspect) dw = el.height * aspect;
    else dh = el.width / aspect;
  }
  const dx = el.x + (el.width - dw) / 2;
  const dy = el.y + (el.height - dh) / 2;

  const letterbox =
    fit === "contain" && el.style.fill
      ? `<rect ${styleAttrs({ x: el.x, y: el.y, width: el.width, height: el.height, fill: el.style.fill })} />`
      : "";

  const body =
    `<rect ${styleAttrs({ x: dx, y: dy, width: dw, height: dh, fill: `url(#${gradId})` })} />` +
    motif(asset?.motif ?? "grain", dx, dy, dw, dh);

  const stroke = el.style.strokeColor
    ? `<rect ${styleAttrs({
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        rx: el.style.radius,
        ry: el.style.radius,
        fill: "none",
        stroke: el.style.strokeColor,
        "stroke-width": el.style.strokeWidth ?? 1,
      })} />`
    : "";

  return `<g clip-path="url(#${clipId})">${letterbox}${body}</g>${stroke}`;
}

function motif(kind: string, x: number, y: number, w: number, h: number): string {
  const white = (o: number) => `fill="#ffffff" fill-opacity="${o}"`;
  const black = (o: number) => `fill="#000000" fill-opacity="${o}"`;
  switch (kind) {
    case "peaks":
      return (
        `<polygon points="${n(x)},${n(y + h)} ${n(x + w * 0.32)},${n(y + h * 0.42)} ${n(x + w * 0.58)},${n(y + h)}" ${black(0.22)} />` +
        `<polygon points="${n(x + w * 0.38)},${n(y + h)} ${n(x + w * 0.72)},${n(y + h * 0.3)} ${n(x + w)},${n(y + h)}" ${black(0.32)} />` +
        `<circle cx="${n(x + w * 0.78)}" cy="${n(y + h * 0.2)}" r="${n(Math.min(w, h) * 0.07)}" ${white(0.65)} />`
      );
    case "portrait":
      return (
        `<circle cx="${n(x + w / 2)}" cy="${n(y + h * 0.36)}" r="${n(Math.min(w, h) * 0.17)}" ${white(0.3)} />` +
        `<path d="M ${n(x + w * 0.18)} ${n(y + h)} Q ${n(x + w / 2)} ${n(y + h * 0.56)} ${n(x + w * 0.82)} ${n(y + h)} Z" ${white(0.24)} />`
      );
    case "arc":
      return (
        `<circle cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" r="${n(Math.min(w, h) * 0.28)}" fill="none" stroke="#ffffff" stroke-opacity="0.45" stroke-width="${n(Math.min(w, h) * 0.05)}" />` +
        `<circle cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" r="${n(Math.min(w, h) * 0.13)}" ${white(0.3)} />`
      );
    case "grid": {
      const cols = 9;
      let out = "";
      for (let i = 0; i < cols; i++) {
        const bw = w / (cols * 1.6);
        const bh = h * (0.25 + ((i * 7) % 5) * 0.13);
        out += `<rect x="${n(x + (i + 0.4) * (w / cols))}" y="${n(y + h - bh)}" width="${n(bw)}" height="${n(bh)}" ${white(0.14)} />`;
      }
      return out;
    }
    default: {
      let out = "";
      for (let i = 0; i < 24; i++) {
        const px = x + ((i * 37) % 100) * (w / 100);
        const py = y + ((i * 61) % 100) * (h / 100);
        out += `<circle cx="${n(px)}" cy="${n(py)}" r="${n(Math.min(w, h) * 0.012)}" ${black(0.08)} />`;
      }
      return out;
    }
  }
}

function renderText(el: Element, defs: string[], idx: number, clip: boolean): string {
  const layout = layoutTextElement(el);
  const parts: string[] = [];

  // A transparent fill still paints when it fades into a fillTo.
  if (el.style.fill && (el.style.fill !== "transparent" || el.style.fillTo)) {
    const paint = fillPaint(el, el.style.fill, idx);
    parts.push(
      paint.defs +
      `<rect ${styleAttrs({
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        rx: el.style.radius,
        ry: el.style.radius,
        fill: paint.fill,
      })} />`,
    );
  }

  const runs = layout.lines
    .filter((l) => l.text.length > 0)
    .map(
      (l) =>
        `<text ${styleAttrs({
          x: l.x,
          y: l.baseline,
          "font-family": FONT_FAMILY,
          "font-size": layout.fontSize,
          "font-weight": el.style.fontWeight === "bold" ? "bold" : "normal",
          fill: el.style.color ?? "#111111",
          textLength: l.width > 0 ? l.width : undefined,
          lengthAdjust: l.width > 0 ? "spacing" : undefined,
          "xml:space": "preserve",
        })}>${escapeXml(l.text)}</text>`,
    )
    .join("");

  if (clip) {
    const clipId = `tclip_${idx}`;
    defs.push(
      `<clipPath id="${clipId}"><rect ${styleAttrs({
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
      })} /></clipPath>`,
    );
    parts.push(`<g clip-path="url(#${clipId})">${runs}</g>`);
  } else {
    parts.push(runs);
  }

  if (el.style.strokeColor) {
    parts.push(
      `<rect ${styleAttrs({
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        rx: el.style.radius,
        ry: el.style.radius,
        fill: "none",
        stroke: el.style.strokeColor,
        "stroke-width": el.style.strokeWidth ?? 1,
      })} />`,
    );
  }
  return parts.join("");
}

/**
 * A path, drawn from the same flattened outline the checks measure: straight
 * segments only, so a smooth curve on screen is the curve that was scored.
 */
function renderPath(el: Element, idx: number): string {
  const drawing = localDrawing(el);
  const d = (pts: { x: number; y: number }[], closed: boolean) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${n(p.x)} ${n(p.y)}`).join(" ") + (closed ? " Z" : "");
  const parts: string[] = [];
  const fill = pathFill(el);
  if (drawing.fill && fill !== null) {
    const paint = fillPaint(el, fill, idx);
    parts.push(paint.defs + `<path ${styleAttrs({ d: d(drawing.fill, true), fill: paint.fill })} />`);
  }
  const stroke = pathStroke(el);
  if (drawing.stroke && stroke) {
    const round = drawing.stroke.round;
    // A lone point has no segment to stroke; with a round cap it is a dot.
    const pts = drawing.stroke.points.length === 1 ? [drawing.stroke.points[0]!, drawing.stroke.points[0]!] : drawing.stroke.points;
    parts.push(
      `<path ${styleAttrs({
        d: d(pts, drawing.stroke.closed),
        fill: "none",
        stroke: stroke.color,
        "stroke-width": stroke.width,
        "stroke-linecap": round ? "round" : "butt",
        "stroke-linejoin": round ? "round" : "miter",
        "stroke-dasharray": el.style.dash ? `${n(el.style.dash)} ${n(el.style.dash)}` : undefined,
      })} />`,
    );
    for (const head of drawing.arrows) {
      parts.push(`<polygon ${styleAttrs({ points: head.map((p) => `${n(p.x)},${n(p.y)}`).join(" "), fill: stroke.color })} />`);
    }
  }
  return parts.join("");
}

/** True when nothing the element could paint reaches the canvas. */
function isOffCanvas(el: Element, doc: Doc): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  // A path paints where its stroke and curve go, which can be outside the
  // box its points span; everything else paints inside its rotated box.
  const polys = el.type === "path" ? shapePolygons(el) : [corners(el)];
  for (const poly of polys) {
    for (const p of poly) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (minX > maxX) return true;
  // A stroke is centred on the edge, so it reaches half its width further.
  const reach = el.type === "path" ? 0 : (el.style.strokeWidth ?? 1) / 2 + 1;
  return maxX + reach < 0 || maxY + reach < 0 || minX - reach > doc.width || minY - reach > doc.height;
}

export function renderSvg(doc: Doc, opts: RenderOptions = {}): string {
  const clipText = opts.clipText !== false;
  const scale = opts.scale ?? 1;
  const defs: string[] = [];
  const body: string[] = [];

  doc.elements.forEach((el, i) => {
    // An element wholly off the canvas paints nothing, so it is not drawn.
    // Not an optimization: the clip path of a text or image element far
    // enough outside the view box makes resvg abort the whole process — a
    // native panic no `try` can catch — and one stray `create` at y=4200 took
    // down a sweep and every cell running beside it. Unclipped text has no
    // clip path, and its later lines can run onto the canvas from a box that
    // is wholly above it, so it is left to draw.
    if (!(el.type === "text" && !clipText) && isOffCanvas(el, doc)) return;
    let inner: string;
    if (el.type === "rect") inner = renderRect(el, i);
    else if (el.type === "path") inner = renderPath(el, i);
    else if (el.type === "image") inner = renderImage(el, defs, i);
    else inner = renderText(el, defs, i, clipText);

    if (opts.outlines) {
      inner += `<rect ${styleAttrs({
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        fill: "none",
        stroke: "#ff00aa",
        "stroke-width": 1,
        "stroke-dasharray": "6 4",
      })} />`;
    }
    body.push(`${openGroup(el)}${inner}</g>`);
  });

  const style = opts.fontCss ? `<style>${opts.fontCss}</style>` : "";
  const defsBlock = defs.length || style ? `<defs>${style}${defs.join("")}</defs>` : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(doc.width * scale)}" height="${n(doc.height * scale)}" ` +
    `viewBox="0 0 ${n(doc.width)} ${n(doc.height)}">` +
    defsBlock +
    `<rect x="0" y="0" width="${n(doc.width)}" height="${n(doc.height)}" fill="${escapeXml(doc.background)}" />` +
    body.join("") +
    `</svg>`
  );
}

/**
 * `@font-face` CSS with the vendored faces inlined, making an SVG
 * self-contained. Required whenever the SVG is rendered somewhere that cannot
 * reach the page's stylesheets — an `<img>`, or a standalone file.
 */
export function inlineFontCss(regular: Uint8Array, bold: Uint8Array): string {
  const face = (bytes: Uint8Array, weight: string) =>
    `@font-face{font-family:'${FONT_FAMILY}';font-style:normal;font-weight:${weight};` +
    `src:url(data:font/ttf;base64,${toBase64(bytes)}) format('truetype');}`;
  return face(regular, "normal") + face(bold, "bold");
}

let cachedFontCss: string | null = null;

/**
 * The same CSS, built from the registered faces and memoized.
 *
 * Every SVG written to disk goes through here. A file without it renders in
 * whatever the viewer falls back to, and a line laid out from Liberation Sans
 * advances but painted in something else is not the document the scorer
 * measured — which is the one thing the saved artifacts exist to show.
 */
export function standaloneFontCss(): string {
  cachedFontCss ??= inlineFontCss(getFontBytes("regular"), getFontBytes("bold"));
  return cachedFontCss;
}

/** A self-contained SVG file: the document, with its faces inlined. */
export function renderStandaloneSvg(doc: Doc, opts: RenderOptions = {}): string {
  return renderSvg(doc, { ...opts, fontCss: standaloneFontCss() });
}
