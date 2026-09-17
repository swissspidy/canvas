/**
 * The live page.
 *
 * Opens an SSE stream for a run and paints each `doc_update` into the canvas,
 * so what you watch is the same SVG the eval renders and the same one the
 * agent is shown under the screenshot conditions. Switching the surface while
 * a run is in flight POSTs to /api/switch; the loop picks the new surface up
 * at the start of its next turn and keeps the document.
 */

const $ = (id) => document.getElementById(id);

const el = {
  task: $("task"),
  brief: $("brief"),
  surface: $("surface"),
  surfaceTools: $("surface-tools"),
  switchHint: $("switch-hint"),
  feedback: $("feedback"),
  model: $("model"),
  run: $("run"),
  stop: $("stop"),
  status: $("status"),
  notice: $("notice"),
  canvas: $("canvas"),
  canvasChip: $("canvas-chip"),
  stats: $("stats"),
  log: $("log"),
  logChip: $("log-chip"),
  results: $("results"),
  resultsNote: $("results-note"),
  checks: $("checks"),
};

const state = {
  meta: null,
  surface: "coordinate",
  runId: null,
  stream: null,
  // Set when the server sends something that means the run is over. Without
  // it there is no way to tell a clean close from a dropped connection.
  terminal: false,
  actions: 0,
  usage: { turns: 0, cost: 0 },
};

function text(node, value) {
  node.textContent = value;
}

async function loadMeta() {
  const res = await fetch("/api/meta");
  state.meta = await res.json();

  el.task.append(new Option("Custom brief…", "custom"));
  for (const task of state.meta.tasks) {
    el.task.append(new Option(`${task.family} · ${task.title}`, task.id));
  }
  el.task.value = state.meta.tasks[0]?.id ?? "custom";
  onTaskChange();

  for (const f of state.meta.feedback) el.feedback.append(new Option(f.label, f.id));
  el.feedback.value = "both";

  for (const m of state.meta.models) el.model.append(new Option(m.label, m.id));
  el.model.value = state.meta.defaultModel;

  for (const s of state.meta.surfaces) {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "radio";
    button.dataset.surface = s.id;
    button.textContent = s.title;
    button.addEventListener("click", () => selectSurface(s.id));
    el.surface.append(button);
  }
  selectSurface("coordinate");

  if (!state.meta.hasCredentials) {
    el.notice.hidden = false;
    text(
      el.notice,
      "No API key configured, so the page runs a recorded replay instead of a model. " +
        "Set ANTHROPIC_API_KEY and restart to run for real.",
    );
  }
}

function onTaskChange() {
  const custom = el.task.value === "custom";
  el.brief.readOnly = !custom;
  const task = state.meta.tasks.find((t) => t.id === el.task.value);
  el.brief.value = custom ? el.brief.value : (task?.brief ?? "");
  if (custom && !el.brief.value) {
    el.brief.value =
      "Make a poster for a music festival called Ridgeline Festival, September 12-14, at Alpine Meadow, " +
      "Colorado. Use the photo/mountains asset. The title should dominate.";
  }
}

function selectSurface(id) {
  state.surface = id;
  for (const button of el.surface.querySelectorAll("button")) {
    button.setAttribute("aria-checked", String(button.dataset.surface === id));
  }
  const surface = state.meta.surfaces.find((s) => s.id === id);
  text(el.surfaceTools, surface ? `Tools: ${surface.tools.join(", ")}` : "");

  if (state.runId) {
    // Mid-run: tell the server, and let the log record the moment.
    fetch(`/api/switch?runId=${encodeURIComponent(state.runId)}&surface=${encodeURIComponent(id)}`, {
      method: "POST",
    }).catch(() => {});
  }
}

function addLog(className, buildContent) {
  const li = document.createElement("li");
  if (className) li.className = className;
  buildContent(li);
  el.log.append(li);
  el.log.parentElement.scrollTop = el.log.parentElement.scrollHeight;
  li.scrollIntoView({ block: "nearest" });
  return li;
}

function summarizeArgs(input) {
  const json = JSON.stringify(input ?? {});
  return json.length > 220 ? `${json.slice(0, 220)}…` : json;
}

function paint(svg) {
  el.canvas.innerHTML = svg;
}

function updateStats() {
  el.stats.hidden = false;
  el.stats.innerHTML = "";
  const entries = [
    ["turns", state.usage.turns],
    ["actions", state.actions],
    ["cost", `$${state.usage.cost.toFixed(4)}`],
  ];
  for (const [label, value] of entries) {
    const span = document.createElement("span");
    span.innerHTML = `${label} <b></b>`;
    span.querySelector("b").textContent = String(value);
    el.stats.append(span);
  }
}

function reset() {
  el.log.innerHTML = "";
  el.results.hidden = true;
  el.checks.innerHTML = "";
  el.stats.hidden = true;
  state.actions = 0;
  state.terminal = false;
  state.usage = { turns: 0, cost: 0 };
  text(el.logChip, "0 actions");
  el.canvas.innerHTML = '<p class="placeholder">Waiting for the first action…</p>';
}

function startRun() {
  reset();
  const params = new URLSearchParams({
    surface: state.surface,
    feedback: el.feedback.value,
    model: el.model.value,
  });
  if (el.task.value === "custom") params.set("brief", el.brief.value);
  else params.set("task", el.task.value);

  el.run.disabled = true;
  el.stop.hidden = false;
  el.switchHint.hidden = false;
  text(el.status, "connecting…");
  text(el.canvasChip, "running");

  const stream = new EventSource(`/api/run?${params}`);
  state.stream = stream;

  stream.addEventListener("message", (event) => handleEvent(JSON.parse(event.data)));
  stream.addEventListener("error", () => {
    // EventSource fires `error` for a clean server-side close *and* for a
    // dropped connection, and then reconnects on its own. Reconnecting here
    // would hit /api/run again and start a second run against a real API key,
    // so close either way — but only claim the run finished if the server
    // said so, rather than reporting a lost connection as a completed run.
    if (!state.terminal) {
      addLog("fail", (li) => {
        li.textContent = "Connection to the server was lost before the run finished.";
      });
      text(el.status, "error");
      text(el.canvasChip, "interrupted");
    }
    finish();
  });
}

function handleEvent(event) {
  switch (event.type) {
    case "hello":
      state.runId = event.runId;
      text(el.status, event.demo ? "replay" : "running");
      if (event.notice) {
        el.notice.hidden = false;
        text(el.notice, event.notice);
      }
      break;

    case "run_start":
      paint("");
      el.canvas.innerHTML = '<p class="placeholder">Waiting for the first action…</p>';
      break;

    case "turn_start":
      state.usage.turns = event.turn;
      text(el.status, `turn ${event.turn}`);
      updateStats();
      break;

    case "text":
      if (event.text.trim()) {
        addLog("say", (li) => {
          li.textContent = event.text.trim();
        });
      }
      break;

    case "surface_switch":
      addLog("switch", (li) => {
        li.textContent = `Tools switched: ${event.from} → ${event.to}. The document carries over.`;
      });
      break;

    case "tool_call":
      addLog("", (li) => {
        li.dataset.seq = String(event.seq);
        const name = document.createElement("span");
        name.className = "tool";
        name.textContent = event.tool;
        const args = document.createElement("code");
        args.className = "args";
        args.textContent = summarizeArgs(event.input);
        li.append(name, args);
      });
      break;

    case "tool_result": {
      state.actions += 1;
      text(el.logChip, `${state.actions} action${state.actions === 1 ? "" : "s"}`);
      const li = el.log.querySelector(`li[data-seq="${event.seq}"]`);
      if (li) {
        if (!event.ok) li.classList.add("fail");
        const msg = document.createElement("span");
        msg.className = "msg";
        msg.textContent = event.message;
        li.append(msg);
      }
      updateStats();
      break;
    }

    case "doc_update":
      paint(event.svg);
      break;

    case "run_end":
      state.usage.cost = event.costUsd ?? 0;
      text(el.canvasChip, event.reason === "completed" ? "finished" : event.reason.replace("_", " "));
      updateStats();
      break;

    case "scored":
      state.terminal = true;
      paint(event.svg);
      showChecks(event);
      break;

    case "error":
      if (event.fatal) state.terminal = true;
      addLog("fail", (li) => {
        li.textContent = event.message;
      });
      text(el.status, "error");
      break;

    default:
      break;
  }
}

function showChecks(event) {
  el.results.hidden = false;
  text(
    el.resultsNote,
    event.universalOnly
      ? "A typed brief has no task-specific checks, so only the universal ones ran: nothing covered, " +
          "nothing off-canvas, no clipped text, readable contrast. This is not a score for the brief."
      : `Constraint score ${(event.constraintScore * 100).toFixed(1)}% — the same checks the sweep uses.`,
  );

  for (const check of event.results) {
    const li = document.createElement("li");
    const score = document.createElement("span");
    score.className = `score ${check.passed ? "pass" : check.score > 0.6 ? "near" : "miss"}`;
    score.textContent = `${Math.round(check.score * 100)}%`;
    const body = document.createElement("span");
    const label = document.createElement("strong");
    label.textContent = check.label;
    const detail = document.createElement("span");
    detail.className = "detail";
    detail.textContent = check.detail;
    body.append(label, detail);
    li.append(score, body);
    el.checks.append(li);
  }
}

function finish() {
  if (state.stream) state.stream.close();
  state.stream = null;
  state.runId = null;
  el.run.disabled = false;
  el.stop.hidden = true;
  el.switchHint.hidden = true;
  if (el.status.textContent !== "error") text(el.status, "done");
}

el.task.addEventListener("change", onTaskChange);
el.run.addEventListener("click", startRun);
el.stop.addEventListener("click", () => {
  state.terminal = true;
  finish();
});

loadMeta().catch((err) => {
  el.notice.hidden = false;
  text(el.notice, `Could not load setup: ${err.message}`);
});
