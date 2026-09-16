/**
 * The task registry.
 *
 * Eighteen tasks across five families. Enough that a per-family breakdown has
 * something to say, few enough that a full sweep across surfaces, feedback
 * conditions, models and repeats stays affordable — the run matrix multiplies
 * fast, and `docs/PREREGISTRATION.md` sizes it.
 */

import type { Task, TaskFamily } from "./types.js";
import { composeTasks } from "./compose.js";
import { repairTasks } from "./repair.js";
import { fitTasks } from "./fit.js";
import { restyleTasks } from "./restyle.js";
import { arrangeTasks } from "./arrange.js";

export const TASKS: Task[] = [
  ...composeTasks,
  ...repairTasks,
  ...fitTasks,
  ...restyleTasks,
  ...arrangeTasks,
];

export const TASKS_BY_ID: Map<string, Task> = new Map(TASKS.map((t) => [t.id, t]));

export function getTask(id: string): Task {
  const task = TASKS_BY_ID.get(id);
  if (!task) {
    throw new Error(`Unknown task '${id}'. Known tasks:\n  ${TASKS.map((t) => t.id).join("\n  ")}`);
  }
  return task;
}

export function tasksInFamily(family: TaskFamily): Task[] {
  return TASKS.filter((t) => t.family === family);
}

/**
 * Resolve a selector into tasks: `all`, a family name, a task id, or a
 * comma-separated list of those.
 */
export function resolveTasks(selector: string): Task[] {
  const parts = selector
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.includes("all")) return [...TASKS];

  const out: Task[] = [];
  for (const part of parts) {
    const family = tasksInFamily(part as TaskFamily);
    if (family.length > 0) {
      out.push(...family);
      continue;
    }
    out.push(getTask(part));
  }
  return [...new Set(out)];
}

export * from "./types.js";
