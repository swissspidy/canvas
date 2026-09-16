/**
 * Family: repair — a broken layout arrives and has to be fixed.
 *
 * The starting documents are hand-built to break in one specific way each, so
 * a failure is attributable. They also carry the copy the agent must keep, so
 * "fix it by deleting the problem" scores zero on `preservesElements`.
 */

import { defineTask } from "./types.js";
import { doc, image, rect, text, POSTER_H, POSTER_W } from "./helpers.js";
import {
  alignedOn,
  containsText,
  inBounds,
  inRegion,
  marginAtLeast,
  noTextOcclusion,
  preservesElements,
} from "../eval/checks.js";

export const repairTasks = [
  defineTask({
    id: "repair.overlapping-stack",
    title: "Fix an overlapping layout",
    family: "repair",
    brief: [
      "This layout has elements piled on top of each other, so some of the text cannot be read.",
      "Fix it. Keep every element and keep all of the copy exactly as it is —",
      "move, resize or restack things, but do not delete anything and do not rewrite the text.",
    ].join("\n"),
    initial: () =>
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
          y: 330,
          w: 880,
          h: 90,
          z: 2,
          text: "Three months of steady growth",
          style: { fontSize: 40, color: "#55556b" },
        }),
        text({
          id: "body",
          x: 100,
          y: 360,
          w: 880,
          h: 260,
          z: 3,
          text: "Revenue rose fourteen percent against a flat market, driven mostly by renewals rather than new business. Churn fell for the third quarter running.",
          style: { fontSize: 30, color: "#3a3a4d", lineHeight: 1.4 },
        }),
        rect({ id: "badge", x: 700, y: 280, w: 240, h: 240, z: 4, style: { fill: "#d94f3d", radius: 120 } }),
      ]),
    checks: [
      preservesElements(["panel", "headline", "subhead", "body", "badge"], 2),
      containsText(["Quarterly Review", "Three months of steady growth"], 1),
      noTextOcclusion(3),
      marginAtLeast(24, 1),
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
      "the caption stays under the photo, and the two tags stay side by side near the bottom.",
      "Keep all five elements.",
    ].join("\n"),
    initial: () =>
      doc([
        image({ id: "photo", x: -140, y: 40, w: 1000, h: 620, src: "photo/city", z: 0, alt: "a city skyline at night" }),
        text({
          id: "caption",
          x: 120,
          y: 700,
          w: 1040,
          h: 120,
          z: 1,
          text: "The skyline after the last train",
          style: { fontSize: 46, fontWeight: "bold", color: "#1a1a2e" },
        }),
        text({
          id: "credit",
          x: 120,
          y: 830,
          w: 600,
          h: 60,
          z: 2,
          text: "Photograph by R. Meyers",
          style: { fontSize: 26, color: "#5a5a72" },
        }),
        rect({ id: "tag_a", x: 120, y: 1240, w: 300, h: 90, z: 3, style: { fill: "#2b3a67", radius: 45 } }),
        rect({ id: "tag_b", x: 880, y: 1240, w: 300, h: 90, z: 4, style: { fill: "#8a6fa8", radius: 45 } }),
      ]),
    checks: [
      preservesElements(["photo", "caption", "credit", "tag_a", "tag_b"], 2),
      inBounds(3),
      inRegion(["photo"], { x0: 0.2, y0: 0, x1: 0.8, y1: 0.45 }, 1, "The photo stays in the upper half"),
      inRegion(["tag_a", "tag_b"], { x0: 0, y0: 0.6, x1: 1, y1: 1 }, 1, "The tags stay near the bottom"),
      alignedOn("vcenter", ["tag_a", "tag_b"], 4, 1),
      marginAtLeast(16, 1),
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
    ].join("\n"),
    initial: () =>
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
        rect({ id: "blot", x: 260, y: 380, w: 560, h: 420, z: 3, style: { fill: "#f3c969", radius: 12, opacity: 1 } }),
      ], { background: "#efeae1" }),
    checks: [
      preservesElements(["card", "title", "note", "blot"], 2),
      containsText(["Field Notes"], 1),
      noTextOcclusion(3),
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
      "Fix the layering so the photo is at the back, the scrim sits over the photo, and the text sits over the scrim.",
      "Do not move or resize anything — only the stacking needs to change.",
    ].join("\n"),
    initial: () =>
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
      ]),
    checks: [
      preservesElements(["hero_title", "hero_sub", "scrim", "hero_photo"], 2),
      noTextOcclusion(4),
      // The fix is purely a restack, so the geometry must come through untouched.
      inRegion(["hero_title"], { x0: 0.35, y0: 0.6, x1: 0.65, y1: 0.85 }, 1, "The title has not been moved"),
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
      "while keeping the same vertical order and the same relative sizes. Keep all four elements.",
    ].join("\n"),
    initial: () =>
      doc([
        text({
          id: "kicker",
          x: 4,
          y: 6,
          w: 500,
          h: 60,
          z: 0,
          text: "ANNUAL REPORT",
          style: { fontSize: 28, fontWeight: "bold", color: "#8a6fa8" },
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
          x: 6,
          y: 1290,
          w: 1070,
          h: 56,
          z: 3,
          text: "ridgeline.fm  —  published March 2026",
          style: { fontSize: 24, color: "#55556b" },
        }),
      ]),
    checks: [
      preservesElements(["kicker", "title", "art", "footer"], 2),
      marginAtLeast(60, 3),
      inBounds(1),
      // Vertical order must survive the reflow.
      inRegion(["kicker"], { x0: 0, y0: 0, x1: 1, y1: 0.3 }, 1, "The kicker stays at the top"),
      inRegion(["footer"], { x0: 0, y0: 0.7, x1: 1, y1: 1 }, 1, "The footer stays at the bottom"),
    ],
    judgeCriteria: [
      "Does every element now sit comfortably inside a consistent margin?",
      "Is the vertical order — kicker, title, art, footer — unchanged?",
      "Do the margins look like a deliberate grid rather than four different guesses?",
    ],
    maxTurns: 30,
  }),
];
