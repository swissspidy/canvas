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
import { animatesAs, atRestBy, startsOffCanvas, staysInside, stillFromStart, textNeverCovered } from "../eval/motion.js";

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
];
