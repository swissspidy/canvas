import { describe, expect, it } from "vitest";
import { createModelContext, installWebMcpPolyfill, isPolyfilled } from "./polyfill.js";
import { registerSurfaceTools, type McpContent } from "./register.js";
import { DocSession } from "../doc/session.js";
import { coordinateSurface, relationalSurface, documentSurface } from "../surfaces/index.js";
import { createFeedbackChannel } from "../feedback/index.js";
import { getTask } from "../tasks/index.js";
import { scoreDocument } from "../eval/score.js";

function parse(raw: string): McpContent {
  return JSON.parse(raw) as McpContent;
}

function textOf(result: McpContent): string {
  return result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

describe("the polyfill", () => {
  it("registers, lists and executes", async () => {
    const context = createModelContext();
    await context.registerTool({
      name: "echo",
      description: "Echoes",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      execute: (input) => ({ content: [{ type: "text", text: String(input.text) }] }),
    });
    const tools = await context.getTools();
    expect(tools.map((t) => t.name)).toEqual(["echo"]);
    expect(parse(await context.executeTool(tools[0]!, { text: "hi" }))).toEqual({
      content: [{ type: "text", text: "hi" }],
    });
  });

  it("hands out a deep copy of the schema, so a caller cannot mutate the registration", async () => {
    const context = createModelContext();
    const schema = { type: "object", properties: { a: { type: "string" } } };
    await context.registerTool({ name: "t", description: "d", inputSchema: schema, execute: () => ({}) });
    const [listed] = await context.getTools();
    (listed!.inputSchema as { properties: Record<string, unknown> }).properties.a = "tampered";
    const [again] = await context.getTools();
    expect((again!.inputSchema as { properties: Record<string, unknown> }).properties.a).toEqual({ type: "string" });
  });

  it("unregisters on abort and fires toolchange", async () => {
    const context = createModelContext();
    const controller = new AbortController();
    let changes = 0;
    context.addEventListener("toolchange", () => changes++);
    await context.registerTool({ name: "t", description: "d", execute: () => ({}) }, { signal: controller.signal });
    expect(await context.getTools()).toHaveLength(1);
    controller.abort();
    expect(await context.getTools()).toHaveLength(0);
    expect(changes).toBe(2);
  });

  it("rejects an invalid tool name and an unknown execution", async () => {
    const context = createModelContext();
    await expect(context.registerTool({ name: "not a name", description: "d", execute: () => ({}) })).rejects.toThrow(
      /Invalid tool name/,
    );
    await expect(context.executeTool("nope")).rejects.toThrow(/No registered tool/);
  });

  it("does not replace a real implementation", () => {
    const fake = { modelContext: { real: true } };
    expect(installWebMcpPolyfill(fake as never)).toBe(false);
    expect(fake.modelContext).toEqual({ real: true });

    const empty: { modelContext?: unknown } = {};
    expect(installWebMcpPolyfill(empty as never)).toBe(true);
    expect(isPolyfilled(empty.modelContext)).toBe(true);
    expect(isPolyfilled({ real: true })).toBe(false);
  });
});

describe("registering a surface", () => {
  it("exposes every tool of the surface, with its JSON Schema", async () => {
    const context = createModelContext();
    const session = new DocSession(getTask("arrange.ragged-column").initial());
    const handle = await registerSurfaceTools(context, session, relationalSurface);

    const tools = await context.getTools();
    expect(tools.map((t) => t.name).sort()).toEqual(relationalSurface.tools.map((t) => t.name).sort());
    expect(handle.names).toEqual(relationalSurface.tools.map((t) => t.name));

    const place = tools.find((t) => t.name === "place")!;
    const schema = place.inputSchema as { properties: Record<string, unknown>; type: string };
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties)).toContain("relation");
    // The relational surface must not leak a raw coordinate over WebMCP either.
    expect(Object.keys(schema.properties)).not.toContain("x");
    expect(place.description.length).toBeGreaterThan(20);
  });

  it("marks only the read-only tool as read-only", async () => {
    const context = createModelContext();
    const session = new DocSession(getTask("arrange.ragged-column").initial());
    await registerSurfaceTools(context, session, documentSurface);
    const tools = await context.getTools();
    expect(tools.find((t) => t.name === "read_document")!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "write_document")!.annotations?.readOnlyHint).toBe(false);
  });

  it("changes the document through the shared mutation layer", async () => {
    const task = getTask("arrange.ragged-column");
    const context = createModelContext();
    const session = new DocSession(task.initial());
    await registerSurfaceTools(context, session, relationalSurface);
    const tools = await context.getTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    const ids = ["r1", "r2", "r3", "r4", "r5"];

    const before = scoreDocument(session.doc, task).score;
    await context.executeTool(byName.get("align")!, { ids, edge: "left" });
    await context.executeTool(byName.get("distribute")!, { ids, axis: "vertical", spacing: 30 });

    expect(new Set(session.doc.elements.map((e) => e.x)).size).toBe(1);
    expect(scoreDocument(session.doc, task).score).toBeGreaterThan(before);
    expect(session.actions).toHaveLength(2);
    expect(session.actions.every((a) => a.ok)).toBe(true);
  });

  it("reports a rejected call as an error, with the shared wording", async () => {
    const context = createModelContext();
    const session = new DocSession(getTask("arrange.ragged-column").initial());
    await registerSurfaceTools(context, session, coordinateSurface);
    const tools = await context.getTools();
    const move = tools.find((t) => t.name === "move")!;

    const result = parse(await context.executeTool(move, { id: "ghost", x: 1, y: 1 }));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No element with id 'ghost'/);
    expect(textOf(result)).toMatch(/Existing ids: r1, r2/);
    // Rejections are still recorded — that is the data.
    expect(session.failedActions).toBe(1);
  });

  it("rejects invalid arguments without touching the document", async () => {
    const context = createModelContext();
    const session = new DocSession(getTask("arrange.ragged-column").initial());
    await registerSurfaceTools(context, session, coordinateSurface);
    const tools = await context.getTools();
    const before = JSON.stringify(session.doc);

    const result = parse(await context.executeTool(tools.find((t) => t.name === "move")!, { id: "r1", x: "left" }));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Invalid arguments/);
    expect(JSON.stringify(session.doc)).toBe(before);
  });

  it("appends the feedback channel's description to each result", async () => {
    const context = createModelContext();
    const session = new DocSession(getTask("arrange.ragged-column").initial());
    await registerSurfaceTools(context, session, relationalSurface, {
      feedback: createFeedbackChannel("structured"),
    });
    const tools = await context.getTools();
    const result = parse(
      await context.executeTool(tools.find((t) => t.name === "align")!, { ids: ["r1", "r2"], edge: "left" }),
    );
    expect(textOf(result)).toContain("Current document:");
    expect(textOf(result)).toContain("Layout notes:");
  });

  it("sends nothing extra under the no-feedback condition", async () => {
    const context = createModelContext();
    const session = new DocSession(getTask("arrange.ragged-column").initial());
    await registerSurfaceTools(context, session, relationalSurface, {
      feedback: createFeedbackChannel("none"),
    });
    const tools = await context.getTools();
    const result = parse(
      await context.executeTool(tools.find((t) => t.name === "align")!, { ids: ["r1", "r2"], edge: "left" }),
    );
    expect(result.content).toHaveLength(1);
    expect(textOf(result)).not.toContain("Current document:");
  });

  it("emits an image part under a screenshot condition", async () => {
    const context = createModelContext();
    const session = new DocSession(getTask("arrange.ragged-column").initial());
    await registerSurfaceTools(context, session, relationalSurface, {
      feedback: createFeedbackChannel("screenshot", { screenshotWidth: 160 }),
    });
    const tools = await context.getTools();
    const result = parse(
      await context.executeTool(tools.find((t) => t.name === "align")!, { ids: ["r1", "r2"], edge: "left" }),
    );
    const image = result.content.find((c) => c.type === "image");
    expect(image).toBeDefined();
    expect((image as { mimeType: string }).mimeType).toBe("image/png");
  });

  it("never exposes the scorer as a tool", async () => {
    const context = createModelContext();
    const session = new DocSession(getTask("arrange.ragged-column").initial());
    for (const surface of [coordinateSurface, relationalSurface, documentSurface]) {
      await registerSurfaceTools(context, session, surface);
    }
    const names = (await context.getTools()).map((t) => t.name);
    for (const forbidden of ["score", "check", "evaluate", "grade", "run_checks"]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("notifies the host on every call, so the page can re-render", async () => {
    const context = createModelContext();
    const session = new DocSession(getTask("arrange.ragged-column").initial());
    const seen: { ok: boolean; tool: string }[] = [];
    await registerSurfaceTools(context, session, coordinateSurface, {
      onAction: (_doc, action) => seen.push({ ok: action.ok, tool: action.tool }),
    });
    const tools = await context.getTools();
    await context.executeTool(tools.find((t) => t.name === "move")!, { id: "r1", x: 10, y: 10 });
    await context.executeTool(tools.find((t) => t.name === "move")!, { id: "ghost", x: 10, y: 10 });
    expect(seen).toEqual([
      { ok: true, tool: "move" },
      { ok: false, tool: "move" },
    ]);
  });

  it("swaps surfaces by disposing one registration and adding another", async () => {
    const context = createModelContext();
    const session = new DocSession(getTask("arrange.ragged-column").initial());

    const first = await registerSurfaceTools(context, session, coordinateSurface);
    await context.executeTool({ name: "move" }, { id: "r1", x: 5, y: 5 });
    expect(session.doc.elements.find((e) => e.id === "r1")!.x).toBe(5);

    first.dispose();
    await registerSurfaceTools(context, session, relationalSurface);
    const names = (await context.getTools()).map((t) => t.name);
    expect(names).toContain("place");
    expect(names).not.toContain("move");

    // The document carried over across the switch.
    await context.executeTool({ name: "place" }, { id: "r1", relation: "canvas_center" });
    expect(session.doc.elements.find((e) => e.id === "r1")!.x).not.toBe(5);
    expect(session.actions).toHaveLength(2);
  });
});
