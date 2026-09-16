/**
 * Family: fit — text that does not fit the box it was put in.
 *
 * The purest test of the relational hypothesis. The coordinate surface has to
 * reason about font metrics it cannot see; the relational surface has one call
 * (`fit_text`) that solves it exactly; document-as-code has to guess a number
 * and check. If relational operations ever pay off, they pay off here — and if
 * they do not pay off here either, that is a strong result.
 */

import { defineTask } from "./types.js";
import { doc, image, rect, text, POSTER_W } from "./helpers.js";
import { containsText, inRegion, noTextClipping, preservesElements } from "../eval/checks.js";

export const fitTasks = [
  defineTask({
    id: "fit.long-headline",
    title: "Fit an over-long headline",
    family: "fit",
    brief: [
      "The headline on this card is too big for its box and is being cut off.",
      "Make the whole headline visible. Keep the exact wording, keep the headline box where it is,",
      "and do not let it overlap the paragraph below it.",
    ].join("\n"),
    initial: () =>
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
      ], { background: "#efeae1" }),
    checks: [
      preservesElements(["card", "headline", "para"], 1),
      containsText(["Everything We Learned Rebuilding The Crossing Upstream"], 2),
      noTextClipping(4, ["headline", "para"]),
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
      "Make all of it readable without changing a word and without covering the caption underneath.",
    ].join("\n"),
    initial: () =>
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
      ], { background: "#f7f4ee" }),
    checks: [
      preservesElements(["title", "body", "caption"], 1),
      noTextClipping(4, ["title", "body", "caption"]),
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
      "Fix every one of them. The three blocks must stay in the same top-to-bottom order,",
      "must not overlap each other, and must stay inside the canvas.",
    ].join("\n"),
    initial: () =>
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
          text: "Second: rebuilding on gravel would have failed again within two seasons, so we moved upstream to rock.",
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
      ], { background: "#ffffff" }),
    checks: [
      preservesElements(["one", "two", "three"], 1),
      noTextClipping(4, ["one", "two", "three"]),
      inRegion(["one"], { x0: 0, y0: 0, x1: 1, y1: 0.4 }, 1, "The first block stays at the top"),
      inRegion(["three"], { x0: 0, y0: 0.6, x1: 1, y1: 1 }, 1, "The third block stays at the bottom"),
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
      "because the footer is directly beneath it.",
      "Make the caption fully readable without moving the photo or the footer, and without covering either.",
    ].join("\n"),
    initial: () =>
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
      ], { background: "#f7f4ee" }),
    checks: [
      preservesElements(["photo", "caption", "rule", "footer"], 1),
      noTextClipping(4, ["caption", "footer"]),
      inRegion(["photo"], { x0: 0.4, y0: 0.2, x1: 0.6, y1: 0.4 }, 1, "The photo has not moved"),
      inRegion(["footer"], { x0: 0, y0: 0.85, x1: 1, y1: 1 }, 1, "The footer has not moved"),
    ],
    judgeCriteria: [
      "Is the whole caption readable?",
      "Are the photo and footer exactly where they were?",
      "Does the caption sit comfortably in the space between them rather than touching either?",
    ],
    maxTurns: 20,
  }),
];
