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
  alignedOn,
  centeredOnCanvas,
  containsText,
  coverage,
  coversCanvas,
  dominantTypeAtLeast,
  edgeAt,
  elementCount,
  fillsMeasure,
  fontSizeAtLeast,
  gapBetween,
  geometryUnchanged,
  hugsText,
  inRegion,
  lineCount,
  marginAtLeast,
  noOverlap,
  notCovered,
  paintedReach,
  preservesElements,
  rotationWithin,
  shapeUnder,
  sizeIs,
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

/**
 * Task set v2 (`docs/PREREGISTRATION.md` §13, 2026-10-07): every compose brief
 * now also states a measure, the gaps between blocks, and how large the
 * headline type goes — "as large as it will go on two lines across a 920-unit
 * measure" — which is font metrics the agent cannot read off the document. The
 * v1 constraints all stay. The pilots showed a strong model clearing every one
 * of them nearly every time; these are what a typographer would specify next.
 */
const isRect = (el: { type: string }) => el.type === "rect";

const buttonShape = shapeUnder("Add to basket");
const ribbonShape = shapeUnder("HALF PRICE");

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
      "  - This is a poster, read from across a room: set the title at 120 units or larger.",
      "  - The dates are set larger than the venue line.",
      "  - The ticket line sits in the bottom fifth.",
      "  - No text smaller than 24 units, and no two blocks of text overlapping.",
      "  - Keep everything at least 40 units clear of every canvas edge.",
      "  - Fill the page: the elements you add should between them cover at least 40% of",
      "    the canvas, not counting the background.",
      "",
      "Typography:",
      "  - Every block of text sits in one flush-left column: each text box runs from x = 80 to x = 1000.",
      "  - The title is set on exactly two lines, as large as it will go on two lines at that measure",
      "    (within 2% of the largest size that still breaks into two lines).",
      "  - Every text box is no taller than its text needs, plus at most 8 units.",
      "  - The dates sit exactly 40 units below the title's box, and the venue exactly 12 units below",
      "    the dates' box.",
      "  - The ticket line's box ends exactly 80 units above the bottom edge of the canvas.",
    ].join("\n"),
    initial: () => blank({ background: "#101020" }),
    checks: [
      containsText(["Ridgeline Festival", "September 12-14", "Alpine Meadow, Colorado", "Tickets at ridgeline.fm"], 2),
      usesImage(["photo/mountains"], 1),
      // "as a background image covering the whole canvas". `usesImage` asks
      // only whether the asset is on the page, so a 120x90 stamp in the corner
      // satisfied it — and `coverage` was independently happy with the type,
      // so a poster with no background at all scored full marks.
      coversCanvas(visibleImage, 3, "The photo covers the whole canvas"),
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
      // "Set the title at 120 units or larger." The ratio checks above are
      // satisfied at any scale — a 60-unit title over 24-unit copy is a
      // hierarchy — and the first live pilot produced posters whose title was
      // 70 units on a 1080-unit canvas, technically dominant and visibly a
      // document heading. Poster scale is a stated number now, as every other
      // constraint here is, and graded as `fontSizeAtLeast` grades a floor.
      dominantTypeAtLeast("Ridgeline Festival", 120, 2),
      noOverlap(visibleText, 1, "Blocks of text do not overlap"),
      marginAtLeast(40, 1),
      coverage(0.4, 0.98, 1),
      // v2.
      edgeAt(visibleText, "left", 80, 2, 1, "The text column starts at x = 80"),
      alignedOn("left", visibleText, 2, 1),
      sizeIs(visibleText, { width: 920 }, 2, 2, "Every text box is 920 wide"),
      lineCount(withText("Ridgeline Festival"), 2, 2, "The title is set on two lines"),
      fillsMeasure(withText("Ridgeline Festival"), 2, 0.98, 2, "The title is as large as it goes on two lines"),
      hugsText(visibleText, 8, 2),
      gapBetween(withText("Ridgeline Festival"), withText("September 12-14"), "vertical", 40, 2, 1, "The dates sit 40 below the title"),
      gapBetween(withText("September 12-14"), withText("Alpine Meadow, Colorado"), "vertical", 12, 2, 1, "The venue sits 12 below the dates"),
      edgeAt(withText("Tickets at ridgeline.fm"), "bottom", 1270, 2, 1, "The ticket line ends 80 above the bottom edge"),
    ],
    judgeCriteria: [
      "Does it read as a poster rather than a list of text boxes?",
      "Is the title unmistakably the dominant element?",
      "Are the dates, venue and call to action grouped sensibly rather than scattered?",
      "Is the spacing deliberate — consistent gutters, nothing crowding an edge?",
    ],
    maxTurns: 40,
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
      "    and it sits in the top third. Set it at 84 units or larger.",
      '  - "All welcome. Bring a friend." is the last thing on the page, below everything else.',
      "  - No text smaller than 22 units, and no two blocks of text overlapping.",
      "  - Keep everything at least 32 units clear of every canvas edge.",
      "  - Fill the page: the elements should between them cover at least 45% of the canvas.",
      "",
      "Layout:",
      "  - Everything sits in one column from x = 60 to x = 1020: the photo and every text box are 960 wide.",
      "  - The headline is set on exactly two lines, as large as it will go on two lines at that measure",
      "    (within 2% of the largest size that still breaks into two lines).",
      "  - Every text box is no taller than its text needs, plus at most 8 units.",
      "  - The photo is exactly 540 tall and sits exactly 32 units below the headline's box.",
      '  - "Every Saturday, 9am to noon" sits exactly 32 units below the photo, and',
      '    "Corner of Fifth and Pine" exactly 12 units below that.',
      '  - The box of "All welcome. Bring a friend." ends exactly 60 units above the bottom edge.',
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
      dominantTypeAtLeast("Saturday Coffee Morning", 84, 2),
      noOverlap(visibleText, 1, "Blocks of text do not overlap"),
      marginAtLeast(32, 1),
      coverage(0.45, 0.98, 1),
      // v2.
      edgeAt((el) => visibleText(el) || visibleImage(el), "left", 60, 2, 1, "The column starts at x = 60"),
      alignedOn("left", (el) => visibleText(el) || visibleImage(el), 2, 1),
      sizeIs((el) => visibleText(el) || visibleImage(el), { width: 960 }, 2, 2, "The photo and every text box are 960 wide"),
      sizeIs(visibleImage, { height: 540 }, 2, 1, "The photo is 540 tall"),
      lineCount(withText("Saturday Coffee Morning"), 2, 2, "The headline is set on two lines"),
      fillsMeasure(withText("Saturday Coffee Morning"), 2, 0.98, 2, "The headline is as large as it goes on two lines"),
      hugsText(visibleText, 8, 2),
      gapBetween(withText("Saturday Coffee Morning"), visibleImage, "vertical", 32, 2, 1, "The photo sits 32 below the headline"),
      gapBetween(visibleImage, withText("Every Saturday, 9am to noon"), "vertical", 32, 2, 1, "The time sits 32 below the photo"),
      gapBetween(withText("Every Saturday, 9am to noon"), withText("Corner of Fifth and Pine"), "vertical", 12, 2, 1, "The place sits 12 below the time"),
      edgeAt(withText("All welcome. Bring a friend."), "bottom", 1290, 2, 1, "The sign-off ends 60 above the bottom edge"),
    ],
    judgeCriteria: [
      "Is there a clear reading order from headline to details?",
      "Does the image support the layout rather than fight the text?",
      "Would this look deliberate if printed and pinned to a noticeboard?",
    ],
    maxTurns: 40,
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
      "  - The quote is set larger than the attribution, and at least twice its size,",
      "    and at 72 units or larger: it is the whole point of the card.",
      "  - The quote sits in the middle of the card, clear of the top and bottom sixths.",
      "  - Nothing smaller than 26 units, and nothing overlapping anything else.",
      "  - Keep everything at least 64 units clear of every canvas edge.",
      "",
      "Typography:",
      "  - The quote's box is 840 wide and starts at x = 120. The quote is set on exactly four lines,",
      "    as large as it will go on four lines at that measure (within 2% of the largest size that",
      "    still breaks into four lines).",
      "  - Every text box is no taller than its text needs, plus at most 8 units.",
      "  - The attribution starts at the same left edge and sits exactly 40 units below the quote's box.",
      "  - The quote and the attribution together are centred vertically on the card.",
      "  - The one decorative shape is a rule exactly 120 wide and 8 tall, starting at x = 120,",
      "    and ending exactly 32 units above the quote's box.",
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
      dominantTypeAtLeast("We shape our buildings; thereafter they shape us.", 72, 2),
      noOverlap(visibleText, 1, "Blocks of text do not overlap"),
      marginAtLeast(64, 1),
      // v2.
      sizeIs(withText("We shape our buildings"), { width: 840 }, 2, 2, "The quote's box is 840 wide"),
      edgeAt(visibleText, "left", 120, 2, 1, "The text starts at x = 120"),
      alignedOn("left", visibleText, 2, 1),
      lineCount(withText("We shape our buildings"), 4, 2, "The quote is set on four lines"),
      fillsMeasure(withText("We shape our buildings"), 4, 0.98, 2, "The quote is as large as it goes on four lines"),
      hugsText(visibleText, 8, 2),
      gapBetween(withText("We shape our buildings"), withText("Winston Churchill, 1943"), "vertical", 40, 2, 1, "The attribution sits 40 below the quote"),
      centeredOnCanvas(visibleText, "vertical", 3, 2, "The quote and attribution are centred vertically"),
      sizeIs(isRect, { width: 120, height: 8 }, 1, 1, "The rule is 120 by 8"),
      edgeAt(isRect, "left", 120, 2, 1, "The rule starts at x = 120"),
      gapBetween(isRect, withText("We shape our buildings"), "vertical", 32, 2, 1, "The rule ends 32 above the quote"),
    ],
    judgeCriteria: [
      "Is the quote the visual centre of the card?",
      "Is the attribution clearly secondary without being an afterthought?",
      "Is the composition balanced — does the text sit deliberately rather than landing wherever it fell?",
    ],
    maxTurns: 35,
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
      "  - The product name is larger than the price, and the price larger than the description,",
      "    and the name is set at 60 units or larger.",
      "  - No text smaller than 20 units, and no two blocks of text overlapping.",
      "  - Keep everything at least 24 units clear of every canvas edge.",
      "  - Fill the card: the photo, copy and button should between them cover at least 45%",
      "    of the canvas.",
      "",
      "Layout:",
      "  - The photo runs the full width of the card along the top edge (x = 0, y = 0), exactly 600 tall.",
      "  - The product name and the price share a row that starts exactly 48 units below the photo:",
      "    the two boxes share a top edge, the name's box starts at x = 64 and is 600 wide, and the",
      "    price's box ends at x = 1016.",
      "  - The name is set on one line, as large as it will go on one line at that 600 measure",
      "    (within 2% of the largest size that still fits on one line).",
      "  - The description's box starts at x = 64 and is 952 wide, sits exactly 24 units below the",
      "    lower of the name and price boxes, and is set on exactly two lines, as large as it will go",
      "    on two lines at that measure (within 2%).",
      "  - Every text box is no taller than its text needs, plus at most 8 units.",
      "  - The button's shape is exactly 400 by 104, starts at x = 64, sits exactly 48 units below the",
      "    description's box, and its label is centred on it both ways.",
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
      dominantTypeAtLeast("Ridge Roast", 60, 2),
      noOverlap(visibleText, 1, "Blocks of text do not overlap"),
      marginAtLeast(24, 1),
      coverage(0.45, 0.98, 1),
      // v2.
      edgeAt(visibleImage, "left", 0, 1, 1, "The photo starts at the left edge"),
      edgeAt(visibleImage, "top", 0, 1, 1, "The photo starts at the top edge"),
      sizeIs(visibleImage, { width: 1080, height: 600 }, 2, 1, "The photo is 1080 by 600"),
      alignedOn("top", (el) => withText("Ridge Roast")(el) || withText("$18.00")(el), 2, 1),
      gapBetween(visibleImage, (el) => withText("Ridge Roast")(el) || withText("$18.00")(el), "vertical", 48, 2, 1, "The name and price row sits 48 below the photo"),
      edgeAt(withText("Ridge Roast"), "left", 64, 2, 1, "The name starts at x = 64"),
      sizeIs(withText("Ridge Roast"), { width: 600 }, 2, 2, "The name's box is 600 wide"),
      edgeAt(withText("$18.00"), "right", 1016, 2, 1, "The price ends at x = 1016"),
      lineCount(withText("Ridge Roast"), 1, 2, "The name is set on one line"),
      fillsMeasure(withText("Ridge Roast"), 1, 0.98, 2, "The name is as large as it goes on one line"),
      edgeAt(withText("A dark, cocoa-forward"), "left", 64, 2, 1, "The description starts at x = 64"),
      sizeIs(withText("A dark, cocoa-forward"), { width: 952 }, 2, 2, "The description's box is 952 wide"),
      gapBetween((el) => withText("Ridge Roast")(el) || withText("$18.00")(el), withText("A dark, cocoa-forward"), "vertical", 24, 2, 1, "The description sits 24 below the row"),
      lineCount(withText("A dark, cocoa-forward"), 2, 2, "The description is set on two lines"),
      fillsMeasure(withText("A dark, cocoa-forward"), 2, 0.98, 2, "The description is as large as it goes on two lines"),
      hugsText(visibleText, 8, 2),
      sizeIs(buttonShape, { width: 400, height: 104 }, 2, 1, "The button is 400 by 104"),
      edgeAt(buttonShape, "left", 64, 2, 1, "The button starts at x = 64"),
      gapBetween(withText("A dark, cocoa-forward"), buttonShape, "vertical", 48, 2, 1, "The button sits 48 below the description"),
      alignedOn("hcenter", (el, d) => buttonShape(el, d) || withText("Add to basket")(el), 2, 1),
      alignedOn("vcenter", (el, d) => buttonShape(el, d) || withText("Add to basket")(el), 2, 1),
    ],
    judgeCriteria: [
      "Does the photo occupy the top of the card with the text below, as asked?",
      "Does the button read as a button — a filled shape with its label sitting on it?",
      "Is the price prominent enough to find at a glance?",
      "Is the description set at a size that is comfortable to read rather than shrunk to fit?",
    ],
    maxTurns: 40,
  }),

  /**
   * The rotation task, and the one the feedback hypothesis rests on.
   *
   * A ribbon is the ordinary reason a designer rotates anything, and it is the
   * case where the numbers in the document and the picture on the page come
   * apart hardest: a 760 by 130 banner is comfortably inside a 32-unit margin
   * on a 1080-unit canvas, and at -14 degrees it reaches 738 + 31 = 769 wide
   * and 184 + 126 = 310 tall — a quarter again as tall as it was declared, and
   * off the margin if it was placed by the numbers. `marginAtLeast` measures
   * what an element paints, so it sees the rotated corners.
   *
   * Nothing in the brief explains that, and that is deliberate: the margin is
   * stated, the technique is not. Working out where a tilted box actually
   * lands is the difficulty, and whether a screenshot makes it easier than a
   * list of coordinates is the question. `docs/PREREGISTRATION.md` H5.
   */
  defineTask({
    id: "compose.sale-card",
    title: "Sale card with a tilted ribbon",
    family: "compose",
    brief: [
      "Make a closing-down sale card for a shop.",
      "",
      "Required copy, word for word:",
      '  - Headline: "Everything Must Go"',
      '  - Ribbon: "HALF PRICE"',
      '  - Shop: "Ridgeline Supply Co."',
      '  - Detail: "Last day Sunday the 26th"',
      "",
      "Constraints:",
      '  - "HALF PRICE" runs at a tilt of -14 degrees, set on a filled shape turned to the same angle,',
      "    so it reads as a ribbon across the card. It sits in the bottom third.",
      "  - The headline is the largest type, at least twice the size of the smallest, and sits in the top third.",
      "    Set it at 110 units or larger.",
      "  - The shop name is set larger than the detail line.",
      "  - Everything else stays square to the canvas — the ribbon and its shape are the only things tilted.",
      "  - No text smaller than 24 units, and no two blocks of text overlapping.",
      "  - Nothing may come within 32 units of a canvas edge.",
      "  - Fill the card: the elements should between them cover at least 45% of the canvas.",
      "",
      "Layout:",
      "  - The ribbon's shape is exactly 140 units tall (measured across the band, before the tilt),",
      "    and it runs across the card: what it paints comes to between 32 and 48 units of the left",
      "    edge, and to between 32 and 48 units of the right edge.",
      '  - "HALF PRICE" is centred on the ribbon\'s shape.',
      "  - The headline's box starts at x = 60 and is 960 wide. The headline is set on exactly two",
      "    lines, as large as it will go on two lines at that measure (within 2% of the largest size",
      "    that still breaks into two lines).",
      "  - Every text box is no taller than its text needs, plus at most 8 units.",
      "  - The shop name sits exactly 24 units below the headline's box, and the detail line exactly",
      "    8 units below the shop name's box.",
    ].join("\n"),
    initial: () => blank({ background: "#f7f4ee" }),
    checks: [
      containsText(["Everything Must Go", "HALF PRICE", "Ridgeline Supply Co.", "Last day Sunday the 26th"], 2),
      rotationWithin(withText("HALF PRICE"), -14, 3, { tolerance: 2, label: "The ribbon runs at -14 degrees" }),
      // A tilted label on an upright rect is not a ribbon, and the two
      // bounding boxes overlap just as happily either way.
      textOnFilledShape("HALF PRICE", 2, { rotationWithin: 3 }),
      inRegion(withText("HALF PRICE"), { x0: 0, y0: 0.66, x1: 1, y1: 1 }, 1, "The ribbon sits in the bottom third"),
      // "Everything else stays square." Without this the answer to a tilted
      // ribbon is to tilt the whole card and call it a design.
      rotationWithin(
        (el) => visibleText(el) && !withText("HALF PRICE")(el),
        0,
        2,
        { label: "The rest of the card is square to the canvas" },
      ),
      inRegion(
        withText("Everything Must Go"),
        { x0: 0, y0: 0, x1: 1, y1: 0.34 },
        1,
        "The headline sits in the top third",
      ),
      textSizeOrder(["Everything Must Go", "Ridgeline Supply Co.", "Last day Sunday the 26th"], 2),
      typeHierarchy(2, 1),
      fontSizeAtLeast(24, 1),
      dominantTypeAtLeast("Everything Must Go", 110, 2),
      noOverlap(visibleText, 1, "Blocks of text do not overlap"),
      // The check the rotation is really about: a tilted banner reaches
      // further than its width and height say, and this measures what it
      // paints rather than what it declared.
      marginAtLeast(32, 3),
      coverage(0.45, 0.98, 1),
      // v2. The rotation hypothesis again: how far a tilted band reaches is
      // its width times the cosine plus its height times the sine, and the
      // brief states the reach, not the width.
      sizeIs(ribbonShape, { height: 140 }, 2, 1, "The ribbon is 140 tall"),
      paintedReach(ribbonShape, "horizontal", 32, 48, 3, "The ribbon reaches to 32–48 units of both side edges"),
      alignedOn("hcenter", (el, d) => ribbonShape(el, d) || withText("HALF PRICE")(el), 3, 1),
      alignedOn("vcenter", (el, d) => ribbonShape(el, d) || withText("HALF PRICE")(el), 3, 1),
      edgeAt(withText("Everything Must Go"), "left", 60, 2, 1, "The headline starts at x = 60"),
      sizeIs(withText("Everything Must Go"), { width: 960 }, 2, 2, "The headline's box is 960 wide"),
      lineCount(withText("Everything Must Go"), 2, 2, "The headline is set on two lines"),
      fillsMeasure(withText("Everything Must Go"), 2, 0.98, 2, "The headline is as large as it goes on two lines"),
      hugsText(visibleText, 8, 2),
      gapBetween(withText("Everything Must Go"), withText("Ridgeline Supply Co."), "vertical", 24, 2, 1, "The shop sits 24 below the headline"),
      gapBetween(withText("Ridgeline Supply Co."), withText("Last day Sunday the 26th"), "vertical", 8, 2, 1, "The detail sits 8 below the shop"),
    ],
    judgeCriteria: [
      "Does the ribbon read as a ribbon — a banner tilted across the card with its words on it?",
      "Is the tilt confined to the ribbon, with everything else square?",
      "Is the headline unmistakably the dominant piece of type?",
      "Does the card look composed, with the ribbon sitting deliberately rather than crossing the copy?",
    ],
    maxTurns: 40,
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
      "  - The talk title is at least twice the size of the smallest type, and at 84 units",
      "    or larger.",
      "  - No two blocks of text overlapping, and everything at least 56 units clear of every edge.",
      "",
      "Layout:",
      "  - All three text boxes start at x = 100, and the talk title's box is 880 wide.",
      "  - The talk title is set on exactly two lines, as large as it will go on two lines at that",
      "    measure (within 2% of the largest size that still breaks into two lines).",
      "  - Every text box is no taller than its text needs, plus at most 8 units.",
      "  - The speaker sits exactly 32 units below the title's box, and the event exactly 8 units",
      "    below the speaker's box.",
      "  - The three together are centred vertically on the card.",
    ].join("\n"),
    initial: titleCard,
    checks: [
      containsText(["Interfaces That Explain Themselves", "Dana Okonkwo", "Layout Conf 2026"], 2),
      typeHierarchy(2, 1),
      textSizeOrder(["Interfaces That Explain Themselves", "Dana Okonkwo", "Layout Conf 2026"], 2),
      fontSizeAtLeast(30, 1),
      dominantTypeAtLeast("Interfaces That Explain Themselves", 84, 2),
      noOverlap(visibleText, 1, "Blocks of text do not overlap"),
      marginAtLeast(56, 1),
      // "Leave it exactly as it is." Nothing stopped a run deleting the
      // gradient, swapping it, shrinking it to a corner — or, once the
      // geometry was pinned, fading it to 5% and setting the text on the plain
      // white page it was supposed to be read against.
      usesImage(["texture/gradient"], 1),
      // Both "unchanged" checks skip an element that is gone — that is
      // `preservesElements`' finding, by design — and `usesImage` accepts any
      // element carrying the asset. Together that let a run delete `bg`,
      // create an identical gradient under another id, and satisfy all three.
      preservesElements(["bg"], 1),
      geometryUnchanged(titleCard(), ["bg"], 1),
      styleUnchanged(titleCard(), ["bg"], 1),
      // v2.
      edgeAt(visibleText, "left", 100, 2, 1, "The text starts at x = 100"),
      alignedOn("left", visibleText, 2, 1),
      sizeIs(withText("Interfaces That Explain Themselves"), { width: 880 }, 2, 2, "The title's box is 880 wide"),
      lineCount(withText("Interfaces That Explain Themselves"), 2, 2, "The title is set on two lines"),
      fillsMeasure(withText("Interfaces That Explain Themselves"), 2, 0.98, 2, "The title is as large as it goes on two lines"),
      hugsText(visibleText, 8, 2),
      gapBetween(withText("Interfaces That Explain Themselves"), withText("Dana Okonkwo"), "vertical", 32, 2, 1, "The speaker sits 32 below the title"),
      gapBetween(withText("Dana Okonkwo"), withText("Layout Conf 2026"), "vertical", 8, 2, 1, "The event sits 8 below the speaker"),
      centeredOnCanvas(visibleText, "vertical", 3, 2, "The three are centred vertically"),
    ],
    judgeCriteria: [
      "Is the talk title legible against the gradient at a glance?",
      "Are speaker and event distinguishable from the title and from each other?",
      "Does the card look composed for projection — generous margins, nothing fussy?",
    ],
    maxTurns: 35,
  }),
];
