/**
 * The canonical mutation layer.
 *
 * Every tool surface funnels through these functions. That is the whole point:
 * if `align` and a hand-computed `move` can reach different document states,
 * the comparison measures the implementation, not the tool surface.
 *
 * All operations are pure — they return a new document. The session in
 * `session.ts` owns the version history.
 */

import type { Doc, Element, Style } from "./types.js";
import { normalizeElement, normalizeDoc } from "./schema.js";

/**
 * An error whose message goes back to the model verbatim as a tool error.
 * Wording is shared across surfaces so error quality is not a confound.
 */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "ToolError";
  }

  toModelString(): string {
    return this.hint ? `${this.message}\nHint: ${this.hint}` : this.message;
  }
}

export function getElement(doc: Doc, id: string): Element | undefined {
  return doc.elements.find((e) => e.id === id);
}

export function requireElement(doc: Doc, id: string): Element {
  const el = getElement(doc, id);
  if (!el) {
    const known = doc.elements.map((e) => e.id);
    throw new ToolError(
      `No element with id '${id}'.`,
      known.length ? `Existing ids: ${known.join(", ")}` : "The document is empty.",
    );
  }
  return el;
}

export function requireElements(doc: Doc, ids: string[]): Element[] {
  return ids.map((id) => requireElement(doc, id));
}

export function topZ(doc: Doc): number {
  return doc.elements.reduce((m, e) => Math.max(m, e.z), 0);
}

export function bottomZ(doc: Doc): number {
  return doc.elements.reduce((m, e) => Math.min(m, e.z), 0);
}

export function addElement(doc: Doc, el: Element): Doc {
  if (getElement(doc, el.id)) {
    throw new ToolError(`An element with id '${el.id}' already exists.`);
  }
  return normalizeDoc({ ...doc, elements: [...doc.elements, normalizeElement(el)] });
}

export type ElementPatch = Partial<Omit<Element, "id" | "type" | "style">> & {
  style?: Style;
};

/**
 * Patch an element. `style` merges key-by-key; passing `null` for a style key
 * clears it. Geometry keys replace outright.
 */
export function patchElement(doc: Doc, id: string, patch: ElementPatch): Doc {
  const el = requireElement(doc, id);
  const style: Style = { ...el.style };
  if (patch.style) {
    for (const [k, v] of Object.entries(patch.style)) {
      if (v === null || v === undefined) delete (style as Record<string, unknown>)[k];
      else (style as Record<string, unknown>)[k] = v;
    }
  }
  const next: Element = normalizeElement({ ...el, ...patch, style });
  return normalizeDoc({
    ...doc,
    elements: doc.elements.map((e) => (e.id === id ? next : e)),
  });
}

export function removeElement(doc: Doc, id: string): Doc {
  requireElement(doc, id);
  return { ...doc, elements: doc.elements.filter((e) => e.id !== id) };
}

/** Elements in paint order (bottom first), which is how `normalizeDoc` stores them. */
export function paintOrder(doc: Doc): Element[] {
  return doc.elements;
}

export function emptyDoc(width = 1080, height = 1350, background = "#ffffff"): Doc {
  return { width, height, background, elements: [] };
}

/**
 * Allocate the next `el_N` id. Takes the set of ids ever used in the session,
 * not just the live ones, so a delete-then-create cycle never reuses an id and
 * transcripts stay unambiguous.
 */
export function nextElementId(everUsed: Iterable<string>): string {
  const used = new Set(everUsed);
  let max = 0;
  for (const id of used) {
    const m = /^el_(\d+)$/.exec(id);
    if (!m) continue;
    const n = Number(m[1]);
    // A suffix past 2^53 does not round-trip through a double, so `n + 1` can
    // equal `n` and hand out an id that already exists. Such a suffix cannot
    // have come from this allocator anyway — ignore it rather than let it
    // poison the counter. `write_document` accepts arbitrary ids, so this is
    // reachable from a tool call, not only from a hand-written fixture.
    if (Number.isSafeInteger(n) && n < Number.MAX_SAFE_INTEGER) max = Math.max(max, n);
  }
  // Ids outside the `el_N` shape can still collide with the next number, so
  // step past anything already taken. Terminates: each step consumes one id
  // from a finite set.
  let candidate = max + 1;
  while (used.has(`el_${candidate}`)) candidate++;
  return `el_${candidate}`;
}
