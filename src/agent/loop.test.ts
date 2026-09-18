import { describe, expect, it } from "vitest";
import { runAgent } from "./loop.js";
import { createScriptedModel, fixedScript, type ScriptedTurn } from "./scripted.js";
import { coordinateSurface, documentSurface, relationalSurface } from "../surfaces/index.js";
import { createFeedbackChannel, type FeedbackMode } from "../feedback/index.js";
import { getTask } from "../tasks/index.js";
import { defineTask } from "../tasks/types.js";
import { blank } from "../tasks/helpers.js";
import { containsText } from "../eval/checks.js";
import { hasRasterizer, setRasterizer } from "../render/rasterizer.js";
import { rasterize } from "../render/raster.js";

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

const MODEL = "anthropic:claude-opus-5";

function run(mode: FeedbackMode, script: ScriptedTurn[], surface = coordinateSurface) {
  const model = createScriptedModel(fixedScript(script));
  return {
    model,
    result: runAgent({
      runId: "test",
      task: trivialTask,
      surface,
      feedback: createFeedbackChannel(mode, { screenshotWidth: 200 }),
      model: MODEL,
      languageModel: model,
    }),
  };
}

type Call = { prompt: unknown; tools?: { name: string }[]; reasoning?: unknown };
type Message = { role: string; content: unknown };

const messagesOf = (call: Call): Message[] => call.prompt as Message[];
const promptText = (call: Call): string => JSON.stringify(call.prompt);

/** Every file part reaching the model, across all message roles. */
function imageParts(call: Call): { data: unknown }[] {
  const found: { data: unknown }[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (obj.type === "file" || obj.type === "image") found.push(obj as { data: unknown });
      Object.values(obj).forEach(walk);
    }
  };
  walk(call.prompt);
  return found;
}

const countImages = (call: Call): number => imageParts(call).length;

/** The bytes behind a file part, whichever inline shape the SDK passed along. */
function partBytes(part: { data: unknown }): Buffer {
  const data = part.data;
  if (typeof data === "string") return Buffer.from(data, "base64");
  if (data instanceof Uint8Array) return Buffer.from(data);
  const tagged = (data as { data?: unknown }).data;
  if (typeof tagged === "string") return Buffer.from(tagged, "base64");
  if (tagged instanceof Uint8Array) return Buffer.from(tagged);
  throw new Error(`Unrecognised file part: ${JSON.stringify(data).slice(0, 80)}`);
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
      tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }],
    }));
    const { result } = run("none", script);
    const r = await result;
    expect(r.stopReason).toBe("max_turns");
    expect(r.turns).toBe(trivialTask.maxTurns);
  });

  it("ends the run on a refusal without running that turn's tools", async () => {
    const { result } = run("none", [
      {
        finish: "content-filter",
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

  /**
   * The opening message rasterizes the starting document under the screenshot
   * conditions, and it used to be built before the loop's own try block — so a
   * rasterizer that died on one document threw straight out of `runAgent`,
   * past every stop reason it is supposed to return. A sweep runs thousands of
   * these; a function whose whole contract is "returns a result saying how the
   * run ended" has to keep it when the failure is in its own first step.
   */
  it("reports a failure building the opening message as a run outcome", async () => {
    const model = createScriptedModel(fixedScript([{ text: "unreached" }]));
    // A rasterizer that dies on this document, which is the realistic shape of
    // the failure: the backend is registered, and one render blows up.
    const previous = hasRasterizer();
    setRasterizer(() => {
      throw new Error("resvg exploded");
    });
    const r = await runAgent({
      runId: "test",
      task: trivialTask,
      surface: coordinateSurface,
      feedback: createFeedbackChannel("screenshot", { screenshotWidth: 200 }),
      model: MODEL,
      languageModel: model,
    }).finally(() => setRasterizer(previous ? rasterize : null));
    expect(r.stopReason).toBe("api_error");
    expect(r.error).toMatch(/resvg exploded/);
    expect(r.turns).toBe(0);
    // Nothing was asked of the model, and the run still scores against the
    // document it never touched.
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(r.finalDoc).toEqual(r.initialDoc);
  });

  it("accumulates usage, splitting cached from uncached input, and prices it", async () => {
    const { result } = run("none", [
      {
        tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }],
        usage: { input: 1000, output: 200, cacheRead: 300 },
      },
      { text: "Done.", usage: { input: 1200, output: 80, cacheRead: 100 } },
    ]);
    const r = await result;
    expect(r.usage.input).toBe(2200);
    expect(r.usage.output).toBe(280);
    expect(r.usage.cacheRead).toBe(400);
    // Opus 5: $5/MTok in, $25/MTok out, cache reads at a tenth of the input rate.
    expect(r.costUsd).toBeCloseTo((2200 * 5 + 280 * 25 + 400 * 5 * 0.1) / 1e6, 9);
    expect(r.pricingKnown).toBe(true);
    expect(r.turnRecords).toHaveLength(2);
  });

  it("reports cost as unknown for a model with no pricing entry", async () => {
    const model = createScriptedModel(fixedScript([{ text: "done" }]));
    const r = await runAgent({
      runId: "unpriced",
      task: trivialTask,
      surface: coordinateSurface,
      feedback: createFeedbackChannel("none"),
      model: "openai:some-model-nobody-priced",
      languageModel: model,
    });
    expect(r.pricingKnown).toBe(false);
    expect(r.costUsd).toBe(0);
  });
});

describe("feedback channel wiring", () => {
  // The opening image is built in prompt.ts, the later ones in the feedback
  // channel. A condition whose first image is 768px and whose rest are 200px
  // is not one condition.
  it("renders every image in a run at the configured width", async () => {
    const { model, result } = run("both", [
      { tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }] },
      { text: "Done." },
    ]);
    await result;
    const parts = imageParts(model.doGenerateCalls.at(-1)!);
    expect(parts.length).toBeGreaterThan(1);
    // Bytes 16..20 of a PNG's IHDR hold the width.
    for (const part of parts) expect(partBytes(part).readUInt32BE(16)).toBe(200);
  });

  const script: ScriptedTurn[] = [
    { tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }] },
    { text: "Done." },
  ];

  it("sends no images and no description under 'none'", async () => {
    const { model, result } = run("none", script);
    await result;
    for (const call of model.doGenerateCalls) expect(countImages(call)).toBe(0);
    expect(promptText(model.doGenerateCalls.at(-1)!)).not.toContain("Current document:");
  });

  it("sends a description but no image under 'structured'", async () => {
    const { model, result } = run("structured", script);
    await result;
    for (const call of model.doGenerateCalls) expect(countImages(call)).toBe(0);
    expect(promptText(model.doGenerateCalls.at(-1)!)).toContain("Current document:");
  });

  it("sends an image but no description under 'screenshot'", async () => {
    const { model, result } = run("screenshot", script);
    await result;
    // One in the opening message, one after the first action.
    expect(countImages(model.doGenerateCalls.at(-1)!)).toBe(2);
    expect(promptText(model.doGenerateCalls.at(-1)!)).not.toContain("Current document:");
  });

  it("sends both under 'both'", async () => {
    const { model, result } = run("both", script);
    await result;
    expect(countImages(model.doGenerateCalls.at(-1)!)).toBeGreaterThan(0);
    expect(promptText(model.doGenerateCalls.at(-1)!)).toContain("Current document:");
  });

  it("omits derived layout notes in the geometry-only variant", async () => {
    const { model, result } = run("structured_plain", script);
    await result;
    const text = promptText(model.doGenerateCalls.at(-1)!);
    expect(text).toContain("Current document:");
    expect(text).not.toContain("Layout notes:");
  });

  it("includes derived layout notes in the full structured variant", async () => {
    const { model, result } = run("structured", script);
    await result;
    expect(promptText(model.doGenerateCalls.at(-1)!)).toContain("Layout notes:");
  });

  it("attaches feedback to the tool result rather than a separate message", async () => {
    const { model, result } = run("structured", script);
    await result;
    const messages = messagesOf(model.doGenerateCalls.at(-1)!);
    expect(messages.filter((m) => m.role === "tool")).toHaveLength(1);
    // No trailing bare user message; the feedback rode on the tool result.
    expect(messages.at(-1)!.role).toBe("tool");
  });

  it("falls back to a user message when every call in a turn failed", async () => {
    const { model, result } = run("structured", [
      { tools: [{ name: "move", input: { id: "ghost", x: 1, y: 1 } }] },
      { text: "Done." },
    ]);
    await result;
    const messages = messagesOf(model.doGenerateCalls.at(-1)!);
    // An error-text output carries no content array, so feedback follows it.
    expect(messages.at(-1)!.role).toBe("user");
    expect(promptText(model.doGenerateCalls.at(-1)!)).toContain("Current document:");
  });

  it("marks a rejected call as an error rather than as a result that says no", async () => {
    const { model, result } = run("none", [
      { tools: [{ name: "move", input: { id: "ghost", x: 1, y: 1 } }] },
      { text: "Done." },
    ]);
    await result;
    expect(promptText(model.doGenerateCalls.at(-1)!)).toContain("error-text");
  });
});

describe("the opening message is the same for every condition except the screenshot", () => {
  it("gives every surface the exact starting document", async () => {
    const task = getTask("repair.overlapping-stack");
    for (const surface of [coordinateSurface, relationalSurface, documentSurface]) {
      const model = createScriptedModel(fixedScript([{ text: "Nothing to do." }]));
      await runAgent({
        runId: "t",
        task,
        surface,
        feedback: createFeedbackChannel("none"),
        model: MODEL,
        languageModel: model,
      });
      const opening = JSON.stringify(messagesOf(model.doGenerateCalls[0]!).find((m) => m.role === "user")!.content);
      expect(opening).toContain("Quarterly Review");
      // The raw JSON is there too, not just the prose description.
      expect(opening).toContain('\\"id\\": \\"headline\\"');
      expect(opening).toContain(task.brief.slice(0, 40));
    }
  });

  it("differs between surfaces only in the instructions", async () => {
    const openings: string[] = [];
    for (const surface of [coordinateSurface, relationalSurface, documentSurface]) {
      const model = createScriptedModel(fixedScript([{ text: "done" }]));
      await runAgent({
        runId: "t",
        task: trivialTask,
        surface,
        feedback: createFeedbackChannel("none"),
        model: MODEL,
        languageModel: model,
      });
      const conversation = messagesOf(model.doGenerateCalls[0]!).filter((m) => m.role !== "system");
      openings.push(JSON.stringify(conversation));
    }
    expect(new Set(openings).size).toBe(1);
  });
});

describe("model configuration", () => {
  it("asks for reasoning on the provider-neutral scale", async () => {
    const { model, result } = run("none", [{ text: "done" }]);
    await result;
    expect(model.doGenerateCalls[0]!.reasoning).toBe("high");
  });

  // The tools and the surface briefing are identical for every run on a
  // surface, so a sweep should pay for that prefix once, not 648 times.
  it("marks the instructions cacheable", async () => {
    const { model, result } = run("none", [{ text: "done" }]);
    await result;
    const system = messagesOf(model.doGenerateCalls[0]!).find((m) => m.role === "system") as
      | { providerOptions?: { anthropic?: { cacheControl?: unknown } } }
      | undefined;
    expect(system?.providerOptions?.anthropic?.cacheControl).toEqual({ type: "ephemeral" });
  });

  it("sends every tool the surface declares, and nothing else", async () => {
    const { model, result } = run("none", [{ text: "done" }], relationalSurface);
    await result;
    const tools = model.doGenerateCalls[0]!.tools ?? [];
    expect(tools.map((t) => t.name).sort()).toEqual(relationalSurface.tools.map((t) => t.name).sort());
    const place = tools.find((t) => t.name === "place")!;
    const schema = (place as { inputSchema: { properties?: Record<string, unknown> } }).inputSchema;
    expect(Object.keys(schema.properties ?? {})).toContain("relation");
    // The relational surface must never expose a raw coordinate.
    expect(Object.keys(schema.properties ?? {})).not.toContain("x");
  });
});

describe("switching surface mid-session", () => {
  it("swaps the tool list and keeps the document", async () => {
    let surface = coordinateSurface;
    const model = createScriptedModel(
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
      model: MODEL,
      languageModel: model,
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

    const toolNames = (model.doGenerateCalls.at(-1)!.tools ?? []).map((t) => t.name);
    expect(toolNames).toContain("place");
    expect(toolNames).not.toContain("move");
  });

  // A mid-conversation system message is accepted, ignored or rejected
  // depending on the provider, and the switch is the one manipulation this
  // study performs in front of every model. It goes in as a user turn.
  it("announces the switch as a labelled user turn, not as a second system message", async () => {
    let surface = coordinateSurface;
    const model = createScriptedModel(
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
      model: MODEL,
      languageModel: model,
      onEvent: (e) => {
        if (e.type === "tool_result") surface = relationalSurface;
      },
    });
    for (const call of model.doGenerateCalls) {
      // Exactly one system message: the instructions.
      expect(messagesOf(call).filter((m) => m.role === "system")).toHaveLength(1);
    }
    const notice = messagesOf(model.doGenerateCalls.at(-1)!).find(
      (m) => m.role === "user" && JSON.stringify(m.content).includes("[operator notice]"),
    );
    expect(JSON.stringify(notice?.content)).toContain("Your tools have been replaced");
  });

  it("does nothing when the provider returns the same surface", async () => {
    const model = createScriptedModel(fixedScript([{ text: "done" }]));
    const r = await runAgent({
      runId: "same",
      task: trivialTask,
      surface: coordinateSurface,
      surfaceProvider: () => coordinateSurface,
      feedback: createFeedbackChannel("none"),
      model: MODEL,
      languageModel: model,
    });
    expect(r.surfacesUsed).toEqual(["coordinate"]);
  });
});

describe("transcripts", () => {
  // The saved transcript is the artifact a later read of a run works from, and
  // the model's own account of what it did is the first thing that read wants.
  it("keeps the model's closing message", async () => {
    const { result } = run("none", [
      { tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }] },
      { text: "Straightened the column and stopped." },
    ]);
    const r = await result;
    expect(JSON.stringify(r.transcript)).toContain("Straightened the column and stopped.");
  });

  // A turn cut off at the output limit is half-written by definition. Storing
  // it would make an abandoned turn read like a finished one.
  it("leaves a truncated turn's content out", async () => {
    const { result } = run("none", [
      {
        finish: "length",
        text: "I was halfway through saying",
        tools: [{ name: "create", input: { type: "rect", x: 0, y: 0, width: 10, height: 10 } }],
      },
    ]);
    const r = await result;
    expect(r.stopReason).toBe("max_tokens");
    expect(JSON.stringify(r.transcript)).not.toContain("I was halfway through saying");
  });

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
