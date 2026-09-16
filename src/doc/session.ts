/**
 * A single editing session: the current document, the action log, and id
 * allocation.
 *
 * Everything the agent does lands here as an `ActionRecord`, including the
 * failures. Failed calls are the interesting data — the whole hypothesis is
 * that one tool surface makes certain mistakes easy and another makes them
 * unrepresentable, and you cannot see that if rejected calls are dropped.
 */

import type { Doc } from "./types.js";
import { cloneDoc } from "./schema.js";
import { nextElementId } from "./ops.js";

export interface ActionRecord {
  seq: number;
  tool: string;
  input: unknown;
  ok: boolean;
  /** What the model was told, verbatim. */
  message: string;
  /** Element ids created, changed or removed. */
  touched: string[];
  /** The document after this action. Unchanged from the previous one if it failed. */
  doc: Doc;
  durationMs: number;
}

export class DocSession {
  private current: Doc;
  private readonly everUsed = new Set<string>();
  readonly actions: ActionRecord[] = [];
  readonly initial: Doc;

  constructor(initial: Doc) {
    this.initial = cloneDoc(initial);
    this.current = cloneDoc(initial);
    for (const el of initial.elements) this.everUsed.add(el.id);
  }

  get doc(): Doc {
    return this.current;
  }

  /** Ids that have ever existed in this session, so deletes never free an id. */
  get usedIds(): ReadonlySet<string> {
    return this.everUsed;
  }

  allocateId(): string {
    const id = nextElementId(this.everUsed);
    this.everUsed.add(id);
    return id;
  }

  /** Register an id the agent chose itself (the document-as-code surface). */
  registerId(id: string): void {
    this.everUsed.add(id);
  }

  commit(doc: Doc): void {
    this.current = doc;
    for (const el of doc.elements) this.everUsed.add(el.id);
  }

  record(entry: Omit<ActionRecord, "seq" | "doc">): ActionRecord {
    const record: ActionRecord = {
      ...entry,
      seq: this.actions.length + 1,
      doc: cloneDoc(this.current),
    };
    this.actions.push(record);
    return record;
  }

  get successfulActions(): number {
    return this.actions.filter((a) => a.ok).length;
  }

  get failedActions(): number {
    return this.actions.filter((a) => !a.ok).length;
  }
}
