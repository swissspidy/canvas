/**
 * Family: compose — build something from a brief, starting near-empty.
 *
 * These are the tasks where the surfaces should differ most, because every
 * element's position has to be decided from nothing. There is no id to align
 * to and no existing layout to imitate.
 */

import { defineTask } from "./types.js";
import { blank, doc, image, POSTER_H, POSTER_W } from "./helpers.js";
import { containsText, coverage, elementCount, marginAtLeast, typeHierarchy, usesImage } from "../eval/checks.js";

export const composeTasks = [
  defineTask({
    id: "compose.festival-poster",
    title: "Festival poster from a brief",
    family: "compose",
    brief: [
      "Make a poster for a music festival on this blank canvas.",
      "",
      "It must contain exactly this copy:",
      '  - Title: "Ridgeline Festival"',
      '  - Dates: "September 12-14"',
      '  - Venue: "Alpine Meadow, Colorado"',
      '  - Call to action: "Tickets at ridgeline.fm"',
      "",
      "Use the photo/mountains asset as a background image.",
      "The title should dominate; everything must be readable and sit comfortably inside the canvas.",
    ].join("\n"),
    initial: () => blank({ background: "#101020" }),
    checks: [
      containsText(["Ridgeline Festival", "September 12-14", "Alpine Meadow, Colorado", "Tickets at ridgeline.fm"], 2),
      usesImage(["photo/mountains"], 1),
      elementCount({ min: 5, selector: undefined, label: "At least five elements" }, 1),
      typeHierarchy(2, 1),
      marginAtLeast(24, 1),
      coverage(0.3, 0.98, 1),
    ],
    judgeCriteria: [
      "Does it read as a poster rather than a list of text boxes?",
      "Is the title unmistakably the dominant element?",
      "Are the dates, venue and call to action grouped sensibly rather than scattered?",
      "Is the spacing deliberate — consistent gutters, nothing crowding an edge?",
    ],
    maxTurns: 30,
  }),

  defineTask({
    id: "compose.event-flyer",
    title: "Community event flyer",
    family: "compose",
    brief: [
      "Design a flyer for a neighbourhood coffee morning.",
      "",
      "Required copy, word for word:",
      '  - "Saturday Coffee Morning"',
      '  - "Every Saturday, 9am to noon"',
      '  - "Corner of Fifth and Pine"',
      '  - "All welcome. Bring a friend."',
      "",
      "Use the photo/coffee asset. Keep it warm and legible; the headline should be the first thing read.",
    ].join("\n"),
    initial: () => blank({ background: "#fdf6ec" }),
    checks: [
      containsText(
        ["Saturday Coffee Morning", "Every Saturday, 9am to noon", "Corner of Fifth and Pine", "All welcome. Bring a friend."],
        2,
      ),
      usesImage(["photo/coffee"], 1),
      typeHierarchy(1.8, 1),
      marginAtLeast(24, 1),
      coverage(0.3, 0.98, 1),
    ],
    judgeCriteria: [
      "Is there a clear reading order from headline to details?",
      "Does the image support the layout rather than fight the text?",
      "Would this look deliberate if printed and pinned to a noticeboard?",
    ],
    maxTurns: 30,
  }),

  defineTask({
    id: "compose.quote-card",
    title: "Quote card",
    family: "compose",
    brief: [
      "Make a shareable quote card on this blank canvas.",
      "",
      "The quote: \"We shape our buildings; thereafter they shape us.\"",
      'Attribution: "Winston Churchill, 1943"',
      "",
      "No images. Use the canvas background and at most one decorative shape.",
      "The quote should be the centre of attention and the attribution clearly subordinate.",
    ].join("\n"),
    initial: () => blank({ background: "#1b1b28" }),
    checks: [
      containsText(["We shape our buildings; thereafter they shape us.", "Winston Churchill, 1943"], 2),
      elementCount({ min: 2, max: 5, label: "Two to five elements" }, 1),
      typeHierarchy(1.8, 1),
      marginAtLeast(48, 1),
    ],
    judgeCriteria: [
      "Is the quote the visual centre of the card?",
      "Is the attribution clearly secondary without being an afterthought?",
      "Is the composition balanced — does the text sit deliberately rather than landing wherever it fell?",
    ],
    maxTurns: 25,
  }),

  defineTask({
    id: "compose.product-card",
    title: "Product card with a photo",
    family: "compose",
    brief: [
      "Build a product card for an online shop.",
      "",
      "Required copy:",
      '  - Product name: "Ridge Roast"',
      '  - Price: "$18.00"',
      '  - Description: "A dark, cocoa-forward blend from three Colorado farms. Roasted weekly."',
      '  - Button label: "Add to basket"',
      "",
      "Use the photo/coffee asset as the product photo, taking up the upper part of the card.",
      "The button label should sit on a filled shape so it reads as a button.",
    ].join("\n"),
    initial: () => blank({ background: "#ffffff" }),
    checks: [
      containsText(["Ridge Roast", "$18.00", "A dark, cocoa-forward blend from three Colorado farms. Roasted weekly.", "Add to basket"], 2),
      usesImage(["photo/coffee"], 1),
      elementCount({ min: 6, label: "At least six elements" }, 1),
      typeHierarchy(1.6, 1),
      marginAtLeast(16, 1),
    ],
    judgeCriteria: [
      "Does the photo occupy the top of the card with the text below, as asked?",
      "Does the button read as a button — a filled shape with its label sitting on it?",
      "Is the price prominent enough to find at a glance?",
      "Is the description set at a size that is comfortable to read rather than shrunk to fit?",
    ],
    maxTurns: 30,
  }),

  defineTask({
    id: "compose.title-card",
    title: "Conference title card",
    family: "compose",
    brief: [
      "Produce an opening title card for a conference talk.",
      "",
      "Required copy:",
      '  - Talk title: "Interfaces That Explain Themselves"',
      '  - Speaker: "Dana Okonkwo"',
      '  - Event: "Layout Conf 2026"',
      "",
      "Start from the texture/gradient asset covering the whole canvas, then set the text over it.",
      "This will be projected, so contrast matters more than decoration.",
    ].join("\n"),
    initial: () => doc(
      [image({ id: "bg", x: 0, y: 0, w: POSTER_W, h: POSTER_H, src: "texture/gradient", z: 0 })],
      { background: "#ffffff" },
    ),
    checks: [
      containsText(["Interfaces That Explain Themselves", "Dana Okonkwo", "Layout Conf 2026"], 2),
      typeHierarchy(1.7, 1),
      marginAtLeast(40, 1),
      elementCount({ min: 4, label: "Background plus at least three text elements" }, 1),
    ],
    judgeCriteria: [
      "Is the talk title legible against the gradient at a glance?",
      "Are speaker and event distinguishable from the title and from each other?",
      "Does the card look composed for projection — generous margins, nothing fussy?",
    ],
    maxTurns: 25,
  }),
];
