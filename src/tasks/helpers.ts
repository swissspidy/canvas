/**
 * Builders for task fixtures. Terse on purpose: a task definition should read
 * as a description of the situation, not as a wall of object literals.
 */

import type { Doc, Element, Style } from "../doc/types.js";
import { normalizeDoc } from "../doc/schema.js";

export const POSTER_W = 1080;
export const POSTER_H = 1350;

let autoZ = 0;

interface Base {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
  z?: number;
  style?: Style;
}

export function rect(base: Base): Element {
  return {
    id: base.id,
    type: "rect",
    x: base.x,
    y: base.y,
    width: base.w,
    height: base.h,
    rotation: base.rot ?? 0,
    z: base.z ?? autoZ++,
    style: base.style ?? {},
  };
}

export function text(base: Base & { text: string }): Element {
  return {
    id: base.id,
    type: "text",
    x: base.x,
    y: base.y,
    width: base.w,
    height: base.h,
    rotation: base.rot ?? 0,
    z: base.z ?? autoZ++,
    text: base.text,
    style: base.style ?? {},
  };
}

export function image(base: Base & { src: string; alt?: string }): Element {
  const el: Element = {
    id: base.id,
    type: "image",
    x: base.x,
    y: base.y,
    width: base.w,
    height: base.h,
    rotation: base.rot ?? 0,
    z: base.z ?? autoZ++,
    src: base.src,
    style: base.style ?? {},
  };
  if (base.alt) el.alt = base.alt;
  return el;
}

export function doc(
  elements: Element[],
  opts: { width?: number; height?: number; background?: string } = {},
): Doc {
  autoZ = 0;
  return normalizeDoc({
    width: opts.width ?? POSTER_W,
    height: opts.height ?? POSTER_H,
    background: opts.background ?? "#ffffff",
    elements: elements.map((el, i) => ({ ...el, z: el.z ?? i })),
  });
}

export function blank(opts: { width?: number; height?: number; background?: string } = {}): Doc {
  return doc([], opts);
}
