/**
 * Family: fit — text that does not fit the box it was put in.
 *
 * The purest test of the relational hypothesis. The coordinate surface has to
 * reason about font metrics it cannot see; the relational surface has one call
 * (`fit_text`) that solves it exactly; document-as-code has to guess a number
 * and check. If relational operations ever pay off, they pay off here — and if
 * they do not pay off here either, that is a strong result.
 *
 * Every task here now states a **minimum type size**, and the reason is the
 * one loophole that made this whole family trivial: shrinking the text until
 * it fits is always available, always works, and takes one call on every
 * surface. `fit.body-overflow` went from 40% to full marks at `fontSize: 9`.
 * With a floor, the agent has to find the room instead — reflow the column,
 * move the neighbour, use the space that is actually there — which is the
 * problem the family exists to pose. The floors are always above what a naive
 * shrink would reach and always below what the original size was, so there is
 * real work either way, and every one of them is in the brief, because a
 * constraint the agent cannot see is a guessing game rather than a task.
 */

import { defineTask } from "./types.js";
import { doc, image, rect, text, POSTER_W } from "./helpers.js";
import {
  alignedOn,
  containsText,
  fontSizeAtLeast,
  geometryUnchanged,
  inRegion,
  marginAtLeast,
  noOverlap,
  noTextClipping,
  notCovered,
  preservesElements,
  sameFontSize,
  verticalOrder,
} from "../eval/checks.js";

const longHeadline = () =>
  doc([
    rect({ id: "card", x: 80, y: 260, w: 920, h: 720, z: 0, style: { fill: "#ffffff", radius: 20 } }),
    text({
      id: "headline",
      x: 130,
      y: 310,
      w: 820,
      h: 180,
      z: 1,
      text: "Everything We Learned Rebuilding The Crossing Upstream",
      style: { fontSize: 76, fontWeight: "bold", color: "#1d1d2b" },
    }),
    text({
      id: "para",
      x: 130,
      y: 540,
      w: 820,
      h: 380,
      z: 2,
      text: "The old ford washed out in April. What follows is a note on why we moved the crossing rather than repairing it, and what that cost.",
      style: { fontSize: 30, color: "#3d3d56", lineHeight: 1.45 },
    }),
  ], { background: "#efeae1" });

const bodyOverflow = () =>
  doc([
    text({
      id: "title",
      x: 100,
      y: 120,
      w: 880,
      h: 120,
      z: 0,
      text: "Notes on Repair",
      style: { fontSize: 64, fontWeight: "bold", color: "#22223b" },
    }),
    text({
      id: "body",
      x: 100,
      y: 280,
      w: 880,
      h: 240,
      z: 1,
      text: "There is a version of maintenance that is really just deferral: you patch the thing, the patch holds for a season, and the same failure returns with interest. The alternative costs more up front and is harder to justify in a quarterly review, because the benefit is an absence — the crossing that did not wash out, the outage that did not happen. Nobody writes that down. The only way we have found to make the case is to keep a record of what the repeated patching actually cost, and to put that number next to the one-off.",
      style: { fontSize: 28, color: "#3d3d56", lineHeight: 1.5 },
    }),
    text({
      id: "caption",
      x: 100,
      y: 1180,
      w: 880,
      h: 80,
      z: 2,
      text: "From the maintenance log, winter 2025",
      style: { fontSize: 24, color: "#6a6a85" },
    }),
  ], { background: "#f7f4ee" });

const threeOverflowing = () =>
  doc([
    text({
      id: "one",
      x: 120,
      y: 120,
      w: 840,
      h: 150,
      z: 0,
      text: "First: the crossing moved forty metres east after the spring melt and took the old ford with it.",
      style: { fontSize: 44, color: "#1d1d2b" },
    }),
    text({
      id: "two",
      x: 120,
      y: 520,
      w: 840,
      h: 150,
      z: 1,
      text: "Second: rebuilding on gravel would have failed again within two seasons, so we moved upstream to rock, which took a fortnight longer than anyone had budgeted for.",
      style: { fontSize: 44, color: "#1d1d2b" },
    }),
    text({
      id: "three",
      x: 120,
      y: 920,
      w: 840,
      h: 150,
      z: 2,
      text: "Third: the new crossing cost roughly twice the patch and should outlast every one of us.",
      style: { fontSize: 44, color: "#1d1d2b" },
    }),
  ], { background: "#ffffff" });

const captionUnderImage = () =>
  doc([
    image({ id: "photo", x: 0, y: 0, w: POSTER_W, h: 820, src: "photo/portrait", z: 0, alt: "a portrait of a person" }),
    text({
      id: "caption",
      x: 80,
      y: 860,
      w: 920,
      h: 120,
      z: 1,
      text: "Dana Okonkwo photographed at the eastern crossing, two weeks after the rebuild was finished and the first trucks went over it.",
      style: { fontSize: 34, color: "#22223b", lineHeight: 1.4 },
    }),
    rect({ id: "rule", x: 80, y: 1180, w: 920, h: 3, z: 2, style: { fill: "#c8c2b6" } }),
    text({
      id: "footer",
      x: 80,
      y: 1210,
      w: 920,
      h: 60,
      z: 3,
      text: "Photograph by R. Meyers",
      style: { fontSize: 24, color: "#6a6a85" },
    }),
  ], { background: "#f7f4ee" });

const twoColumns = () =>
  doc([
    text({
      id: "heading",
      x: 90,
      y: 120,
      w: 900,
      h: 110,
      z: 0,
      text: "Two Ways to Cross a River",
      style: { fontSize: 66, fontWeight: "bold", color: "#22223b" },
    }),
    text({
      id: "left_col",
      x: 90,
      y: 300,
      w: 420,
      h: 700,
      z: 1,
      text: "A ford is cheap and it is honest about what it is: you drive through the water and you accept that four days a year you do not. It needs a gravel bed, a gentle bank on both sides, and somebody willing to grade it after every melt.",
      style: { fontSize: 44, color: "#3d3d56", lineHeight: 1.45 },
    }),
    text({
      id: "right_col",
      x: 570,
      y: 300,
      w: 420,
      h: 700,
      z: 2,
      text: "A bridge costs four times as much and asks for rock on both banks, which the eastern crossing does not have within half a mile of the old ford. In exchange it is there in April, it is there at night, and nobody has to drive down to look at the water before deciding whether today is a day for going to town.",
      style: { fontSize: 44, color: "#3d3d56", lineHeight: 1.45 },
    }),
    text({
      id: "foot",
      x: 90,
      y: 1180,
      w: 900,
      h: 60,
      z: 3,
      text: "From the maintenance log, winter 2025",
      style: { fontSize: 24, color: "#6a6a85" },
    }),
  ], { background: "#f7f4ee" });

export const fitTasks = [
  defineTask({
    id: "fit.long-headline",
    title: "Fit an over-long headline",
    family: "fit",
    brief: [
      "The headline on this card is too big for its box and is being cut off.",
      "Make the whole headline visible, keeping the exact wording and keeping the headline box",
      "roughly where it is — in the upper middle of the card.",
      "",
      "The headline must stay at least 48 units, the paragraph at least 26, the two must not overlap,",
      "and neither may be painted over the other or run off the card.",
    ].join("\n"),
    initial: longHeadline,
    checks: [
      preservesElements(["card", "headline", "para"], 1),
      containsText(["Everything We Learned Rebuilding The Crossing Upstream"], 2),
      noTextClipping(6, ["headline", "para"]),
      // Without a floor this task has a one-line solution on every surface:
      // set the headline to 12 units and it fits.
      fontSizeAtLeast(48, 4, ["headline"]),
      fontSizeAtLeast(26, 1, ["para"]),
      noOverlap(["headline", "para"], 2),
      inRegion(["headline"], { x0: 0.3, y0: 0.15, x1: 0.7, y1: 0.45 }, 1, "The headline box stays put"),
    ],
    judgeCriteria: [
      "Is the entire headline visible?",
      "Is the headline still clearly the dominant piece of type?",
      "Does the card still look balanced, or has the fix left an awkward gap or a cramped block?",
    ],
    maxTurns: 20,
  }),

  defineTask({
    id: "fit.body-overflow",
    title: "Reflow body copy that overruns its box",
    family: "fit",
    brief: [
      "The body text here runs past the bottom of its box and the last few lines are lost.",
      "Make all of it readable without changing a word.",
      "",
      "The body must stay at least 24 units, the caption stays at the foot of the page,",
      "the order down the page stays title, body, caption, and nothing may overlap or cover anything else.",
    ].join("\n"),
    initial: bodyOverflow,
    checks: [
      preservesElements(["title", "body", "caption"], 1),
      noTextClipping(6, ["title", "body", "caption"]),
      // There is room on this page: the body box ends at 520 and the caption
      // starts at 1180. Finding it is the task; shrinking to 9 units was not.
      fontSizeAtLeast(24, 4, ["body"]),
      verticalOrder(["title", "body", "caption"], 2),
      noOverlap(["title", "body", "caption"], 2),
      inRegion(["caption"], { x0: 0, y0: 0.7, x1: 1, y1: 1 }, 1, "The caption stays at the bottom"),
    ],
    judgeCriteria: [
      "Is every line of the body text visible?",
      "Is the body still set at a comfortable reading size, rather than shrunk to the point of illegibility?",
      "Does the page still have a sensible rhythm between title, body and caption?",
    ],
    maxTurns: 20,
  }),

  defineTask({
    id: "fit.three-overflowing",
    title: "Three boxes, all overflowing",
    family: "fit",
    brief: [
      "All three text blocks in this column overflow their boxes.",
      "Fix every one of them, and treat them as a set: the three end up at the same font size,",
      "no smaller than 30 units.",
      "",
      "They must stay in the same top-to-bottom order, keep the single left edge they share now,",
      "must not overlap each other, and must stay inside the canvas.",
    ].join("\n"),
    initial: threeOverflowing,
    checks: [
      preservesElements(["one", "two", "three"], 1),
      noTextClipping(6, ["one", "two", "three"]),
      // Three blocks, three different overflows, and the obvious fix is to
      // shrink each one by however much it happens to overrun — which leaves
      // three sizes in one column. That is three fixes, not one treatment, and
      // only the judge could see it.
      sameFontSize(["one", "two", "three"], 3),
      fontSizeAtLeast(30, 3, ["one", "two", "three"]),
      verticalOrder(["one", "two", "three"], 2),
      noOverlap(["one", "two", "three"], 2),
      alignedOn("left", ["one", "two", "three"], 2, 1),
    ],
    judgeCriteria: [
      "Is all three blocks' text fully visible?",
      "Are the three treated consistently — the same size and the same spacing logic, not three different fixes?",
      "Does the column look evenly set?",
    ],
    maxTurns: 25,
  }),

  defineTask({
    id: "fit.caption-under-image",
    title: "Fit a caption without covering the image",
    family: "fit",
    brief: [
      "The caption under this photo is clipped, and the box it sits in cannot grow downwards",
      "because the rule and the footer are directly beneath it.",
      "",
      "Make the caption fully readable. The photo, the rule and the footer stay exactly where they are,",
      "at exactly their current size, and nothing may be painted over any of them.",
      "The caption must stay at least 26 units.",
    ].join("\n"),
    initial: captionUnderImage,
    checks: [
      preservesElements(["photo", "caption", "rule", "footer"], 1),
      noTextClipping(6, ["caption", "footer"]),
      fontSizeAtLeast(26, 3, ["caption"]),
      // "without moving the photo or the footer, and without covering either".
      // Two loose region bands were standing in for the first half, and
      // nothing at all was watching the second: growing the caption box up
      // over the photograph cleared the clipping and buried the picture.
      geometryUnchanged(captionUnderImage(), ["photo", "rule", "footer"], 3),
      notCovered(["photo", "rule", "footer"], 3, "Nothing is painted over the photo, the rule or the footer"),
    ],
    judgeCriteria: [
      "Is the whole caption readable?",
      "Are the photo and footer exactly where they were?",
      "Does the caption sit comfortably in the space between them rather than touching either?",
    ],
    maxTurns: 20,
  }),

  defineTask({
    id: "fit.two-column",
    title: "Balance two overflowing columns",
    family: "fit",
    brief: [
      "Both columns of this spread overflow their boxes, and the right-hand one holds a good deal more",
      "copy than the left — so they will not come right at the same size by accident.",
      "",
      "Make every word of both columns visible, without changing a word. The columns keep their position",
      "and their measure — same x, same y, same width — so the levers are the box height and the type.",
      "",
      "The two columns must end up at the same font size, no smaller than 24 units. The heading stays",
      "above both and the footnote below both, nothing overlaps anything else, and everything stays at",
      "least 40 units clear of every canvas edge.",
    ].join("\n"),
    initial: twoColumns,
    checks: [
      preservesElements(["heading", "left_col", "right_col", "foot"], 1),
      noTextClipping(6, ["heading", "left_col", "right_col", "foot"]),
      // The unequal columns are the point: whatever size the longer one can
      // take is the size both have to be, so the two cannot be solved
      // independently. `fit_text` on each, one at a time, gets this wrong.
      sameFontSize(["left_col", "right_col"], 3),
      fontSizeAtLeast(24, 3, ["left_col", "right_col"]),
      // "same x, same y, same width". Left free, the two columns can simply be
      // moved apart down the page, which is a one-column spread wearing a
      // two-column brief and makes the shared size constraint vacuous.
      geometryUnchanged(twoColumns(), ["left_col", "right_col"], 2, { fields: ["x", "y", "width"] }),
      noOverlap(["heading", "left_col", "right_col", "foot"], 2),
      verticalOrder(["heading", "left_col", "foot"], 1),
      verticalOrder(["heading", "right_col", "foot"], 1),
      marginAtLeast(40, 1),
    ],
    judgeCriteria: [
      "Is every line of both columns visible?",
      "Do the two columns read as a pair — same size, same top edge, same measure?",
      "Is the spread still balanced, or has one column been squeezed to make the other work?",
      "Does the type stay comfortable to read?",
    ],
    maxTurns: 25,
  }),
];
