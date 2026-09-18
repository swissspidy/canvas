/**
 * Family: repair — a broken layout arrives and has to be fixed.
 *
 * The starting documents are hand-built to break in one specific way each, so
 * a failure is attributable. They also carry the copy the agent must keep, so
 * "fix it by deleting the problem" scores zero on `preservesElements`.
 *
 * Each also pins the cheap escape that is not a repair: shrinking the shape
 * that is in the way, resizing the photograph that will not fit, fading out
 * the layer that is on top. Those all clear the defect the check measures
 * while leaving a worse document than the one the agent was handed, and every
 * one of them was available before the briefs said otherwise.
 *
 * `repair.mixed-defects` is the deliberate exception to the one-defect rule,
 * and it is there because fixing these defects one at a time reintroduces
 * them: it is the only task in the set where the agent has to hold three
 * constraints at once. Attribution survives it, because the checks are still
 * one per defect.
 */

import { defineTask } from "./types.js";
import { doc, image, rect, text, POSTER_H, POSTER_W } from "./helpers.js";
import {
  alignedOn,
  containsText,
  geometryUnchanged,
  inBounds,
  inRegion,
  marginAtLeast,
  noOverlap,
  noTextOcclusion,
  notCovered,
  paintOrder,
  preservesElements,
  rotationWithin,
  styleUnchanged,
  textUnchanged,
  verticalOrder,
} from "../eval/checks.js";

const overlappingStack = () =>
  doc([
    rect({ id: "panel", x: 60, y: 200, w: 960, h: 700, z: 0, style: { fill: "#f2efe9", radius: 16 } }),
    text({
      id: "headline",
      x: 100,
      y: 260,
      w: 880,
      h: 160,
      z: 1,
      text: "Quarterly Review",
      style: { fontSize: 84, fontWeight: "bold", color: "#1d1d2b" },
    }),
    text({
      id: "subhead",
      x: 100,
      y: 300,
      w: 880,
      h: 90,
      z: 2,
      text: "Three months of steady growth",
      style: { fontSize: 40, color: "#55556b" },
    }),
    text({
      id: "body",
      x: 100,
      y: 330,
      w: 880,
      h: 260,
      z: 3,
      text: "Revenue rose fourteen percent against a flat market, driven mostly by renewals rather than new business. Churn fell for the third quarter running.",
      style: { fontSize: 30, color: "#3a3a4d", lineHeight: 1.4 },
    }),
    rect({ id: "badge", x: 620, y: 270, w: 300, h: 300, z: 4, style: { fill: "#d94f3d", radius: 150 } }),
  ]);

const offCanvas = () =>
  doc([
    image({ id: "photo", x: -220, y: 40, w: 1000, h: 620, src: "photo/city", z: 0, alt: "a city skyline at night" }),
    text({
      id: "caption",
      x: 200,
      y: 700,
      w: 1040,
      h: 120,
      z: 1,
      text: "The skyline after the last train",
      style: { fontSize: 46, fontWeight: "bold", color: "#1a1a2e" },
    }),
    text({
      id: "credit",
      x: -60,
      y: 830,
      w: 600,
      h: 60,
      z: 2,
      text: "Photograph by R. Meyers",
      style: { fontSize: 26, color: "#5a5a72" },
    }),
    rect({ id: "tag_a", x: 120, y: 1240, w: 300, h: 90, z: 3, style: { fill: "#2b3a67", radius: 45 } }),
    rect({ id: "tag_b", x: 940, y: 1290, w: 300, h: 90, z: 4, style: { fill: "#8a6fa8", radius: 45 } }),
  ]);

const buriedText = () =>
  doc([
    rect({ id: "card", x: 80, y: 300, w: 920, h: 620, z: 0, style: { fill: "#ffffff", radius: 24, strokeColor: "#e0dcd4", strokeWidth: 2 } }),
    text({
      id: "title",
      x: 140,
      y: 360,
      w: 800,
      h: 120,
      z: 1,
      text: "Field Notes",
      style: { fontSize: 72, fontWeight: "bold", color: "#22223b" },
    }),
    text({
      id: "note",
      x: 140,
      y: 500,
      w: 800,
      h: 340,
      z: 2,
      text: "Six weeks in the valley. The river moved forty metres east after the spring melt, taking the old crossing with it. We rebuilt further upstream where the bank is rock rather than gravel.",
      style: { fontSize: 32, color: "#3d3d56", lineHeight: 1.45 },
    }),
    rect({ id: "blot", x: 220, y: 400, w: 640, h: 420, z: 3, style: { fill: "#f3c969", radius: 12, opacity: 1 } }),
  ], { background: "#efeae1" });

const zOrder = () =>
  doc([
    text({
      id: "hero_title",
      x: 100,
      y: 900,
      w: 880,
      h: 160,
      z: 0,
      text: "After the Last Train",
      style: { fontSize: 78, fontWeight: "bold", color: "#ffffff" },
    }),
    text({
      id: "hero_sub",
      x: 100,
      y: 1070,
      w: 880,
      h: 80,
      z: 1,
      text: "A night walk through the eastern districts",
      style: { fontSize: 34, color: "#e8e8f2" },
    }),
    rect({ id: "scrim", x: 0, y: 780, w: POSTER_W, h: 570, z: 2, style: { fill: "#0e172699" } }),
    image({ id: "hero_photo", x: 0, y: 0, w: POSTER_W, h: POSTER_H, src: "photo/city", z: 3 }),
  ]);

const crowdedMargins = () =>
  doc([
    text({
      id: "kicker",
      x: 4,
      y: 6,
      w: 500,
      h: 60,
      z: 0,
      text: "ANNUAL REPORT",
      style: { fontSize: 28, fontWeight: "bold", color: "#6b4f8a" },
    }),
    text({
      id: "title",
      x: 2,
      y: 80,
      w: 1076,
      h: 200,
      z: 1,
      text: "A Year of Building Quietly",
      style: { fontSize: 86, fontWeight: "bold", color: "#1d1d2b" },
    }),
    image({ id: "art", x: 0, y: 300, w: POSTER_W, h: 700, src: "photo/mountains", z: 2 }),
    text({
      id: "footer",
      x: 44,
      y: 1290,
      w: 1070,
      h: 56,
      z: 3,
      text: "ridgeline.fm  —  published March 2026",
      style: { fontSize: 24, color: "#55556b" },
    }),
  ]);

const mixedDefects = () =>
  doc([
    image({ id: "cover", x: -180, y: -60, w: 1000, h: 700, src: "photo/mountains", z: 3, alt: "a mountain range at dawn" }),
    rect({ id: "plate", x: 90, y: 700, w: 900, h: 420, z: 2, style: { fill: "#ffffff", radius: 20 } }),
    text({
      id: "lead",
      x: 130,
      y: 740,
      w: 820,
      h: 175,
      z: 0,
      text: "Carrying a Stage to Nine Thousand Feet",
      style: { fontSize: 62, fontWeight: "bold", color: "#1d1d2b" },
    }),
    text({
      id: "standfirst",
      x: 130,
      y: 925,
      w: 820,
      h: 180,
      z: 1,
      text: "Three days of music above the treeline, and the fortnight of hauling that makes it possible.",
      style: { fontSize: 32, color: "#3d3d56", lineHeight: 1.45 },
    }),
    text({
      id: "byline",
      x: 8,
      y: 1300,
      w: 700,
      h: 50,
      z: 4,
      text: "By Dana Okonkwo",
      style: { fontSize: 26, color: "#55556b" },
    }),
  ], { background: "#f4f1ea" });

/**
 * A notice knocked askew: four elements, four different angles, and a
 * consequence that follows from the angles rather than from the boxes — a card
 * that fits the canvas with 60 units to spare at every edge reaches 75 units
 * wider than the canvas at twelve degrees, so both of its sides hang off.
 *
 * Every box is where it belongs. Rotation turns an element about its own
 * centre, so straightening is the whole repair, and it needs nothing moved.
 * One defect, one lever, which is what keeps the family attributable.
 *
 * It is also the task where the document's numbers and its appearance come
 * apart hardest, which is why it is one of the two the rotation hypothesis
 * rests on: every angle is in the description the agent is given, and what
 * they add up to is trigonometry it has to do in its head — or read off a
 * picture. `docs/PREREGISTRATION.md` H5.
 */
const tiltedStack = () =>
  doc([
    rect({
      id: "card",
      x: 60,
      y: 160,
      w: 960,
      h: 1040,
      rot: -12,
      z: 0,
      style: { fill: "#ffffff", radius: 20, strokeColor: "#e0dcd4", strokeWidth: 2 },
    }),
    text({
      id: "title",
      x: 140,
      y: 260,
      w: 800,
      h: 150,
      rot: 6,
      z: 1,
      text: "Closing for the Season",
      style: { fontSize: 62, fontWeight: "bold", color: "#22223b" },
    }),
    text({
      id: "body",
      x: 140,
      y: 440,
      w: 800,
      h: 380,
      rot: -5,
      z: 2,
      text: "The shop shuts on the last Sunday in October and opens again when the pass is clear, which is usually the second week of May. Orders placed before then ship in the spring.",
      style: { fontSize: 34, color: "#3d3d56", lineHeight: 1.45 },
    }),
    rect({ id: "stamp", x: 700, y: 900, w: 240, h: 240, rot: 14, z: 3, style: { fill: "#d94f3d", radius: 24 } }),
  ], { background: "#efeae1" });

export const repairTasks = [
  defineTask({
    id: "repair.overlapping-stack",
    title: "Fix an overlapping layout",
    family: "repair",
    brief: [
      "This layout has elements piled on top of each other, so some of the text cannot be read.",
      "Fix it. Keep every element and keep all of the copy exactly as it is —",
      "move, resize or restack things, but do not delete anything and do not rewrite the text.",
      "",
      "When you are done: no block of text may overlap another, the three blocks must still read",
      "headline, subhead, body from top to bottom, and nothing may be painted over any of them.",
      "Keep everything at least 40 units clear of every canvas edge.",
    ].join("\n"),
    initial: overlappingStack,
    checks: [
      preservesElements(["panel", "headline", "subhead", "body", "badge"], 2),
      containsText(["Quarterly Review", "Three months of steady growth"], 1),
      // "keep all of the copy exactly as it is ... do not rewrite the text".
      // `containsText` named two of the three text elements, so the body copy
      // could be shortened away — the cheapest way to clear an occlusion
      // without doing any layout work.
      textUnchanged(overlappingStack(), ["headline", "subhead", "body"], 3),
      noTextOcclusion(3),
      // Occlusion asks whether the glyphs are hidden, which two blocks can
      // avoid while still sitting on top of each other — a 30-unit line
      // threading the gap between two lines of a paragraph is not a fix.
      noOverlap(["headline", "subhead", "body"], 2, "The three blocks of text do not overlap"),
      verticalOrder(["headline", "subhead", "body"], 2),
      marginAtLeast(40, 1),
    ],
    judgeCriteria: [
      "Is every piece of text now fully readable?",
      "Does the result look like a designed panel rather than elements shoved apart until they stopped touching?",
      "Is the reading order — headline, subhead, body — still obvious?",
      "Does the badge sit somewhere deliberate rather than wherever it ended up?",
    ],
    maxTurns: 30,
  }),

  defineTask({
    id: "repair.off-canvas",
    title: "Bring stray elements back on canvas",
    family: "repair",
    brief: [
      "Several elements have drifted off the edge of the canvas and are being cut off.",
      "Bring everything fully inside the canvas, keeping the layout's intent: the photo stays at the top,",
      "the caption stays under the photo, the credit under the caption, and the two tags stay side by side",
      "near the bottom, sharing a centre line.",
      "",
      "Keep all five elements. Do not resize the photo — it already fits, it is simply in the wrong place —",
      "and leave at least 24 units between anything and a canvas edge.",
    ].join("\n"),
    initial: offCanvas,
    checks: [
      preservesElements(["photo", "caption", "credit", "tag_a", "tag_b"], 2),
      inBounds(3),
      // "Do not resize the photo." Squashing it to fit is the cheap fix, and
      // it was worth full marks: the photo is 1000 units wide on a 1080-unit
      // canvas, so the repair is a move of 220 units and nothing else.
      geometryUnchanged(offCanvas(), ["photo"], 2, { fields: ["width", "height"] }),
      inRegion(["photo"], { x0: 0.2, y0: 0, x1: 0.8, y1: 0.45 }, 1, "The photo stays in the upper half"),
      verticalOrder(["photo", "caption", "credit"], 2),
      inRegion(["tag_a", "tag_b"], { x0: 0, y0: 0.6, x1: 1, y1: 1 }, 1, "The tags stay near the bottom"),
      alignedOn("vcenter", ["tag_a", "tag_b"], 2, 1),
      marginAtLeast(24, 1),
    ],
    judgeCriteria: [
      "Is every element fully visible, with nothing cropped by the canvas edge?",
      "Was the original arrangement preserved — photo above, caption beneath, tags at the bottom?",
      "Do the margins look intentional and roughly even?",
    ],
    maxTurns: 30,
  }),

  defineTask({
    id: "repair.buried-text",
    title: "Rescue text buried under a shape",
    family: "repair",
    brief: [
      "A decorative shape was added on top of this card and it is now covering the text.",
      "Make all of the text readable again without deleting the shape or the text.",
      "",
      "The shape keeps its 640 by 420 size and stays fully inside the card, and the card itself stays",
      "exactly where it is. Move the shape, restack it, or move the text around it — but the shape is",
      "part of the design, so it has to end up somewhere a designer would have put it.",
    ].join("\n"),
    initial: buriedText,
    checks: [
      preservesElements(["card", "title", "note", "blot"], 2),
      containsText(["Field Notes"], 1),
      // "without deleting the shape or the text" — and shortening the note is
      // deleting the text by other means.
      //
      // Weighted one above the occlusion check it defends, rather than level
      // with it. Gutting the copy clears every occlusion outright, so at equal
      // weight the two cancel exactly: deleting the text scored the same as
      // leaving the card untouched. It has to cost more than it pays.
      textUnchanged(buriedText(), ["title", "note"], 4),
      noTextOcclusion(5),
      // "without shrinking the shape". A 1x1 blot occludes nothing, and that
      // was the whole task solved in one call.
      geometryUnchanged(buriedText(), ["blot"], 2, { fields: ["width", "height"] }),
      geometryUnchanged(buriedText(), ["card"], 1),
      inRegion(["blot"], { x0: 0.074, y0: 0.222, x1: 0.926, y1: 0.682 }, 1, "The shape stays on the card", {
        whole: true,
      }),
      marginAtLeast(24, 1),
    ],
    judgeCriteria: [
      "Is all of the text readable?",
      "Does the shape still play a deliberate decorative role, rather than being hidden or shoved off to a corner?",
      "Does the card still read as one composed object?",
    ],
    maxTurns: 25,
  }),

  defineTask({
    id: "repair.z-order",
    title: "Fix a broken stacking order",
    family: "repair",
    brief: [
      "The stacking order on this hero image is wrong: the background photo is painted over the text,",
      "and the scrim that should sit behind the text is on top of everything.",
      "Fix the layering so the photo is at the back, the scrim sits over the photo, the title sits over",
      "the scrim, and the subtitle over that.",
      "",
      "Only the stacking needs to change: do not move anything, do not resize anything,",
      "and do not restyle anything either — the same fills, colours and opacities come out the other side.",
    ].join("\n"),
    initial: zOrder,
    checks: [
      preservesElements(["hero_title", "hero_sub", "scrim", "hero_photo"], 2),
      noTextOcclusion(3),
      // The occlusion check measures the symptom, and the symptom has a second
      // cure: fade the photograph to nothing and it covers nothing. This reads
      // the stacking the brief is actually about.
      paintOrder(["hero_photo", "scrim", "hero_title", "hero_sub"], 4),
      // "Do not move or resize anything — only the stacking needs to change."
      // A loose region on one element was standing in for that.
      geometryUnchanged(zOrder(), ["hero_title", "hero_sub", "scrim", "hero_photo"], 2),
      styleUnchanged(zOrder(), ["hero_title", "hero_sub", "scrim", "hero_photo"], 2),
      textUnchanged(zOrder(), ["hero_title", "hero_sub"], 1),
    ],
    judgeCriteria: [
      "Is the photo behind everything, with the text clearly on top?",
      "Does the scrim sit between them, so the text has something to read against?",
      "Were the positions and sizes left alone, as asked?",
    ],
    maxTurns: 20,
  }),

  defineTask({
    id: "repair.crowded-margins",
    title: "Give a cramped layout room to breathe",
    family: "repair",
    brief: [
      "Everything in this layout is jammed against the edges of the canvas.",
      "Rework it so every element keeps a margin of at least 60 units from every canvas edge,",
      "while keeping the same vertical order: kicker, title, art, footer.",
      "",
      "Line all four up on a single left edge, and keep all four elements.",
      "Nothing may overlap anything else when you are done.",
    ].join("\n"),
    initial: crowdedMargins,
    checks: [
      preservesElements(["kicker", "title", "art", "footer"], 2),
      marginAtLeast(60, 3),
      inBounds(1),
      // Two loose region bands were standing in for "the same vertical
      // order": both are satisfied by a kicker and a title that have swapped
      // places inside the top third.
      verticalOrder(["kicker", "title", "art", "footer"], 2),
      alignedOn("left", ["kicker", "title", "art", "footer"], 2, 2),
      noOverlap(["kicker", "title", "art", "footer"], 1),
    ],
    judgeCriteria: [
      "Does every element now sit comfortably inside a consistent margin?",
      "Is the vertical order — kicker, title, art, footer — unchanged?",
      "Do the margins look like a deliberate grid rather than four different guesses?",
    ],
    maxTurns: 30,
  }),

  defineTask({
    id: "repair.tilted-stack",
    title: "Straighten a card knocked askew",
    family: "repair",
    brief: [
      "Every element on this notice has been knocked askew, each by a different amount, and the card now hangs",
      "off both sides of the canvas because of it.",
      "",
      "Put all four back upright — square to the canvas, at zero degrees.",
      "Nothing needs to move or resize: every box is already where it belongs, and turning an element about its",
      "own centre is enough. So do not change any element's position or size, do not delete anything,",
      "and do not rewrite the copy.",
    ].join("\n"),
    initial: tiltedStack,
    checks: [
      preservesElements(["card", "title", "body", "stamp"], 2),
      // Budget 5, not the default 10: "square to the canvas" has no band of
      // acceptable tilt, and a reader sees three degrees.
      rotationWithin(["card", "title", "body", "stamp"], 0, 8, {
        budget: 5,
        label: "Everything is square to the canvas",
      }),
      // The boxes are already right, so straightening is the whole repair —
      // and a run that "fixes" the overhang by shoving the card left has not
      // done it.
      geometryUnchanged(tiltedStack(), ["card", "title", "body", "stamp"], 2, {
        fields: ["x", "y", "width", "height"],
      }),
      inBounds(2),
      textUnchanged(tiltedStack(), ["title", "body"], 1),
      marginAtLeast(40, 1),
    ],
    judgeCriteria: [
      "Is everything square to the canvas?",
      "Is the card fully on the canvas, with the margins looking even?",
      "Are the title and the body clear of each other and comfortable to read?",
      "Does the notice look like it was never knocked about, rather than patched up?",
    ],
    maxTurns: 25,
  }),

  defineTask({
    id: "repair.mixed-defects",
    title: "Three defects at once",
    family: "repair",
    brief: [
      "This article opener is broken in three separate ways: the cover photo hangs off the top-left",
      "corner, the white plate and the two blocks of text on it are stacked in the wrong order so the",
      "copy is buried, and the byline is jammed into the bottom-left corner.",
      "",
      "Fix all three. When you are done:",
      "  - Every element is fully on the canvas, at least 40 units clear of every edge.",
      "  - The photo sits above the plate, the plate is painted behind the lead and the standfirst,",
      "    and nothing is painted over either of them.",
      "  - The order down the page is photo, lead, standfirst, byline, and nothing overlaps the byline.",
      "  - Keep all five elements and every word of the copy exactly as it is.",
      "  - Do not resize the photo.",
    ].join("\n"),
    initial: mixedDefects,
    checks: [
      preservesElements(["cover", "plate", "lead", "standfirst", "byline"], 2),
      textUnchanged(mixedDefects(), ["lead", "standfirst", "byline"], 2),
      inBounds(3),
      marginAtLeast(40, 2),
      geometryUnchanged(mixedDefects(), ["cover"], 1, { fields: ["width", "height"] }),
      paintOrder(["plate", "lead", "standfirst"], 3),
      noTextOcclusion(3),
      notCovered(["cover"], 1, "Nothing is painted over the photo"),
      verticalOrder(["cover", "lead", "standfirst", "byline"], 2),
      noOverlap(["lead", "standfirst", "byline"], 2),
    ],
    judgeCriteria: [
      "Are all three defects fixed, rather than one of them traded for another?",
      "Does the opener read as a single composition — photo, headline, standfirst, byline?",
      "Is the white plate doing its job, sitting behind the copy rather than over it?",
      "Do the margins and the gaps look deliberate?",
    ],
    maxTurns: 35,
  }),
];
