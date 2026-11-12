/**
 * Revising a large painting: the first task in which the document is big.
 *
 * Every other task starts from a page of a few dozen elements at most, so the
 * three surfaces cost about the same to change one thing. They should not at
 * scale. Document-as-code rewrites the whole document to change any of it;
 * coordinate and relational touch only what changes. This task asks a handful
 * of edits of a 140-element landscape, each of which reaches many elements —
 * every tree, the sun and all of its rays, every bird — and requires the rest
 * to be left exactly as it was. What it measures, past whether the edits land,
 * is what each surface pays for them.
 *
 * Each edit is checked deterministically, and the untouched elements are held
 * by id: a run that rebuilds the painting instead of editing it loses them.
 */

import { defineTask } from "./types.js";
import { doc, rect, text } from "./helpers.js";
import type { Doc, Element, Style } from "../doc/types.js";
import { boxOfPoints, type Pt } from "../doc/path.js";
import { check, geometryUnchanged, preservesElements, styleUnchanged, type Check } from "../eval/checks.js";
import { paintsAnything } from "../doc/occlusion.js";

export const SCENE = { width: 1200, height: 1500 };

/** A fixed pseudo-random stream, so the painting is the same painting everywhere. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function path(id: string, points: Pt[], style: Style, z: number, closed = false): Element {
  return { id, type: "path", ...boxOfPoints(points), rotation: 0, z, points, style, ...(closed ? { closed: true } : {}) };
}

export const SUN = { cx: 300, cy: 300, r: 90 };
export const SUN_MOVED = { cx: 900, cy: 380 };
export const RAY_COUNT = 16;
export const RAY_DISTANCE = 160;
export const TREE_COUNT = 40;
export const BIRD_COUNT = 12;
export const AUTUMN = "#d9822b";
export const OLD_TITLE = "Summer in the Valley";
export const NEW_TITLE = "Autumn in the Valley";

export const rayIds = Array.from({ length: RAY_COUNT }, (_, i) => `ray_${i + 1}`);
export const crownIds = Array.from({ length: TREE_COUNT }, (_, i) => `crown_${i + 1}`);
export const trunkIds = Array.from({ length: TREE_COUNT }, (_, i) => `trunk_${i + 1}`);
export const birdIds = Array.from({ length: BIRD_COUNT }, (_, i) => `bird_${i + 1}`);

/** The painting as the agent finds it. */
export function landscape(): Doc {
  const rnd = lcg(1500);
  const els: Element[] = [];
  let z = 0;
  els.push(rect({ id: "sky", x: 0, y: 0, w: 1200, h: 900, z: z++, style: { fill: "#8ecae6", fillTo: "#fef3c7", gradientAngle: 90 } }));
  els.push(rect({ id: "sun", x: SUN.cx - SUN.r, y: SUN.cy - SUN.r, w: SUN.r * 2, h: SUN.r * 2, z: z++, style: { fill: "#ffb703", shape: "ellipse" } }));
  rayIds.forEach((id, i) => {
    const a = (i * 2 * Math.PI) / RAY_COUNT;
    const cx = SUN.cx + Math.sin(a) * RAY_DISTANCE;
    const cy = SUN.cy - Math.cos(a) * RAY_DISTANCE;
    els.push(rect({ id, x: cx - 6, y: cy - 30, w: 12, h: 60, rot: (i * 360) / RAY_COUNT, z: z++, style: { fill: "#ffb703" } }));
  });
  // Three ranges of hills, far to near. Straight-sided: a smooth closed
  // outline bulges past its corners, and these corners are the canvas's.
  const ranges: [string, number, string][] = [["hills_far", 640, "#6b9080"], ["hills_mid", 720, "#4f772d"], ["hills_near", 820, "#31572c"]];
  for (const [id, base, fill] of ranges) {
    const pts: Pt[] = [[0, 1500]];
    for (let x = 0; x <= 1200; x += 75) pts.push([x, Math.round(base + (rnd() - 0.5) * 90)]);
    pts.push([1200, 1500]);
    els.push(path(id, pts, { fill }, z++, true));
  }
  els.push(path("lake", [[150, 1180], [420, 1120], [760, 1140], [1000, 1200], [880, 1300], [420, 1310], [200, 1260]], { fill: "#219ebc", curve: "smooth" }, z++, true));
  // Forty trees on the hills, smaller further back.
  for (let i = 0; i < TREE_COUNT; i++) {
    const row = i % 4;
    const y = 700 + row * 90 + Math.round(rnd() * 30);
    const x = Math.round(40 + ((i * 97) % 1120));
    const scale = 0.55 + row * 0.18;
    const h = Math.round(110 * scale);
    const w = Math.round(70 * scale);
    const pine = (i * 7) % 3 !== 0;
    els.push(rect({ id: trunkIds[i]!, x: x - Math.round(6 * scale), y: y - Math.round(10 * scale), w: Math.round(12 * scale), h: Math.round(36 * scale), z: z++, style: { fill: "#6f4518" } }));
    els.push(
      rect({
        id: crownIds[i]!,
        x: x - Math.round(w / 2),
        y: y - h,
        w,
        h,
        z: z++,
        style: pine ? { fill: "#2d6a4f", shape: "polygon", sides: 3 } : { fill: "#40916c", shape: "ellipse" },
      }),
    );
  }
  // A house with its door and windows, and a fence along the shore.
  els.push(rect({ id: "house", x: 820, y: 960, w: 220, h: 150, z: z++, style: { fill: "#f4f1de" } }));
  els.push(rect({ id: "roof", x: 800, y: 870, w: 260, h: 100, z: z++, style: { fill: "#9d0208", shape: "polygon", sides: 3 } }));
  els.push(rect({ id: "door", x: 905, y: 1035, w: 50, h: 75, z: z++, style: { fill: "#6f4518" } }));
  els.push(rect({ id: "window_1", x: 845, y: 990, w: 45, h: 45, z: z++, style: { fill: "#8ecae6", strokeColor: "#6f4518", strokeWidth: 4 } }));
  els.push(rect({ id: "window_2", x: 970, y: 990, w: 45, h: 45, z: z++, style: { fill: "#8ecae6", strokeColor: "#6f4518", strokeWidth: 4 } }));
  for (let i = 0; i < 18; i++) {
    els.push(rect({ id: `post_${i + 1}`, x: 60 + i * 62, y: 1360, w: 10, h: 60, z: z++, style: { fill: "#7f5539" } }));
  }
  els.push(path("rail_1", [[60, 1375], [1134, 1375]], { strokeColor: "#7f5539", strokeWidth: 6 }, z++));
  els.push(path("rail_2", [[60, 1400], [1134, 1400]], { strokeColor: "#7f5539", strokeWidth: 6 }, z++));
  // Birds: small smooth V strokes in the sky.
  birdIds.forEach((id, i) => {
    const bx = 520 + ((i * 131) % 600);
    const by = 120 + ((i * 53) % 260);
    els.push(path(id, [[bx - 18, by - 8], [bx, by + 4], [bx + 18, by - 8]], { strokeColor: "#1d3557", strokeWidth: 3, curve: "smooth" }, z++));
  });
  els.push(
    text({
      id: "title",
      x: 100,
      y: 1430,
      w: 1000,
      h: 60,
      text: OLD_TITLE,
      z: z++,
      style: { fontSize: 44, fontWeight: "bold", color: "#fdf0d5", align: "center", valign: "middle" },
    }),
  );
  return doc(els, { ...SCENE, background: "#ffffff" });
}

const START = landscape();
const ids = START.elements.map((e) => e.id);
const changed = new Set([...crownIds, "sun", ...rayIds, ...birdIds, "title"]);
const untouched = ids.filter((id) => !changed.has(id));
const centre = (e: Element) => ({ x: e.x + e.width / 2, y: e.y + e.height / 2 });

/** A path's points held still: moving a box is caught elsewhere, reshaping inside the same box here. */
function pointsUnchanged(pathIds: string[], weight: number): Check {
  const before = new Map(START.elements.filter((e) => pathIds.includes(e.id)).map((e) => [e.id, e.points!]));
  return check("points_unchanged", "Lines and outlines are untouched", weight, (d) => {
    const drifted: string[] = [];
    for (const [id, pts] of before) {
      const after = d.elements.find((e) => e.id === id);
      if (!after) continue;
      const same = after.points?.length === pts.length && after.points.every(([x, y], i) => Math.abs(x - pts[i]![0]) <= 1 && Math.abs(y - pts[i]![1]) <= 1);
      if (!same) drifted.push(id);
    }
    return { score: before.size ? 1 - drifted.length / before.size : 1, detail: drifted.length ? `Reshaped: ${drifted.join(", ")}` : "All as they were." };
  });
}

/** Every crown in autumn colour, and nothing else about them changed. */
function autumnCrowns(weight: number): Check {
  return check("autumn", `Every tree's crown is filled ${AUTUMN}`, weight, (d) => {
    const wrong = crownIds.filter((id) => d.elements.find((e) => e.id === id)?.style.fill?.toLowerCase() !== AUTUMN);
    return { score: 1 - wrong.length / crownIds.length, detail: wrong.length ? `${wrong.length} of ${crownIds.length} not recoloured.` : "All recoloured." };
  });
}

/** The sun at its new centre, every ray carried the same distance and still turned as it was. */
function sunMoved(weight: number): Check {
  const dx = SUN_MOVED.cx - SUN.cx;
  const dy = SUN_MOVED.cy - SUN.cy;
  return check("sun_moved", `The sun and its rays are centred on (${SUN_MOVED.cx}, ${SUN_MOVED.cy})`, weight, (d) => {
    let worst = 0;
    const off: string[] = [];
    for (const id of ["sun", ...rayIds]) {
      const before = START.elements.find((e) => e.id === id)!;
      const after = d.elements.find((e) => e.id === id);
      if (!after) {
        off.push(`${id} deleted`);
        worst = Infinity;
        continue;
      }
      const want = { x: centre(before).x + dx, y: centre(before).y + dy };
      const miss = Math.max(
        Math.hypot(centre(after).x - want.x, centre(after).y - want.y),
        Math.abs(after.width - before.width),
        Math.abs(after.height - before.height),
        Math.abs(after.rotation - before.rotation),
      );
      if (miss > 1) off.push(id);
      worst = Math.max(worst, miss);
    }
    return {
      score: worst <= 1 ? 1 : Math.max(0, 1 - off.length / (RAY_COUNT + 1)),
      detail: off.length ? `Off: ${off.slice(0, 8).join(", ")}${off.length > 8 ? "…" : ""}` : "Sun and rays moved as one.",
    };
  });
}

function birdsGone(weight: number): Check {
  return check("birds_gone", "Every bird is removed", weight, (d) => {
    const left = birdIds.filter((id) => d.elements.some((e) => e.id === id && paintsAnything(e)));
    return { score: 1 - left.length / BIRD_COUNT, detail: left.length ? `${left.length} still there.` : "All removed." };
  });
}

function retitled(weight: number): Check {
  return check("retitled", `The title reads '${NEW_TITLE}'`, weight, (d) => {
    const t = d.elements.find((e) => e.id === "title");
    return { score: t?.text === NEW_TITLE ? 1 : 0, detail: t ? `Reads '${t.text}'.` : "The title is gone." };
  });
}

/** Nothing new: the painting is revised, not added to. */
function nothingAdded(weight: number): Check {
  const known = new Set(ids);
  return check("nothing_added", "Nothing is added", weight, (d) => {
    const extra = d.elements.filter((e) => !known.has(e.id) && paintsAnything(e)).map((e) => e.id);
    return { score: extra.length === 0 ? 1 : Math.max(0, 1 - extra.length / 5), detail: extra.length ? `Added: ${extra.join(", ")}` : "Nothing added." };
  });
}

const reviseTask = defineTask({
  id: "paint.revise",
  title: "Revise a large painting",
  family: "paint",
  paint: true,
  brief: [
    `This is a landscape painting of ${START.elements.length} elements: a sky, a sun ringed by ${RAY_COUNT} rays, three ranges of hills, a lake, ${TREE_COUNT} trees (each a trunk and a crown), a house, a fence and ${BIRD_COUNT} birds, with a title. Revise it:`,
    "",
    `1. Make it autumn: fill every tree's crown (the elements crown_1 to crown_${TREE_COUNT}) with ${AUTUMN}.`,
    `2. Move the sun so its centre is at (${SUN_MOVED.cx}, ${SUN_MOVED.cy}), and its rays with it: each ray keeps its size, its rotation and its place relative to the sun.`,
    `3. Remove all ${BIRD_COUNT} birds.`,
    `4. Change the title to '${NEW_TITLE}'.`,
    "",
    "Change nothing else: every other element keeps its position, size, rotation, shape and style, and nothing is added. Edit the elements that are there; do not delete and recreate them.",
  ].join("\n"),
  initial: landscape,
  checks: [
    autumnCrowns(4),
    sunMoved(4),
    birdsGone(3),
    retitled(1),
    nothingAdded(2),
    preservesElements([...untouched, ...crownIds, "sun", ...rayIds, "title"], 3),
    geometryUnchanged(START, [...untouched, ...crownIds, "title"], 3),
    styleUnchanged(START, untouched, 2),
    styleUnchanged(START, ["sun", ...rayIds], 1),
    pointsUnchanged(untouched.filter((id) => START.elements.find((e) => e.id === id)?.type === "path"), 2),
  ],
  judgeCriteria: ["Reads as the same painting in autumn, with nothing else disturbed."],
  maxTurns: 30,
});

export const reviseTasks = [reviseTask];

/** The reference revision: the starting painting with the four edits made, and nothing else. */
export function reviseSolution(): Doc {
  const d = landscape();
  const dx = SUN_MOVED.cx - SUN.cx;
  const dy = SUN_MOVED.cy - SUN.cy;
  return {
    ...d,
    elements: d.elements
      .filter((e) => !birdIds.includes(e.id))
      .map((e) => {
        if (crownIds.includes(e.id)) return { ...e, style: { ...e.style, fill: AUTUMN } };
        if (e.id === "sun" || rayIds.includes(e.id)) return { ...e, x: e.x + dx, y: e.y + dy };
        if (e.id === "title") return { ...e, text: NEW_TITLE };
        return e;
      }),
  };
}
