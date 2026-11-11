/**
 * The document model.
 *
 * Small, and close to the Web Stories model: a fixed-size canvas holding a
 * flat list of absolutely-positioned elements. No nesting, no groups, no rich
 * text, no multi-page. Every sharp edge in this project should come from the
 * research question, not from the model.
 *
 * It is no longer only boxes. A `path` is a line drawn through points — open
 * or closed, straight or smooth, stroked or filled — which is what makes this
 * a canvas one can draw on rather than only lay out. See `src/doc/path.ts`.
 */

export const ELEMENT_TYPES = ["text", "rect", "image", "path"] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

/** The kinds `create` makes. A path is drawn, with `draw`, not created in a box. */
export const BOX_ELEMENT_TYPES = ["text", "rect", "image"] as const;
export type BoxElementType = (typeof BOX_ELEMENT_TYPES)[number];

export const CURVES = ["straight", "smooth"] as const;
export type Curve = (typeof CURVES)[number];

export const LINE_CAPS = ["butt", "round"] as const;
export type LineCap = (typeof LINE_CAPS)[number];

export const ARROWS = ["none", "end", "start", "both"] as const;
export type Arrow = (typeof ARROWS)[number];

/** How many points one path may hold. */
export const MAX_PATH_POINTS = 400;

export const FONT_WEIGHTS = ["regular", "bold"] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

export const H_ALIGNS = ["left", "center", "right"] as const;
export type HAlign = (typeof H_ALIGNS)[number];

export const V_ALIGNS = ["top", "middle", "bottom"] as const;
export type VAlign = (typeof V_ALIGNS)[number];

export const OBJECT_FITS = ["cover", "contain"] as const;
/** What a `rect` element draws inside its box. */
export const SHAPES = ["rect", "ellipse", "polygon", "star"] as const;
export type Shape = (typeof SHAPES)[number];
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
  /**
   * `rect` only: what is drawn inside the box. An ellipse, a regular polygon
   * or a star, stretched to fill the box, with its first point straight up
   * before rotation. Default `rect`.
   */
  shape?: Shape;
  /** Sides of a `polygon` (default 6) or points of a `star` (default 5). */
  sides?: number;
  /** A star's inner radius as a share of its outer one. Default 0.5. */
  innerRatio?: number;
  /** Second colour of a linear gradient running from `fill` to this. */
  fillTo?: string;
  /** Direction of the gradient in degrees: 0 runs left to right, 90 top to bottom. Default 90. */
  gradientAngle?: number;
  /**
   * `path` only: how the line runs between its points. `straight` joins them
   * with segments; `smooth` passes a curve through every one of them. Default
   * `straight`.
   */
  curve?: Curve;
  /** `path` only: the shape of a stroke's ends and corners. Default `round`. */
  lineCap?: LineCap;
  /** `path` only: dash length in canvas units, with gaps of the same length. Absent means a solid line. */
  dash?: number;
  /** `path` only: arrowheads on an open path's ends. Default `none`. */
  arrow?: Arrow;
}

export const ANIMATION_EFFECTS = ["fade", "fly"] as const;
export type AnimationEffect = (typeof ANIMATION_EFFECTS)[number];

export const FLY_SIDES = ["left", "right", "top", "bottom"] as const;
export type FlySide = (typeof FLY_SIDES)[number];

/**
 * One entrance animation, as on a Web Stories page: the element arrives once
 * and then stays where the document puts it. Its x, y and style are always its
 * resting state, so everything that scores a static page scores the last frame
 * unchanged. Timing is linear, in milliseconds from the moment the page opens.
 */
export interface Animation {
  /** `fade`: opacity rises from 0 to the element's own. `fly`: it travels in a straight line to its place. */
  effect: AnimationEffect;
  /** When it starts. Before then the element shows its starting state. */
  delay: number;
  /** How long it takes. */
  duration: number;
  /** `fly` only: the side it comes in from. */
  from?: FlySide;
  /** `fly` only: how far it travels, in canvas units. */
  distance?: number;
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
  /**
   * `path` only. The points the line runs through, as `[x, y]` pairs in canvas
   * units before rotation. Their bounding box is always the element's box:
   * moving or resizing the element carries the points with it.
   */
  points?: [number, number][];
  /** `path` only. Joins the last point back to the first, making a shape that can be filled. */
  closed?: boolean;
  style: Style;
  /** An entrance animation. Absent means the element is there from the start. */
  animation?: Animation;
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
