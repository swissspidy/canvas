/**
 * Task definitions.
 *
 * A task is a brief, a starting document, deterministic checks, and the
 * criteria the judge is asked about. The brief is the *only* thing the agent
 * sees of this — check definitions and judge criteria never reach it, or the
 * task degenerates into "satisfy this rubric" and stops telling you anything
 * about laying out a document.
 */

import type { Doc } from "../doc/types.js";
import type { Check } from "../eval/checks.js";

export const TASK_FAMILIES = ["compose", "repair", "fit", "restyle", "arrange", "measure", "paint"] as const;
export type TaskFamily = (typeof TASK_FAMILIES)[number];

export interface Task {
  id: string;
  title: string;
  family: TaskFamily;
  /** Exactly what the agent is asked to do. */
  brief: string;
  /** The document the agent starts from. Built fresh per run. */
  initial(): Doc;
  /** Task-specific checks. The universal ones are added automatically. */
  checks: Check[];
  /**
   * What the judge assesses, one criterion per line. Kept to things the
   * deterministic checks cannot see — whether the result reads as a poster,
   * whether the hierarchy makes sense — so the two scores stay independent.
   */
  judgeCriteria: string[];
  /** Turn budget. Generous by default; exceeding it ends the run as incomplete. */
  maxTurns: number;
  /**
   * The task animates, so each surface gets its animation tool
   * (`withMotion`). Unset everywhere else, so a task that never animates sends
   * exactly the tool list it always has.
   */
  motion?: boolean;
  /**
   * The task draws, so each surface gets its drawing tools and the note that
   * explains a path (`withPaint`). Unset everywhere else, for the same reason.
   */
  paint?: boolean;
  /**
   * Further instructions, each handed over when the agent signs off the one
   * before, in the same conversation: an editing session rather than one
   * brief. The checks score the page after the last round. Absent means the
   * task is the brief alone.
   */
  rounds?: string[];
}

/**
 * Everything the task asks for, for whoever judges the result: the brief and,
 * for a task delivered in rounds, every later instruction after it. The agent
 * still receives the rounds one at a time; a judge, a human rater or a pairwise
 * comparison shown only the first would fault a page for edits it was asked
 * for later.
 */
export function fullBrief(task: Pick<Task, "brief" | "rounds">): string {
  if (!task.rounds?.length) return task.brief;
  const total = task.rounds.length + 1;
  return [
    `${task.brief}\n\n(This was round 1 of ${total}. The later instructions, each given once the one before was done:)`,
    ...task.rounds.map((round, i) => `# Round ${i + 2} of ${total}\n\n${round}`),
  ].join("\n\n");
}

export function defineTask(task: Task): Task {
  return task;
}
