import { describe, expect, it } from "vitest";
import { demoPolicy } from "./demo.js";
import { runAgent } from "../agent/loop.js";
import { createScriptedModel } from "../agent/scripted.js";
import { getSurface } from "../surfaces/index.js";
import { createFeedbackChannel } from "../feedback/index.js";
import { defineTask } from "../tasks/types.js";
import { blank } from "../tasks/helpers.js";
import { containsText } from "../eval/checks.js";
import type { SurfaceId } from "../surfaces/types.js";
import type { Doc } from "../doc/types.js";
import { request } from "node:http";
import { createApp } from "./index.js";

const poster = defineTask({
  id: "demo.poster",
  title: "Poster",
  family: "compose",
  brief: "Make a festival poster.",
  initial: () => blank({ width: 1080, height: 1350, background: "#101020" }),
  checks: [containsText(["Ridgeline Festival"])],
  judgeCriteria: ["Is it a poster?"],
  maxTurns: 12,
});

/** Run the replay, optionally switching surface after `switchAfter` turns. */
async function replay(from: SurfaceId, to?: SurfaceId, switchAfter = 2): Promise<Doc> {
  let surface = from;
  let turns = 0;
  const result = await runAgent({
    runId: "demo",
    task: poster,
    surface: getSurface(from),
    surfaceProvider: () => getSurface(surface),
    feedback: createFeedbackChannel("none"),
    model: "anthropic:claude-opus-5",
    languageModel: createScriptedModel(demoPolicy(() => surface)),
    onEvent: (e) => {
      if (e.type !== "turn_start") return;
      turns++;
      if (to && turns === switchAfter) surface = to;
    },
  });
  return result.finalDoc;
}

const COPY = ["Ridgeline Festival", "September 12-14", "Tickets at ridgeline.fm"];

function copyIn(doc: Doc): string {
  return doc.elements
    .filter((el) => el.type === "text")
    .map((el) => el.text ?? "")
    .join(" | ");
}

describe("the replay builds the same layout on every surface", () => {
  it.each(["coordinate", "relational", "document", "hybrid"] as SurfaceId[])("on %s", async (surface) => {
    const doc = await replay(surface);
    expect(doc.elements).toHaveLength(5);
    for (const phrase of COPY) expect(copyIn(doc)).toContain(phrase);
  });
});

/**
 * Indexing the new surface's script by the *global* turn number skipped its
 * opening steps — switching to `document` on turn 3 played a turn that does
 * not exist and the layout was never built — or replayed steps already done,
 * creating the elements twice.
 */
describe("a mid-run surface switch still finishes the layout", () => {
  const surfaces: SurfaceId[] = ["coordinate", "relational", "document"];

  it.each(surfaces.flatMap((from) => surfaces.filter((to) => to !== from).map((to) => [from, to])))(
    "%s -> %s",
    async (from, to) => {
      for (const switchAfter of [1, 2, 3, 4]) {
        const doc = await replay(from!, to!, switchAfter);
        const copy = copyIn(doc);
        for (const phrase of COPY) expect(copy, `${from}->${to} at turn ${switchAfter}`).toContain(phrase);
        // No stage runs twice, whichever vocabulary finishes it.
        expect(doc.elements, `${from}->${to} at turn ${switchAfter}`).toHaveLength(5);
      }
    },
  );
});

describe("the live page's request guards", () => {
  async function get(app: ReturnType<typeof createApp>, path: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const server = app.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as { port: number };
        request({ host: "127.0.0.1", port, path }, (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            server.close();
            resolve({ status: res.statusCode ?? 0, body });
          });
        })
          .on("error", (err) => {
            server.close();
            reject(err);
          })
          .end();
      });
    });
  }

  // `Number(x) || fallback` let a negative, a fraction and Infinity through to
  // the rasterizer as a pixel count.
  it.each(["-500", "0", "1e9", "Infinity", "NaN", "abc", "1.0e400"])(
    "refuses %s as a canvas width",
    async (width) => {
      const app = createApp();
      const { status, body } = await get(app, `/api/run?brief=hello&width=${encodeURIComponent(width)}`);
      expect(status).toBe(400);
      expect(body).toMatch(/Canvas dimensions/);
    },
  );

  it("accepts a sane canvas", async () => {
    const app = createApp();
    const { status } = await get(app, "/api/run?brief=hello&width=1080&height=1350&demo=1");
    expect(status).toBe(200);
  });

  // /api/run spends whatever key the operator has in the environment, so the
  // models it accepts are the page's own list and nothing else.
  it.each(["claude-opus-5", "anthropic:something-enormous", "__proto__"])(
    "refuses %s as a model",
    async (model) => {
      const app = createApp();
      const { status, body } = await get(app, `/api/run?brief=hello&model=${encodeURIComponent(model)}`);
      expect(status).toBe(400);
      expect(body).toMatch(/Unknown model/);
    },
  );

  // `in` and plain indexing both walk the prototype chain.
  it.each(["toString", "__proto__", "constructor"])("refuses %s as a surface", async (surface) => {
    const app = createApp();
    const { status, body } = await get(app, `/api/run?brief=hello&surface=${encodeURIComponent(surface)}`);
    expect(status).toBe(400);
    expect(body).toMatch(/Unknown surface/);
  });
});
