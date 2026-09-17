/**
 * Family: restyle — change the appearance, keep the layout.
 *
 * The reference is given as a written specification rather than as a reference
 * image. An image reference would have to be shown to the agent in every
 * condition, including `feedback: none`, which would put a picture into the
 * no-picture cell and wreck the feedback comparison. Describing the target in
 * words keeps the feedback axis clean; `docs/TASKS.md` records the tradeoff.
 */

import { defineTask } from "./types.js";
import { doc, image, rect, text, POSTER_H, POSTER_W } from "./helpers.js";
import {
  geometryUnchanged,
  minContrast,
  preservesElements,
  surfacesNoLighterThan,
  textNoDarkerThan,
  usesPalette,
} from "../eval/checks.js";

const paletteSwap = () =>
  doc([
    rect({ id: "panel", x: 90, y: 280, w: 900, h: 760, z: 0, style: { fill: "#ffffff", radius: 24 } }),
    text({
      id: "heading",
      x: 140,
      y: 330,
      w: 800,
      h: 110,
      z: 1,
      text: "Ridge Roast",
      style: { fontSize: 68, fontWeight: "bold", color: "#1d1d2b" },
    }),
    text({
      id: "price",
      x: 140,
      y: 450,
      w: 800,
      h: 80,
      z: 2,
      text: "$18.00",
      style: { fontSize: 52, fontWeight: "bold", color: "#2b3a67" },
    }),
    text({
      id: "description",
      x: 140,
      y: 560,
      w: 800,
      h: 240,
      z: 3,
      text: "A dark, cocoa-forward blend from three Colorado farms. Roasted weekly and shipped the next morning.",
      style: { fontSize: 30, color: "#55556b", lineHeight: 1.45 },
    }),
    rect({ id: "button", x: 140, y: 860, w: 380, h: 110, z: 4, style: { fill: "#d94f3d", radius: 55 } }),
    text({
      id: "button_label",
      x: 140,
      y: 860,
      w: 380,
      h: 110,
      z: 5,
      text: "Add to basket",
      style: { fontSize: 34, fontWeight: "bold", color: "#ffffff", align: "center", valign: "middle" },
    }),
  ], { background: "#f7f4ee" });

const PALETTE_SWAP_IDS = ["panel", "heading", "price", "description", "button", "button_label"];

const darkMode = () =>
  doc([
    image({ id: "photo", x: 0, y: 0, w: POSTER_W, h: 560, src: "photo/mountains", z: 0 }),
    rect({ id: "sheet", x: 0, y: 560, w: POSTER_W, h: POSTER_H - 560, z: 1, style: { fill: "#ffffff" } }),
    text({
      id: "title",
      x: 90,
      y: 630,
      w: 900,
      h: 130,
      z: 2,
      text: "Above the Clouds",
      style: { fontSize: 72, fontWeight: "bold", color: "#1a1a2e" },
    }),
    text({
      id: "standfirst",
      x: 90,
      y: 790,
      w: 900,
      h: 200,
      z: 3,
      text: "Three days of music at nine thousand feet, and what it takes to carry a stage up there.",
      style: { fontSize: 34, color: "#4a4a63", lineHeight: 1.45 },
    }),
    text({
      id: "byline",
      x: 90,
      y: 1030,
      w: 900,
      h: 60,
      z: 4,
      text: "By Dana Okonkwo",
      style: { fontSize: 26, color: "#6a6a85" },
    }),
  ], { background: "#ffffff" });

const DARK_MODE_IDS = ["photo", "sheet", "title", "standfirst", "byline"];

export const restyleTasks = [
  defineTask({
    id: "restyle.palette-swap",
    title: "Restyle to a specified palette",
    family: "restyle",
    brief: [
      "Restyle this card to match the following palette, without moving or resizing anything.",
      "",
      "  Canvas background: #12121f",
      "  Panel fill:        #1e1e33",
      "  Primary text:      #f4f1ea",
      "  Secondary text:    #a8a3c0",
      "  Accent fill:       #e3655b",
      "",
      "Use only these five colors. The heading and the price are primary text,",
      "the description is secondary text, and the button keeps the accent fill.",
      "Every piece of text must stay comfortably readable against what is behind it.",
    ].join("\n"),
    initial: paletteSwap,
    checks: [
      preservesElements(PALETTE_SWAP_IDS, 1),
      usesPalette(["#12121f", "#1e1e33", "#f4f1ea", "#a8a3c0", "#e3655b"], 3),
      minContrast(4.5, 3),
      // "without moving or resizing anything". Keeping the ids is a different
      // claim from keeping the boxes, and only the ids were being checked.
      geometryUnchanged(paletteSwap(), PALETTE_SWAP_IDS, 2),
    ],
    judgeCriteria: [
      "Has the card been restyled to the given palette throughout?",
      "Is the hierarchy still legible — heading and price reading as primary, description as secondary?",
      "Does the button still read as a button?",
      "Was the layout genuinely left alone?",
    ],
    maxTurns: 25,
  }),

  defineTask({
    id: "restyle.dark-mode",
    title: "Convert a light layout to dark mode",
    family: "restyle",
    brief: [
      "Convert this light layout to a dark theme.",
      "",
      "The background should become dark, text should become light, and every piece of text must end up",
      "with a contrast ratio of at least 4.5:1 against whatever sits behind it.",
      "Keep the photograph as it is, and do not move or resize anything.",
    ].join("\n"),
    initial: darkMode,
    checks: [
      preservesElements(DARK_MODE_IDS, 1),
      minContrast(4.5, 3),
      // Contrast is invariant under inversion, so it cannot tell a dark theme
      // from a light one. These two do.
      surfacesNoLighterThan(0.15, 3),
      textNoDarkerThan(0.35, 3, ["title", "standfirst", "byline"]),
      // "do not move or resize anything".
      geometryUnchanged(darkMode(), DARK_MODE_IDS, 2),
    ],
    judgeCriteria: [
      "Does the layout read as a genuine dark theme rather than a light one with a few colors inverted?",
      "Is every piece of text comfortably readable?",
      "Does the photograph still sit naturally against the darkened sheet?",
      "Was the layout left untouched, as asked?",
    ],
    maxTurns: 25,
  }),
];
