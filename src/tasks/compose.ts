/**
 * Family: compose — build something from a brief, starting near-empty.
 *
 * These are the tasks where the surfaces should differ most, because every
 * element's position has to be decided from nothing. There is no id to align
 * to and no existing layout to imitate.
 *
 * Which is also why the checks here are keyed on the *copy* rather than on
 * ids: the brief gives the wording verbatim, so `withText` can find whichever
 * element ended up carrying it, and a brief that says where something goes can
 * be scored. Before that, composition was scored only in aggregate — some copy
 * present, a hierarchy somewhere, a margin — and "the title should dominate"
 * was satisfied by a poster that set the venue twice the size of the festival's
 * name.
 *
 * What these tasks no longer do is demand a number of elements. A newline is a
 * hard line break, the system prompt says so, and one text element can hold a
 * date, a venue and a call to action as three lines. "At least five elements"
 * was therefore scoring a particular way of dividing the copy up, which is not
 * a property of a good poster — and it was satisfiable with a rect nobody
 * asked for. `elementCount` explains the reasoning in full.
 */

import { defineTask } from "./types.js";
import { blank, doc, image, POSTER_H, POSTER_W } from "./helpers.js";
import {
  containsText,
  coverage,
  elementCount,
  fontSizeAtLeast,
  geometryUnchanged,
  inRegion,
  marginAtLeast,
  noOverlap,
  notCovered,
  styleUnchanged,
  textOnFilledShape,
  textSizeOrder,
  typeBudget,
  typeHierarchy,
  usesImage,
  visibleImage,
  visibleText,
  withText,
} from "../eval/checks.js";

const titleCard = () =>
  doc([image({ id: "bg", x: 0, y: 0, w: POSTER_W, h: POSTER_H, src: "texture/gradient", z: 0 })], {
    background: "#ffffff",
  });

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
      "Use the photo/mountains asset as a background image covering the whole canvas.",
      "",
      "Constraints:",
      "  - The title is the largest type on the poster and at least two and a half times",
      "    the size of the smallest, and it sits in the upper half.",
      "  - The dates are set larger than the venue line.",
      "  - The ticket line sits in the bottom fifth.",
      "  - No text smaller than 24 units, and no two blocks of text overlapping.",
      "  - Keep everything at least 40 units clear of every canvas edge.",
    ].join("\n"),
    initial: () => blank({ background: "#101020" }),
    checks: [
      containsText(["Ridgeline Festival", "September 12-14", "Alpine Meadow, Colorado", "Tickets at ridgeline.fm"], 2),
      usesImage(["photo/mountains"], 1),
      typeHierarchy(2.5, 1),
      // "The title is the largest type ... the dates are set larger than the
      // venue line." `typeHierarchy` only asks whether *some* text is big.
      textSizeOrder(["Ridgeline Festival", "September 12-14", "Alpine Meadow, Colorado"], 2),
      inRegion(withText("Ridgeline Festival"), { x0: 0, y0: 0, x1: 1, y1: 0.5 }, 1, "The title sits in the upper half"),
      inRegion(
        withText("Tickets at ridgeline.fm"),
        { x0: 0, y0: 0.8, x1: 1, y1: 1 },
        1,
        "The ticket line sits at the foot of the poster",
      ),
      fontSizeAtLeast(24, 1),
      noOverlap(visibleText, 1, "Blocks of text do not overlap"),
      marginAtLeast(40, 1),
      coverage(0.35, 0.98, 1),
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
      "Use the photo/coffee asset, and let nothing be painted over it.",
      "",
      "Constraints:",
      "  - The headline is the largest type, at least twice the size of the smallest,",
      "    and it sits in the top third.",
      '  - "All welcome. Bring a friend." is the last thing on the page, below everything else.',
      "  - No text smaller than 22 units, and no two blocks of text overlapping.",
      "  - Keep everything at least 32 units clear of every canvas edge.",
    ].join("\n"),
    initial: () => blank({ background: "#fdf6ec" }),
    checks: [
      containsText(
        ["Saturday Coffee Morning", "Every Saturday, 9am to noon", "Corner of Fifth and Pine", "All welcome. Bring a friend."],
        2,
      ),
      usesImage(["photo/coffee"], 1),
      typeHierarchy(2, 1),
      textSizeOrder(["Saturday Coffee Morning", "Every Saturday, 9am to noon"], 1),
      inRegion(
        withText("Saturday Coffee Morning"),
        { x0: 0, y0: 0, x1: 1, y1: 0.34 },
        1,
        "The headline sits in the top third",
      ),
      inRegion(
        withText("All welcome. Bring a friend."),
        { x0: 0, y0: 0.66, x1: 1, y1: 1 },
        1,
        "The sign-off sits at the foot of the flyer",
      ),
      // "let nothing be painted over it" — the photograph is the reason this
      // is a flyer and not a memo, and dropping a panel on top of it is the
      // cheapest way to make room for copy.
      notCovered(visibleImage, 1, "Nothing is painted over the photograph"),
      fontSizeAtLeast(22, 1),
      noOverlap(visibleText, 1, "Blocks of text do not overlap"),
      marginAtLeast(32, 1),
      coverage(0.35, 0.98, 1),
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
      "No images. Use the canvas background and at most one decorative shape,",
      "and no more than five elements in total.",
      "",
      "Constraints:",
      "  - The quote is set larger than the attribution, and at least twice its size.",
      "  - The quote sits in the middle of the card, clear of the top and bottom sixths.",
      "  - Nothing smaller than 26 units, and nothing overlapping anything else.",
      "  - Keep everything at least 64 units clear of every canvas edge.",
    ].join("\n"),
    initial: () => blank({ background: "#1b1b28" }),
    checks: [
      containsText(["We shape our buildings; thereafter they shape us.", "Winston Churchill, 1943"], 2),
      // A ceiling, not a floor: "at most one decorative shape" bounds what may
      // be added however the copy is split, which a floor never does.
      elementCount({ max: 5, label: "At most five elements" }, 1),
      typeBudget({ image: 0, rect: 1 }, 1, "No images, and at most one decorative shape"),
      typeHierarchy(2, 1),
      textSizeOrder(["We shape our buildings; thereafter they shape us.", "Winston Churchill, 1943"], 2),
      inRegion(
        withText("We shape our buildings; thereafter they shape us."),
        { x0: 0, y0: 0.17, x1: 1, y1: 0.83 },
        1,
        "The quote sits in the middle of the card",
      ),
      fontSizeAtLeast(26, 1),
      noOverlap(visibleText, 1, "Blocks of text do not overlap"),
      marginAtLeast(64, 1),
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
      "Constraints:",
      "  - Use the photo/coffee asset as the product photo. It sits entirely within the top",
      "    half of the card, and nothing is painted over it.",
      "  - All four pieces of copy sit below the photo.",
      '  - The button label sits on a filled shape, so it reads as a button.',
      "  - The product name is larger than the price, and the price larger than the description.",
      "  - No text smaller than 20 units, and no two blocks of text overlapping.",
      "  - Keep everything at least 24 units clear of every canvas edge.",
    ].join("\n"),
    initial: () => blank({ background: "#ffffff" }),
    checks: [
      containsText(["Ridge Roast", "$18.00", "A dark, cocoa-forward blend from three Colorado farms. Roasted weekly.", "Add to basket"], 2),
      usesImage(["photo/coffee"], 1),
      // "It occupies the top half of the card": the centre landing in the top
      // half is satisfied by a photo twice the height of the region, so the
      // whole box is measured.
      inRegion(visibleImage, { x0: 0, y0: 0, x1: 1, y1: 0.5 }, 2, "The photo occupies the top half", { whole: true }),
      notCovered(visibleImage, 1, "Nothing is painted over the photo"),
      inRegion(visibleText, { x0: 0, y0: 0.5, x1: 1, y1: 1 }, 1, "The copy sits below the photo"),
      textOnFilledShape("Add to basket", 2),
      textSizeOrder(["Ridge Roast", "$18.00", "A dark, cocoa-forward blend from three Colorado farms. Roasted weekly."], 2),
      typeHierarchy(1.8, 1),
      fontSizeAtLeast(20, 1),
      noOverlap(visibleText, 1, "Blocks of text do not overlap"),
      marginAtLeast(24, 1),
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
      "The texture/gradient asset already covers the whole canvas. Leave it exactly as it is —",
      "same box, same style, same asset — and set the text over it.",
      "",
      "This will be projected, so:",
      "  - Nothing smaller than 30 units, and the talk title larger than the speaker's name,",
      "    which is larger than the event.",
      "  - The talk title is at least twice the size of the smallest type.",
      "  - No two blocks of text overlapping, and everything at least 56 units clear of every edge.",
    ].join("\n"),
    initial: titleCard,
    checks: [
      containsText(["Interfaces That Explain Themselves", "Dana Okonkwo", "Layout Conf 2026"], 2),
      typeHierarchy(2, 1),
      textSizeOrder(["Interfaces That Explain Themselves", "Dana Okonkwo", "Layout Conf 2026"], 2),
      fontSizeAtLeast(30, 1),
      noOverlap(visibleText, 1, "Blocks of text do not overlap"),
      marginAtLeast(56, 1),
      // "Leave it exactly as it is." Nothing stopped a run deleting the
      // gradient, swapping it, shrinking it to a corner — or, once the
      // geometry was pinned, fading it to 5% and setting the text on the plain
      // white page it was supposed to be read against.
      usesImage(["texture/gradient"], 1),
      geometryUnchanged(titleCard(), ["bg"], 1),
      styleUnchanged(titleCard(), ["bg"], 1),
    ],
    judgeCriteria: [
      "Is the talk title legible against the gradient at a glance?",
      "Are speaker and event distinguishable from the title and from each other?",
      "Does the card look composed for projection — generous margins, nothing fussy?",
    ],
    maxTurns: 25,
  }),
];
