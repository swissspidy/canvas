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
 * Task set v2 (`docs/PREREGISTRATION.md` §13, 2026-10-07) makes each of the
 * three carry more than one axis at once: rows of different heights whose
 * boxes must hug text the agent cannot measure, cards of different widths
 * with captions that travel with them, and a twelve-card grid that has to be
 * resized to a stated gutter with a label centred on every card.
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
  centeredOnCanvas,
  centeredOnEach,
  edgeAt,
  evenlySpaced,
  gapBetween,
  geometryUnchanged,
  hugsText,
  inBounds,
  marginAtLeast,
  noOverlap,
  noTextClipping,
  outerMarginsBalanced,
  preservesElements,
  sizeIs,
  styleUnchanged,
  textUnchanged,
} from "../eval/checks.js";

const ROW_STYLE = { fontSize: 40, color: "#1d1d2b", lineHeight: 1.3 };

/**
 * Five rows of different lengths, so different heights — and every box the
 * wrong height for its text, two of them clipped. Equal gaps between boxes
 * mean nothing until each box is the height of its text.
 */
const raggedColumn = () =>
  doc([
    text({ id: "r1", x: 132, y: 180, w: 700, h: 80, z: 0, text: "Reduce the blast radius", style: ROW_STYLE }),
    text({ id: "r2", x: 118, y: 296, w: 700, h: 80, z: 1, text: "Make the failure loud enough that someone hears it the first time", style: ROW_STYLE }),
    text({ id: "r3", x: 147, y: 420, w: 700, h: 140, z: 2, text: "Write down what it cost", style: ROW_STYLE }),
    text({ id: "r4", x: 109, y: 611, w: 700, h: 80, z: 3, text: "Rebuild on rock, not gravel, even when gravel is all the budget will stretch to this year", style: ROW_STYLE }),
    text({ id: "r5", x: 140, y: 748, w: 700, h: 120, z: 4, text: "Check it again in a season", style: ROW_STYLE }),
  ], { background: "#f7f4ee" });

const ROWS = ["r1", "r2", "r3", "r4", "r5"];

const CAPTION = { fontSize: 28, color: "#e8e8f2", align: "center" as const };

/** Four cards of four widths, each with a caption that belongs under it. */
const unevenRow = () =>
  doc([
    rect({ id: "c1", x: 60, y: 520, w: 160, h: 300, z: 0, style: { fill: "#2b3a67", radius: 16 } }),
    rect({ id: "c2", x: 236, y: 548, w: 240, h: 300, z: 1, style: { fill: "#4a5a8a", radius: 16 } }),
    rect({ id: "c3", x: 492, y: 505, w: 200, h: 300, z: 2, style: { fill: "#8a6fa8", radius: 16 } }),
    rect({ id: "c4", x: 640, y: 533, w: 280, h: 300, z: 3, style: { fill: "#c98b6b", radius: 16 } }),
    text({ id: "k1", x: 40, y: 840, w: 200, h: 60, z: 4, text: "Ford", style: CAPTION }),
    text({ id: "k2", x: 270, y: 880, w: 200, h: 60, z: 5, text: "Footbridge", style: CAPTION }),
    text({ id: "k3", x: 500, y: 830, w: 200, h: 60, z: 6, text: "Ferry", style: CAPTION }),
    text({ id: "k4", x: 700, y: 900, w: 200, h: 60, z: 7, text: "Bridge", style: CAPTION }),
  ], { background: "#12121f" });

const CARDS = ["c1", "c2", "c3", "c4"];
const CAPTIONS = ["k1", "k2", "k3", "k4"];

const GRID_FILLS = ["#2b3a67", "#3f4d7a", "#5b4a7a", "#8a4a2e", "#3f5f45", "#7a3a4e"];
const GRID_NAMES = ["Ford", "Ferry", "Weir", "Ridge", "Pass", "Col", "Tarn", "Scree", "Cairn", "Fell", "Beck", "Ghyll"];

/**
 * Twelve cards that want to be a four-by-three grid, each with its name on it,
 * and every card and every name slightly off. The cards are also the wrong
 * size for the grid the brief describes, so they have to be resized as well
 * as moved — and each name has to follow its card.
 */
const cardGrid = () => {
  const jitter = [[14, -22], [-9, 18], [22, 6], [-16, -12], [8, 25], [-20, -6], [11, -17], [-5, 21], [19, -9], [-13, 14], [6, -24], [-18, 9]];
  const els = [];
  for (let i = 0; i < 12; i++) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const [dx, dy] = jitter[i] as [number, number];
    const x = 70 + col * 250 + dx;
    const y = 250 + row * 330 + dy;
    els.push(rect({ id: `g${i + 1}`, x, y, w: 210, h: 280, z: i, style: { fill: GRID_FILLS[i % 6]!, radius: 16 } }));
    els.push(
      text({
        id: `n${i + 1}`,
        x: x + 5 + ((i * 7) % 11),
        y: y + 100 + ((i * 5) % 13),
        w: 180,
        h: 50,
        z: 20 + i,
        text: GRID_NAMES[i]!,
        style: { fontSize: 32, fontWeight: "bold", color: "#ffffff", align: "center" },
      }),
    );
  }
  return doc(els, { background: "#12121f" });
};

const GRID = Array.from({ length: 12 }, (_, i) => `g${i + 1}`);
const NAMES = Array.from({ length: 12 }, (_, i) => `n${i + 1}`);
const gridRow = (r: number) => GRID.slice(r * 4, r * 4 + 4);
const gridCol = (c: number) => [0, 1, 2].map((r) => GRID[r * 4 + c]!);

export const arrangeTasks = [
  defineTask({
    id: "arrange.ragged-column",
    title: "Straighten a ragged column",
    family: "arrange",
    brief: [
      "These five rows were placed by hand and none of them line up. Some of them are longer than",
      "others and wrap onto more lines, and several boxes are the wrong height for their text —",
      "two are cutting their text off.",
      "",
      "  - Line all five up on a single left edge at x = 140.",
      "  - Make every box exactly as tall as its text needs (at most 4 units over), with nothing cut off.",
      "  - Leave exactly 36 units between each box and the next, in the same order as now.",
      "  - Centre the whole column vertically on the canvas.",
      "",
      "Keep every row's 700 width, font, size and line height, keep all five, and do not change the copy.",
    ].join("\n"),
    initial: raggedColumn,
    checks: [
      preservesElements(ROWS, 1),
      textUnchanged(raggedColumn(), ROWS, 1),
      edgeAt(ROWS, "left", 140, 1.5, 2, "The column's left edge is at x = 140"),
      alignedOn("left", ROWS, 1.5, 3),
      noTextClipping(4, ROWS),
      hugsText(ROWS, 4, 3),
      gapBetween(["r1"], ["r2"], "vertical", 36, 1.5, 1, "36 between rows 1 and 2"),
      gapBetween(["r2"], ["r3"], "vertical", 36, 1.5, 1, "36 between rows 2 and 3"),
      gapBetween(["r3"], ["r4"], "vertical", 36, 1.5, 1, "36 between rows 3 and 4"),
      gapBetween(["r4"], ["r5"], "vertical", 36, 1.5, 1, "36 between rows 4 and 5"),
      centeredOnCanvas(ROWS, "vertical", 2, 2, "The column is centred vertically"),
      geometryUnchanged(raggedColumn(), ROWS, 1, { fields: ["width"] }),
      styleUnchanged(raggedColumn(), ROWS, 1, { keys: ["fontSize", "fontWeight", "lineHeight"] }),
      inBounds(1),
    ],
    judgeCriteria: [
      "Do the five rows share one left edge?",
      "Are the gaps between the rows visibly equal, however many lines each row takes?",
      "Does the column read as a deliberate list, sitting in the middle of the page?",
    ],
    maxTurns: 35,
  }),

  defineTask({
    id: "arrange.uneven-row",
    title: "Space a row of cards evenly",
    family: "arrange",
    brief: [
      "These four cards, each a different width, are bunched to one side with uneven gaps, and their",
      "captions have wandered off.",
      "",
      "  - Keep the cards in their current left-to-right order and share one top edge at y = 480.",
      "  - Space them across the canvas so the three gaps between neighbours and the space at the",
      "    far left and far right are all the same.",
      "  - Each caption (k1 belongs to c1, k2 to c2, and so on) sits exactly 16 units below its card,",
      "    centred under it, in a box exactly as tall as its text (at most 4 units over).",
      "",
      "Do not resize the cards, keep every caption box 200 wide, and keep all eight elements.",
    ].join("\n"),
    initial: unevenRow,
    checks: [
      preservesElements([...CARDS, ...CAPTIONS], 1),
      edgeAt(CARDS, "top", 480, 1.5, 2, "The cards' top edge is at y = 480"),
      alignedOn("top", CARDS, 1.5, 2),
      evenlySpaced("horizontal", CARDS, 2, 3),
      outerMarginsBalanced("horizontal", CARDS, 2, 2),
      // "the space at the far left and far right" equals the gaps, which with
      // these widths is 40: (1080 - 880) / 5.
      edgeAt(["c1"], "left", 40, 2, 2, "The space at the far left equals the gaps"),
      ...CARDS.map((c, i) => alignedOn("hcenter", [c, CAPTIONS[i]!], 1.5, 1)),
      ...CARDS.map((c, i) => gapBetween([c], [CAPTIONS[i]!], "vertical", 16, 1.5, 1, `${CAPTIONS[i]} sits 16 below ${c}`)),
      hugsText(CAPTIONS, 4, 2),
      geometryUnchanged(unevenRow(), CARDS, 2, { fields: ["width", "height"] }),
      geometryUnchanged(unevenRow(), CAPTIONS, 1, { fields: ["width"] }),
      noOverlap([...CARDS, ...CAPTIONS], 2),
      inBounds(2),
    ],
    judgeCriteria: [
      "Are the four cards evenly spaced across the canvas, with the same air at both ends?",
      "Do they share a top edge?",
      "Does each caption sit squarely under its own card?",
    ],
    maxTurns: 35,
  }),

  defineTask({
    id: "arrange.card-grid",
    title: "Pull twelve cards into a grid",
    family: "arrange",
    brief: [
      "These twelve cards are meant to be a four-by-three grid, and every card and every name on it is",
      "slightly off. The cards are also the wrong size for the grid.",
      "",
      "  - Keep each card in the cell it is nearest to now: g1 to g4 are the top row, left to right,",
      "    g5 to g8 the middle row, g9 to g12 the bottom row.",
      "  - Resize every card to the same size: 300 tall, and as wide as four columns can be when they",
      "    run from x = 60 to x = 1020 with exactly 24 units between neighbouring columns.",
      "  - The three rows are separated by exactly 24 units, and the grid as a whole is centred",
      "    vertically on the canvas.",
      "  - Each name (n1 belongs on g1, n2 on g2, and so on) is centred on its card, both ways.",
      "",
      "Keep all twelve cards and all twelve names, and do not resize or restyle the names.",
    ].join("\n"),
    initial: cardGrid,
    checks: [
      preservesElements([...GRID, ...NAMES], 1),
      sizeIs(GRID, { width: 222, height: 300 }, 1.5, 3, "Every card is 222 by 300"),
      edgeAt(GRID, "left", 60, 1.5, 1, "The grid starts at x = 60"),
      edgeAt(GRID, "right", 1020, 1.5, 1, "The grid ends at x = 1020"),
      ...[0, 1, 2, 3].map((c) => alignedOn("left", gridCol(c), 1.5, 1)),
      ...[0, 1, 2].map((r) => alignedOn("top", gridRow(r), 1.5, 1)),
      ...[0, 1, 2].map((r) => evenlySpaced("horizontal", gridRow(r), 1.5, 1)),
      gapBetween(gridRow(0), gridRow(1), "vertical", 24, 1.5, 1, "24 between the first and second rows"),
      gapBetween(gridRow(1), gridRow(2), "vertical", 24, 1.5, 1, "24 between the second and third rows"),
      centeredOnCanvas(GRID, "vertical", 2, 2, "The grid is centred vertically"),
      centeredOnEach(NAMES.map((n, i) => [n, GRID[i]!] as [string, string]), 2, 3, "Each name is centred on its card"),
      geometryUnchanged(cardGrid(), NAMES, 1, { fields: ["width", "height"] }),
      styleUnchanged(cardGrid(), NAMES, 1),
      noOverlap(GRID, 2),
      marginAtLeast(40, 1),
      inBounds(1),
    ],
    judgeCriteria: [
      "Does it read as a grid — four columns, three rows, one rhythm?",
      "Are the gutters between columns the same as each other, and the row gaps the same?",
      "Is the block of cards sitting squarely on the canvas rather than drifting?",
      "Does every name sit in the middle of its own card?",
    ],
    maxTurns: 45,
  }),
];
