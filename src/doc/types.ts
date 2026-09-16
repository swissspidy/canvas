/**
 * The document model.
 *
 * Deliberately tiny, and deliberately close to the Web Stories model: a
 * fixed-size canvas holding a flat list of absolutely-positioned elements.
 * No nesting, no groups, no rich text, no multi-page. Every sharp edge in
 * this project should come from the research question, not from the model.
 */

export const ELEMENT_TYPES = ["text", "rect", "image"] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export const FONT_WEIGHTS = ["regular", "bold"] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

export const H_ALIGNS = ["left", "center", "right"] as const;
export type HAlign = (typeof H_ALIGNS)[number];

export const V_ALIGNS = ["top", "middle", "bottom"] as const;
export type VAlign = (typeof V_ALIGNS)[number];

export const OBJECT_FITS = ["cover", "contain"] as const;
export type ObjectFit = (typeof OBJECT_FITS)[number];

/**
 * The small style bag. Kept small on purpose: every key here is one more
 * degree of freedom the agent can spend tokens on, and one more thing the
 * deterministic checks have to reason about.
 *
 * Colors are `#rgb`, `#rrggbb`, `#rrggbbaa`, or `transparent`.
 */
export interface Style {
  /** Fill color. Background for `rect` and for `text` blocks. */
  fill?: string;
  /** Text color. `text` only. */
  color?: string;
  /** Font size in canvas units. `text` only. */
  fontSize?: number;
  fontWeight?: FontWeight;
  /** Horizontal alignment of text within the element box. */
  align?: HAlign;
  /** Vertical alignment of the wrapped text block within the element box. */
  valign?: VAlign;
  /** Line height as a multiple of `fontSize`. */
  lineHeight?: number;
  /** 0..1 */
  opacity?: number;
  /** Corner radius, `rect` and `image`. */
  radius?: number;
  strokeColor?: string;
  strokeWidth?: number;
  /** Inset between the element box and its text, in canvas units. */
  padding?: number;
  /** How an image fills its box when aspect ratios disagree. */
  objectFit?: ObjectFit;
}

export interface Element {
  id: string;
  type: ElementType;
  /** Left edge of the unrotated box. */
  x: number;
  /** Top edge of the unrotated box. */
  y: number;
  width: number;
  height: number;
  /** Clockwise degrees about the box center. */
  rotation: number;
  /** Paint order. Higher is nearer the viewer. Ties break by array order. */
  z: number;
  /** `text` only. Plain text; `\n` is a hard break. No rich text. */
  text?: string;
  /** `image` only. A key into the asset library (see `src/doc/assets.ts`). */
  src?: string;
  /** `image` only. Description, used by the structured-feedback channel. */
  alt?: string;
  style: Style;
}

export interface Doc {
  width: number;
  height: number;
  /** Canvas background color. */
  background: string;
  elements: Element[];
}

/** A rectangle in canvas space. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Polygon = Point[];
