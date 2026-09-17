/**
 * The live page's server.
 *
 * Streams a run's events over SSE as the agent works, and accepts a surface
 * switch mid-run. Deliberately small — no framework, no build step, no
 * bundler. The page is the shareable artifact, and a shareable artifact that
 * needs a toolchain to start does not get shared.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "../agent/loop.js";
import { createScriptedModel } from "../agent/scripted.js";
import { getSurface, isSurfaceId, SURFACES } from "../surfaces/index.js";
import type { SurfaceId } from "../surfaces/types.js";
import { createFeedbackChannel, FEEDBACK_MODES, feedbackLabel, type FeedbackMode } from "../feedback/index.js";
import {
  DEFAULT_MODEL,
  EXTRA_MODELS_ENV,
  MODELS,
  PROVIDER_ENV,
  credentialedProviders,
  hasCredentials,
  parseModelSpec,
} from "../agent/models.js";
import { TASKS, getTask } from "../tasks/index.js";
import { defineTask, type Task } from "../tasks/types.js";
import { blank } from "../tasks/helpers.js";
import { universalChecks } from "../eval/checks.js";
import { scoreDocument } from "../eval/score.js";
import { renderSvg } from "../render/svg.js";
import { FONT_DIR, FONT_FILES } from "../text/fonts.js";
import { demoPolicy, DEMO_NOTICE } from "./demo.js";
import type { AgentEvent } from "../agent/events.js";

const here = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(here, "..", "..", "web");

interface LiveRun {
  id: string;
  surface: SurfaceId;
  abort: AbortController;
}

const live = new Map<string, LiveRun>();

/**
 * Limits on what a caller can ask this server for.
 *
 * `/api/run` spends real money against whatever key the operator has in the
 * environment, so a page that anyone can point a loop at is a page that can
 * empty an account. The three guards below are the cheap ones: a canvas that
 * cannot be a hundred million pixels, a brief that cannot be a novel, and a
 * ceiling on how many runs can be in flight at once. Binding to loopback,
 * below, is the fourth.
 */
const MIN_CANVAS = 200;
const MAX_CANVAS = 4000;
const MAX_BRIEF = 4000;
const MAX_LIVE_RUNS = Number(process.env.CANVAS_MAX_LIVE_RUNS) || 2;

/**
 * A canvas dimension from a query string.
 *
 * `Number(x) || fallback` lets through a negative, a fraction and `Infinity`,
 * all of which reach the rasterizer as a pixel count.
 */
function canvasDimension(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Canvas dimensions must be numbers; got '${raw}'.`);
  const rounded = Math.round(n);
  if (rounded < MIN_CANVAS || rounded > MAX_CANVAS) {
    throw new Error(`Canvas dimensions must be between ${MIN_CANVAS} and ${MAX_CANVAS}; got ${rounded}.`);
  }
  return rounded;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function send(res: ServerResponse, status: number, body: string | Buffer, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value), "application/json; charset=utf-8");
}

/** Serve a file from a fixed directory, refusing anything that escapes it. */
function serveStatic(res: ServerResponse, baseDir: string, relative: string): boolean {
  const target = join(baseDir, normalize(relative).replace(/^(\.\.[/\\])+/, ""));
  if (!target.startsWith(baseDir) || !existsSync(target)) return false;
  send(res, 200, readFileSync(target), MIME[extname(target)] ?? "application/octet-stream");
  return true;
}

/**
 * A brief typed into the page becomes a task with the universal checks only.
 * There is no way to know what a stranger's brief should satisfy, so the page
 * reports "no broken constraints" rather than pretending to grade intent.
 */
function adHocTask(brief: string, canvas: { width: number; height: number }): Task {
  return defineTask({
    id: "adhoc",
    title: "Typed brief",
    family: "compose",
    brief,
    initial: () => blank({ width: canvas.width, height: canvas.height, background: "#ffffff" }),
    checks: [],
    judgeCriteria: ["Does the result match the brief?"],
    maxTurns: 30,
  });
}

function resolveTask(params: URLSearchParams): Task {
  const taskId = params.get("task");
  if (taskId && taskId !== "custom") return getTask(taskId);
  const brief = (params.get("brief") ?? "").trim();
  if (!brief) throw new Error("Pass either a known task id or a non-empty brief.");
  if (brief.length > MAX_BRIEF) throw new Error(`Briefs are limited to ${MAX_BRIEF} characters.`);
  return adHocTask(brief, {
    width: canvasDimension(params.get("width"), 1080),
    height: canvasDimension(params.get("height"), 1350),
  });
}

async function handleRun(req: IncomingMessage, res: ServerResponse, params: URLSearchParams): Promise<void> {
  let task: Task;
  try {
    task = resolveTask(params);
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    return;
  }

  const surfaceId = (params.get("surface") ?? "coordinate") as SurfaceId;
  const feedbackMode = (params.get("feedback") ?? "both") as FeedbackMode;
  const model = params.get("model") ?? DEFAULT_MODEL;
  const runId = `live_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  if (!FEEDBACK_MODES.includes(feedbackMode) || !isSurfaceId(surfaceId)) {
    sendJson(res, 400, { error: "Unknown surface or feedback mode." });
    return;
  }
  // Only the models this build knows about. A free-text model id would let a
  // caller point the operator's key at anything at all.
  if (!Object.hasOwn(MODELS, model)) {
    sendJson(res, 400, { error: `Unknown model '${model}'.` });
    return;
  }

  const demo = params.get("demo") === "1" || !isRunnable(model);

  // Replays cost nothing; a real run costs money per turn, so only those are
  // rationed.
  if (!demo && live.size >= MAX_LIVE_RUNS) {
    sendJson(res, 429, {
      error: `Already running ${live.size} run(s); this server allows ${MAX_LIVE_RUNS} at a time. Try again shortly.`,
    });
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  const write = (event: unknown): void => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const state: LiveRun = { id: runId, surface: surfaceId, abort: new AbortController() };
  live.set(runId, state);
  req.on("close", () => {
    state.abort.abort();
    live.delete(runId);
  });

  write({ type: "hello", runId, demo, notice: demo ? DEMO_NOTICE : null, surfaces: Object.keys(SURFACES) });

  try {
    const result = await runAgent({
      runId,
      task,
      surface: getSurface(surfaceId),
      surfaceProvider: () => getSurface(state.surface),
      feedback: createFeedbackChannel(feedbackMode),
      model,
      signal: state.abort.signal,
      ...(demo ? { languageModel: createScriptedModel(demoPolicy(() => state.surface)) } : {}),
      onEvent: (event: AgentEvent) => write(event),
    });

    const { score, results } = scoreDocument(result.finalDoc, task);
    write({
      type: "scored",
      constraintScore: score,
      // An ad-hoc brief has no task-specific checks, so only the universal
      // ones ran; say so rather than presenting a bare number.
      universalOnly: task.checks.length === 0,
      results: results.map((r) => ({ id: r.id, label: r.label, score: r.score, passed: r.passed, detail: r.detail })),
      svg: renderSvg(result.finalDoc),
      surfacesUsed: result.surfacesUsed,
      costUsd: result.costUsd,
      turns: result.turns,
      toolCalls: result.toolCalls,
      failedToolCalls: result.failedToolCalls,
    });
  } catch (err) {
    write({ type: "error", message: err instanceof Error ? err.message : String(err), fatal: true });
  } finally {
    live.delete(runId);
    if (!res.writableEnded) res.end();
  }
}

/** Whether a key is configured for the provider behind a model spec. */
function isRunnable(model: string): boolean {
  try {
    return hasCredentials(parseModelSpec(model).provider);
  } catch {
    return false;
  }
}

/** Whether anything on the page's model list can actually be driven. */
function anyRunnable(): boolean {
  return Object.keys(MODELS).some(isRunnable);
}

/**
 * What the page's model menu should start on.
 *
 * The usual default, unless it is a model this machine has no key for and
 * another listed model is runnable — opening the menu on a model that can
 * only replay, while a live one sits further down the list, reads as "no key
 * found" when the key is right there.
 */
function pageDefaultModel(): string {
  if (isRunnable(DEFAULT_MODEL)) return DEFAULT_MODEL;
  return Object.keys(MODELS).find(isRunnable) ?? DEFAULT_MODEL;
}

/**
 * Why the page cannot run live, in a form the operator can act on.
 *
 * Reason and remedy only — the console and the page each frame it their own
 * way — because two different situations reach replay mode and they need
 * different advice. No key at all is the ordinary one. A key for a provider
 * that no listed model names is the confusing one: the key works, nothing is
 * misconfigured, and the message still said "no provider API key found".
 */
function replayReason(): string {
  const configured = credentialedProviders();
  if (configured.length === 0) {
    const recognized = Object.entries(PROVIDER_ENV)
      .map(([provider, name]) => `${provider} (${name})`)
      .join(", ");
    return `No provider API key found. Recognized: ${recognized}.`;
  }
  return (
    `A key is set for ${configured.join(", ")}, but every model on this build's list belongs to ` +
    `another provider. Name one to use it — for example ` +
    `${EXTRA_MODELS_ENV}='${configured[0]}:<model-id>' — and restart.`
  );
}

function handleSwitch(res: ServerResponse, params: URLSearchParams): void {
  const runId = params.get("runId") ?? "";
  const surface = params.get("surface") as SurfaceId;
  const state = live.get(runId);
  if (!state) {
    sendJson(res, 404, { error: "No such live run. It may have already finished." });
    return;
  }
  if (!isSurfaceId(surface)) {
    sendJson(res, 400, { error: `Unknown surface '${surface}'.` });
    return;
  }
  state.surface = surface;
  sendJson(res, 200, { ok: true, surface });
}

export function createApp() {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    if (path === "/api/meta") {
      sendJson(res, 200, {
        hasCredentials: anyRunnable(),
        replayReason: anyRunnable() ? null : replayReason(),
        defaultModel: pageDefaultModel(),
        models: Object.values(MODELS).map((m) => ({ id: m.id, label: m.label })),
        surfaces: Object.values(SURFACES).map((s) => ({
          id: s.id,
          title: s.title,
          tools: s.tools.map((t) => t.name),
        })),
        feedback: FEEDBACK_MODES.map((m) => ({ id: m, label: feedbackLabel(m) })),
        tasks: TASKS.map((t) => ({ id: t.id, title: t.title, family: t.family, brief: t.brief })),
      });
      return;
    }

    if (path === "/api/run") {
      void handleRun(req, res, url.searchParams);
      return;
    }

    if (path === "/api/switch" && req.method === "POST") {
      handleSwitch(res, url.searchParams);
      return;
    }

    if (path.startsWith("/fonts/")) {
      const name = path.slice("/fonts/".length);
      if (Object.values(FONT_FILES).includes(name) && serveStatic(res, FONT_DIR, name)) return;
      send(res, 404, "Not found");
      return;
    }

    if (serveStatic(res, WEB_DIR, path === "/" ? "index.html" : path)) return;
    send(res, 404, "Not found");
  });
}

const port = Number(process.env.PORT) || 5173;

/**
 * Loopback by default.
 *
 * `/api/run` has no authentication and spends the operator's API key, so the
 * default has to be an address only this machine can reach. Exposing it is a
 * deliberate act: set `HOST`, and know what you are doing — put it behind
 * something that authenticates, or run it with no key so it stays in replay
 * mode.
 */
const host = process.env.HOST || "127.0.0.1";
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1]);

if (isMain) {
  createApp().listen(port, host, () => {
    console.log(`Canvas agent bench: http://${host === "0.0.0.0" || host === "::" ? "localhost" : host}:${port}`);
    if (!anyRunnable()) {
      console.log(`${replayReason()} The page will run in replay mode.`);
    } else if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
      console.log(
        `WARNING: listening on ${host} with an API key set. /api/run is unauthenticated — anyone who can ` +
          `reach this port can spend your credits. Put it behind a proxy that authenticates, or unset the key.`,
      );
    }
  });
}
