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
 *
 * Task set v2 (`docs/PREREGISTRATION.md` §13, 2026-10-07) keeps it that way and
 * makes the colour reasoning real: more elements, assignments that follow from
 * a contrast rule the agent has to compute ("whichever palette colour reads
 * best on the chip"), and dark-theme surfaces that must sit a stated contrast
 * step apart — which nobody can judge from a hex code by eye.
 */

import { defineTask } from "./types.js";
import { doc, image, rect, text, POSTER_H, POSTER_W } from "./helpers.js";
import {
  colorRoles,
  fillContrastBetween,
  fullyOpaque,
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
    rect({ id: "outline", x: 560, y: 860, w: 380, h: 110, z: 6, style: { fill: "transparent", radius: 55, strokeColor: "#d94f3d", strokeWidth: 3 } }),
    text({
      id: "outline_label",
      x: 560,
      y: 860,
      w: 380,
      h: 110,
      z: 7,
      text: "Save for later",
      style: { fontSize: 34, fontWeight: "bold", color: "#d94f3d", align: "center", valign: "middle" },
    }),
    rect({ id: "divider", x: 140, y: 820, w: 800, h: 3, z: 8, style: { fill: "#e0dcd4" } }),
    rect({ id: "tag", x: 700, y: 455, w: 240, h: 64, z: 9, style: { fill: "#f1ece4", radius: 32 } }),
    text({
      id: "tag_label",
      x: 700,
      y: 455,
      w: 240,
      h: 64,
      z: 10,
      text: "Single origin",
      style: { fontSize: 26, fontWeight: "bold", color: "#55556b", align: "center", valign: "middle" },
    }),
    text({
      id: "footnote",
      x: 140,
      y: 990,
      w: 800,
      h: 40,
      z: 11,
      text: "Free delivery on orders over $40",
      style: { fontSize: 24, color: "#8a8aa0" },
    }),
  ], { background: "#f7f4ee" });

const PALETTE_SWAP_IDS = [
  "panel",
  "heading",
  "price",
  "description",
  "button",
  "button_label",
  "outline",
  "outline_label",
  "divider",
  "tag",
  "tag_label",
  "footnote",
];

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
    rect({ id: "divider", x: 90, y: 1005, w: 900, h: 3, z: 7, style: { fill: "#e0dcd4" } }),
    rect({ id: "callout", x: 560, y: 1110, w: 430, h: 140, z: 8, style: { fill: "#f3f0f8", radius: 16 } }),
    text({
      id: "callout_text",
      x: 590,
      y: 1130,
      w: 370,
      h: 100,
      z: 9,
      text: "Tickets go on sale Friday at noon.",
      style: { fontSize: 28, color: "#3a3a52", lineHeight: 1.35 },
    }),
    rect({ id: "button", x: 90, y: 1250, w: 300, h: 70, z: 10, style: { fill: "#4a3a8a", radius: 35 } }),
    text({
      id: "button_label",
      x: 90,
      y: 1250,
      w: 300,
      h: 70,
      z: 11,
      text: "Read more",
      style: { fontSize: 26, fontWeight: "bold", color: "#ffffff", align: "center", valign: "middle" },
    }),
  ], { background: "#ffffff" });

const DARK_MODE_IDS = [
  "photo",
  "sheet",
  "title",
  "standfirst",
  "byline",
  "tag",
  "tag_label",
  "divider",
  "callout",
  "callout_text",
  "button",
  "button_label",
];
const DARK_TEXT = ["title", "standfirst", "byline", "tag_label", "callout_text"];

export const restyleTasks = [
  defineTask({
    id: "restyle.palette-swap",
    title: "Restyle to a specified palette",
    family: "restyle",
    brief: [
      "Restyle this card to the following palette. Change colours only: nothing moves, nothing resizes,",
      "no type size, weight, alignment, radius or stroke width changes, and no copy is rewritten.",
      "",
      "  Canvas background: #12121f",
      "  Panel fill:        #1e1e33",
      "  Primary text:      #f4f1ea",
      "  Secondary text:    #a8a3c0",
      "  Accent:            #e3655b",
      "  Muted fill:        #34345a",
      "  Rule:              #4a4a6a",
      "",
      "Use only these seven colours, and use them as assigned:",
      "  - The canvas takes the background colour and the panel takes the panel fill.",
      "  - The heading and the price are primary text; the description is secondary text.",
      "  - The divider is filled with the rule colour.",
      "  - The tag's chip takes the muted fill. Its label takes whichever of the seven colours has the",
      "    highest contrast against the muted fill.",
      "  - The solid button takes the accent fill. Its label takes whichever of the seven colours has the",
      "    highest contrast against the accent.",
      "  - The outline button keeps no fill, and its outline takes the accent. Its label is set in the",
      "    accent if the accent reaches at least 4.5:1 against the panel fill, and in primary text if not.",
      "  - The footnote is set in secondary text if secondary text reaches at least 7:1 against the panel",
      "    fill, and in primary text if not.",
      "",
      "Every piece of text must stay readable — at least 4.5:1 against what is behind it.",
    ].join("\n"),
    initial: paletteSwap,
    checks: [
      preservesElements(PALETTE_SWAP_IDS, 1),
      usesPalette(["#12121f", "#1e1e33", "#f4f1ea", "#a8a3c0", "#e3655b", "#34345a", "#4a4a6a"], 2),
      // The four rule-derived assignments are worked out here once, from the
      // palette, and the brief states the rules rather than the answers: the
      // best colour on the muted chip is primary text (10.4:1), on the accent
      // it is the background (5.6:1), the accent reaches 4.9:1 on the panel,
      // and secondary text reaches only 6.7:1 on it.
      colorRoles(
        [
          { ids: ["panel"], prop: "fill", color: "#1e1e33", role: "panel fill" },
          { ids: ["heading", "price"], prop: "color", color: "#f4f1ea", role: "primary text" },
          { ids: ["description"], prop: "color", color: "#a8a3c0", role: "secondary text" },
          { ids: ["divider"], prop: "fill", color: "#4a4a6a", role: "rule" },
          { ids: ["tag"], prop: "fill", color: "#34345a", role: "muted fill" },
          { ids: ["tag_label"], prop: "color", color: "#f4f1ea", role: "the best contrast on the muted fill" },
          { ids: ["button"], prop: "fill", color: "#e3655b", role: "accent" },
          { ids: ["button_label"], prop: "color", color: "#12121f", role: "the best contrast on the accent" },
          { ids: ["outline"], prop: "strokeColor", color: "#e3655b", role: "accent outline" },
          { ids: ["outline_label"], prop: "color", color: "#e3655b", role: "the accent, which clears 4.5:1 on the panel" },
          { ids: ["footnote"], prop: "color", color: "#f4f1ea", role: "primary text, as secondary misses 7:1 on the panel" },
        ],
        4,
        { background: "#12121f" },
      ),
      minContrast(4.5, 3),
      geometryUnchanged(paletteSwap(), PALETTE_SWAP_IDS, 2),
      // "no type size, weight or alignment changes". A restyle that also
      // resets the type is not the restyle that was asked for, and the colour
      // checks cannot see it.
      styleUnchanged(paletteSwap(), PALETTE_SWAP_IDS, 2, { keys: [...TYPE_KEYS, "strokeWidth"] }),
      textUnchanged(paletteSwap(), ["heading", "price", "description", "button_label", "outline_label", "tag_label", "footnote"], 1),
      fullyOpaque(PALETTE_SWAP_IDS.filter((id) => id !== "outline"), 1),
    ],
    judgeCriteria: [
      "Has the card been restyled to the given palette throughout?",
      "Is the hierarchy still legible — heading and price reading as primary, description as secondary?",
      "Does the button still read as a button?",
      "Was the layout genuinely left alone?",
    ],
    maxTurns: 35,
  }),

  defineTask({
    id: "restyle.dark-mode",
    title: "Convert a light layout to dark mode",
    family: "restyle",
    brief: [
      "Convert this light layout to a dark theme.",
      "",
      "  - The canvas and the sheet become genuinely dark: a relative luminance of 0.02 or less.",
      "  - Every piece of text becomes light, and reaches a contrast ratio of at least 7:1 against",
      "    whatever sits behind it — except the button's label, which needs at least 4.5:1 on the button.",
      "  - Each shape on the sheet sits a measured step away from the sheet's fill:",
      "      the callout box: between 1.2:1 and 1.5:1 against the sheet (one step lighter),",
      "      the tag's chip: between 1.6:1 and 2.4:1 against the sheet,",
      "      the divider: between 1.5:1 and 2.5:1 against the sheet,",
      "      the button: at least 3:1 against the sheet.",
      "  - The photograph is left exactly as it is: same asset, same box, same style.",
      "",
      "Nothing moves, nothing resizes, no type size or weight changes, and no copy is rewritten.",
      "Fading elements out is not a dark theme — everything stays fully opaque.",
    ].join("\n"),
    initial: darkMode,
    checks: [
      preservesElements(DARK_MODE_IDS, 1),
      minContrast(7, 3, DARK_TEXT),
      minContrast(4.5, 1, ["button_label"]),
      // Contrast is invariant under inversion, so it cannot tell a dark theme
      // from a light one. These two can.
      surfacesNoLighterThan(0.02, 4),
      textNoDarkerThan(0.4, 4, [...DARK_TEXT, "button_label"]),
      // "do not move or resize anything".
      geometryUnchanged(darkMode(), DARK_MODE_IDS, 2),
      // "The tag keeps its role: a filled chip with a legible label on it."
      // Every other check on this task is about the label, so setting the
      // chip's fill to `transparent` left the label perfectly readable against
      // the sheet and scored 100% — a conversion that deleted one of the
      // elements it was told to keep, in the only sense a reader cares about.
      // v2 states the step for every shape on the sheet, which closes the
      // same hole for each of them.
      fillContrastBetween("callout", "sheet", 1.2, 1.5, 2, "The callout is one step lighter than the sheet"),
      fillContrastBetween("tag", "sheet", 1.6, 2.4, 2, "The tag's chip stands off the sheet"),
      fillContrastBetween("divider", "sheet", 1.5, 2.5, 1, "The divider is visible on the sheet"),
      fillContrastBetween("button", "sheet", 3, 21, 2, "The button stands off the sheet"),
      // "The photograph is left exactly as it is." Geometry and id were held;
      // the asset, the opacity and a fill dropped on top of it were not, and
      // dimming the photo to 10% is the cheapest way to make a page look dark.
      styleUnchanged(darkMode(), ["photo"], 3),
      styleUnchanged(darkMode(), DARK_MODE_IDS, 2, { keys: [...TYPE_KEYS] }),
      // "Fading elements out is not a dark theme — everything stays fully
      // opaque." Held as its own check rather than as one key averaged in with
      // seven others: at `opacity: 0` on all seven elements that arrangement
      // lost 7 comparisons of 56, and every check that measures the page then
      // reported nothing wrong with it, because there was nothing left to
      // measure. A dark canvas behind an invisible document scored 92.7%.
      fullyOpaque(DARK_MODE_IDS, 3),
      textUnchanged(darkMode(), [...DARK_TEXT, "button_label"], 1),
    ],
    judgeCriteria: [
      "Does the layout read as a genuine dark theme rather than a light one with a few colors inverted?",
      "Is every piece of text comfortably readable?",
      "Does the photograph still sit naturally against the darkened sheet?",
      "Does the tag still read as a chip, rather than dissolving into the sheet?",
      "Do the callout, divider and button sit on the sheet as a deliberate set of steps?",
      "Was the layout left untouched, as asked?",
    ],
    maxTurns: 35,
  }),
];
