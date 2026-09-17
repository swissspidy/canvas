/**
 * The WebMCP host page.
 *
 * Runs the whole bench in the browser — document model, tool surfaces,
 * renderer and scorer — and publishes the current surface's tools on
 * `document.modelContext`. Any agent that speaks WebMCP can then drive the
 * canvas without this repo's agent loop being involved at all.
 *
 * It exposes two different things to two different audiences, and the split is
 * the point:
 *
 *   `document.modelContext` — what the *agent* gets: the tools, and nothing
 *   else. No scorer, no task metadata, no rubric.
 *
 *   `window.__canvasBench`  — what a *harness* gets: switch task, surface and
 *   feedback condition, read the document, and score it. An agent driving the
 *   page over WebMCP cannot reach any of this.
 */

import { DocSession, type ActionRecord } from "../doc/session.js";
import { getSurface, SURFACES } from "../surfaces/index.js";
import type { SurfaceId } from "../surfaces/types.js";
import { availableFeedbackModes, createFeedbackChannel, type FeedbackMode } from "../feedback/index.js";
import { getTask, TASKS } from "../tasks/index.js";
import { renderSvg } from "../render/svg.js";
import { describeDoc } from "../render/describe.js";
import { scoreDocument, baselineFor, normalize } from "../eval/score.js";
import { registerFontBytes, FONT_FILES } from "../text/font-registry.js";
import { installBrowserRasterizer, rasterizeInBrowser } from "../render/browser-raster.js";
import { toBase64 } from "../render/rasterizer.js";
import { installWebMcpPolyfill, isPolyfilled } from "./polyfill.js";
import { registerSurfaceTools, type ModelContextLike, type RegisteredSurface } from "./register.js";
import type { Doc } from "../doc/types.js";

interface BenchState {
  taskId: string;
  surfaceId: SurfaceId;
  feedback: FeedbackMode;
  doc: Doc;
  actions: { seq: number; tool: string; ok: boolean; message: string }[];
  toolNames: string[];
  /** True when the tools are hosted by this repo's polyfill rather than a browser. */
  polyfilled: boolean;
}

interface ScoreReport {
  taskId: string;
  constraintScore: number;
  baseline: number;
  improvement: number;
  results: { id: string; label: string; score: number; passed: boolean; detail: string }[];
}

let session = new DocSession(TASKS[0]!.initial());
let taskId = TASKS[0]!.id;
let surfaceId: SurfaceId = "relational";
let feedbackMode: FeedbackMode = "structured";
let registration: RegisteredSurface | null = null;

const modelContext = (): ModelContextLike & {
  getTools(): Promise<{ name: string; description: string; inputSchema?: object }[]>;
  executeTool(tool: { name: string } | string, input?: object): Promise<string>;
} => {
  const context = (document as unknown as { modelContext?: unknown }).modelContext;
  if (!context) throw new Error("document.modelContext is unavailable and the polyfill failed to install.");
  return context as never;
};

const el = (id: string): HTMLElement => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node;
};

function render(): void {
  el("canvas").innerHTML = renderSvg(session.doc);
  el("tools").textContent = (registration?.names ?? []).join(", ");
  el("status").textContent =
    `${taskId} · ${surfaceId} · ${feedbackMode} · ${session.actions.length} action(s)` +
    (isPolyfilled(modelContext()) ? " · polyfill" : " · native WebMCP");

  const log = el("log");
  log.innerHTML = "";
  for (const action of session.actions.slice(-40)) {
    const li = document.createElement("li");
    if (!action.ok) li.className = "fail";
    const name = document.createElement("span");
    name.className = "tool";
    name.textContent = action.tool;
    const msg = document.createElement("span");
    msg.className = "msg";
    msg.textContent = action.message;
    li.append(name, msg);
    log.append(li);
  }
  log.scrollTop = log.scrollHeight;
}

function onAction(_doc: Doc, _action: ActionRecord): void {
  render();
}

async function applySurface(): Promise<void> {
  registration?.dispose();
  registration = await registerSurfaceTools(modelContext(), session, getSurface(surfaceId), {
    feedback: createFeedbackChannel(feedbackMode),
    onAction,
  });
  render();
}

async function loadTask(id: string): Promise<void> {
  taskId = id;
  session = new DocSession(getTask(id).initial());
  await applySurface();
}

function state(): BenchState {
  return {
    taskId,
    surfaceId,
    feedback: feedbackMode,
    doc: structuredClone(session.doc),
    actions: session.actions.map((a) => ({ seq: a.seq, tool: a.tool, ok: a.ok, message: a.message })),
    toolNames: registration?.names ?? [],
    polyfilled: isPolyfilled(modelContext()),
  };
}

function score(): ScoreReport {
  const task = getTask(taskId);
  const { score: constraintScore, results } = scoreDocument(session.doc, task);
  const baseline = baselineFor(task);
  return {
    taskId,
    constraintScore,
    baseline,
    improvement: normalize(constraintScore, baseline),
    results: results.map((r) => ({ id: r.id, label: r.label, score: r.score, passed: r.passed, detail: r.detail })),
  };
}

async function boot(): Promise<void> {
  // Metrics have to be registered before anything lays out text. The font is
  // fetched rather than read from disk — the only part of the stack that knew
  // about a filesystem, and the reason all of this runs in a browser at all.
  for (const weight of ["regular", "bold"] as const) {
    const response = await fetch(`/fonts/${FONT_FILES[weight]}`);
    if (!response.ok) throw new Error(`Could not load ${FONT_FILES[weight]}: ${response.status}`);
    registerFontBytes(weight, new Uint8Array(await response.arrayBuffer()));
  }

  // Must come before the feedback dropdown is built: it is what makes the
  // screenshot conditions available in a browser at all.
  installBrowserRasterizer();
  installWebMcpPolyfill();

  const taskSelect = el("task") as HTMLSelectElement;
  for (const task of TASKS) taskSelect.append(new Option(`${task.family} · ${task.title}`, task.id));
  taskSelect.value = taskId;
  taskSelect.addEventListener("change", () => void loadTask(taskSelect.value));

  const surfaceSelect = el("surface") as HTMLSelectElement;
  for (const surface of Object.values(SURFACES)) surfaceSelect.append(new Option(surface.title, surface.id));
  surfaceSelect.value = surfaceId;
  surfaceSelect.addEventListener("change", () => {
    surfaceId = surfaceSelect.value as SurfaceId;
    void applySurface();
  });

  const feedbackSelect = el("feedback") as HTMLSelectElement;
  for (const mode of availableFeedbackModes()) feedbackSelect.append(new Option(mode, mode));
  feedbackSelect.value = feedbackMode;
  feedbackSelect.addEventListener("change", () => {
    feedbackMode = feedbackSelect.value as FeedbackMode;
    void applySurface();
  });

  el("reset").addEventListener("click", () => void loadTask(taskId));
  el("describe").addEventListener("click", () => {
    el("description").textContent = describeDoc(session.doc);
  });
  el("score").addEventListener("click", () => {
    const report = score();
    el("description").textContent =
      `Constraint score ${(report.constraintScore * 100).toFixed(1)}% ` +
      `(baseline ${(report.baseline * 100).toFixed(1)}%, improvement ${(report.improvement * 100).toFixed(1)}%)\n\n` +
      report.results.map((r) => `${r.passed ? "ok  " : "FAIL"} ${(r.score * 100).toFixed(0).padStart(3)}%  ${r.label}\n      ${r.detail}`).join("\n");
  });

  await loadTask(taskId);
}

const ready = boot();

/** The harness-facing handle. Deliberately not reachable from a WebMCP tool. */
Object.defineProperty(window, "__canvasBench", {
  value: {
    ready,
    state,
    score,
    tasks: TASKS.map((t) => ({ id: t.id, family: t.family, title: t.title, brief: t.brief })),
    surfaces: Object.values(SURFACES).map((s) => ({ id: s.id, title: s.title })),
    feedbackModes: availableFeedbackModes(),
    async setTask(id: string) {
      await ready;
      (el("task") as HTMLSelectElement).value = id;
      await loadTask(id);
    },
    async setSurface(id: SurfaceId) {
      await ready;
      surfaceId = id;
      (el("surface") as HTMLSelectElement).value = id;
      await applySurface();
    },
    async setFeedback(mode: FeedbackMode) {
      await ready;
      feedbackMode = mode;
      (el("feedback") as HTMLSelectElement).value = mode;
      await applySurface();
    },
    async reset() {
      await ready;
      await loadTask(taskId);
    },
    async listTools() {
      await ready;
      return modelContext().getTools();
    },
    async callTool(name: string, input: object = {}) {
      await ready;
      return JSON.parse(await modelContext().executeTool({ name }, input)) as unknown;
    },
    svg: () => renderSvg(session.doc),
    /**
     * The rendered document as a base64 PNG, for a harness that wants the
     * image without going through a tool call. `embedFont: false` skips the
     * inlined face — only useful for checking that embedding does anything.
     */
    async png(opts: { pixelWidth?: number; embedFont?: boolean } = {}) {
      await ready;
      return toBase64(await rasterizeInBrowser(session.doc, opts));
    },
  },
  writable: false,
  enumerable: false,
});

ready.catch((err: unknown) => {
  el("status").textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
