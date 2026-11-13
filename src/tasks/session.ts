/**
 * Editing sessions: the same page, asked for in rounds.
 *
 * Every other task is one brief and one sitting. Real editing is a series of
 * notes on the same page, and that is where the surfaces' costs should part
 * most: every round re-reads the conversation so far, and document-as-code
 * rewrites the whole page for each note. A pass rate saturates; the bill for
 * a session does not.
 *
 * Each session is derived from an existing task and ends at the same page
 * under the same checks — only the delivery changes. So a session against its
 * single-brief twin, on the same surface and model, is the price of being
 * told in rounds, with everything else held.
 */

import type { Task } from "./types.js";
import { defineTask } from "./types.js";
import { CYCLE_SPEC, diagramTask, type DiagramSpec } from "./paint.js";
import { reviseTaskFor, type ReviseSpec } from "./paint-revise.js";

/** The revision's four numbered edits, one per round. */
function reviseSession(spec: ReviseSpec): Task {
  const base = reviseTaskFor(spec).task;
  const lines = base.brief.split("\n");
  const edits = lines.filter((l) => /^\d\. /.test(l)).map((l) => l.replace(/^\d\. /, ""));
  const intro = lines[0]!.replace("Revise it:", "You will revise it in a few rounds. First:");
  const rule = lines[lines.length - 1]!;
  if (edits.length < 2) throw new Error(`${spec.id}: no numbered edits to split into rounds`);
  return defineTask({
    ...base,
    id: `session.${spec.id.replace(/^paint\./, "")}`,
    title: `${base.title}, in rounds`,
    brief: [intro, "", edits[0]!, "", rule].join("\n"),
    rounds: edits.slice(1),
  });
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const say = (n: number) => NUMBER_WORDS[n] ?? String(n);

/** A diagram's arrows in `chunks` rounds: the brief draws the first batch, each round the next. */
function diagramSession(spec: DiagramSpec, chunks: number): Task {
  const base = diagramTask(spec);
  const lines = base.brief.split("\n");
  const arrowLines = lines.filter((l) => l.startsWith("- from "));
  const size = Math.ceil(arrowLines.length / chunks);
  const batches = Array.from({ length: chunks }, (_, i) => arrowLines.slice(i * size, (i + 1) * size)).filter((b) => b.length);
  const header = lines[0]!.replace(/Draw these [\w-]+ arrows:/, `You will add the arrows in a few rounds. First, draw these ${say(batches[0]!.length)}:`);
  const rules = lines
    .slice(lines.lastIndexOf("") + 1)
    .map((l) => l.replace(/add nothing but the [\w-]+ arrows\./, "add nothing but the arrows you are asked for."));
  return defineTask({
    ...base,
    id: `session.${spec.id.replace(/^paint\./, "")}`,
    title: `${base.title}, in rounds`,
    brief: [header, "", ...batches[0]!, "", ...rules].join("\n"),
    rounds: batches.slice(1).map((b) => [`Draw ${say(b.length)} more arrows, made exactly as before:`, "", ...b].join("\n")),
  });
}

/** Single-brief twin of each session, for the comparison the sessions exist for. */
export const SESSION_TWINS: Record<string, string> = {
  "session.revise-280": "paint.revise-280",
  "session.cycle": "paint.cycle",
};

export const sessionTasks: Task[] = [
  reviseSession({ id: "paint.revise-280", rays: 8, trees: 12, birds: 6, scenery: 210 }),
  diagramSession(CYCLE_SPEC, 3),
];
