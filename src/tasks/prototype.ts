/**
 * Prototype: constructions from shapes.
 *
 * Not in the registered task set and not in any grid. These exist to find out
 * whether a different *kind* of task is hard enough to separate conditions on
 * a strong model, after two calibration rounds showed that precision and text
 * measurement on the v2 set leave Opus 5 passing three runs in four
 * (`docs/PREREGISTRATION.md` §13).
 *
 * The genre is the geometric poster — sunbursts, Bauhaus studies, a clock
 * face — because it is a real one, and because its specifications are
 * naturally exact: a ring of twelve rays every 30 degrees, a triangle whose
 * apex touches a circle, hands set to ten past ten. Every one is determined by
 * its brief, so it can be scored without the judge, and every one needs the
 * thing the pilots found hard: rotation, and positions that follow from other
 * shapes' geometry rather than from a number in the brief.
 *
 * Run them by id, or all three with `--tasks proto`.
 */

import { defineTask } from "./types.js";
import { blank, doc, image } from "./helpers.js";
import type { Doc, Element } from "../doc/types.js";
import { aabb } from "../doc/geometry.js";
import { assetAspect } from "../doc/assets.js";
import type { Check } from "../eval/checks.js";
import {
  alignedOn,
  centerAt,
  centeredOnCanvas,
  containsText,
  edgeAt,
  fillsMeasure,
  gapBetween,
  gradientIs,
  hugsText,
  lineCount,
  marginAtLeast,
  noOverlap,
  ring,
  rotationWithin,
  shapeIs,
  sizeIs,
  visibleText,
  withText,
} from "../eval/checks.js";

const shaped = (shape: string, fill?: string, sides?: number) => (el: Element) =>
  el.type === "rect" &&
  (el.style.shape ?? "rect") === shape &&
  (sides === undefined || (el.style.sides ?? (shape === "star" ? 5 : 6)) === sides) &&
  (fill === undefined || el.style.fill?.toLowerCase() === fill);

const plainRect = (fill: string) => (el: Element) =>
  el.type === "rect" && (el.style.shape ?? "rect") === "rect" && el.style.fill?.toLowerCase() === fill;

// --- sunburst -----------------------------------------------------------------

const disc = shaped("ellipse");
const star = shaped("star");
const ray = plainRect("#ffd166");

// --- clock --------------------------------------------------------------------

const face = shaped("ellipse", "#ffffff");
const cap = shaped("ellipse", "#d62828");
const tick = plainRect("#1d1d2b");
const hourHand = plainRect("#2b3a67");
const minuteHand = plainRect("#457b9d");
const NUMERALS = ["12", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"];
const numeral = (el: Element) => visibleText(el) && NUMERALS.includes((el.text ?? "").trim());

// --- bauhaus ------------------------------------------------------------------

const circle = shaped("ellipse", "#d62828");
const triangle = shaped("polygon", "#f6bd60", 3);
const square = plainRect("#1d3557");
const bar = plainRect("#111111");

// --- gallery ------------------------------------------------------------------

/**
 * Eleven photos in a fixed order, whose aspect ratios admit exactly one
 * justified layout inside the brief's limits: rows of 3, 3, 3 and 2, 267, 267,
 * 312 and 312 tall, ending at y = 1255. Found by enumerating every partition;
 * no other one keeps every row between 180 and 340 and ends between 1240 and
 * 1290. The brief states the rules, not the rows — finding them is the task.
 */
const GALLERY = ["coffee", "coffee", "mountains", "coffee", "mountains", "coffee", "coffee", "coffee", "coffee", "portrait", "city"];
const PHOTOS = GALLERY.map((_, i) => `p${i + 1}`);

const gallery = (): Doc =>
  doc(
    GALLERY.map((key, i) => {
      const aspect = assetAspect(`photo/${key}`)!;
      const h = 150;
      return image({ id: PHOTOS[i]!, x: 80 + (i % 4) * 230 + ((i * 37) % 50), y: 120 + Math.floor(i / 4) * 330 + ((i * 53) % 70), w: h * aspect, h, src: `photo/${key}`, z: i });
    }),
    { background: "#f7f4ee" },
  );

interface Row {
  ids: string[];
  boxes: { x: number; y: number; width: number; height: number }[];
}

/** Photos grouped into rows by their top edge, rows top to bottom, each row left to right. */
function rowsOf(d: Doc): Row[] {
  const photos = PHOTOS.map((id) => d.elements.find((e) => e.id === id)).filter((e): e is Element => !!e);
  const rows: Row[] = [];
  for (const el of [...photos].sort((a, b) => aabb(a).y - aabb(b).y)) {
    const b = aabb(el);
    const row = rows.find((r) => Math.abs(r.boxes[0]!.y - b.y) <= 3);
    if (row) {
      row.ids.push(el.id);
      row.boxes.push(b);
    } else rows.push({ ids: [el.id], boxes: [b] });
  }
  for (const r of rows) {
    const order = r.boxes.map((b, i) => i).sort((a, b) => r.boxes[a]!.x - r.boxes[b]!.x);
    r.ids = order.map((i) => r.ids[i]!);
    r.boxes = order.map((i) => r.boxes[i]!);
  }
  return rows;
}

function galleryCheck(id: string, label: string, weight: number, defect: (rows: Row[], d: Doc) => number, budget: number): Check {
  return {
    id,
    label,
    weight,
    run(d) {
      const rows = rowsOf(d);
      if (rows.length === 0) return { score: 0, detail: "No photos." };
      const amount = defect(rows, d);
      return {
        score: amount <= 0 ? 1 : Math.max(0, 1 - amount / budget),
        detail: `Rows of ${rows.map((r) => r.ids.length).join(", ")}, ${rows.map((r) => Math.round(r.boxes[0]!.height)).join("/")} tall; worst miss ${Math.round(amount * 10) / 10}.`,
      };
    },
  };
}

const galleryChecks: Check[] = [
  galleryCheck("gallery_aspect", "Every photo keeps its proportions", 3, (_, d) => {
    let worst = 0;
    for (const [i, id] of PHOTOS.entries()) {
      const el = d.elements.find((e) => e.id === id);
      if (!el) return 1;
      const want = assetAspect(`photo/${GALLERY[i]}`)!;
      worst = Math.max(worst, Math.abs(el.width / el.height - want) / want);
    }
    return Math.max(0, worst - 0.01);
  }, 0.1),
  galleryCheck("gallery_order", "The photos keep their order, left to right and top to bottom", 3, (rows) => {
    const read = rows.flatMap((r) => r.ids);
    return read.join() === PHOTOS.join() ? 0 : 1;
  }, 1),
  galleryCheck("gallery_span", "Every row runs from x = 60 to x = 1020", 3, (rows) =>
    Math.max(...rows.map((r) => Math.max(Math.abs(r.boxes[0]!.x - 60), Math.abs(r.boxes.at(-1)!.x + r.boxes.at(-1)!.width - 1020)) - 2), 0), 24),
  galleryCheck("gallery_row_height", "Every photo in a row is the same height", 2, (rows) =>
    Math.max(...rows.map((r) => Math.max(...r.boxes.map((b) => b.height)) - Math.min(...r.boxes.map((b) => b.height))), 0) - 1, 20),
  galleryCheck("gallery_gutters", "12 units between photos, and between rows", 3, (rows) => {
    let worst = 0;
    for (const r of rows) for (let i = 1; i < r.boxes.length; i++) worst = Math.max(worst, Math.abs(r.boxes[i]!.x - (r.boxes[i - 1]!.x + r.boxes[i - 1]!.width) - 12));
    for (let i = 1; i < rows.length; i++) {
      const above = Math.max(...rows[i - 1]!.boxes.map((b) => b.y + b.height));
      worst = Math.max(worst, Math.abs(rows[i]!.boxes[0]!.y - above - 12));
    }
    return worst - 2;
  }, 24),
  galleryCheck("gallery_heights", "Every row is between 180 and 340 tall", 2, (rows) =>
    Math.max(...rows.map((r) => Math.max(180 - r.boxes[0]!.height, r.boxes[0]!.height - 340, 0))), 60),
  galleryCheck("gallery_extent", "The gallery starts at y = 60 and ends between y = 1240 and 1290", 2, (rows) => {
    const top = rows[0]!.boxes[0]!.y;
    const end = Math.max(...rows.at(-1)!.boxes.map((b) => b.y + b.height));
    return Math.max(Math.abs(top - 60) - 2, 1240 - end, end - 1290, 0);
  }, 60),
];

export const prototypeTasks = [
  defineTask({
    id: "proto.sunburst",
    title: "A sunburst badge",
    family: "compose",
    brief: [
      "Build a badge for a midsummer festival on this blank canvas, out of these parts:",
      "",
      "  - A disc: a circle 480 across, centred at (540, 480), filled with a gradient running top to bottom",
      "    from #ffb347 to #ff5e62.",
      "  - Twelve rays around the disc: plain rects 36 wide and 150 long, filled #ffd166, one every 30 degrees",
      "    starting straight up. Each points straight out from the disc's centre, and each ray's inner end",
      "    sits exactly 24 units outside the disc's edge.",
      "  - A five-pointed star centred on the disc, 260 across and 260 tall, one point straight up,",
      "    filled #fff3d6 and painted over the disc.",
      '  - The title "MIDSUMMER" in bold #fff3d6, its box from x = 100 and 880 wide, text centred, its top',
      "    exactly 40 units below the lowest point any ray reaches. It is set on one line, as large as it",
      "    will go on one line at that width (within 2%), in a box no taller than its text needs plus 8.",
      '  - "June 21, Ridgeline Meadow" in #ffd166 at 40 units, box from x = 100 and 880 wide, text centred,',
      "    exactly 12 units below the title, in a box no taller than its text needs plus 8.",
      "",
      "Nothing may come within 40 units of a canvas edge.",
    ].join("\n"),
    initial: () => blank({ background: "#1b1b3a" }),
    checks: [
      containsText(["MIDSUMMER", "June 21, Ridgeline Meadow"], 1),
      shapeIs(disc, "ellipse", undefined, 1, "The disc is a circle"),
      sizeIs(disc, { width: 480, height: 480 }, 2, 1, "The disc is 480 across"),
      centerAt(disc, 540, 480, 2, 1, "The disc is centred at (540, 480)"),
      gradientIs(disc, "#ffb347", "#ff5e62", 90, 1, "The disc runs #ffb347 to #ff5e62, top to bottom"),
      sizeIs(ray, { width: 36, height: 150 }, 1.5, 2, "Every ray is 36 by 150"),
      // Inner end 24 outside a 240 radius, half a 150 ray further out.
      ring(ray, { cx: 540, cy: 480, radius: 240 + 24 + 75, count: 12, step: 30, facing: true, tolerance: 3 }, 6, "Twelve rays, every 30 degrees, pointing out"),
      shapeIs(star, "star", 5, 1, "The star has five points"),
      sizeIs(star, { width: 260, height: 260 }, 2, 1, "The star is 260 by 260"),
      centerAt(star, 540, 480, 2, 1, "The star is centred on the disc"),
      rotationWithin(star, 0, 1, { tolerance: 1, label: "The star has a point straight up" }),
      edgeAt(withText("MIDSUMMER"), "left", 100, 2, 1, "The title starts at x = 100"),
      sizeIs(visibleText, { width: 880 }, 2, 2, "The text boxes are 880 wide"),
      gapBetween(ray, withText("MIDSUMMER"), "vertical", 40, 2, 2, "The title sits 40 below the lowest ray"),
      lineCount(withText("MIDSUMMER"), 1, 1, "The title is on one line"),
      fillsMeasure(withText("MIDSUMMER"), 1, 0.98, 2, "The title is as large as it goes on one line"),
      hugsText(visibleText, 8, 1),
      gapBetween(withText("MIDSUMMER"), withText("June 21"), "vertical", 12, 2, 1, "The date sits 12 below the title"),
      centeredOnCanvas(visibleText, "horizontal", 2, 1, "The text is centred"),
      marginAtLeast(40, 2),
    ],
    judgeCriteria: [
      "Does it read as a sunburst badge — a glowing disc with rays all round it and a star at its heart?",
      "Are the rays evenly spaced and pointing straight out?",
      "Does the title sit comfortably under the badge?",
    ],
    maxTurns: 45,
  }),

  defineTask({
    id: "proto.clock",
    title: "A clock face at ten past ten",
    family: "compose",
    brief: [
      "Draw a clock face showing ten past ten, on this blank canvas:",
      "",
      "  - The face: a circle 760 across, centred at (540, 560), filled #ffffff, with a #1d1d2b outline 12 wide.",
      "  - Twelve hour ticks: plain rects 12 wide and 48 long, filled #1d1d2b, one every 30 degrees starting",
      "    straight up, each pointing straight out from the centre, with its centre 336 from the clock's centre.",
      '  - The twelve numerals "12", "1", "2" ... "11" in the usual places, bold #1d1d2b at 64 units, upright,',
      "    each centred on a point 260 from the clock's centre in its hour's direction, in a box 120 wide with",
      "    the text centred, no taller than its text needs plus 8.",
      "  - The hour hand: a plain rect 24 wide and 160 long, filled #2b3a67, running from the clock's centre out",
      "    along the hour hand's direction for ten past ten (its far end 160 from the centre).",
      "  - The minute hand: a plain rect 16 wide and 220 long, filled #457b9d, running from the clock's centre",
      "    out along the minute hand's direction for ten past ten.",
      "  - A centre cap: a circle 40 across, filled #d62828, centred on the clock's centre.",
      '  - The title "Ridgeline Clockworks" in bold #1d1d2b, its box from x = 100 and 880 wide, text centred,',
      "    exactly 48 units below the face's box, set on one line as large as it will go at that width (within 2%),",
      "    in a box no taller than its text needs plus 8.",
      "",
      "The hour hand of a real clock has moved on from the 10 by ten minutes' worth.",
    ].join("\n"),
    initial: () => blank({ background: "#f4f1ea" }),
    checks: [
      containsText(["Ridgeline Clockworks"], 1),
      sizeIs(face, { width: 760, height: 760 }, 2, 1, "The face is 760 across"),
      centerAt(face, 540, 560, 2, 1, "The face is centred at (540, 560)"),
      sizeIs(tick, { width: 12, height: 48 }, 1, 1, "Every tick is 12 by 48"),
      ring(tick, { cx: 540, cy: 560, radius: 336, count: 12, step: 30, facing: true, tolerance: 3 }, 4, "Twelve ticks, every 30 degrees"),
      ring(numeral, { cx: 540, cy: 560, radius: 260, count: 12, step: 30, texts: NUMERALS, tolerance: 3 }, 6, "The numerals are in their places"),
      rotationWithin(numeral, 0, 1, { tolerance: 1, label: "The numerals are upright" }),
      sizeIs(numeral, { width: 120 }, 1.5, 1, "The numeral boxes are 120 wide"),
      hugsText(visibleText, 8, 1),
      // 10:10 — the hour hand at 300 + 10 * 0.5 = 305 degrees, the minute hand
      // at 60, each centred half its length out from the clock's centre.
      sizeIs(hourHand, { width: 24, height: 160 }, 1.5, 1, "The hour hand is 24 by 160"),
      ring(hourHand, { cx: 540, cy: 560, radius: 80, count: 1, start: 305, step: 0, facing: true, tolerance: 3 }, 4, "The hour hand shows ten past ten"),
      sizeIs(minuteHand, { width: 16, height: 220 }, 1.5, 1, "The minute hand is 16 by 220"),
      ring(minuteHand, { cx: 540, cy: 560, radius: 110, count: 1, start: 60, step: 0, facing: true, tolerance: 3 }, 4, "The minute hand shows ten past ten"),
      sizeIs(cap, { width: 40, height: 40 }, 1, 1, "The cap is 40 across"),
      centerAt(cap, 540, 560, 1.5, 1, "The cap sits on the centre"),
      edgeAt(withText("Ridgeline Clockworks"), "left", 100, 2, 1, "The title starts at x = 100"),
      sizeIs(withText("Ridgeline Clockworks"), { width: 880 }, 2, 2, "The title's box is 880 wide"),
      gapBetween(face, withText("Ridgeline Clockworks"), "vertical", 48, 2, 1, "The title sits 48 below the face"),
      lineCount(withText("Ridgeline Clockworks"), 1, 1, "The title is on one line"),
      fillsMeasure(withText("Ridgeline Clockworks"), 1, 0.98, 2, "The title is as large as it goes on one line"),
      marginAtLeast(40, 1),
    ],
    judgeCriteria: [
      "Does it read as a clock face, numerals and ticks evenly round the dial?",
      "Does it show ten past ten, hour hand just past the 10?",
      "Is the title set comfortably under the face?",
    ],
    maxTurns: 50,
  }),

  defineTask({
    id: "proto.bauhaus",
    title: "A Bauhaus study",
    family: "compose",
    brief: [
      "Make a Bauhaus-style study in primary shapes on this blank canvas. The frame is the canvas inset by 80",
      "units: x from 80 to 1000, y from 80 to 1270.",
      "",
      "  - A red (#d62828) circle 440 across, touching the frame's top line and its left line.",
      "  - A yellow (#f6bd60) triangle (a 3-sided polygon) 440 wide, standing on the frame's bottom line, its",
      "    apex exactly touching the circle's lowest point.",
      "  - A blue (#1d3557) square 300 by 300, turned 45 degrees so it stands on a corner, its centre level with",
      "    the circle's centre and its right-hand corner exactly on the frame's right line.",
      "  - A black (#111111) bar, a plain rect 24 tall spanning the frame's full width, its top edge exactly",
      "    touching the square's bottom corner.",
      '  - The title "WEIMAR 1919" in bold #111111, its box 400 wide ending on the frame\'s right line and its',
      "    bottom on the frame's bottom line, right-aligned, set on one line as large as it will go at that width",
      "    (within 2%), in a box no taller than its text needs plus 8.",
      "",
      "Nothing goes outside the frame.",
    ].join("\n"),
    initial: () => blank({ background: "#f2ede4" }),
    checks: [
      containsText(["WEIMAR 1919"], 1),
      sizeIs(circle, { width: 440, height: 440 }, 2, 1, "The circle is 440 across"),
      edgeAt(circle, "left", 80, 2, 1, "The circle touches the frame's left line"),
      edgeAt(circle, "top", 80, 2, 1, "The circle touches the frame's top line"),
      sizeIs(triangle, { width: 440 }, 2, 1, "The triangle is 440 wide"),
      edgeAt(triangle, "bottom", 1270, 2, 1, "The triangle stands on the frame's bottom line"),
      // The apex is the top centre of its box, the circle's lowest point the
      // bottom centre of its: touching means one sits on the other.
      gapBetween(circle, triangle, "vertical", 0, 2, 2, "The apex touches the circle's lowest point"),
      alignedOn("hcenter", (el) => circle(el) || triangle(el), 2, 2),
      sizeIs(square, { width: 300, height: 300 }, 2, 1, "The square is 300 by 300"),
      rotationWithin(square, 45, 1, { tolerance: 1, label: "The square stands on a corner" }),
      alignedOn("vcenter", (el) => circle(el) || square(el), 2, 2),
      edgeAt(square, "right", 1000, 2, 2, "The square's right corner is on the frame's right line"),
      sizeIs(bar, { width: 920, height: 24 }, 2, 1, "The bar is 920 by 24"),
      edgeAt(bar, "left", 80, 2, 1, "The bar spans the frame"),
      gapBetween(square, bar, "vertical", 0, 2, 2, "The bar's top touches the square's bottom corner"),
      sizeIs(withText("WEIMAR 1919"), { width: 400 }, 2, 2, "The title's box is 400 wide"),
      edgeAt(withText("WEIMAR 1919"), "right", 1000, 2, 1, "The title ends on the frame's right line"),
      edgeAt(withText("WEIMAR 1919"), "bottom", 1270, 2, 1, "The title sits on the frame's bottom line"),
      lineCount(withText("WEIMAR 1919"), 1, 1, "The title is on one line"),
      fillsMeasure(withText("WEIMAR 1919"), 1, 0.98, 2, "The title is as large as it goes on one line"),
      hugsText(visibleText, 8, 1),
      noOverlap((el) => triangle(el) || visibleText(el), 1, "The title clears the triangle"),
      marginAtLeast(80, 2),
    ],
    judgeCriteria: [
      "Does it read as a Bauhaus composition — bold primary shapes in tension?",
      "Do the shapes meet where the brief says they touch?",
      "Does the title anchor the corner rather than float?",
    ],
    maxTurns: 40,
  }),

  defineTask({
    id: "proto.gallery",
    title: "A justified photo gallery",
    family: "arrange",
    brief: [
      "Lay these eleven photos out as a justified gallery, the way a photo site does:",
      "",
      "  - The photos stay in their order, p1 to p11, reading left to right and then top to bottom.",
      "  - Every photo keeps its own proportions (its box keeps the aspect ratio it has now, within 1%).",
      "  - The photos in a row are all the same height, and each row runs exactly from x = 60 to x = 1020,",
      "    with exactly 12 units between neighbouring photos.",
      "  - Rows are exactly 12 units apart, and every row is between 180 and 340 tall.",
      "  - The first row starts at y = 60, and the last row ends somewhere between y = 1240 and y = 1290.",
      "",
      "How many photos go in each row is up to you. Keep all eleven, and do not change which photo is which.",
    ].join("\n"),
    initial: gallery,
    checks: galleryChecks,
    judgeCriteria: [
      "Does it read as a justified gallery — full-width rows of photos at consistent gutters?",
      "Are the photos in their original proportions?",
    ],
    maxTurns: 45,
  }),
];
