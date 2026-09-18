/**
 * Family: arrange — pure alignment and spacing.
 *
 * The narrowest family, and the one where the relational surface has the most
 * direct advantage: `align` and `distribute` are single calls for what the
 * coordinate surface must compute element by element. Including it is a
 * deliberate check on whether that advantage shows up where it should. If
 * relational operations do not win *here*, they are unlikely to win anywhere.
 *
 * Three tasks rather than two, because this family carries H4 and two tasks is
 * a thin basis for a per-family claim. `arrange.card-grid` is the one that
 * separates a surface with `align` and `distribute` from one without: the two
 * axes have to be reconciled at once, and getting the rows right by hand does
 * not get the columns right.
 *
 * The tolerances here are tight on purpose. `alignedOn` and `evenlySpaced`
 * used to bottom out at 40 units of spread, which on a 1080-unit canvas is a
 * rag anyone would see from across the room — and the ragged column scored
 * half marks for it before anything had been done.
 */

import { defineTask } from "./types.js";
import { doc, rect, text } from "./helpers.js";
import {
  alignedOn,
  evenlySpaced,
  geometryUnchanged,
  inBounds,
  marginAtLeast,
  noOverlap,
  outerMarginsBalanced,
  preservesElements,
} from "../eval/checks.js";

const raggedColumn = () =>
  doc([
    text({ id: "r1", x: 132, y: 220, w: 700, h: 80, z: 0, text: "Reduce the blast radius", style: { fontSize: 40, color: "#1d1d2b" } }),
    text({ id: "r2", x: 118, y: 336, w: 700, h: 80, z: 1, text: "Make the failure loud", style: { fontSize: 40, color: "#1d1d2b" } }),
    text({ id: "r3", x: 147, y: 420, w: 700, h: 80, z: 2, text: "Write down what it cost", style: { fontSize: 40, color: "#1d1d2b" } }),
    text({ id: "r4", x: 109, y: 561, w: 700, h: 80, z: 3, text: "Rebuild on rock, not gravel", style: { fontSize: 40, color: "#1d1d2b" } }),
    text({ id: "r5", x: 140, y: 648, w: 700, h: 80, z: 4, text: "Check it again in a season", style: { fontSize: 40, color: "#1d1d2b" } }),
  ], { background: "#f7f4ee" });

const unevenRow = () =>
  doc([
    rect({ id: "c1", x: 60, y: 520, w: 200, h: 300, z: 0, style: { fill: "#2b3a67", radius: 16 } }),
    rect({ id: "c2", x: 276, y: 548, w: 200, h: 300, z: 1, style: { fill: "#4a5a8a", radius: 16 } }),
    rect({ id: "c3", x: 492, y: 505, w: 200, h: 300, z: 2, style: { fill: "#8a6fa8", radius: 16 } }),
    rect({ id: "c4", x: 640, y: 533, w: 200, h: 300, z: 3, style: { fill: "#c98b6b", radius: 16 } }),
  ], { background: "#12121f" });

/**
 * Six cards that want to be a 3x2 grid and are not one.
 *
 * Every card is the same size, so the target is unambiguous: three columns
 * sharing a left edge, two rows sharing a top edge, one horizontal gap, one
 * vertical gap, and the same air at the left as at the right.
 */
const cardGrid = () =>
  doc([
    rect({ id: "g1", x: 74, y: 300, w: 280, h: 320, z: 0, style: { fill: "#2b3a67", radius: 16 } }),
    rect({ id: "g2", x: 402, y: 268, w: 280, h: 320, z: 1, style: { fill: "#4a5a8a", radius: 16 } }),
    rect({ id: "g3", x: 700, y: 318, w: 280, h: 320, z: 2, style: { fill: "#8a6fa8", radius: 16 } }),
    rect({ id: "g4", x: 96, y: 700, w: 280, h: 320, z: 3, style: { fill: "#c98b6b", radius: 16 } }),
    rect({ id: "g5", x: 379, y: 742, w: 280, h: 320, z: 4, style: { fill: "#6b8a6f", radius: 16 } }),
    rect({ id: "g6", x: 726, y: 688, w: 280, h: 320, z: 5, style: { fill: "#a8546b", radius: 16 } }),
  ], { background: "#12121f" });

export const arrangeTasks = [
  defineTask({
    id: "arrange.ragged-column",
    title: "Straighten a ragged column",
    family: "arrange",
    brief: [
      "These five rows were placed by hand and none of them line up.",
      "Line them all up on a single left edge and give them equal vertical gaps.",
      "Centre the column vertically as well: the same space above the first row as below the last.",
      "",
      "Do not change any element's size, and keep all five.",
    ].join("\n"),
    initial: raggedColumn,
    checks: [
      preservesElements(["r1", "r2", "r3", "r4", "r5"], 1),
      alignedOn("left", ["r1", "r2", "r3", "r4", "r5"], 1.5, 4),
      evenlySpaced("vertical", ["r1", "r2", "r3", "r4", "r5"], 1.5, 4),
      // "the same space above the first row as below the last". `evenlySpaced`
      // measures only the gaps between neighbours, so a perfectly regular
      // column shoved against the top of the canvas scores full marks on it.
      outerMarginsBalanced("vertical", ["r1", "r2", "r3", "r4", "r5"], 2, 2),
      // "Do not change any element's size" — position is the whole point here,
      // so only the boxes are held still.
      geometryUnchanged(raggedColumn(), ["r1", "r2", "r3", "r4", "r5"], 2, { fields: ["width", "height"] }),
      inBounds(1),
    ],
    judgeCriteria: [
      "Do the five rows share one left edge?",
      "Are the vertical gaps visibly equal?",
      "Does the column read as a deliberate list?",
    ],
    maxTurns: 25,
  }),

  defineTask({
    id: "arrange.uneven-row",
    title: "Space a row of cards evenly",
    family: "arrange",
    brief: [
      "These four cards are bunched to one side with uneven gaps between them.",
      "Space them evenly across the canvas, keeping equal gaps between neighbours and equal margins",
      "at the far left and far right. They should all share a common top edge.",
      "Do not resize them, and do not let them touch or overlap.",
    ].join("\n"),
    initial: unevenRow,
    checks: [
      preservesElements(["c1", "c2", "c3", "c4"], 1),
      alignedOn("top", ["c1", "c2", "c3", "c4"], 1.5, 3),
      evenlySpaced("horizontal", ["c1", "c2", "c3", "c4"], 2, 4),
      // The brief asks for equal outer margins as well as equal inner gaps,
      // and `evenlySpaced` only measures the gaps between neighbours.
      outerMarginsBalanced("horizontal", ["c1", "c2", "c3", "c4"], 2, 2),
      geometryUnchanged(unevenRow(), ["c1", "c2", "c3", "c4"], 2, { fields: ["width", "height"] }),
      noOverlap(["c1", "c2", "c3", "c4"], 2),
      inBounds(2),
    ],
    judgeCriteria: [
      "Are the four cards evenly spaced across the canvas?",
      "Do they share a top edge?",
      "Are the outer margins balanced, so the row looks centred rather than pushed to one side?",
    ],
    maxTurns: 25,
  }),

  defineTask({
    id: "arrange.card-grid",
    title: "Pull six cards into a grid",
    family: "arrange",
    brief: [
      "These six cards are meant to be a three-by-two grid and every one of them is slightly off.",
      "",
      "Lay them out as a grid, keeping each card in the cell it is nearest to now:",
      "  - g1, g2, g3 are the top row; g4, g5, g6 are the bottom row.",
      "  - g1 and g4 share a left edge, g2 and g5 share a left edge, g3 and g6 share a left edge.",
      "  - Each row shares a top edge.",
      "  - The horizontal gaps between neighbouring columns are equal, and so are the margins",
      "    at the far left and the far right.",
      "  - The two rows are separated by a single even gap, and the space above the top row matches",
      "    the space below the bottom row.",
      "",
      "Do not resize anything, keep all six cards, and keep everything at least 40 units",
      "clear of every canvas edge.",
    ].join("\n"),
    initial: cardGrid,
    checks: [
      preservesElements(["g1", "g2", "g3", "g4", "g5", "g6"], 1),
      // Columns, then rows. Scored separately because a run that gets the rows
      // right and the columns wrong has done half the job, and one combined
      // check would call that a failure.
      alignedOn("left", ["g1", "g4"], 1.5, 2),
      alignedOn("left", ["g2", "g5"], 1.5, 2),
      alignedOn("left", ["g3", "g6"], 1.5, 2),
      alignedOn("top", ["g1", "g2", "g3"], 1.5, 3),
      alignedOn("top", ["g4", "g5", "g6"], 1.5, 3),
      evenlySpaced("horizontal", ["g1", "g2", "g3"], 2, 3),
      evenlySpaced("horizontal", ["g4", "g5", "g6"], 2, 3),
      outerMarginsBalanced("horizontal", ["g1", "g2", "g3"], 2, 2),
      outerMarginsBalanced("vertical", ["g1", "g2", "g3", "g4", "g5", "g6"], 2, 2),
      geometryUnchanged(cardGrid(), ["g1", "g2", "g3", "g4", "g5", "g6"], 2, { fields: ["width", "height"] }),
      noOverlap(["g1", "g2", "g3", "g4", "g5", "g6"], 2),
      marginAtLeast(40, 1),
      inBounds(1),
    ],
    judgeCriteria: [
      "Does it read as a grid — three columns, two rows, one rhythm?",
      "Are the gutters between columns the same as each other, and the row gap consistent?",
      "Is the block of cards sitting squarely on the canvas rather than drifting to one side?",
      "Did the cards keep their sizes and their places in the grid?",
    ],
    maxTurns: 30,
  }),
];
