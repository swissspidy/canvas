import { describe, expect, it } from "vitest";
import "../text/fonts.js";
import { DocSession } from "../doc/session.js";
import { executeToolCall } from "./execute.js";
import { coordinateSurface, documentSurface, relationalSurface, getSurface } from "./index.js";
import { withMotion } from "./motion.js";
import { getTask } from "../tasks/index.js";
import { PROTOTYPE_SOLUTIONS } from "../tasks/solutions.js";
import { normalizeDoc } from "../doc/schema.js";
import { animationEnd, frameAt, offscreenDistance, progressAt, sampleTimes } from "../doc/motion.js";
import type { ToolSurface } from "./types.js";
import type { Doc } from "../doc/types.js";

const task = getTask("anim.launch");
const solution = (): Doc => normalizeDoc(PROTOTYPE_SOLUTIONS["anim.launch"]!());

function play(surface: ToolSurface, calls: [string, unknown][]): Doc {
  const session = new DocSession(task.initial());
  for (const [name, input] of calls) {
    const r = executeToolCall(session, surface, name, input);
    expect(r.ok, `${name}: ${r.message}`).toBe(true);
  }
  return session.doc;
}

describe("frames", () => {
  const d = solution();

  it("interpolates linearly between the start state and rest", () => {
    const a = { effect: "fade" as const, delay: 100, duration: 200 };
    expect(progressAt(a, 0)).toBe(0);
    expect(progressAt(a, 200)).toBe(0.5);
    expect(progressAt(a, 400)).toBe(1);
  });

  it("starts a fly displaced and a fade invisible, and ends at the document as written", () => {
    const at0 = frameAt(d, 0);
    expect(at0.elements.find((e) => e.id === "headline")!.x).toBe(80 - 840);
    expect(at0.elements.find((e) => e.id === "f1")!.style.opacity).toBe(0);
    const halfway = frameAt(d, 300).elements.find((e) => e.id === "headline")!;
    expect(halfway.x).toBe(80 - 420);
    const rest = frameAt(d, animationEnd(d));
    expect(rest.elements.map(({ id, x, y, style }) => ({ id, x, y, style }))).toEqual(
      d.elements.map(({ id, x, y, style }) => ({ id, x, y, style })),
    );
    expect(rest.elements.every((e) => e.animation === undefined)).toBe(true);
  });

  it("samples every start and end, so a short animation between steps is never missed", () => {
    const times = sampleTimes(d, 500);
    for (const t of [0, 600, 750, 900, 1050, 1350, 1550, 2000]) expect(times).toContain(t);
  });

  it("works out the distance that starts an element just off the canvas", () => {
    const el = d.elements.find((e) => e.id === "cta")!;
    expect(offscreenDistance(d, el, "left")).toBe(540);
    expect(offscreenDistance(d, el, "right")).toBe(1000);
    expect(offscreenDistance(d, el, "top")).toBe(1220);
    expect(offscreenDistance(d, el, "bottom")).toBe(260);
  });
});

describe("animation tools reach the same page on every surface", () => {
  it("coordinate: every number given", () => {
    const fly = (id: string, from: string, distance: number, delay: number, duration: number) =>
      ["set_animation", { id, effect: "fly", from, distance, delay, duration }] as [string, unknown];
    const fade = (id: string, delay: number) => ["set_animation", { id, effect: "fade", delay, duration: 300 }] as [string, unknown];
    const doc = play(withMotion(coordinateSurface), [
      fly("headline", "left", 840, 0, 600),
      fade("f1", 600),
      fade("f2", 750),
      fade("f3", 900),
      fade("f4", 1050),
      fly("cta", "left", 540, 1550, 450),
      fly("cta_label", "left", 540, 1550, 450),
    ]);
    expect(doc).toEqual(solution());
  });

  it("relational: starts and distances said as relations", () => {
    const doc = play(withMotion(relationalSurface), [
      ["animate", { id: "headline", effect: "fly", from: "left", distance: "offscreen", start: { at: 0 }, duration: 600 }],
      ["animate", { id: "f1", effect: "fade", start: { after: "headline" }, duration: 300 }],
      ["animate", { id: "f2", effect: "fade", start: { with: "f1", offset: 150 }, duration: 300 }],
      ["animate", { id: "f3", effect: "fade", start: { with: "f2", offset: 150 }, duration: 300 }],
      ["animate", { id: "f4", effect: "fade", start: { with: "f3", offset: 150 }, duration: 300 }],
      ["animate", { id: "cta", effect: "fly", from: "left", distance: "offscreen", start: { after: "f4", gap: 200 }, duration: 450 }],
      ["animate", { id: "cta_label", effect: "fly", from: "left", distance: 540, start: { with: "cta" }, duration: 450 }],
    ]);
    expect(doc).toEqual(solution());
  });

  it("document-as-code: the animation field in the JSON", () => {
    const doc = play(documentSurface, [["write_document", { document: PROTOTYPE_SOLUTIONS["anim.launch"]!() }]]);
    expect(doc).toEqual(solution());
  });

  it("removes an animation on every incremental surface", () => {
    for (const [surface, name] of [[withMotion(coordinateSurface), "set_animation"], [withMotion(relationalSurface), "animate"]] as const) {
      const session = new DocSession(solution());
      const r = executeToolCall(session, surface, name, { id: "headline", effect: "none" });
      expect(r.ok, r.message).toBe(true);
      expect(session.doc.elements.find((e) => e.id === "headline")!.animation).toBeUndefined();
    }
  });
});

describe("animation errors say what is missing", () => {
  const cases: [ToolSurface, string, unknown, RegExp][] = [
    [withMotion(coordinateSurface), "set_animation", { id: "headline", effect: "fly", delay: 0, duration: 600 }, /needs from and distance/],
    [withMotion(coordinateSurface), "set_animation", { id: "f1", effect: "fade", delay: 0, duration: 300, from: "left" }, /Only a fly/],
    [withMotion(coordinateSurface), "set_animation", { id: "f1", effect: "fade" }, /needs both delay and duration/],
    [withMotion(relationalSurface), "animate", { id: "f1", effect: "fade", duration: 300 }, /needs both start and duration/],
    [withMotion(relationalSurface), "animate", { id: "f1", effect: "fade", start: { after: "nope" }, duration: 300 }, /nope/],
    [documentSurface, "write_document", { document: { ...task.initial(), elements: task.initial().elements.map((e) => (e.id === "f1" ? { ...e, animation: { effect: "fly", delay: 0, duration: 1 } } : e)) } }, /needs from and distance/],
  ];
  it.each(cases.map((c, i) => [i, ...c] as const))("case %i", (_i, surface, name, input, message) => {
    const r = executeToolCall(new DocSession(task.initial()), surface, name, input);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(message);
  });
});

describe("animation tools are attached only where a task animates", () => {
  it("leaves every surface's own tool list alone", () => {
    for (const s of [coordinateSurface, relationalSurface, documentSurface]) {
      expect(s.tools.map((t) => t.name)).not.toContain("set_animation");
      expect(s.tools.map((t) => t.name)).not.toContain("animate");
    }
  });

  it("gives each surface the tool its vocabulary calls for", () => {
    expect(withMotion(coordinateSurface).tools.map((t) => t.name)).toContain("set_animation");
    expect(withMotion(relationalSurface).tools.map((t) => t.name)).toContain("animate");
    expect(withMotion(getSurface("hybrid")).tools.map((t) => t.name)).toEqual(expect.arrayContaining(["set_animation", "animate"]));
    expect(withMotion(documentSurface)).toBe(documentSurface);
  });
});
