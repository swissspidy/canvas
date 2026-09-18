/**
 * Family: restyle — change the appearance, keep the layout.
 *
 * The reference is given as a written specification rather than as a reference
 * image. An image reference would have to be shown to the agent in every
 * condition, including `feedback: none`, which would put a picture into the
 * no-picture cell and wreck the feedback comparison. Describing the target in
 * words keeps the feedback axis clean; `docs/TASKS.md` records the tradeoff.
 *
 * Because the target is written down, it can be scored exactly. `usesPalette`
 * asks whether the colours came from the list, which a brief that says *which
 * colour goes where* is not asking: a card painted entirely in the accent red
 * is completely on-palette and has thrown the hierarchy away. `colorRoles`
 * reads the assignment the brief spells out, so the answer key and the brief
 * are the same document.
 *
 * This is also the family where the relational surface should have no
 * advantage at all, which makes it the control on the family breakdown — so it
 * matters that the difficulty here is colour reasoning and not geometry. Every
 * geometric lever is pinned shut.
 */

import { defineTask } from "./types.js";
import { doc, image, rect, text, POSTER_H, POSTER_W } from "./helpers.js";
import {
  colorRoles,
  geometryUnchanged,
  minContrast,
  preservesElements,
  styleUnchanged,
  surfacesNoLighterThan,
  textNoDarkerThan,
  textUnchanged,
  usesPalette,
} from "../eval/checks.js";

/** The style keys a restyle brief does not licence changing. */
const TYPE_KEYS = ["fontSize", "fontWeight", "align", "valign", "lineHeight", "padding", "radius"] as const;

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
    rect({ id: "tag", x: 90, y: 1140, w: 300, h: 80, z: 5, style: { fill: "#e9e4f2", radius: 40 } }),
    text({
      id: "tag_label",
      x: 90,
      y: 1140,
      w: 300,
      h: 80,
      z: 6,
      text: "Festivals",
      style: { fontSize: 28, fontWeight: "bold", color: "#4a3a6a", align: "center", valign: "middle" },
    }),
  ], { background: "#ffffff" });

const DARK_MODE_IDS = ["photo", "sheet", "title", "standfirst", "byline", "tag", "tag_label"];

export const restyleTasks = [
  defineTask({
    id: "restyle.palette-swap",
    title: "Restyle to a specified palette",
    family: "restyle",
    brief: [
      "Restyle this card to the following palette. Change colours only: nothing moves, nothing resizes,",
      "no type size, weight or alignment changes, and no copy is rewritten.",
      "",
      "  Canvas background: #12121f",
      "  Panel fill:        #1e1e33",
      "  Primary text:      #f4f1ea",
      "  Secondary text:    #a8a3c0",
      "  Accent fill:       #e3655b",
      "",
      "Use only these five colours, and use them as assigned:",
      "  - The canvas takes the background colour and the panel takes the panel fill.",
      "  - The heading and the price are primary text.",
      "  - The description is secondary text.",
      "  - The button keeps the accent fill, and its label is set in the background colour,",
      "    which is the only one of the five that is readable on the accent.",
      "",
      "Every piece of text must stay readable — at least 4.5:1 against what is behind it.",
    ].join("\n"),
    initial: paletteSwap,
    checks: [
      preservesElements(PALETTE_SWAP_IDS, 1),
      usesPalette(["#12121f", "#1e1e33", "#f4f1ea", "#a8a3c0", "#e3655b"], 2),
      // The brief says which colour goes where, so that is what gets scored.
      // On-palette-but-wrong-everywhere was worth full marks here.
      colorRoles(
        [
          { ids: ["panel"], prop: "fill", color: "#1e1e33", role: "panel fill" },
          { ids: ["heading", "price"], prop: "color", color: "#f4f1ea", role: "primary text" },
          { ids: ["description"], prop: "color", color: "#a8a3c0", role: "secondary text" },
          { ids: ["button"], prop: "fill", color: "#e3655b", role: "accent fill" },
          // Primary text on the accent is 2.97:1, so an assignment that put it
          // there would have contradicted the 4.5:1 the same brief asks for —
          // the task would have been unsatisfiable, and every run would have
          // recorded the same failure. The background colour on the accent is
          // 5.55:1.
          { ids: ["button_label"], prop: "color", color: "#12121f", role: "the label on the accent" },
        ],
        3,
        { background: "#12121f" },
      ),
      minContrast(4.5, 3),
      // "without moving or resizing anything". Keeping the ids is a different
      // claim from keeping the boxes, and only the ids were being checked.
      geometryUnchanged(paletteSwap(), PALETTE_SWAP_IDS, 2),
      // "no type size, weight or alignment changes". A restyle that also
      // resets the type is not the restyle that was asked for, and the colour
      // checks cannot see it.
      styleUnchanged(paletteSwap(), PALETTE_SWAP_IDS, 2, { keys: [...TYPE_KEYS] }),
      textUnchanged(paletteSwap(), ["heading", "price", "description", "button_label"], 1),
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
      "  - Every large surface — the canvas, the sheet — becomes genuinely dark.",
      "  - Every piece of text becomes light, and keeps a contrast ratio of at least 4.5:1",
      "    against whatever sits behind it.",
      "  - The tag keeps its role: a filled chip with a legible label on it.",
      "  - The photograph is left exactly as it is: same asset, same box, same style.",
      "",
      "Nothing moves, nothing resizes, no type size or weight changes, and no copy is rewritten.",
      "Fading elements out is not a dark theme — everything stays fully opaque.",
    ].join("\n"),
    initial: darkMode,
    checks: [
      preservesElements(DARK_MODE_IDS, 1),
      minContrast(4.5, 3),
      // Contrast is invariant under inversion, so it cannot tell a dark theme
      // from a light one. These two can.
      surfacesNoLighterThan(0.12, 4),
      textNoDarkerThan(0.4, 4, ["title", "standfirst", "byline", "tag_label"]),
      // "do not move or resize anything".
      geometryUnchanged(darkMode(), DARK_MODE_IDS, 2),
      // "The photograph is left exactly as it is." Geometry and id were held;
      // the asset, the opacity and a fill dropped on top of it were not, and
      // dimming the photo to 10% is the cheapest way to make a page look dark.
      styleUnchanged(darkMode(), ["photo"], 3),
      styleUnchanged(darkMode(), DARK_MODE_IDS, 2, { keys: [...TYPE_KEYS, "opacity"] }),
      textUnchanged(darkMode(), ["title", "standfirst", "byline", "tag_label"], 1),
    ],
    judgeCriteria: [
      "Does the layout read as a genuine dark theme rather than a light one with a few colors inverted?",
      "Is every piece of text comfortably readable?",
      "Does the photograph still sit naturally against the darkened sheet?",
      "Does the tag still read as a chip, rather than dissolving into the sheet?",
      "Was the layout left untouched, as asked?",
    ],
    maxTurns: 25,
  }),
];
