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

export const TASK_FAMILIES = ["compose", "repair", "fit", "restyle", "arrange"] as const;
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
}

export function defineTask(task: Task): Task {
  return task;
}
