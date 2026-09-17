/**
 * End-to-end: an AI SDK agent drives the canvas over WebMCP.
 *
 * This is the whole integration in one script, and it asserts each link rather
 * than assuming it:
 *
 *   1. The page runs the bench in a browser and publishes the current
 *      surface's tools on `document.modelContext`.
 *   2. A driver in Node discovers those tools — schemas and all — the way any
 *      WebMCP harness would, including webmcp-evals' browser mode.
 *   3. The discovered schemas become AI SDK tools, so any provider the SDK
 *      supports can be pointed at them.
 *   4. Each tool call the model makes is executed *in the page*, through
 *      `document.modelContext.executeTool` — not against a Node-side copy.
 *   5. The page's own scorer reports the improvement, and the driver never
 *      exposes the scorer to the model.
 *
 * Runs with no API key by default, against the SDK's mock model, so it can sit
 * in CI. Pass `--model provider:model-id` to drive it with a real one.
 *
 *   npm run e2e:webmcp
 *   npm run e2e:webmcp -- --model anthropic:claude-opus-5
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { generateText, jsonSchema, stepCountIs, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { chromium } from "playwright-core";

const PORT = Number(process.env.E2E_PORT ?? 5310);
const BASE = `http://127.0.0.1:${PORT}`;
const TASK = "arrange.ragged-column";
const SURFACE = "relational";
const IDS = ["r1", "r2", "r3", "r4", "r5"];

const modelArg = process.argv.indexOf("--model");
const modelSpec = modelArg > -1 ? process.argv[modelArg + 1] : null;

const CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM_PATH,
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
].filter(Boolean);

const failures = [];
let checks = 0;

function check(label, condition, detail = "") {
  checks++;
  if (condition) {
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Kill the server's whole process group, not just its leader. */
function stopServer(server) {
  if (server.pid === undefined) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
}

function findChromium() {
  const found = CHROMIUM_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `No Chromium found. Set CHROMIUM_PATH, or install one of:\n  ${CHROMIUM_CANDIDATES.join("\n  ")}`,
    );
  }
  return found;
}

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/meta`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not start on ${BASE}`);
}

/**
 * A model that issues the calls a competent agent would for this task, so the
 * plumbing can be asserted without an API key or a sampled response.
 */
function scriptedModel() {
  const script = [
    [{ name: "align", input: { ids: IDS, edge: "left" } }],
    [{ name: "distribute", input: { ids: IDS, axis: "vertical", spacing: 30 } }],
    // A deliberately bad call: the error path has to survive the round trip too.
    [{ name: "place", input: { id: "r1", relation: "below" } }],
    [],
  ];
  let turn = 0;
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: "scripted",
    doGenerate: async () => {
      const calls = script[turn++] ?? [];
      return {
        content: calls.map((call, i) => ({
          type: "tool-call",
          toolCallId: `call_${turn}_${i}`,
          toolName: call.name,
          input: JSON.stringify(call.input),
        })),
        finishReason: { unified: calls.length ? "tool-calls" : "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 20, text: 20, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

async function main() {
  const executable = findChromium();
  console.log(`Chromium: ${executable}`);

  // The tsx binary directly rather than through npx: one fewer process to
  // reap, and `detached` puts the server in its own group so the whole tree
  // can be killed at the end. Without that the grandchild outlives the test
  // and holds the event loop open.
  const server = spawn(join("node_modules", ".bin", "tsx"), ["src/server/index.ts"], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

  const browser = await chromium.launch({ executablePath: executable });
  try {
    await waitForServer();
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await page.goto(`${BASE}/webmcp.html`, { waitUntil: "networkidle" });
    await page.evaluate(() => window.__canvasBench.ready);
    await page.evaluate(
      ([task, surface]) => window.__canvasBench.setTask(task).then(() => window.__canvasBench.setSurface(surface)),
      [TASK, SURFACE],
    );

    console.log("\n1. The page hosts the bench and publishes tools");
    const hosted = await page.evaluate(() => ({
      hasModelContext: typeof document.modelContext?.getTools === "function",
      state: window.__canvasBench.state(),
    }));
    check("document.modelContext exists", hosted.hasModelContext);
    check("the task loaded in the browser", hosted.state.taskId === TASK, hosted.state.taskId);
    check("the surface is registered", hosted.state.surfaceId === SURFACE, hosted.state.surfaceId);
    check("no page errors during boot", pageErrors.length === 0, pageErrors.join("; "));
    console.log(`       tools hosted by ${hosted.state.polyfilled ? "the bundled polyfill" : "native WebMCP"}`);

    console.log("\n2. A harness discovers the tools over WebMCP");
    // Straight off document.modelContext — no bench-specific handle involved,
    // which is exactly what an external harness has access to.
    const discovered = await page.evaluate(async () => {
      const tools = await document.modelContext.getTools();
      return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    });
    check("tools were discovered", discovered.length > 0, `${discovered.length} tools`);
    check(
      "every tool carries a JSON Schema",
      discovered.every((t) => t.inputSchema && t.inputSchema.type === "object"),
    );
    const place = discovered.find((t) => t.name === "place");
    check("the relational surface exposes `place`", Boolean(place));
    check(
      "the relational surface exposes no raw coordinate",
      place && !Object.keys(place.inputSchema.properties ?? {}).includes("x"),
      place ? Object.keys(place.inputSchema.properties ?? {}).join(", ") : "",
    );
    check(
      "the scorer is not reachable as a tool",
      !discovered.some((t) => /score|check|grade|evaluate/i.test(t.name)),
    );

    console.log("\n3. The discovered schemas become AI SDK tools");
    const toolSet = Object.fromEntries(
      discovered.map((t) => [t.name, tool({ description: t.description, inputSchema: jsonSchema(t.inputSchema) })]),
    );
    check("every discovered tool converted", Object.keys(toolSet).length === discovered.length);

    let model;
    if (modelSpec) {
      const { resolveModel } = await import("../src/agent/providers.js");
      model = resolveModel(modelSpec).model;
      console.log(`       driving with ${modelSpec}`);
    } else {
      model = scriptedModel();
      console.log("       driving with the SDK mock model (no API key needed)");
    }

    console.log("\n4. The model's calls execute inside the page");
    const brief = await page.evaluate((id) => window.__canvasBench.tasks.find((t) => t.id === id).brief, TASK);
    const messages = [{ role: "user", content: brief }];
    const executed = [];

    for (let turn = 1; turn <= 8; turn++) {
      const result = await generateText({
        model,
        system: "You lay out a document by calling the tools available to you. Stop when the brief is satisfied.",
        messages,
        tools: toolSet,
        stopWhen: stepCountIs(1),
      });
      if (result.toolCalls.length === 0) break;
      messages.push(...result.responseMessages);

      const outputs = [];
      for (const call of result.toolCalls) {
        // The real WebMCP round trip: the call crosses into the page and the
        // page's own session applies it.
        const raw = await page.evaluate(
          ([name, input]) => document.modelContext.executeTool({ name }, input),
          [call.toolName, call.input ?? {}],
        );
        const parsed = JSON.parse(raw);
        executed.push({ name: call.toolName, isError: Boolean(parsed.isError) });
        outputs.push({
          type: "tool-result",
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: parsed.isError
            ? { type: "error-text", value: parsed.content.map((c) => c.text ?? "").join("\n") }
            : { type: "content", value: parsed.content.filter((c) => c.type === "text") },
        });
      }
      messages.push({ role: "tool", content: outputs });
    }

    check("the model made tool calls", executed.length > 0, `${executed.length} calls`);
    check("at least one call succeeded", executed.some((e) => !e.isError));
    check(
      "a rejected call came back flagged as an error",
      executed.some((e) => e.isError),
      executed.map((e) => `${e.name}${e.isError ? "!" : ""}`).join(" "),
    );

    console.log("\n5. The page's own state and scorer reflect the work");
    const after = await page.evaluate(() => ({
      state: window.__canvasBench.state(),
      score: window.__canvasBench.score(),
    }));
    const xs = after.state.doc.elements.map((e) => e.x);
    check("the document in the page changed", after.state.actions.length === executed.length);
    check("the rows share one left edge", new Set(xs).size === 1, `x = ${[...new Set(xs)].join(", ")}`);
    check(
      "the page recorded the rejected call too",
      after.state.actions.filter((a) => !a.ok).length === executed.filter((e) => e.isError).length,
    );
    check(
      "the score improved over the task baseline",
      after.score.improvement > 0,
      `improvement ${(after.score.improvement * 100).toFixed(1)}% ` +
        `(score ${(after.score.constraintScore * 100).toFixed(1)}%, baseline ${(after.score.baseline * 100).toFixed(1)}%)`,
    );
    check("still no page errors", pageErrors.length === 0, pageErrors.join("; "));

    console.log("\n6. Switching surface re-registers the tools, keeping the document");
    await page.evaluate(() => window.__canvasBench.setSurface("coordinate"));
    const afterSwitch = await page.evaluate(async () => ({
      names: (await document.modelContext.getTools()).map((t) => t.name),
      elements: window.__canvasBench.state().doc.elements.length,
    }));
    check("coordinate tools are now registered", afterSwitch.names.includes("move"));
    check("relational tools are gone", !afterSwitch.names.includes("place"));
    check("the document survived the switch", afterSwitch.elements === after.state.doc.elements.length);

    const shot = process.env.E2E_SCREENSHOT;
    if (shot) {
      await page.evaluate(() => window.__canvasBench.setSurface("relational"));
      await page.screenshot({ path: shot, fullPage: false });
      console.log(`\nScreenshot: ${shot}`);
    }
  } finally {
    await browser.close();
    stopServer(server);
  }

  console.log(`\n${checks - failures.length}/${checks} checks passed.`);
  if (failures.length) console.error(`\nFailed:\n  ${failures.join("\n  ")}`);
  return failures.length === 0;
}

main().then(
  (passed) => process.exit(passed ? 0 : 1),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
