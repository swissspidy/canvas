/**
 * Runtime validation and normalization for documents and tool inputs.
 *
 * Zod is the single source of truth: the same schemas validate tool inputs at
 * runtime and generate the JSON Schemas sent to the model. Tool descriptions
 * live on `.describe()` calls so a surface's entire contract with the model is
 * readable in one place — the tool surface is the independent variable, so it
 * must not be spread across two hand-synced definitions.
 */

import { z } from "zod";
import { ELEMENT_TYPES, FONT_WEIGHTS, H_ALIGNS, OBJECT_FITS, V_ALIGNS } from "./types.js";
import type { Doc, Element } from "./types.js";
import { ASSET_KEYS } from "./assets.js";
import { round } from "./geometry.js";

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, or the keyword `transparent`. */
export const COLOR_RE = /^(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|transparent)$/;

/**
 * Bring a text payload to the one form the layout engine breaks lines on.
 *
 * Two repairs, both of things a model sends when it means "new line here":
 *
 * `\r\n` and a bare `\r` become `\n`, because a line ending is a line ending.
 *
 * The two characters backslash-n become one newline. Models write that
 * constantly — a tool description saying "\n is a hard line break" reads, once
 * the JSON is decoded, as an instruction to emit those two characters, and
 * models oblige by escaping the backslash. The result rendered as a visible
 * `\n` in the middle of a poster. Models clever enough to notice worked around
 * it by splitting the copy into two elements, which is worse: it turns a
 * wrapping decision the surfaces are being compared on into a layout the agent
 * has to place by hand.
 *
 * The cost is that a document cannot hold a literal backslash followed by an
 * `n`. On a task set of posters, flyers and quote cards, that is a trade worth
 * making, and it is the same trade on every surface — which is what matters
 * here, since the surfaces have to differ only in how elements get arranged.
 */
export function normalizeTextContent(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\\n/g, "\n");
}

/**
 * A text payload, normalized on the way in. Shared by every surface so a hard
 * line break means the same thing in `create`, `set_style` and a whole
 * document.
 */
export function zTextContent(maxLength: number, description: string) {
  return z.string().max(maxLength).transform(normalizeTextContent).describe(description);
}

/** What every surface tells the model about line breaks. Held identical. */
export const TEXT_FIELD_NOTE =
  "A newline in the string is a hard line break; otherwise the text wraps at the box width.";

/**
 * True for text that would paint nothing: absent, empty, or whitespace alone.
 *
 * `create` has always refused an empty string, on the grounds that a text
 * element with no content is a deleted element wearing a disguise. A space bar
 * is the same act, and `"   "` used to sail through — it laid out, it
 * validated, and it painted not one pixel. Whitespace has an advance width but
 * no outline, which is exactly why the checks now measure outlines.
 *
 * Unlike an invisible *rect*, this costs nothing to forbid. A transparent fill
 * is the only way to draw an unfilled box, and an element can pass through
 * invisible on its way to being styled — a rule against either would land on
 * the incremental surfaces and not on document-as-code, which is the one kind
 * of obstacle this project must not put in a surface's way. Blank copy is
 * neither: `create` demands the text up front, so there is no build-up state to
 * protect, and nothing is expressible only through a blank string.
 */
export function isBlankText(text: string | undefined): boolean {
  return text === undefined || text.trim() === "";
}

/**
 * The one wording for it, shared by every surface. Error quality is a real
 * lever on how well an agent recovers, so it is held constant rather than
 * left to whichever tool happened to raise it.
 */
export const BLANK_TEXT_MESSAGE =
  "A text element needs 'text' with something in it; whitespace alone paints nothing.";

export const zColor = z
  .string()
  .regex(COLOR_RE, "must be a hex color like #1a1a2e, or 'transparent'");

export const zStyle = z
  .strictObject({
    fill: zColor.optional().describe("Fill color. Background for rect and text elements."),
    color: zColor.optional().describe("Text color (text elements only)."),
    fontSize: z.number().min(4).max(400).optional().describe("Font size in canvas units."),
    fontWeight: z.enum(FONT_WEIGHTS).optional(),
    align: z.enum(H_ALIGNS).optional().describe("Horizontal alignment of text inside its box."),
    valign: z.enum(V_ALIGNS).optional().describe("Vertical alignment of the text block inside its box."),
    lineHeight: z.number().min(0.5).max(4).optional().describe("Line height as a multiple of fontSize. Default 1.25."),
    opacity: z.number().min(0).max(1).optional(),
    radius: z.number().min(0).max(2000).optional().describe("Corner radius for rect and image."),
    strokeColor: zColor.optional(),
    strokeWidth: z.number().min(0).max(200).optional(),
    padding: z.number().min(0).max(500).optional().describe("Inset between the element box and its text. Default 0."),
    objectFit: z.enum(OBJECT_FITS).optional().describe("How an image fills its box. Default 'cover'."),
  })
  .describe("Visual style. Every key is optional; omitted keys keep their defaults.");

/**
 * A style patch. Same keys as `zStyle`, but each accepts `null` to clear the
 * key back to its default — otherwise there is no way to remove a stroke once
 * it has been set, and the surfaces would differ in power for no good reason.
 */
export const zStylePatch = z.strictObject(
  Object.fromEntries(
    Object.entries(zStyle.shape).map(([key, value]) => [key, (value as z.ZodType).nullable()]),
  ) as { [K in keyof typeof zStyle.shape]: z.ZodNullable<(typeof zStyle.shape)[K]> },
);

export const zElement = z
  .strictObject({
    id: z.string().min(1).max(64).describe("Unique element id."),
    type: z.enum(ELEMENT_TYPES),
    x: z.number().describe("Left edge of the unrotated box."),
    y: z.number().describe("Top edge of the unrotated box."),
    width: z.number().min(1),
    height: z.number().min(1),
    rotation: z.number().min(-360).max(360).default(0).describe("Clockwise degrees about the box center."),
    z: z.number().int().describe("Paint order. Higher is nearer the viewer."),
    text: zTextContent(4000, `Text content (text elements). ${TEXT_FIELD_NOTE}`).optional(),
    src: z.string().optional().describe(`Asset key (image elements). One of: ${ASSET_KEYS.join(", ")}`),
    alt: z.string().max(300).optional(),
    style: zStyle.default({}),
  })
  .describe("A single absolutely-positioned element.");

export const zDoc = z
  .strictObject({
    width: z.number().min(16).max(8000),
    height: z.number().min(16).max(8000),
    background: zColor,
    elements: z.array(zElement),
  })
  .describe("The whole document.");

export type ParsedDoc = z.infer<typeof zDoc>;

export class DocValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = "DocValidationError";
  }
}

/** Flatten a ZodError into short, model-readable lines. */
export function formatIssues(err: z.ZodError): string[] {
  return err.issues.map((i) => {
    const path = i.path.length ? i.path.join(".") : "(root)";
    return `${path}: ${i.message}`;
  });
}

/**
 * Semantic rules that a JSON schema cannot express. Returned as plain strings
 * because they are fed straight back to the model as a tool error.
 */
export function semanticIssues(doc: Doc): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const el of doc.elements) {
    if (seen.has(el.id)) issues.push(`elements: duplicate id '${el.id}'`);
    seen.add(el.id);
    if (el.type === "text" && isBlankText(el.text)) {
      issues.push(`${el.id}: ${BLANK_TEXT_MESSAGE}`);
    }
    if (el.type === "image") {
      if (!el.src) issues.push(`${el.id}: image elements need 'src'`);
      else if (!ASSET_KEYS.includes(el.src)) {
        issues.push(`${el.id}: unknown asset '${el.src}'. Available: ${ASSET_KEYS.join(", ")}`);
      }
    }
    if (el.type !== "text" && el.text !== undefined) {
      issues.push(`${el.id}: only text elements may set 'text'`);
    }
    if (el.type !== "image" && el.src !== undefined) {
      issues.push(`${el.id}: only image elements may set 'src'`);
    }
  }
  return issues;
}

/** Round geometry so serialized docs are stable and diffable across runs. */
export function normalizeDoc(doc: Doc): Doc {
  return {
    width: round(doc.width),
    height: round(doc.height),
    background: doc.background,
    elements: doc.elements
      .map(normalizeElement)
      // Stable paint order: z ascending, original index as tiebreak.
      .map((el, i) => ({ el, i }))
      .sort((a, b) => a.el.z - b.el.z || a.i - b.i)
      .map(({ el }) => el),
  };
}

export function normalizeElement(el: Element): Element {
  const out: Element = {
    id: el.id,
    type: el.type,
    x: round(el.x),
    y: round(el.y),
    width: round(Math.max(1, el.width)),
    height: round(Math.max(1, el.height)),
    rotation: round(normalizeAngle(el.rotation ?? 0), 3),
    z: Math.round(el.z),
    style: { ...(el.style ?? {}) },
  };
  if (el.text !== undefined) out.text = el.text;
  if (el.src !== undefined) out.src = el.src;
  if (el.alt !== undefined) out.alt = el.alt;
  return out;
}

/** Map any angle into (-180, 180]. */
export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

/**
 * Parse an untrusted document (the document-as-code surface writes whole
 * documents). Throws `DocValidationError` with model-readable issues.
 */
export function parseDoc(input: unknown): Doc {
  const res = zDoc.safeParse(input);
  if (!res.success) {
    const issues = formatIssues(res.error);
    throw new DocValidationError(`Document failed validation (${issues.length} issue(s))`, issues);
  }
  const doc = normalizeDoc(res.data as Doc);
  const sem = semanticIssues(doc);
  if (sem.length) {
    throw new DocValidationError(`Document failed validation (${sem.length} issue(s))`, sem);
  }
  return doc;
}

/**
 * Convert a Zod object into a JSON Schema suitable for an Anthropic tool
 * definition: no `$schema` key, and `additionalProperties: false` throughout
 * so tools can be declared `strict: true`.
 */
export function toolInputSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export function cloneDoc(doc: Doc): Doc {
  return structuredClone(doc);
}
