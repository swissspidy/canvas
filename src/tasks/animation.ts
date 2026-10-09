/**
 * Prototype: entrance animations.
 *
 * Not in the registered task set and not in any grid. These exist to find out
 * whether a different *kind* of task separates conditions on a strong model,
 * after every static family saturated on Opus 5.5 (`docs/PREREGISTRATION.md`
 * §13). The page is laid out already and must not change; the task is how it
 * arrives.
 *
 * What makes it hard is not the timing, which is stated and is arithmetic,
 * but the paths. The brief leaves the side an element flies in from to the
 * agent and says no text may be covered at any moment; the layout makes some
 * sides wrong, and nothing about the page at rest — or a screenshot of it —
 * shows which. The agent has to reason about motion it cannot see.
 *
 * Run by id, or with `--tasks anim` (and `proto`, which includes these).
 */

import { defineTask } from "./types.js";
import { doc, rect, text, POSTER_W, POSTER_H } from "./helpers.js";
import type { Doc } from "../doc/types.js";
import { containsText, geometryUnchanged, styleUnchanged } from "../eval/checks.js";
import { animatesAs, atRestBy, staggered, startsOffCanvas, staysInside, stillFromStart, textNeverCovered } from "../eval/motion.js";

/** How an entrance animation works, worded once and the same for every surface. */
export const MOTION_RULES = [
  "How animation works here: an element can have one entrance animation. It either fades in, its opacity rising",
  "from 0 to its own, or flies in, travelling in a straight line from a stated distance out on one side (left,",
  "right, top or bottom) to its place. Both run at a constant speed, starting at a delay in milliseconds from the",
  "moment the page opens and lasting a duration. An element's position and style are always where it comes to",
  "rest; before its delay it shows its starting state (invisible for a fade, displaced for a fly). Paint order",
  "does not change while anything moves.",
].join("\n");

const NAVY = "#14213d";
const FEATURES = ["12 km of forest trail", "Aid stations every 3 km", "Finisher medal and lunch", "Start 9:00, Saturday"];
const IDS = ["headline", "badge", "badge_text", "f1", "f2", "f3", "f4", "cta", "cta_label", "footer"];

const launch = (): Doc =>
  doc(
    [
      text({ id: "headline", x: 80, y: 120, w: 760, h: 275, z: 2, text: "Ridgeline\nTrail Run", style: { fontSize: 110, fontWeight: "bold", color: "#ffffff" } }),
      ...FEATURES.map((t, i) =>
        text({ id: `f${i + 1}`, x: 80, y: 470 + i * 100, w: 920, h: 60, z: 2, text: t, style: { fontSize: 44, color: "#e5e5e5" } }),
      ),
      rect({ id: "cta", x: 80, y: 1090, w: 460, h: 130, z: 3, style: { fill: "#fb8500", radius: 65 } }),
      text({ id: "cta_label", x: 80, y: 1090, w: 460, h: 130, z: 4, text: "Register now", style: { fontSize: 48, fontWeight: "bold", color: NAVY, align: "center", valign: "middle" } }),
      rect({ id: "badge", x: 780, y: 90, w: 200, h: 200, rot: 12, z: 5, style: { shape: "ellipse", fill: "#ffb703" } }),
      text({ id: "badge_text", x: 800, y: 135, w: 160, h: 110, z: 6, text: "NEW\nROUTE", style: { fontSize: 40, fontWeight: "bold", color: NAVY, align: "center", valign: "middle" } }),
      text({ id: "footer", x: 80, y: 1262, w: 920, h: 50, z: 7, text: "ridgelinerun.com  ·  Saturday 14 June", style: { fontSize: 34, color: "#e5e5e5" } }),
    ],
    { width: POSTER_W, height: POSTER_H, background: NAVY },
  );

// --- market: a timing puzzle ------------------------------------------------------

const DUSK = "#1b1b2f";
const MARKET_IDS = ["headline", "b1", "b2", "b3", "card", "card_caption", "cta", "cta_label", "footer"];

const market = (): Doc =>
  doc(
    [
      text({ id: "headline", x: 80, y: 90, w: 920, h: 140, z: 2, text: "Night Market", style: { fontSize: 112, fontWeight: "bold", color: "#ffffff" } }),
      ...["Food from 20 stalls", "Live music, two stages", "Free entry, all ages"].map((t, i) =>
        text({ id: `b${i + 1}`, x: 80, y: 330 + i * 80, w: 460, h: 50, z: 2, text: t, style: { fontSize: 36, color: "#e0e0e0" } }),
      ),
      rect({ id: "card", x: 560, y: 300, w: 440, h: 420, z: 4, style: { fill: "#e9c46a", radius: 24 } }),
      text({ id: "card_caption", x: 590, y: 630, w: 380, h: 60, z: 5, text: "Fridays from 6 pm", style: { fontSize: 40, fontWeight: "bold", color: DUSK } }),
      rect({ id: "cta", x: 80, y: 1090, w: 460, h: 120, z: 3, style: { fill: "#f4a261", radius: 60 } }),
      text({ id: "cta_label", x: 80, y: 1090, w: 460, h: 120, z: 4, text: "Get directions", style: { fontSize: 44, fontWeight: "bold", color: DUSK, align: "center", valign: "middle" } }),
      text({ id: "footer", x: 80, y: 1262, w: 920, h: 50, z: 7, text: "harbourside.example  ·  Fridays, May to September", style: { fontSize: 32, color: "#e0e0e0" } }),
    ],
    { width: POSTER_W, height: POSTER_H, background: DUSK },
  );

// --- cards: an ordering puzzle ------------------------------------------------------

const INK = "#1d3557";
const TIPS = ["1. Switch tariffs", "2. Seal the drafts", "3. Turn it down a degree", "4. Wash at thirty", "5. Unplug at night"];
const CARDS = TIPS.map((_, i) => `card${i + 1}`);
const TITLES = TIPS.map((_, i) => `title${i + 1}`);

const cards = (): Doc =>
  doc(
    [
      text({ id: "heading", x: 80, y: 70, w: 920, h: 70, z: 1, text: "Five ways to cut your energy bill", style: { fontSize: 50, fontWeight: "bold", color: INK } }),
      ...TIPS.flatMap((t, i) => [
        rect({ id: CARDS[i]!, x: 140, y: 200 + i * 215, w: 800, h: 180, z: 2 * i + 2, style: { fill: "#a8dadc", radius: 20 } }),
        text({ id: TITLES[i]!, x: 180, y: 200 + i * 215 + 55, w: 720, h: 70, z: 2 * i + 3, text: t, style: { fontSize: 48, fontWeight: "bold", color: INK } }),
      ]),
    ],
    { width: POSTER_W, height: POSTER_H, background: "#f1faee" },
  );

export const animationTasks = [
  defineTask({
    id: "anim.launch",
    title: "An event page's entrance",
    family: "compose",
    motion: true,
    brief: [
      "This event page is laid out and must not change: keep every element exactly where it is, at its size, in its",
      "style. Add entrance animations so that it plays like this:",
      "",
      "  - The badge, its text and the footer line (badge, badge_text, footer) are there from the first moment. Do not",
      "    animate them.",
      "  - The headline flies in, starting entirely off the canvas, from 0 to 600 ms. Which side it comes from is",
      "    up to you.",
      "  - The four feature lines fade in, top to bottom, over 300 ms each. f1 starts the moment the headline lands;",
      "    each of the others starts 150 ms after the one above it starts.",
      "  - The button and its label (cta, cta_label) fly in together, starting entirely off the canvas, beginning",
      "    200 ms after f4 has finished fading in, and lasting 450 ms. The label stays inside its button the whole",
      "    way. Which side they come from is up to you.",
      "  - Everything is at rest by 2000 ms.",
      "  - At no moment may any text be covered by anything painted above it — not while it moves, and not while",
      "    something else moves past it.",
      "",
      MOTION_RULES,
    ].join("\n"),
    initial: launch,
    checks: [
      containsText(["Ridgeline", "Register now"], 1),
      geometryUnchanged(launch(), IDS, 3),
      styleUnchanged(launch(), IDS, 2),
      stillFromStart(["badge", "badge_text", "footer"], 1),
      animatesAs(["headline"], { effect: "fly", delay: 0, duration: 600 }, 2, "The headline flies in from 0 to 600ms"),
      startsOffCanvas(["headline"], 2),
      animatesAs(["f1"], { effect: "fade", delay: 600, duration: 300 }, 1, "f1 fades in as the headline lands"),
      animatesAs(["f2"], { effect: "fade", delay: 750, duration: 300 }, 1, "f2 fades in 150ms after f1"),
      animatesAs(["f3"], { effect: "fade", delay: 900, duration: 300 }, 1, "f3 fades in 150ms after f2"),
      animatesAs(["f4"], { effect: "fade", delay: 1050, duration: 300 }, 1, "f4 fades in 150ms after f3"),
      animatesAs(["cta", "cta_label"], { effect: "fly", delay: 1550, duration: 450 }, 2, "The button flies in 200ms after f4, for 450ms"),
      startsOffCanvas(["cta", "cta_label"], 2),
      staysInside("cta_label", "cta", 2, "The label stays inside its button"),
      textNeverCovered(4),
      atRestBy(2000, 1),
    ],
    // The judge sees the page at rest, which this task does not change. It
    // scores that the page still reads; the motion is the checks' to score.
    judgeCriteria: [
      "Does the page read as an event poster, with a clear headline and call to action?",
      "Is every piece of text legible?",
    ],
    maxTurns: 30,
  }),

  defineTask({
    id: "anim.market",
    title: "A market poster's entrance, against the clock",
    family: "compose",
    motion: true,
    brief: [
      "This market poster is laid out and must not change: keep every element exactly where it is, at its size, in its",
      "style. Add entrance animations so that it plays like this:",
      "",
      "  - The headline flies in from the left, starting entirely off the canvas, from 0 to 600 ms.",
      "  - The photo card and its caption (card, card_caption) fly in together from the left, starting entirely off the",
      "    canvas, over 500 ms. The caption stays inside the card the whole way.",
      "  - The three blurb lines (b1, b2, b3) fade in, top to bottom, over 300 ms each; each starts 150 ms after the one",
      "    above it starts.",
      "  - The button and its label (cta, cta_label) fly in together from the bottom, starting entirely off the canvas,",
      "    over 500 ms. The label stays inside the button the whole way.",
      "  - The footer fades in over 300 ms.",
      "  - When each of these starts is up to you, except the headline's. Everything is at rest by 1600 ms.",
      "  - At no moment may any text be covered by anything painted above it — not while it moves, and not while",
      "    something else moves past it.",
      "",
      MOTION_RULES,
    ].join("\n"),
    initial: market,
    checks: [
      containsText(["Night Market", "Get directions"], 1),
      geometryUnchanged(market(), MARKET_IDS, 3),
      styleUnchanged(market(), MARKET_IDS, 2),
      animatesAs(["headline"], { effect: "fly", from: "left", delay: 0, duration: 600 }, 2, "The headline flies in from the left, 0 to 600ms"),
      startsOffCanvas(["headline"], 1),
      animatesAs(["card", "card_caption"], { effect: "fly", from: "left", duration: 500 }, 2, "The card flies in from the left over 500ms"),
      startsOffCanvas(["card", "card_caption"], 1),
      staysInside("card_caption", "card", 2, "The caption stays inside the card"),
      animatesAs(["b1", "b2", "b3"], { effect: "fade", duration: 300 }, 1, "The blurbs fade in over 300ms"),
      staggered(["b1", "b2", "b3"], 150, { order: "given" }, 2, "The blurbs start 150ms apart, top to bottom"),
      animatesAs(["cta", "cta_label"], { effect: "fly", from: "bottom", duration: 500 }, 2, "The button flies in from the bottom over 500ms"),
      startsOffCanvas(["cta", "cta_label"], 1),
      staysInside("cta_label", "cta", 2, "The label stays inside the button"),
      animatesAs(["footer"], { effect: "fade", duration: 300 }, 1, "The footer fades in over 300ms"),
      atRestBy(1600, 2),
      textNeverCovered(5),
    ],
    judgeCriteria: [
      "Does the page read as an event poster, with a clear headline and call to action?",
      "Is every piece of text legible?",
    ],
    maxTurns: 30,
  }),

  defineTask({
    id: "anim.cards",
    title: "A list of cards dropping in",
    family: "compose",
    motion: true,
    brief: [
      "This list of tips is laid out and must not change: keep every element exactly where it is, at its size, in its",
      "style. Add entrance animations so that it plays like this:",
      "",
      "  - The five cards (card1 to card5) drop in from the top, each starting entirely above the canvas, over 400 ms.",
      "    Each card's title (title1 to title5) travels with its card and stays inside it the whole way.",
      "  - The first card to drop starts at 0 ms, and each of the others starts 120 ms after the one before it. Which",
      "    card drops first, second and so on is up to you.",
      "  - The heading fades in over 300 ms, whenever you choose.",
      "  - Everything is at rest by 1400 ms.",
      "  - At no moment may any text be covered by anything painted above it — not while it moves, and not while",
      "    something else moves past it.",
      "",
      MOTION_RULES,
    ].join("\n"),
    initial: cards,
    checks: [
      containsText(["Five ways", "Switch tariffs", "Unplug at night"], 1),
      geometryUnchanged(cards(), ["heading", ...CARDS, ...TITLES], 3),
      styleUnchanged(cards(), ["heading", ...CARDS, ...TITLES], 2),
      animatesAs([...CARDS, ...TITLES], { effect: "fly", from: "top", duration: 400 }, 2, "The cards drop in from the top over 400ms"),
      startsOffCanvas([...CARDS, ...TITLES], 1),
      ...TITLES.map((t, i) => staysInside(t, CARDS[i]!, 1, `${t} stays inside ${CARDS[i]}`)),
      staggered(CARDS, 120, { order: "any", first: 0 }, 2, "The cards start 120ms apart, the first at 0ms"),
      animatesAs(["heading"], { effect: "fade", duration: 300 }, 1, "The heading fades in over 300ms"),
      atRestBy(1400, 1),
      textNeverCovered(5),
    ],
    judgeCriteria: [
      "Does the page read as a clear list of five tips?",
      "Is every piece of text legible?",
    ],
    maxTurns: 30,
  }),
];
