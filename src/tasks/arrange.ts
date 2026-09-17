/**
 * Family: arrange — pure alignment and spacing.
 *
 * The narrowest family, and the one where the relational surface has the most
 * direct advantage: `align` and `distribute` are single calls for what the
 * coordinate surface must compute element by element. Including it is a
 * deliberate check on whether that advantage shows up where it should. If
 * relational operations do not win *here*, they are unlikely to win anywhere.
 */

import { defineTask } from "./types.js";
import { doc, rect, text } from "./helpers.js";
import {
  alignedOn,
  evenlySpaced,
  geometryUnchanged,
  inBounds,
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

export const arrangeTasks = [
  defineTask({
    id: "arrange.ragged-column",
    title: "Straighten a ragged column",
    family: "arrange",
    brief: [
      "These five rows were placed by hand and none of them line up.",
      "Line them all up on a single left edge and give them equal vertical gaps.",
      "Do not change any element's size, and keep all five.",
    ].join("\n"),
    initial: raggedColumn,
    checks: [
      preservesElements(["r1", "r2", "r3", "r4", "r5"], 1),
      alignedOn("left", ["r1", "r2", "r3", "r4", "r5"], 1.5, 4),
      evenlySpaced("vertical", ["r1", "r2", "r3", "r4", "r5"], 1.5, 4),
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
      "Do not resize them.",
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
      inBounds(2),
    ],
    judgeCriteria: [
      "Are the four cards evenly spaced across the canvas?",
      "Do they share a top edge?",
      "Are the outer margins balanced, so the row looks centred rather than pushed to one side?",
    ],
    maxTurns: 25,
  }),
];
