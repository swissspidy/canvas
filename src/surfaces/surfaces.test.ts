import { describe, expect, it } from "vitest";
import { DocSession } from "../doc/session.js";
import { executeToolCall } from "./execute.js";
import { coordinateSurface } from "./coordinate.js";
import { relationalSurface } from "./relational.js";
import { documentSurface } from "./document.js";
import { getSurface, SURFACES } from "./index.js";
import { emptyDoc } from "../doc/ops.js";
import { aabb, overlapArea } from "../doc/geometry.js";
import { layoutTextElement } from "../text/layout.js";
import type { Doc, Element } from "../doc/types.js";

function session(doc: Doc = emptyDoc(1000, 1000)): DocSession {
  return new DocSession(doc);
}

function el(id: string, partial: Partial<Element> = {}): Element {
  return {
    id,
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    z: 0,
    style: { fill: "#ff0000" },
    ...partial,
  };
}

function docWith(...elements: Element[]): Doc {
  return { ...emptyDoc(1000, 1000), elements };
}

function find(doc: Doc, id: string): Element {
  const found = doc.elements.find((e) => e.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe("surface registry", () => {
  it("exposes every surface with unique tool names", () => {
    for (const id of Object.keys(SURFACES) as (keyof typeof SURFACES)[]) {
      const surface = getSurface(id);
      const names = surface.tools.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
      expect(surface.briefing.length).toBeGreaterThan(50);
    }
  });

  it("rejects an unknown surface by name", () => {
    expect(() => getSurface("nope" as never)).toThrow(/Unknown surface/);
  });
});

describe("shared behaviour across surfaces", () => {
  it("reports unknown tools the same way everywhere", () => {
    for (const surface of [coordinateSurface, relationalSurface, documentSurface]) {
      const s = session();
      const r = executeToolCall(s, surface, "teleport", {});
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/no tool called 'teleport'/);
      // A rejected call is still recorded — failures are the interesting data.
      expect(s.actions).toHaveLength(1);
      expect(s.actions[0]!.ok).toBe(false);
    }
  });

  it("leaves the document untouched when arguments are invalid", () => {
    const s = session();
    const before = JSON.stringify(s.doc);
    const r = executeToolCall(s, coordinateSurface, "create", { type: "rect", x: "left" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Invalid arguments/);
    expect(JSON.stringify(s.doc)).toBe(before);
  });

  it("refuses a text element with no text, on every surface that creates", () => {
    for (const surface of [coordinateSurface, relationalSurface]) {
      const s = session();
      const input =
        surface.id === "coordinate"
          ? { type: "text", x: 0, y: 0, width: 100, height: 50 }
          : { type: "text", width: 100, height: 50, relation: "canvas_center" };
      const r = executeToolCall(s, surface, "create", input);
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/needs 'text'/);
    }
  });

  it("never reuses an id after a delete", () => {
    const s = session();
    executeToolCall(s, coordinateSurface, "create", { type: "rect", x: 0, y: 0, width: 10, height: 10 });
    expect(s.doc.elements[0]!.id).toBe("el_1");
    executeToolCall(s, coordinateSurface, "delete", { id: "el_1" });
    executeToolCall(s, coordinateSurface, "create", { type: "rect", x: 0, y: 0, width: 10, height: 10 });
    expect(s.doc.elements[0]!.id).toBe("el_2");
  });
});

describe("equivalence: the same intent reaches the same document", () => {
  const spec = { type: "rect" as const, width: 200, height: 100 };

  it("centres an element identically by arithmetic and by relation", () => {
    const coord = session();
    executeToolCall(coord, coordinateSurface, "create", {
      ...spec,
      // (1000 - 200) / 2, (1000 - 100) / 2
      x: 400,
      y: 450,
    });

    const rel = session();
    executeToolCall(rel, relationalSurface, "create", { ...spec, relation: "canvas_center" });

    expect(find(rel.doc, "el_1")).toEqual(find(coord.doc, "el_1"));
  });

  it("stacks elements identically by arithmetic and by place(below)", () => {
    const start = docWith(el("a", { x: 100, y: 100, width: 300, height: 80 }));

    const coord = session(start);
    executeToolCall(coord, coordinateSurface, "create", {
      type: "rect",
      // a ends at y=180, plus a 20 unit gap; centred on a horizontally.
      x: 150,
      y: 200,
      width: 200,
      height: 60,
    });

    const rel = session(start);
    executeToolCall(rel, relationalSurface, "create", {
      type: "rect",
      width: 200,
      height: 60,
      relation: "below",
      target: "a",
      gap: 20,
    });

    expect(find(rel.doc, "el_1")).toEqual(find(coord.doc, "el_1"));
  });

  /**
   * Rotation was the hole in this claim. `create` took an angle on every
   * surface, so a *new* rotated element was reachable everywhere — but
   * rotating one that already existed was a `move` away on the coordinate
   * surface, a whole-document write on document-as-code, and unreachable on
   * relational, where `place` took no angle and `set_style` is appearance,
   * text and paint order. The equivalence tests only covered placement, so
   * nothing said so, and `docs/PREREGISTRATION.md` §8 claimed a parity the
   * surfaces did not have.
   */
  it("straightens an existing element identically on all three surfaces", () => {
    const start = docWith(el("a", { x: 100, y: 120, width: 300, height: 80, rotation: 7 }));

    const coord = session(start);
    expect(executeToolCall(coord, coordinateSurface, "move", { id: "a", x: 100, y: 120, rotation: 0 }).ok).toBe(true);

    const rel = session(start);
    expect(executeToolCall(rel, relationalSurface, "rotate", { ids: ["a"], degrees: 0 }).ok).toBe(true);

    const asCode = session(start);
    expect(
      executeToolCall(asCode, documentSurface, "write_document", {
        document: {
          ...emptyDoc(1000, 1000),
          elements: [
            { id: "a", type: "rect", x: 100, y: 120, width: 300, height: 80, rotation: 0, z: 0, style: { fill: "#ff0000" } },
          ],
        },
      }).ok,
    ).toBe(true);

    expect(find(rel.doc, "a")).toEqual(find(coord.doc, "a"));
    expect(find(asCode.doc, "a")).toEqual(find(coord.doc, "a"));
    expect(find(rel.doc, "a").rotation).toBe(0);
  });

  // Rotating about the center is what the model says it does, and it is what
  // makes "straighten these" expressible without also repositioning them.
  it("rotates about the center, so nothing moves", () => {
    const start = docWith(el("a", { x: 100, y: 120, width: 300, height: 80, rotation: 0 }));
    const rel = session(start);
    executeToolCall(rel, relationalSurface, "rotate", { ids: ["a"], degrees: 30 });
    const after = find(rel.doc, "a");
    expect(after).toMatchObject({ x: 100, y: 120, width: 300, height: 80, rotation: 30 });
  });

  it("copies another element's angle", () => {
    const start = {
      ...docWith(el("a", { rotation: 12 })),
      elements: [el("a", { rotation: 12 }), el("b", { x: 400, rotation: 0 })],
    };
    const rel = session(start);
    const r = executeToolCall(rel, relationalSurface, "rotate", { ids: ["b"], to: "a" });
    expect(r.ok).toBe(true);
    expect(find(rel.doc, "b").rotation).toBe(12);
  });

  // A tool that accepts an argument and then throws it away reports success
  // for a document it did not produce, which on the surface under study is a
  // measurement error rather than a rough edge.
  it("refuses a rotation the placement would throw away, rather than dropping it", () => {
    for (const relation of ["cover", "fill_canvas"]) {
      const target = { ...el("t", { x: 100, y: 100, width: 400, height: 200 }) };
      const rel = session(docWith(target, el("a", { x: 0, y: 0, width: 50, height: 50 })));
      const r = executeToolCall(rel, relationalSurface, "place", {
        id: "a",
        relation,
        rotation: 30,
        ...(relation === "cover" ? { target: "t" } : {}),
      });
      expect(r.ok, relation).toBe(false);
      expect(r.message).toMatch(/cannot carry a rotation/);
      // And nothing moved on the way to being refused.
      expect(find(rel.doc, "a")).toMatchObject({ x: 0, y: 0, rotation: 0 });
    }
  });

  it("refuses the same combination on create", () => {
    const rel = session();
    const r = executeToolCall(rel, relationalSurface, "create", {
      type: "rect",
      width: 200,
      height: 100,
      rotation: 30,
      relation: "fill_canvas",
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/cannot carry a rotation/);
    expect(rel.doc.elements).toHaveLength(0);
  });

  // Zero is not a rotation, so asking for it alongside a sizing relation is
  // asking for what the relation already does.
  it("allows an explicit zero rotation with a sizing relation", () => {
    const rel = session(docWith(el("a", { rotation: 40 })));
    const r = executeToolCall(rel, relationalSurface, "place", { id: "a", relation: "fill_canvas", rotation: 0 });
    expect(r.ok).toBe(true);
    expect(find(rel.doc, "a")).toMatchObject({ x: 0, y: 0, width: 1000, height: 1000, rotation: 0 });
  });

  it("refuses a rotate that names neither an angle nor an element", () => {
    const rel = session(docWith(el("a")));
    const r = executeToolCall(rel, relationalSurface, "rotate", { ids: ["a"] });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/exactly one of 'degrees' or 'to'/);
  });

  it("leaves every element alone when one id in the batch is wrong", () => {
    const start = { ...docWith(el("a")), elements: [el("a"), el("b", { x: 400 })] };
    const rel = session(start);
    const r = executeToolCall(rel, relationalSurface, "rotate", { ids: ["a", "nope"], degrees: 45 });
    expect(r.ok).toBe(false);
    expect(find(rel.doc, "a").rotation).toBe(0);
  });

  it("reaches the same document through whole-document rewriting", () => {
    const coord = session();
    executeToolCall(coord, coordinateSurface, "create", { ...spec, x: 400, y: 450 });

    const asCode = session();
    executeToolCall(asCode, documentSurface, "write_document", {
      document: {
        ...emptyDoc(1000, 1000),
        elements: [
          { id: "el_1", type: "rect", x: 400, y: 450, width: 200, height: 100, rotation: 0, z: 1, style: {} },
        ],
      },
    });

    expect(asCode.doc.elements).toEqual(coord.doc.elements);
  });
});

describe("coordinate surface", () => {
  it("moves to absolute coordinates", () => {
    const s = session(docWith(el("a", { x: 10, y: 10 })));
    const r = executeToolCall(s, coordinateSurface, "move", { id: "a", x: 300, y: 400 });
    expect(r.ok).toBe(true);
    expect(find(s.doc, "a")).toMatchObject({ x: 300, y: 400 });
  });

  it("resizes from the top-left corner", () => {
    const s = session(docWith(el("a", { x: 50, y: 50 })));
    executeToolCall(s, coordinateSurface, "resize", { id: "a", width: 400, height: 20 });
    expect(find(s.doc, "a")).toMatchObject({ x: 50, y: 50, width: 400, height: 20 });
  });

  it("names the existing ids when one is wrong", () => {
    const s = session(docWith(el("a"), el("b")));
    const r = executeToolCall(s, coordinateSurface, "move", { id: "c", x: 0, y: 0 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Existing ids: a, b/);
  });

  it("clears a style key when passed null", () => {
    const s = session(docWith(el("a", { style: { fill: "#ff0000", strokeColor: "#000000" } })));
    executeToolCall(s, coordinateSurface, "set_style", { id: "a", style: { strokeColor: null } });
    expect(find(s.doc, "a").style).toEqual({ fill: "#ff0000" });
  });

  it("refuses to set text on a non-text element", () => {
    const s = session(docWith(el("a")));
    const r = executeToolCall(s, coordinateSurface, "set_style", { id: "a", text: "hello" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/has no text/);
  });
});

describe("relational surface", () => {
  // `place` computes against the painted bounding box; `create` computed
  // against the declared width and height and then wrote the result into x/y,
  // which are the *unrotated* top-left. A rotated create therefore landed off
  // by half the difference, and hung outside the margin it asked for.
  it("places a rotated create exactly where place would put it", () => {
    for (const relation of ["canvas_top_left", "canvas_center", "canvas_bottom_right"]) {
      const viaCreate = session();
      expect(
        executeToolCall(viaCreate, relationalSurface, "create", {
          type: "rect",
          width: 200,
          height: 100,
          rotation: 30,
          relation,
          margin: 40,
        }).ok,
      ).toBe(true);

      const viaPlace = session();
      expect(
        executeToolCall(viaPlace, relationalSurface, "create", {
          type: "rect",
          width: 200,
          height: 100,
          relation: "canvas_center",
        }).ok,
      ).toBe(true);
      const created = viaPlace.doc.elements[0]!.id;
      expect(executeToolCall(viaPlace, coordinateSurface, "set_style", { id: created, z: 0 }).ok).toBe(true);
      viaPlace.commit({
        ...viaPlace.doc,
        elements: viaPlace.doc.elements.map((e) => ({ ...e, rotation: 30 })),
      });
      expect(executeToolCall(viaPlace, relationalSurface, "place", { id: created, relation, margin: 40 }).ok).toBe(true);

      const a = aabb(viaCreate.doc.elements[0]!);
      const b = aabb(viaPlace.doc.elements[0]!);
      expect(a.x).toBeCloseTo(b.x, 6);
      expect(a.y).toBeCloseTo(b.y, 6);
    }
  });

  it("keeps a rotated create inside the margin it asked for", () => {
    const s = session();
    executeToolCall(s, relationalSurface, "create", {
      type: "rect",
      width: 200,
      height: 100,
      rotation: 45,
      relation: "canvas_top_left",
      margin: 40,
    });
    const box = aabb(s.doc.elements[0]!);
    // Committed geometry is rounded to two decimals.
    expect(box.x).toBeCloseTo(40, 1);
    expect(box.y).toBeCloseTo(40, 1);
  });

  it("has no tool that accepts a raw coordinate", () => {
    // The point of the surface: intent in, geometry computed. If an `x` ever
    // appears in a schema here, the comparison has sprung a leak.
    for (const tool of relationalSurface.tools) {
      const json = JSON.stringify(tool.schema.safeParse({}).success ? {} : tool.schema);
      void json;
    }
    const names = relationalSurface.tools.flatMap((t) =>
      Object.keys((t.schema as unknown as { shape?: Record<string, unknown> }).shape ?? {}),
    );
    expect(names).not.toContain("x");
    expect(names).not.toContain("y");
  });

  it("places below using visual bounds, so rotation is respected", () => {
    const start = docWith(el("a", { x: 400, y: 400, width: 200, height: 100, rotation: 45 }));
    const s = session(start);
    executeToolCall(s, relationalSurface, "create", {
      type: "rect",
      width: 100,
      height: 50,
      relation: "below",
      target: "a",
      gap: 10,
    });
    const target = aabb(find(s.doc, "a"));
    const placed = aabb(find(s.doc, "el_1"));
    // Committed geometry is rounded to 2dp, so agree to within that.
    expect(placed.y).toBeCloseTo(target.y + target.height + 10, 1);
  });

  it("aligns a group to a shared left edge", () => {
    const s = session(docWith(el("a", { x: 100 }), el("b", { x: 250 }), el("c", { x: 400 })));
    executeToolCall(s, relationalSurface, "align", { ids: ["a", "b", "c"], edge: "left" });
    for (const id of ["a", "b", "c"]) expect(find(s.doc, id).x).toBeCloseTo(100, 6);
  });

  it("aligns to the canvas when asked", () => {
    const s = session(docWith(el("a", { x: 100, width: 200 })));
    executeToolCall(s, relationalSurface, "align", { ids: ["a"], edge: "horizontal_center", to: "canvas" });
    expect(find(s.doc, "a").x).toBeCloseTo(400, 6);
  });

  it("equalizes gaps when distributing without a spacing", () => {
    const s = session(
      docWith(
        el("a", { x: 0, width: 100 }),
        el("b", { x: 130, width: 100 }),
        el("c", { x: 700, width: 100 }),
      ),
    );
    executeToolCall(s, relationalSurface, "distribute", { ids: ["a", "b", "c"], axis: "horizontal" });
    const gap1 = find(s.doc, "b").x - (find(s.doc, "a").x + 100);
    const gap2 = find(s.doc, "c").x - (find(s.doc, "b").x + 100);
    expect(gap1).toBeCloseTo(gap2, 6);
    // The outermost elements do not move.
    expect(find(s.doc, "a").x).toBeCloseTo(0, 6);
    expect(find(s.doc, "c").x).toBeCloseTo(700, 6);
  });

  it("uses a fixed gap when spacing is given", () => {
    const s = session(docWith(el("a", { x: 0, width: 100 }), el("b", { x: 500, width: 100 })));
    executeToolCall(s, relationalSurface, "distribute", { ids: ["a", "b"], axis: "horizontal", spacing: 25 });
    expect(find(s.doc, "b").x).toBeCloseTo(125, 6);
  });

  it("shrinks text until it fits", () => {
    const s = session(
      docWith(
        el("t", {
          type: "text",
          text: "A headline that is far too long for this small box to hold",
          width: 200,
          height: 80,
          style: { fontSize: 60 },
        }),
      ),
    );
    expect(layoutTextElement(find(s.doc, "t")).clipped).toBe(true);
    const r = executeToolCall(s, relationalSurface, "fit_text", { id: "t", mode: "shrink_to_fit" });
    expect(r.ok).toBe(true);
    expect(layoutTextElement(find(s.doc, "t")).clipped).toBe(false);
  });

  it("leaves text alone when shrink_to_fit has nothing to do", () => {
    const s = session(docWith(el("t", { type: "text", text: "Short", width: 400, height: 200, style: { fontSize: 20 } })));
    const r = executeToolCall(s, relationalSurface, "fit_text", { id: "t", mode: "shrink_to_fit" });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/already fits/);
    expect(find(s.doc, "t").style.fontSize).toBe(20);
  });

  it("grows the box instead of the font when asked", () => {
    const s = session(
      docWith(el("t", { type: "text", text: "one two three four five six seven", width: 200, height: 30, style: { fontSize: 24 } })),
    );
    executeToolCall(s, relationalSurface, "fit_text", { id: "t", mode: "grow_box" });
    expect(find(s.doc, "t").style.fontSize).toBe(24);
    expect(layoutTextElement(find(s.doc, "t")).clipped).toBe(false);
  });

  it("explains why grow_box cannot help an over-wide word", () => {
    const s = session(docWith(el("t", { type: "text", text: "Unbreakablylongword", width: 40, height: 30, style: { fontSize: 40 } })));
    const r = executeToolCall(s, relationalSurface, "fit_text", { id: "t", mode: "grow_box" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/too wide/);
  });

  it("scales an element down to fit inside the canvas", () => {
    const s = session(docWith(el("a", { x: 0, y: 0, width: 2000, height: 1000 })));
    executeToolCall(s, relationalSurface, "fit_within", { id: "a", container: "canvas", margin: 50 });
    const box = aabb(find(s.doc, "a"));
    expect(box.width).toBeLessThanOrEqual(900.01);
    expect(box.x).toBeGreaterThanOrEqual(49.99);
    // Aspect ratio preserved.
    expect(box.width / box.height).toBeCloseTo(2, 6);
  });

  it("pushes overlapping elements apart", () => {
    const s = session(
      docWith(
        el("a", { x: 100, y: 100, width: 200, height: 200 }),
        el("b", { x: 150, y: 150, width: 200, height: 200 }),
      ),
    );
    expect(overlapArea(find(s.doc, "a"), find(s.doc, "b"))).toBeGreaterThan(0);
    const r = executeToolCall(s, relationalSurface, "avoid_overlap", { ids: ["a", "b"], padding: 10 });
    expect(r.ok).toBe(true);
    expect(overlapArea(find(s.doc, "a"), find(s.doc, "b"))).toBeCloseTo(0, 6);
  });

  it("says so when there is not enough room to separate", () => {
    const small = { ...emptyDoc(200, 200) };
    const s = session({
      ...small,
      elements: [el("a", { x: 0, y: 0, width: 190, height: 190 }), el("b", { x: 5, y: 5, width: 190, height: 190 })],
    });
    const r = executeToolCall(s, relationalSurface, "avoid_overlap", { ids: ["a", "b"], padding: 20 });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/still overlap|not enough room/);
  });

  it("requires a target for target-relative placement", () => {
    const s = session(docWith(el("a")));
    const r = executeToolCall(s, relationalSurface, "place", { id: "a", relation: "below" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/needs a 'target'/);
  });

  it("refuses to place an element relative to itself", () => {
    const s = session(docWith(el("a")));
    const r = executeToolCall(s, relationalSurface, "place", { id: "a", relation: "below", target: "a" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/relative to itself/);
  });
});

describe("document-as-code surface", () => {
  it("replaces the whole document", () => {
    const s = session(docWith(el("a"), el("b")));
    const r = executeToolCall(s, documentSurface, "write_document", {
      document: {
        width: 1000,
        height: 1000,
        background: "#000000",
        elements: [{ id: "only", type: "rect", x: 1, y: 2, width: 3, height: 4, rotation: 0, z: 0, style: {} }],
      },
    });
    expect(r.ok).toBe(true);
    expect(s.doc.elements.map((e) => e.id)).toEqual(["only"]);
    expect(r.message).toMatch(/Removed a, b/);
    expect(r.message).toMatch(/Background is now #000000/);
  });

  it("rejects an invalid document without changing anything", () => {
    const s = session(docWith(el("a")));
    const before = JSON.stringify(s.doc);
    const r = executeToolCall(s, documentSurface, "write_document", {
      document: {
        width: 1000,
        height: 1000,
        background: "not-a-color",
        elements: [{ id: "x", type: "blob", x: 0, y: 0, width: 10, height: 10, z: 0, style: {} }],
      },
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(s.doc)).toBe(before);
    expect(r.message).toMatch(/Nothing was changed/);
  });

  it("rejects duplicate ids", () => {
    const s = session();
    const dup = { id: "x", type: "rect" as const, x: 0, y: 0, width: 10, height: 10, rotation: 0, z: 0, style: {} };
    const r = executeToolCall(s, documentSurface, "write_document", {
      document: { width: 1000, height: 1000, background: "#ffffff", elements: [dup, { ...dup }] },
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/duplicate id/);
  });

  it("rejects an unknown asset key", () => {
    const s = session();
    const r = executeToolCall(s, documentSurface, "write_document", {
      document: {
        width: 1000,
        height: 1000,
        background: "#ffffff",
        elements: [{ id: "i", type: "image", src: "photo/nope", x: 0, y: 0, width: 10, height: 10, rotation: 0, z: 0, style: {} }],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/unknown asset/i);
  });

  it("returns the document as JSON on read", () => {
    const s = session(docWith(el("a")));
    const r = executeToolCall(s, documentSurface, "read_document", {});
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.message)).toEqual(s.doc);
  });

  // Growing the page turns an out-of-bounds element in-bounds and rescales
  // every margin the checks measure. Neither other surface can do it, so
  // allowing it here would stop the three being compared on one problem.
  it("refuses to resize the canvas", () => {
    const s = session(docWith(el("a")));
    const before = JSON.stringify(s.doc);
    for (const [width, height] of [
      [2000, 1000],
      [1000, 2000],
    ]) {
      const r = executeToolCall(s, documentSurface, "write_document", {
        document: { width, height, background: "#ffffff", elements: [el("a")] },
      });
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/cannot be resized/);
      expect(r.message).toMatch(/was not changed/);
    }
    expect(JSON.stringify(s.doc)).toBe(before);
  });

  it("still allows the background to change, which a restyle brief asks for", () => {
    const s = session(docWith(el("a")));
    const r = executeToolCall(s, documentSurface, "write_document", {
      document: { width: 1000, height: 1000, background: "#12121f", elements: [el("a")] },
    });
    expect(r.ok).toBe(true);
    expect(s.doc.background).toBe("#12121f");
  });
});

describe("surface lookup", () => {
  // Ids arrive from a query string and from WebMCP, and both `in` and plain
  // indexing walk the prototype chain.
  it("does not mistake an Object.prototype key for a surface", () => {
    for (const id of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(() => getSurface(id as never)).toThrow(/Unknown surface/);
    }
  });

  it("still resolves the real ids", () => {
    for (const id of Object.keys(SURFACES)) {
      expect(getSurface(id as never).id).toBe(id);
    }
  });
});

describe("set_style", () => {
  // `create` and `write_document` both reject blank copy, and a blanked
  // element still counts as preserved, so this would be a way to satisfy a
  // copy-preserving task by deleting the copy. A space bar is the same act as
  // an empty string, so the spaces are here too — and a lone line break, which
  // is what text normalization turns a bare escape into.
  it.each([["empty", ""], ["spaces", "   "], ["a tab", "\t"], ["a line break", "\n"]])(
    "refuses to blank a text element with %s",
    (_label, text) => {
      const s = session(docWith(el("t", { type: "text", text: "Keep me", style: {} })));
      const r = executeToolCall(s, coordinateSurface, "set_style", { id: "t", text });
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/whitespace alone paints nothing/);
      expect(r.message).toMatch(/delete/);
      expect(s.doc.elements[0]!.text).toBe("Keep me");
    },
  );

  it("still sets real text, and keeps the space around it", () => {
    const s = session(docWith(el("t", { type: "text", text: "Keep me", style: {} })));
    const r = executeToolCall(s, coordinateSurface, "set_style", { id: "t", text: "  Changed  " });
    expect(r.ok).toBe(true);
    // Blank is about having no content at all, not about tidy copy: the
    // padding is the author's business and alignment may depend on it.
    expect(s.doc.elements[0]!.text).toBe("  Changed  ");
  });
});

/**
 * Blank copy is refused the same way everywhere. `create` demands the text up
 * front, so unlike an invisible rect there is no half-built state to protect —
 * and a rule one surface enforces and another does not is the one kind of
 * obstacle this project must not put in a surface's way.
 */
describe("blank copy", () => {
  const blanks = ["", "   ", "\n", " \t "];

  it("is refused by create on every surface that has one", () => {
    for (const surface of [coordinateSurface, relationalSurface]) {
      for (const text of blanks) {
        const s = session();
        const placement =
          surface.id === "coordinate"
            ? { x: 0, y: 0, width: 200, height: 50 }
            : { width: 200, height: 50, relation: "canvas_center" };
        const r = executeToolCall(s, surface, "create", { type: "text", text, ...placement });
        expect(r.ok, `${surface.id} ${JSON.stringify(text)}`).toBe(false);
        expect(r.message).toMatch(/needs 'text'/);
        expect(s.doc.elements).toHaveLength(0);
      }
    }
  });

  it("is refused by write_document, which names the element", () => {
    for (const text of blanks) {
      const s = session();
      const r = executeToolCall(s, documentSurface, "write_document", {
        document: {
          ...emptyDoc(1000, 1000),
          elements: [
            { id: "t", type: "text", x: 0, y: 0, width: 200, height: 50, rotation: 0, z: 1, text, style: {} },
          ],
        },
      });
      expect(r.ok, JSON.stringify(text)).toBe(false);
      expect(r.message).toMatch(/t: A text element needs 'text'/);
      expect(s.doc.elements).toHaveLength(0);
    }
  });
});

/**
 * A hard line break has to mean the same thing on every surface: the surfaces
 * differ in how elements get *arranged*, and nothing else.
 */
describe("hard line breaks", () => {
  // What models actually send. A tool description reading "\n is a hard line
  // break" invites the two characters, not the one.
  const escaped = "September 12-14\\nAlpine Meadow, Colorado";
  const lines = ["September 12-14", "Alpine Meadow, Colorado"];

  function linesOf(doc: Doc, id: string): string[] {
    return layoutTextElement(find(doc, id)).lines.map((l) => l.text);
  }

  it("breaks the line on coordinate's create", () => {
    const s = session();
    const r = executeToolCall(s, coordinateSurface, "create", {
      type: "text",
      text: escaped,
      x: 50,
      y: 50,
      width: 900,
      height: 300,
      style: { fontSize: 40 },
    });
    expect(r.ok).toBe(true);
    expect(linesOf(s.doc, s.doc.elements[0]!.id)).toEqual(lines);
  });

  it("breaks the line on relational's create", () => {
    const s = session();
    const r = executeToolCall(s, relationalSurface, "create", {
      type: "text",
      text: escaped,
      width: 900,
      height: 300,
      relation: "canvas_center",
      style: { fontSize: 40 },
    });
    expect(r.ok).toBe(true);
    expect(linesOf(s.doc, s.doc.elements[0]!.id)).toEqual(lines);
  });

  it("breaks the line on write_document", () => {
    const s = session();
    const r = executeToolCall(s, documentSurface, "write_document", {
      document: {
        ...emptyDoc(1000, 1000),
        elements: [
          {
            id: "t",
            type: "text",
            x: 50,
            y: 50,
            width: 900,
            height: 300,
            rotation: 0,
            z: 1,
            text: escaped,
            style: { fontSize: 40 },
          },
        ],
      },
    });
    expect(r.ok).toBe(true);
    expect(linesOf(s.doc, "t")).toEqual(lines);
  });

  it("breaks the line on set_style", () => {
    const s = session(
      docWith(el("t", { type: "text", text: "one line", width: 900, height: 300, style: { fontSize: 40 } })),
    );
    const r = executeToolCall(s, coordinateSurface, "set_style", { id: "t", text: escaped });
    expect(r.ok).toBe(true);
    expect(linesOf(s.doc, "t")).toEqual(lines);
  });

  // A real newline is the form the layout engine wants, and has to survive
  // untouched — otherwise a document read back and written out again would
  // pick up breaks it never had.
  it("leaves a real newline alone, and round-trips it", () => {
    const s = session();
    const real = lines.join("\n");
    executeToolCall(s, coordinateSurface, "create", {
      type: "text",
      text: real,
      x: 50,
      y: 50,
      width: 900,
      height: 300,
      style: { fontSize: 40 },
    });
    const id = s.doc.elements[0]!.id;
    expect(find(s.doc, id).text).toBe(real);

    const again = session();
    const r = executeToolCall(again, documentSurface, "write_document", { document: s.doc });
    expect(r.ok).toBe(true);
    expect(find(again.doc, id).text).toBe(real);
  });
});
