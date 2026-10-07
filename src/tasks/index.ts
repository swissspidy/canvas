/**
 * The task registry.
 *
 * Twenty-seven tasks across six families. Enough that a per-family breakdown has
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
import { prototypeTasks } from "./prototype.js";
import { measureTasks } from "./measure.js";

export const TASKS: Task[] = [
  ...composeTasks,
  ...repairTasks,
  ...fitTasks,
  ...restyleTasks,
  ...arrangeTasks,
  ...measureTasks,
];

/**
 * Prototype tasks: resolvable by id, or all together as `proto`, and never
 * part of `TASKS` — so no default sweep, grid or registry test includes them.
 */
export const PROTOTYPE_TASKS: Task[] = [...prototypeTasks];

export const TASKS_BY_ID: Map<string, Task> = new Map([...TASKS, ...PROTOTYPE_TASKS].map((t) => [t.id, t]));

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
    if (part === "proto") {
      out.push(...prototypeTasks);
      continue;
    }
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
