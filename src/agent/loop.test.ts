import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { runAgent, thinkingBudget } from "./loop.js";
import { createScriptedClient, fixedScript } from "./scripted.js";
import { coordinateSurface, documentSurface, relationalSurface } from "../surfaces/index.js";
import { createFeedbackChannel, type FeedbackMode } from "../feedback/index.js";
import { getTask } from "../tasks/index.js";
import { defineTask } from "../tasks/types.js";
import { blank } from "../tasks/helpers.js";
import { containsText } from "../eval/checks.js";

const trivialTask = defineTask({
  id: "test.trivial",
  title: "Trivial",
  family: "compose",
  brief: "Put the word Hello on the canvas somewhere sensible.",
  initial: () => blank({ width: 1000, height: 1000 }),
  checks: [containsText(["Hello"])],
  judgeCriteria: ["Is the word visible?", "Is it placed sensibly?", "Is it legible?"],
  maxTurns: 5,
});

function blocksOf(message: Anthropic.MessageParam): Anthropic.ContentBlockParam[] {
  return Array.isArray(message.content) ? message.content : [];
}

/** Every image block anywhere in a request, including inside tool results. */
function countImages(params: Anthropic.MessageStreamParams): number {
  let n = 0;
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (obj.type === "image") n++;
      Object.values(obj).forEach(walk);
    }
  };
  walk(params.messages);
  return n;
}

function run(mode: FeedbackMode, turns: Parameters<typeof fixedScript>[0], surface = coordinateSurface) {
  const client = createScriptedClient(fixedScript(turns));
  return {
    client,
    result: runAgent({
      runId: "test",
      task: trivialTask,
      surface,
      feedback: createFeedbackChannel(mode, { screenshotWidth: 200 }),
      model: "claude-opus-5",
      client,
    }),
  };
}

describe("agent loop", () => {
  it("runs tools, commits them, and stops when the model stops calling them", async () => {
    const { result } = run("none", [
      { text: "Adding the text.", tools: [{ name: "create", input: { type: "text", text: "Hello", x: 100, y: 100, width: 400, height: 80 } }] },
      { text: "Done." },
    ]);
    const r = await result;
    expect(r.stopReason).toBe("completed");
    expect(r.finalDoc.elements).toHaveLength(1);
    expect(r.finalDoc.elements[0]!.text).toBe("Hello");
    expect(r.toolCalls).toBe(1);
    expect(r.failedToolCalls).toBe(0);
    expect(r.turns).toBe(2);
  });

  it("records failed tool calls without changing the document", async () => {
    const { result } = run("none", [
      { tools: [{ name: "move", input: { id: "nope", x: 0, y: 0 } }] },
      { text: "Giving up." },
    ]);
    const r = await result;
    expect(r.failedToolCalls).toBe(1);
    expect(r.toolUsage.move).toEqual({ ok: 0, failed: 1 });
    expect(r.finalDoc.elements).toHaveLength(0);
    // The failure is in the log, not swallowed.
    expect(r.session.actions[0]!.ok).toBe(false);
  });

  it("counts which tools the agent reached for", async () => {
    const { result } = run("none", [
      { tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }] },
      { tools: [{ name: "move", input: { id: "el_1", x: 5, y: 5 } }, { name: "resize", input: { id: "el_1", width: 20, height: 20 } }] },
      { text: "Done." },
    ]);
    const r = await result;
    expect(r.toolUsage).toEqual({ create: { ok: 1, failed: 0 }, move: { ok: 1, failed: 0 }, resize: { ok: 1, failed: 0 } });
    expect(r.toolCalls).toBe(3);
  });

  it("stops at the turn budget", async () => {
    const script = Array.from({ length: 20 }, () => ({
      tools: [{ name: "create" as const, input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }],
    }));
    const { result } = run("none", script);
    const r = await result;
    expect(r.stopReason).toBe("max_turns");
    expect(r.turns).toBe(trivialTask.maxTurns);
  });

  it("ends the run on a refusal without running that turn's tools", async () => {
    const { result } = run("none", [
      {
        stopReason: "refusal",
        tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }],
      },
    ]);
    const r = await result;
    expect(r.stopReason).toBe("refusal");
    expect(r.toolCalls).toBe(0);
    expect(r.finalDoc.elements).toHaveLength(0);
  });

  it("ends the run on truncation rather than running a half-written tool input", async () => {
    const { result } = run("none", [
      {
        stopReason: "max_tokens",
        tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }],
      },
    ]);
    const r = await result;
    expect(r.stopReason).toBe("max_tokens");
    expect(r.toolCalls).toBe(0);
  });

  it("reports an API failure as a run outcome", async () => {
    const { result } = run("none", [{ throws: new Error("connection reset") }]);
    const r = await result;
    expect(r.stopReason).toBe("api_error");
    expect(r.error).toMatch(/connection reset/);
  });

  it("accumulates usage and prices it", async () => {
    const { result } = run("none", [
      { tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }], usage: { input: 1000, output: 200 } },
      { text: "Done.", usage: { input: 1200, output: 80 } },
    ]);
    const r = await result;
    expect(r.usage.input).toBe(2200);
    expect(r.usage.output).toBe(280);
    // Opus 5: $5/MTok in, $25/MTok out.
    expect(r.costUsd).toBeCloseTo((2200 * 5 + 280 * 25) / 1e6, 9);
    expect(r.turnRecords).toHaveLength(2);
  });
});

describe("feedback channel wiring", () => {
  // The opening image is built in prompt.ts, the later ones in the feedback
  // channel. A condition whose first image is 768px and whose rest are 200px
  // is not one condition.
  it("renders every image in a run at the configured width", async () => {
    const { client, result } = run("both", [
      { tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }] },
      { text: "Done." },
    ]);
    await result;
    const pngs: Buffer[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== "object") return;
      const block = value as { type?: string; source?: { data?: string } };
      if (block.type === "image" && block.source?.data) pngs.push(Buffer.from(block.source.data, "base64"));
      for (const v of Object.values(value)) walk(v);
    };
    walk(client.requests.at(-1)!.messages);
    expect(pngs.length).toBeGreaterThan(1);
    // Bytes 16..20 of a PNG's IHDR hold the width.
    for (const png of pngs) expect(png.readUInt32BE(16)).toBe(200);
  });

  const script = [
    { tools: [{ name: "create" as const, input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }] },
    { text: "Done." },
  ];

  it("sends no images and no description under 'none'", async () => {
    const { client, result } = run("none", script);
    await result;
    for (const req of client.requests) expect(countImages(req)).toBe(0);
    const lastRequest = client.requests.at(-1)!;
    const text = JSON.stringify(lastRequest.messages);
    expect(text).not.toContain("Current document:");
  });

  it("sends a description but no image under 'structured'", async () => {
    const { client, result } = run("structured", script);
    await result;
    for (const req of client.requests) expect(countImages(req)).toBe(0);
    expect(JSON.stringify(client.requests.at(-1)!.messages)).toContain("Current document:");
  });

  it("sends an image but no description under 'screenshot'", async () => {
    const { client, result } = run("screenshot", script);
    await result;
    // One in the opening message, one after the first action.
    expect(countImages(client.requests.at(-1)!)).toBe(2);
    expect(JSON.stringify(client.requests.at(-1)!.messages)).not.toContain("Current document:");
  });

  it("sends both under 'both'", async () => {
    const { client, result } = run("both", script);
    await result;
    expect(countImages(client.requests.at(-1)!)).toBeGreaterThan(0);
    expect(JSON.stringify(client.requests.at(-1)!.messages)).toContain("Current document:");
  });

  it("omits derived layout notes in the geometry-only variant", async () => {
    const { client, result } = run("structured_plain", script);
    await result;
    const text = JSON.stringify(client.requests.at(-1)!.messages);
    expect(text).toContain("Current document:");
    expect(text).not.toContain("Layout notes:");
  });

  it("includes derived layout notes in the full structured variant", async () => {
    const { client, result } = run("structured", script);
    await result;
    expect(JSON.stringify(client.requests.at(-1)!.messages)).toContain("Layout notes:");
  });

  it("attaches feedback to the tool result rather than a separate message", async () => {
    const { client, result } = run("structured", script);
    await result;
    const messages = client.requests.at(-1)!.messages as Anthropic.MessageParam[];
    const toolResultMessages = messages.filter((m) =>
      blocksOf(m).some((b) => (b as { type?: string }).type === "tool_result"),
    );
    expect(toolResultMessages).toHaveLength(1);
    // No bare user message carrying feedback on its own.
    const bareUserTexts = messages.filter(
      (m, i) => i > 0 && m.role === "user" && blocksOf(m).every((b) => (b as { type?: string }).type === "text"),
    );
    expect(bareUserTexts).toHaveLength(0);
  });
});

describe("the opening message is the same for every condition except the screenshot", () => {
  it("gives every surface the exact starting document", async () => {
    const task = getTask("repair.overlapping-stack");
    for (const surface of [coordinateSurface, relationalSurface, documentSurface]) {
      const client = createScriptedClient(fixedScript([{ text: "Nothing to do." }]));
      await runAgent({
        runId: "t",
        task,
        surface,
        feedback: createFeedbackChannel("none"),
        model: "claude-opus-5",
        client,
      });
      const opening = blocksOf((client.requests[0]!.messages as Anthropic.MessageParam[])[0]!)
        .map((b) => ((b as { type?: string }).type === "text" ? (b as Anthropic.TextBlockParam).text : ""))
        .join("\n");
      expect(opening).toContain("Quarterly Review");
      // The raw JSON is there too, not just the prose description.
      expect(opening).toContain('"id": "headline"');
      expect(opening).toContain(task.brief.slice(0, 40));
    }
  });

  it("differs between surfaces only in the system prompt", async () => {
    const openings: string[] = [];
    for (const surface of [coordinateSurface, relationalSurface, documentSurface]) {
      const client = createScriptedClient(fixedScript([{ text: "done" }]));
      await runAgent({
        runId: "t",
        task: trivialTask,
        surface,
        feedback: createFeedbackChannel("none"),
        model: "claude-opus-5",
        client,
      });
      openings.push(JSON.stringify(client.requests[0]!.messages));
    }
    expect(new Set(openings).size).toBe(1);
  });
});

describe("model configuration", () => {
  it("uses adaptive thinking and an effort level for models that take one", async () => {
    const { client, result } = run("none", [{ text: "done" }]);
    await result;
    const req = client.requests[0]! as Record<string, unknown>;
    expect(req.thinking).toEqual({ type: "adaptive" });
    expect(req.output_config).toEqual({ effort: "high" });
  });

  it("falls back to a token budget on models without adaptive thinking", async () => {
    const client = createScriptedClient(fixedScript([{ text: "done" }]));
    await runAgent({
      runId: "t",
      task: trivialTask,
      surface: coordinateSurface,
      feedback: createFeedbackChannel("none"),
      model: "claude-haiku-4-5",
      client,
    });
    const req = client.requests[0]! as Record<string, unknown>;
    expect(req.thinking).toMatchObject({ type: "enabled" });
    expect(req.output_config).toBeUndefined();
  });

  it("caches the system prompt so a sweep does not pay for it every run", async () => {
    const { client, result } = run("none", [{ text: "done" }]);
    await result;
    const system = client.requests[0]!.system as { cache_control?: unknown }[];
    expect(system[0]!.cache_control).toEqual({ type: "ephemeral" });
  });

  it("does not declare tools strict, so malformed calls stay observable", async () => {
    const { client, result } = run("none", [{ text: "done" }]);
    await result;
    for (const tool of client.requests[0]!.tools ?? []) {
      expect((tool as { strict?: boolean }).strict).toBeUndefined();
    }
  });
});

describe("budgeted thinking", () => {
  // `budget_tokens` has to be >= 1024 and < max_tokens, so a small
  // --max-tokens has no valid budget at all and must not invent one.
  it("never asks for a budget the API would reject", () => {
    for (const maxTokens of [0, 1, 512, 1024, 1500, 2047]) {
      expect(thinkingBudget(maxTokens)).toEqual({ thinking: { type: "disabled" } });
    }
    expect(thinkingBudget(2048)).toEqual({ thinking: { type: "enabled", budget_tokens: 1024 } });
    expect(thinkingBudget(3000)).toEqual({ thinking: { type: "enabled", budget_tokens: 1976 } });
    expect(thinkingBudget(16_000)).toEqual({ thinking: { type: "enabled", budget_tokens: 4000 } });
  });
});

describe("switching surface mid-session", () => {
  it("swaps the tool list and keeps the document", async () => {
    let surface = coordinateSurface;
    const client = createScriptedClient(
      fixedScript([
        { tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 100, height: 100 } }] },
        // After the switch, a relational-only tool must work.
        { tools: [{ name: "place", input: { id: "el_1", relation: "canvas_center" } }] },
        { text: "Done." },
      ]),
    );
    const events: string[] = [];
    const result = await runAgent({
      runId: "switch",
      task: trivialTask,
      surface: coordinateSurface,
      surfaceProvider: () => surface,
      feedback: createFeedbackChannel("none"),
      model: "claude-opus-5",
      client,
      onEvent: (e) => {
        if (e.type === "tool_result" && e.tool === "create") surface = relationalSurface;
        if (e.type === "surface_switch") events.push(`${e.from}->${e.to}`);
      },
    });

    expect(events).toEqual(["coordinate->relational"]);
    expect(result.surfacesUsed).toEqual(["coordinate", "relational"]);
    expect(result.failedToolCalls).toBe(0);
    // The element survived the switch and was then centred relationally.
    expect(result.finalDoc.elements).toHaveLength(1);
    expect(result.finalDoc.elements[0]!.x).toBeCloseTo(450, 1);

    const toolNames = (client.requests.at(-1)!.tools ?? []).map((t) => (t as { name: string }).name);
    expect(toolNames).toContain("place");
    expect(toolNames).not.toContain("move");
  });

  // `messages` on the Messages API takes user and assistant roles only; a
  // system entry needs a beta, and means different things to different
  // providers on the AI SDK loop. The switch is the one thing this study puts
  // in front of every model, so it goes in as a user turn on every model.
  it.each(["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"])(
    "announces the switch as a labelled user turn on %s",
    async (model) => {
      let surface = coordinateSurface;
      const client = createScriptedClient(
        fixedScript([
          { tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }] },
          { text: "Done." },
        ]),
      );
      await runAgent({
        runId: "switch",
        task: trivialTask,
        surface: coordinateSurface,
        surfaceProvider: () => surface,
        feedback: createFeedbackChannel("none"),
        model,
        client,
        onEvent: (e) => {
          if (e.type === "tool_result") surface = relationalSurface;
        },
      });
      for (const request of client.requests) {
        const messages = request.messages as { role: string }[];
        expect(messages.every((m) => m.role === "user" || m.role === "assistant")).toBe(true);
      }
      const last = client.requests.at(-1)!.messages as { role: string }[];
      expect(JSON.stringify(last)).toContain("[operator notice] Your tools have been replaced");
    },
  );

  it("does nothing when the provider returns the same surface", async () => {
    const { client, result } = run("none", [{ text: "done" }]);
    await result;
    void client;
    const r = await runAgent({
      runId: "same",
      task: trivialTask,
      surface: coordinateSurface,
      surfaceProvider: () => coordinateSurface,
      feedback: createFeedbackChannel("none"),
      model: "claude-opus-5",
      client: createScriptedClient(fixedScript([{ text: "done" }])),
    });
    expect(r.surfacesUsed).toEqual(["coordinate"]);
  });
});

describe("transcripts", () => {
  it("elides base64 image payloads", async () => {
    const { result } = run("screenshot", [
      { tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }] },
      { text: "Done." },
    ]);
    const r = await result;
    const json = JSON.stringify(r.transcript);
    expect(json).toContain("base64 chars elided");
    // A 200px render is comfortably over 1KB of base64 if it leaked through.
    expect(json.length).toBeLessThan(200_000);
  });
});
