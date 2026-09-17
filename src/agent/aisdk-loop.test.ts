import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
} from "@ai-sdk/provider";
import { runAgentViaAiSdk } from "./aisdk-loop.js";
import { parseModelSpec, PRICING, reasoningFor, resolveModel } from "./providers.js";
import { coordinateSurface, relationalSurface, documentSurface } from "../surfaces/index.js";
import { createFeedbackChannel, type FeedbackMode } from "../feedback/index.js";
import { getTask } from "../tasks/index.js";
import { defineTask } from "../tasks/types.js";
import { blank } from "../tasks/helpers.js";
import { containsText } from "../eval/checks.js";

const trivialTask = defineTask({
  id: "test.trivial-aisdk",
  title: "Trivial",
  family: "compose",
  brief: "Put the word Hello on the canvas somewhere sensible.",
  initial: () => blank({ width: 1000, height: 1000 }),
  checks: [containsText(["Hello"])],
  judgeCriteria: ["Is the word visible?", "Is it placed sensibly?", "Is it legible?"],
  maxTurns: 5,
});

interface MockTurn {
  text?: string;
  tools?: { name: string; input: unknown }[];
  finish?: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other";
  throws?: Error;
}

interface MockHarness {
  model: MockLanguageModelV4;
  calls: LanguageModelV4CallOptions[];
}

function mockModel(script: MockTurn[]): MockHarness {
  const calls: LanguageModelV4CallOptions[] = [];
  let turn = 0;
  const model = new MockLanguageModelV4({
    provider: "mock",
    modelId: "mock-model",
    doGenerate: async (options): Promise<LanguageModelV4GenerateResult> => {
      calls.push(options);
      const spec = script[turn++] ?? { text: "Done." };
      if (spec.throws) throw spec.throws;

      const content: LanguageModelV4Content[] = [];
      if (spec.text) content.push({ type: "text", text: spec.text });
      for (const [i, call] of (spec.tools ?? []).entries()) {
        content.push({
          type: "tool-call",
          toolCallId: `call_${turn}_${i}`,
          toolName: call.name,
          input: JSON.stringify(call.input),
        });
      }
      return {
        content,
        finishReason: {
          unified: spec.finish ?? ((spec.tools?.length ?? 0) > 0 ? "tool-calls" : "stop"),
          raw: spec.finish ?? "stop",
        },
        usage: {
          inputTokens: { total: 120, noCache: 100, cacheRead: 20, cacheWrite: 0 },
          outputTokens: { total: 50, text: 50, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
  return { model, calls };
}

function run(mode: FeedbackMode, script: MockTurn[], surface = coordinateSurface) {
  const harness = mockModel(script);
  return {
    harness,
    result: runAgentViaAiSdk({
      runId: "aisdk-test",
      task: trivialTask,
      surface,
      feedback: createFeedbackChannel(mode, { screenshotWidth: 200 }),
      model: "mock:mock-model",
      languageModel: harness.model,
    }),
  };
}

/** Every file part reaching the model, across all message roles. */
function countImages(options: LanguageModelV4CallOptions): number {
  let n = 0;
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (obj.type === "file" || obj.type === "image") n++;
      Object.values(obj).forEach(walk);
    }
  };
  walk(options.prompt);
  return n;
}

function promptText(options: LanguageModelV4CallOptions): string {
  return JSON.stringify(options.prompt);
}

describe("provider resolution", () => {
  it("parses provider:model specs", () => {
    expect(parseModelSpec("anthropic:claude-opus-5")).toEqual({
      provider: "anthropic",
      modelId: "claude-opus-5",
    });
    expect(parseModelSpec("google:some-model-id").provider).toBe("google");
    // A model id containing a colon survives.
    expect(parseModelSpec("openai:gpt:weird").modelId).toBe("gpt:weird");
  });

  it("refuses a spec with no provider", () => {
    expect(() => parseModelSpec("claude-opus-5")).toThrow(/missing a provider/);
    expect(() => parseModelSpec(":model")).toThrow(/missing a provider/);
  });

  it("refuses an unknown provider and an empty model id", () => {
    expect(() => parseModelSpec("acme:thing")).toThrow(/Unknown provider/);
    expect(() => parseModelSpec("openai:")).toThrow(/empty model id/);
  });

  it("resolves a real provider model and carries its pricing", () => {
    const resolved = resolveModel("anthropic:claude-opus-5");
    expect(resolved.provider).toBe("anthropic");
    expect(resolved.pricing).toEqual(PRICING["anthropic:claude-opus-5"]);
  });

  it("still resolves an unpriced model, but says pricing is unknown", () => {
    const resolved = resolveModel("google:not-in-the-pricing-table");
    expect(resolved.model).toBeTruthy();
    expect(resolved.pricing).toBeNull();
  });

  it("maps effort onto the SDK's provider-neutral reasoning scale", () => {
    expect(reasoningFor("low")).toBe("low");
    expect(reasoningFor("high")).toBe("high");
    // `max` has no counterpart, so it saturates at the top of the shared scale.
    expect(reasoningFor("max")).toBe("xhigh");
    expect(reasoningFor("xhigh")).toBe("xhigh");
    expect(reasoningFor(null)).toBe("provider-default");
  });
});

describe("the AI SDK loop", () => {
  it("runs tools, commits them, and stops when the model stops calling them", async () => {
    const { result } = run("none", [
      {
        text: "Adding the text.",
        tools: [{ name: "create", input: { type: "text", text: "Hello", x: 100, y: 100, width: 400, height: 80 } }],
      },
      { text: "Done." },
    ]);
    const r = await result;
    expect(r.stopReason).toBe("completed");
    expect(r.runner).toBe("aisdk");
    expect(r.finalDoc.elements).toHaveLength(1);
    expect(r.finalDoc.elements[0]!.text).toBe("Hello");
    expect(r.toolCalls).toBe(1);
    expect(r.failedToolCalls).toBe(0);
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
  });

  it("sends the same tool schemas the native loop does", async () => {
    const { harness, result } = run("none", [{ text: "done" }], relationalSurface);
    await result;
    const tools = harness.calls[0]!.tools ?? [];
    expect(tools.map((t) => t.name).sort()).toEqual(
      relationalSurface.tools.map((t) => t.name).sort(),
    );
    const place = tools.find((t) => t.name === "place")!;
    const schema = (place as { inputSchema: { properties?: Record<string, unknown> } }).inputSchema;
    expect(Object.keys(schema.properties ?? {})).toContain("relation");
    // The relational surface must never expose a raw coordinate.
    expect(Object.keys(schema.properties ?? {})).not.toContain("x");
  });

  it("asks for reasoning on the provider-neutral scale", async () => {
    const { harness, result } = run("none", [{ text: "done" }]);
    await result;
    expect(harness.calls[0]!.reasoning).toBe("high");
  });

  it("accumulates usage, splitting cached from uncached input", async () => {
    const { result } = run("none", [
      { tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }] },
      { text: "Done." },
    ]);
    const r = await result;
    // Two turns at noCache 100 / cacheRead 20 / output 50.
    expect(r.usage.input).toBe(200);
    expect(r.usage.cacheRead).toBe(40);
    expect(r.usage.output).toBe(100);
  });

  it("reports cost as unknown for a model with no pricing entry", async () => {
    const { result } = run("none", [{ text: "done" }]);
    const r = await result;
    expect(r.pricingKnown).toBe(false);
    expect(r.costUsd).toBe(0);
  });

  it("stops at the turn budget", async () => {
    const script = Array.from({ length: 20 }, () => ({
      tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }],
    }));
    const { result } = run("none", script);
    const r = await result;
    expect(r.stopReason).toBe("max_turns");
    expect(r.turns).toBe(trivialTask.maxTurns);
  });

  it("ends the run on a content filter without running that turn's tools", async () => {
    const { result } = run("none", [
      {
        finish: "content-filter",
        tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }],
      },
    ]);
    const r = await result;
    expect(r.stopReason).toBe("refusal");
    expect(r.toolCalls).toBe(0);
  });

  it("ends the run on truncation rather than running a half-written tool input", async () => {
    const { result } = run("none", [
      { finish: "length", tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }] },
    ]);
    const r = await result;
    expect(r.stopReason).toBe("max_tokens");
    expect(r.toolCalls).toBe(0);
  });

  it("reports a transport failure as a run outcome", async () => {
    const { result } = run("none", [{ throws: new Error("connection reset") }]);
    const r = await result;
    expect(r.stopReason).toBe("api_error");
    expect(r.error).toMatch(/connection reset/);
  });
});

describe("feedback wiring matches the native loop", () => {
  const script = [
    { tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }] },
    { text: "Done." },
  ];

  it("sends nothing under 'none'", async () => {
    const { harness, result } = run("none", script);
    await result;
    for (const call of harness.calls) expect(countImages(call)).toBe(0);
    expect(promptText(harness.calls.at(-1)!)).not.toContain("Current document:");
  });

  it("sends a description but no image under 'structured'", async () => {
    const { harness, result } = run("structured", script);
    await result;
    for (const call of harness.calls) expect(countImages(call)).toBe(0);
    expect(promptText(harness.calls.at(-1)!)).toContain("Current document:");
  });

  it("sends an image but no description under 'screenshot'", async () => {
    const { harness, result } = run("screenshot", script);
    await result;
    expect(countImages(harness.calls.at(-1)!)).toBeGreaterThan(0);
    expect(promptText(harness.calls.at(-1)!)).not.toContain("Current document:");
  });

  it("omits derived layout notes in the geometry-only variant", async () => {
    const { harness, result } = run("structured_plain", script);
    await result;
    const text = promptText(harness.calls.at(-1)!);
    expect(text).toContain("Current document:");
    expect(text).not.toContain("Layout notes:");
  });

  it("attaches feedback to the tool result, not a separate message", async () => {
    const { harness, result } = run("structured", script);
    await result;
    const prompt = harness.calls.at(-1)!.prompt as { role: string }[];
    expect(prompt.filter((m) => m.role === "tool")).toHaveLength(1);
    // No trailing bare user message; the feedback rode on the tool result.
    expect(prompt.at(-1)!.role).toBe("tool");
  });

  it("falls back to a user message when every call in a turn failed", async () => {
    const { harness, result } = run("structured", [
      { tools: [{ name: "move", input: { id: "ghost", x: 1, y: 1 } }] },
      { text: "Done." },
    ]);
    await result;
    const prompt = harness.calls.at(-1)!.prompt as { role: string }[];
    // An error-text output carries no content array, so feedback follows it.
    expect(prompt.at(-1)!.role).toBe("user");
    expect(promptText(harness.calls.at(-1)!)).toContain("Current document:");
  });

  it("marks a rejected call as an error, the way is_error does natively", async () => {
    const { harness, result } = run("none", [
      { tools: [{ name: "move", input: { id: "ghost", x: 1, y: 1 } }] },
      { text: "Done." },
    ]);
    await result;
    expect(promptText(harness.calls.at(-1)!)).toContain("error-text");
  });
});

describe("cross-loop parity", () => {
  it("gives every surface the same opening message as the native loop", async () => {
    const task = getTask("repair.overlapping-stack");
    const openings: string[] = [];
    for (const surface of [coordinateSurface, relationalSurface, documentSurface]) {
      const harness = mockModel([{ text: "Nothing to do." }]);
      await runAgentViaAiSdk({
        runId: "t",
        task,
        surface,
        feedback: createFeedbackChannel("none"),
        model: "mock:mock-model",
        languageModel: harness.model,
      });
      const prompt = harness.calls[0]!.prompt as { role: string; content: unknown }[];
      const user = prompt.find((m) => m.role === "user")!;
      openings.push(JSON.stringify(user.content));
    }
    expect(new Set(openings).size).toBe(1);
    expect(openings[0]).toContain("Quarterly Review");
  });

  it("reaches the same document as the native loop for the same tool calls", async () => {
    const task = getTask("arrange.ragged-column");
    const ids = ["r1", "r2", "r3", "r4", "r5"];
    const harness = mockModel([
      { tools: [{ name: "align", input: { ids, edge: "left" } }] },
      { tools: [{ name: "distribute", input: { ids, axis: "vertical", spacing: 30 } }] },
      { text: "Done." },
    ]);
    const viaAiSdk = await runAgentViaAiSdk({
      runId: "parity",
      task,
      surface: relationalSurface,
      feedback: createFeedbackChannel("none"),
      model: "mock:mock-model",
      languageModel: harness.model,
    });

    const { runAgent } = await import("./loop.js");
    const { createScriptedClient, fixedScript } = await import("./scripted.js");
    const native = await runAgent({
      runId: "parity",
      task,
      surface: relationalSurface,
      feedback: createFeedbackChannel("none"),
      model: "claude-opus-5",
      client: createScriptedClient(
        fixedScript([
          { tools: [{ name: "align", input: { ids, edge: "left" } }] },
          { tools: [{ name: "distribute", input: { ids, axis: "vertical", spacing: 30 } }] },
          { text: "Done." },
        ]),
      ),
    });

    expect(viaAiSdk.finalDoc).toEqual(native.finalDoc);
    expect(viaAiSdk.toolCalls).toBe(native.toolCalls);
    expect(viaAiSdk.stopReason).toBe(native.stopReason);
  });
});

describe("switching surface mid-session", () => {
  it("swaps the tool set and keeps the document", async () => {
    let surface = coordinateSurface;
    const harness = mockModel([
      { tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 100, height: 100 } }] },
      { tools: [{ name: "place", input: { id: "el_1", relation: "canvas_center" } }] },
      { text: "Done." },
    ]);
    const result = await runAgentViaAiSdk({
      runId: "switch",
      task: trivialTask,
      surface: coordinateSurface,
      surfaceProvider: () => surface,
      feedback: createFeedbackChannel("none"),
      model: "mock:mock-model",
      languageModel: harness.model,
      onEvent: (e) => {
        if (e.type === "tool_result" && e.tool === "create") surface = relationalSurface;
      },
    });

    expect(result.surfacesUsed).toEqual(["coordinate", "relational"]);
    expect(result.failedToolCalls).toBe(0);
    expect(result.finalDoc.elements[0]!.x).toBeCloseTo(450, 1);
    // The switch arrives as an operator instruction, not as user speech.
    const prompt = harness.calls.at(-1)!.prompt as { role: string }[];
    expect(prompt.some((m) => m.role === "system")).toBe(true);
  });
});
