/**
 * The measurement family (prototype): real layouts with many pieces of text
 * that each have to be measured.
 *
 * Two calibration rounds and two prototypes (`docs/PREREGISTRATION.md` §13)
 * found the same thing from three directions: a strong model computes stated
 * geometry exactly — gaps, grids, rotation, even a partition search — and
 * what it misses is text it cannot measure: type set as large as it goes on a
 * line, a box the height its text needs. So every task here is a page a
 * designer would recognise, with a handful of such measurements in it rather
 * than one: auto-fit headlines on a contents page, dish names on a menu,
 * session titles in a programme's cards, a timeline whose spine has to run
 * exactly as far as its hugged entries do.
 *
 * Kept out of `TASKS` until calibrated. Run them with `--tasks measure`.
 */

import { defineTask, type Task } from "./types.js";
import { doc, rect, text } from "./helpers.js";
import type { Doc, Element } from "../doc/types.js";
import { aabb } from "../doc/geometry.js";
import {
  alignedOn,
  edgeAt,
  fillsBox,
  fillsMeasure,
  gapBetween,
  geometryUnchanged,
  hugsText,
  insetWithin,
  lineCount,
  sizeIs,
  styleUnchanged,
  type Check,
} from "../eval/checks.js";

const INK = "#1d1d2b";
const ACCENT = "#c0392b";
const MUTED = "#55556b";
const PAPER = "#f7f4ee";

/** Every matched element ends by `y`. */
function endsBy(ids: string[], y: number): Check {
  return {
    id: "ends_by",
    label: `Nothing goes below y = ${y}`,
    weight: 1,
    run(d) {
      const bottoms = ids
        .map((id) => d.elements.find((e) => e.id === id))
        .filter((e): e is Element => !!e)
        .map((e) => aabb(e).y + aabb(e).height);
      const worst = Math.max(...bottoms, 0) - y;
      return { score: worst <= 0 ? 1 : Math.max(0, 1 - worst / 60), detail: `Lowest edge at ${Math.round(Math.max(...bottoms, 0))}.` };
    },
  };
}

const header = (copy: string) =>
  text({ id: "header", x: 60, y: 60, w: 960, h: 90, z: 0, text: copy, style: { fontSize: 72, fontWeight: "bold", color: INK } });

// --- contents ---------------------------------------------------------------

const ENTRY_COPY = [
  { n: "04", title: "The Crossing We Moved Upstream", teaser: "Why we rebuilt on rock." },
  { n: "09", title: "Nine Thousand Feet of Stage", teaser: "A festival above the treeline." },
  { n: "12", title: "What the Ford Taught Us", teaser: "Four days a year, no crossing." },
  { n: "16", title: "Winter Notes From the Valley Road", teaser: "What the snowplough saw." },
  { n: "19", title: "Letters From the Eastern Bank", teaser: "Readers on the long way round." },
  { n: "23", title: "A Bridge Is a Promise", teaser: "Four times the price. Worth it?" },
  { n: "27", title: "Notes on Patching, Honestly", teaser: "A season of quick fixes, totted up." },
  { n: "31", title: "The Long Way Round, Measured", teaser: "Seven extra miles a day." },
  { n: "34", title: "Rebuilding the Footbridge in a Week", teaser: "One very long Saturday." },
  { n: "38", title: "Six Volunteers and a Borrowed Winch", teaser: "How the winch came back." },
  { n: "41", title: "The Map We Drew After the Melt", teaser: "Every bend, redrawn by hand." },
  { n: "45", title: "Why the Old Signs Stayed Up", teaser: "Nobody had the heart." },
  { n: "48", title: "A Year of Building Quietly", teaser: "Twelve months, no headlines." },
  { n: "52", title: "The Ferryman Retires", teaser: "Forty years on the river." },
  { n: "55", title: "Counting Trucks at Dawn", teaser: "A census before breakfast." },
  { n: "58", title: "What Gravel Remembers", teaser: "Notes from the riverbed." },
];
const NUM_STYLE = { fontSize: 30, fontWeight: "bold" as const, color: ACCENT };
const TITLE_STYLE = { fontSize: 40, fontWeight: "bold" as const, color: INK };
const TEASER_STYLE = { fontSize: 26, color: MUTED, lineHeight: 1.35 };

export interface ContentsSpec {
  id: string;
  entries: number;
  /** Left edge of each column. */
  columns: number[];
  width: number;
}

/**
 * A magazine contents page whose headlines auto-fit: each is set as large as
 * it will go on exactly two lines of its column — the "auto-fit text" a story
 * editor offers — and every box hugs text whose line breaks are unseen.
 */
export function contentsTask(spec: ContentsSpec): Task {
  const entries = ENTRY_COPY.slice(0, spec.entries);
  const perColumn = spec.entries / spec.columns.length;
  const NUM = entries.map((_, i) => `num${i + 1}`);
  const TITLE = entries.map((_, i) => `title${i + 1}`);
  const TEASER = entries.map((_, i) => `teaser${i + 1}`);
  const columnOf = (i: number) => Math.floor(i / perColumn);
  const initial = (): Doc =>
    doc(
      [
        header("In this issue"),
        ...entries.flatMap((e, i) => {
          // Roughly where each entry belongs, every box the wrong size.
          const x = spec.columns[columnOf(i)]! + ((i * 29) % 40) - 20;
          const y = 220 + (i % perColumn) * (1000 / perColumn) + ((i * 41) % 60) - 30;
          return [
            text({ id: NUM[i]!, x, y, w: spec.width - 150, h: 60, z: 1 + i * 3, text: e.n, style: NUM_STYLE }),
            text({ id: TITLE[i]!, x, y: y + 50, w: spec.width - 30, h: 100, z: 2 + i * 3, text: e.title, style: TITLE_STYLE }),
            text({ id: TEASER[i]!, x, y: y + 170, w: spec.width + 20, h: 50, z: 3 + i * 3, text: e.teaser, style: TEASER_STYLE }),
          ];
        }),
      ],
      { background: PAPER },
    );
  const ids = (i: number) => [NUM[i]!, TITLE[i]!, TEASER[i]!];
  const inColumn = (c: number) => entries.map((_, i) => i).filter((i) => columnOf(i) === c);
  const checks: Check[] = [
    geometryUnchanged(initial(), ["header"], 1),
    styleUnchanged(initial(), [...NUM, ...TEASER], 2, { keys: ["fontSize", "fontWeight", "lineHeight"] }),
    styleUnchanged(initial(), TITLE, 1, { keys: ["fontWeight", "lineHeight"] }),
    sizeIs([...NUM, ...TITLE, ...TEASER], { width: spec.width }, 1.5, 3, `Every box is ${spec.width} wide`),
    ...spec.columns.flatMap((x, c) => [
      edgeAt(inColumn(c).flatMap(ids), "left", x, 1.5, 1, `Column ${c + 1} starts at x = ${x}`),
      alignedOn("left", inColumn(c).flatMap(ids), 1.5, 1),
      edgeAt([NUM[inColumn(c)[0]!]!], "top", 200, 1.5, 1, `Column ${c + 1} starts at y = 200`),
    ]),
    ...entries.flatMap((_, i) => [
      gapBetween([NUM[i]!], [TITLE[i]!], "vertical", 8, 1.5, 1, `Headline ${i + 1} sits 8 below its number`),
      gapBetween([TITLE[i]!], [TEASER[i]!], "vertical", 12, 1.5, 1, `Teaser ${i + 1} sits 12 below its headline`),
      ...(i % perColumn < perColumn - 1
        ? [gapBetween([TEASER[i]!], [NUM[i + 1]!], "vertical", 48, 1.5, 1, `Entry ${i + 2} sits 48 below entry ${i + 1}`)]
        : []),
    ]),
    lineCount(TITLE, 2, 3, "Every headline is set on two lines"),
    fillsMeasure(TITLE, 2, 0.98, 6, "Every headline is as large as it goes on two lines"),
    hugsText([...NUM, ...TITLE, ...TEASER], 4, 4),
    endsBy([...NUM, ...TITLE, ...TEASER], 1290),
  ];
  const columnWords = ["", "one column", "two columns", "three columns", "four columns"][spec.columns.length];
  const ranges = spec.columns.map((_, c) => `${inColumn(c)[0]! + 1} to ${inColumn(c).at(-1)! + 1}`);
  return defineTask({
    id: spec.id,
    title: "A contents page with auto-fit headlines",
    family: "fit",
    brief: [
      "Set this contents page. The header stays exactly as it is. The entries — each a page number, a headline",
      `and a teaser (num1, title1, teaser1 and so on) — go into ${columnWords}, in order: entries ${ranges.join(", then ")},`,
      "each column filled top to bottom, columns left to right.",
      "",
      `  - The columns' boxes start at x = ${spec.columns.join(", ")}; every box is ${spec.width} wide.`,
      "  - Each column's first page number starts at y = 200.",
      "  - Within an entry, the headline sits exactly 8 units below its number, and the teaser exactly 12 below",
      "    the headline. Each entry sits exactly 48 units below the teaser of the entry above it.",
      "  - The headlines auto-fit: each is set on exactly two lines, as large as it will go on two lines at the",
      `    ${spec.width} width (within 2% of the largest size that still breaks into two lines).`,
      "  - Every box is no taller than its text needs, plus at most 4 units, and nothing goes below y = 1290.",
      "",
      "Page numbers and teasers keep their type size, weight and line height; headlines keep their weight and",
      "line height. Keep every element and every word.",
    ].join("\n"),
    initial,
    checks,
    judgeCriteria: [
      "Does it read as a magazine contents page — tidy columns of entries?",
      "Do the headlines fill their measure without crowding?",
    ],
    maxTurns: 60,
  });
}

// --- menu -------------------------------------------------------------------

/**
 * Twelve dishes in two columns. Every name is long enough that "as large as it
 * goes on two lines, up to 40" lands below the cap, so every one of the twelve
 * is a measurement rather than a number to copy.
 */
const MENU: { section: string; dishes: [string, string, string][] }[] = [
  {
    section: "Small plates",
    dishes: [
      ["Charred leeks with hazelnut crumb and brown butter", "11", "Leeks from the valley farm."],
      ["Cold-smoked trout on dark rye with horseradish", "9", "Smoked in the back shed."],
      ["Roast beetroot, whipped feta and bright dill oil", "10", "Three colours, roasted slowly."],
      ["Grilled flatbread with wild garlic and sea salt", "7", "Straight from the wood oven."],
      ["Crisp potato terrine with smoked onion cream", "9", "Forty layers, pressed overnight."],
      ["Chicory, blood orange and toasted walnut salad", "10", "Bitter, sweet and crunchy."],
    ],
  },
  {
    section: "Mains",
    dishes: [
      ["Slow-braised lamb shoulder with garlic white beans", "26", "Seven hours in the oven."],
      ["Wild mushroom risotto with aged mountain cheese", "21", "Whatever the woods gave us."],
      ["Pan-roasted hake with mussels and saffron broth", "24", "Line-caught, every morning."],
      ["Ridgeline beef burger with our own pickles and slaw", "18", "On a soft milk bun."],
      ["Roast celeriac steak with green sauce and capers", "19", "The vegetable as the main event."],
      ["Whole roast trout with brown shrimp and lemon butter", "25", "Served on the bone."],
    ],
  },
];

const DISHES = MENU.flatMap((s) => s.dishes);
const dishIds = DISHES.map((_, i) => ({ name: `dish${i + 1}`, price: `price${i + 1}`, desc: `desc${i + 1}` }));
const sectionIds = MENU.map((_, i) => `section${i + 1}`);
const MENU_COLUMNS = [60, 560];

const menu = (): Doc => {
  const els: Element[] = [header("Ridgeline Kitchen")];
  MENU.forEach((s, si) => {
    els.push(text({ id: sectionIds[si]!, x: MENU_COLUMNS[si]! + 10, y: 230, w: 400, h: 70, z: els.length, text: s.section, style: { fontSize: 34, fontWeight: "bold", color: ACCENT } }));
  });
  DISHES.forEach(([name, price, desc], i) => {
    const col = Math.floor(i / 6);
    const x = MENU_COLUMNS[col]! + ((i * 13) % 20);
    const y = 320 + (i % 6) * 160 + ((i * 37) % 40);
    const ids = dishIds[i]!;
    els.push(text({ id: ids.name, x, y, w: 340, h: 70, z: els.length, text: name, style: { fontSize: 30, fontWeight: "bold", color: INK } }));
    els.push(text({ id: ids.price, x: x + 370, y: y + 10, w: 70, h: 60, z: els.length, text: price, style: { fontSize: 30, fontWeight: "bold", color: INK, align: "right" } }));
    els.push(text({ id: ids.desc, x, y: y + 90, w: 420, h: 40, z: els.length, text: desc, style: { fontSize: 24, color: MUTED, lineHeight: 1.4 } }));
  });
  return doc(els, { background: PAPER });
};

const inMenuColumn = (c: number) => dishIds.slice(c * 6, c * 6 + 6);

export const menuTask = defineTask({
  id: "measure.menu",
  title: "A menu with auto-fit dish names",
  family: "fit",
  brief: [
    "Set this menu. The header stays exactly as it is. Two columns: section1 heads the left column with dishes",
    "1 to 6 under it, section2 heads the right column with dishes 7 to 12, in order. Each dish is a name, a price",
    "and a description (dish1, price1, desc1 and so on).",
    "",
    "  - The columns start at x = 60 and x = 560. In each, the heading and the descriptions are 460 wide and the",
    "    names 360 wide, starting at the column's left edge; each price is 80 wide, right-aligned, ends at the",
    "    column's right edge (x = 520 or x = 1020), and shares a top edge with its dish's name.",
    "  - Both headings start at y = 200. Each column's first dish sits exactly 16 units below its heading; each",
    "    description sits exactly 6 units below its name; each next dish sits exactly 28 units below the",
    "    description above it.",
    "  - Dish names auto-fit: each is set on exactly two lines, as large as it will go on two lines at the 360",
    "    width but never larger than 40 (within 2% of whichever is smaller).",
    "  - Every box is no taller than its text needs, plus at most 4 units, and nothing goes below y = 1290.",
    "",
    "Headings, prices and descriptions keep their type size, weight and line height; names keep their weight.",
    "Keep every element and every word.",
  ].join("\n"),
  initial: menu,
  checks: [
    geometryUnchanged(menu(), ["header"], 1),
    styleUnchanged(menu(), [...sectionIds, ...dishIds.flatMap((d) => [d.price, d.desc])], 2, { keys: ["fontSize", "fontWeight", "lineHeight"] }),
    styleUnchanged(menu(), dishIds.map((d) => d.name), 1, { keys: ["fontWeight"] }),
    sizeIs([...sectionIds, ...dishIds.map((d) => d.desc)], { width: 460 }, 1.5, 2, "Headings and descriptions are 460 wide"),
    sizeIs(dishIds.map((d) => d.name), { width: 360 }, 1.5, 3, "Names are 360 wide"),
    sizeIs(dishIds.map((d) => d.price), { width: 80 }, 1.5, 1, "Prices are 80 wide"),
    ...[0, 1].flatMap((c) => {
      const ids = inMenuColumn(c);
      const x = MENU_COLUMNS[c]!;
      return [
        edgeAt([sectionIds[c]!, ...ids.flatMap((d) => [d.name, d.desc])], "left", x, 1.5, 1, `Column ${c + 1} starts at x = ${x}`),
        alignedOn("left", [sectionIds[c]!, ...ids.flatMap((d) => [d.name, d.desc])], 1.5, 1),
        edgeAt(ids.map((d) => d.price), "right", x + 460, 1.5, 1, `Column ${c + 1}'s prices end at x = ${x + 460}`),
        alignedOn("right", ids.map((d) => d.price), 1.5, 1),
        edgeAt([sectionIds[c]!], "top", 200, 1.5, 1, `Heading ${c + 1} starts at y = 200`),
        gapBetween([sectionIds[c]!], [ids[0]!.name], "vertical", 16, 1.5, 1, `Column ${c + 1}'s first dish sits 16 below its heading`),
        ...ids.slice(0, -1).map((d, k) => gapBetween([d.desc], [ids[k + 1]!.name], "vertical", 28, 1.5, 1, `Dish ${c * 6 + k + 2} sits 28 below dish ${c * 6 + k + 1}`)),
      ];
    }),
    ...dishIds.map((d) => alignedOn("top", [d.name, d.price], 1.5, 1)),
    ...dishIds.map((d, i) => gapBetween([d.name], [d.desc], "vertical", 6, 1.5, 1, `Description ${i + 1} sits 6 below its name`)),
    lineCount(dishIds.map((d) => d.name), 2, 3, "Every name is on two lines"),
    fillsMeasure(dishIds.map((d) => d.name), 2, 0.98, 6, "Every name is as large as it goes on two lines, up to 40", 40),
    hugsText([...sectionIds, ...dishIds.flatMap((d) => [d.name, d.price, d.desc])], 4, 4),
    endsBy(dishIds.map((d) => d.desc), 1290),
  ],
  judgeCriteria: ["Does it read as a menu — two columns of dishes with prices on the right?", "Do the dish names read as one family despite their different sizes?"],
  maxTurns: 60,
});

// --- programme --------------------------------------------------------------

const SESSIONS = [
  ["09:00", "Opening remarks", "Dana Okonkwo"],
  ["09:00", "Grids that bend without breaking", "Ruth Meyers"],
  ["09:00", "A field guide to variable fonts", "Tomas Lind"],
  ["10:30", "What we learned shipping auto-layout to a million editors", "Priya Natarajan"],
  ["10:30", "Colour", "Sam Okafor"],
  ["10:30", "Accessible contrast in dark themes, measured", "Lea Brandt"],
  ["13:00", "Lunch talk: the history of the paste-up board", "Joan Ferris"],
  ["13:00", "Rotation is a layout problem", "Marc Duval"],
  ["13:00", "Designing for screens nobody has built yet", "Yuki Sato"],
  ["15:00", "Panel: tools, taste and the agents in between", "Five speakers"],
  ["15:00", "Small type", "Iris Chen"],
  ["15:00", "Closing keynote: the page is a promise", "Dana Okonkwo"],
] as const;
const CARD_X = [60, 390, 720];
const CARD_Y = [200, 470, 740, 1010];
const CARD = SESSIONS.map((_, i) => ({ card: `card${i + 1}`, time: `time${i + 1}`, title: `session${i + 1}`, speaker: `speaker${i + 1}` }));

const programme = (): Doc => {
  const els: Element[] = [header("Layout Conf 2026")];
  SESSIONS.forEach(([time, title, speaker], i) => {
    const x = CARD_X[i % 3]!;
    const y = CARD_Y[Math.floor(i / 3)]!;
    const ids = CARD[i]!;
    els.push(rect({ id: ids.card, x, y, w: 300, h: 240, z: els.length, style: { fill: "#ffffff", radius: 12 } }));
    // Inside their card, near enough, at the wrong sizes.
    els.push(text({ id: ids.time, x: x + 14 + (i % 3) * 4, y: y + 12, w: 200, h: 40, z: els.length, text: time, style: { fontSize: 24, fontWeight: "bold", color: ACCENT } }));
    els.push(text({ id: ids.title, x: x + 18, y: y + 60 + (i % 4) * 5, w: 270, h: 110, z: els.length, text: title, style: { fontSize: 28, fontWeight: "bold", color: INK, lineHeight: 1.15 } }));
    els.push(text({ id: ids.speaker, x: x + 22, y: y + 190, w: 250, h: 40, z: els.length, text: speaker, style: { fontSize: 22, color: MUTED } }));
  });
  return doc(els, { background: "#efeae1" });
};

export const programmeTask = defineTask({
  id: "measure.programme",
  title: "A programme whose session titles fill their cards",
  family: "fit",
  brief: [
    "Set the session cards in this conference programme. The header and the twelve white cards stay exactly",
    "where they are. Each card holds a time, a session title and a speaker (time1, session1, speaker1 for card1,",
    "and so on).",
    "",
    "  - Inside each card, the time starts 20 units in from the card's left and top edges, and the speaker",
    "    starts 20 units in from its left edge and ends 20 units above its bottom edge.",
    "  - The session title starts 20 in from the card's left edge and is 260 wide; its box starts exactly 8 units",
    "    below the time's box and ends exactly 12 units above the speaker's box.",
    "  - Each title fills its box: set as large as it will go while still fitting that box (within 2% of the",
    "    largest size that fits).",
    "  - The time and speaker boxes are no taller than their text needs, plus at most 4 units.",
    "",
    "Times and speakers keep their type size, weight and colour; titles keep their weight and line height.",
    "Keep every element and every word.",
  ].join("\n"),
  initial: programme,
  checks: [
    geometryUnchanged(programme(), ["header", ...CARD.map((c) => c.card)], 2),
    styleUnchanged(programme(), CARD.flatMap((c) => [c.time, c.speaker]), 2, { keys: ["fontSize", "fontWeight", "color"] }),
    styleUnchanged(programme(), CARD.map((c) => c.title), 1, { keys: ["fontWeight", "lineHeight"] }),
    ...CARD.flatMap((c, i) => [
      insetWithin([c.time], c.card, { left: 20, top: 20 }, 1.5, 1, `Time ${i + 1} sits 20 in`),
      insetWithin([c.speaker], c.card, { left: 20, bottom: 20 }, 1.5, 1, `Speaker ${i + 1} sits 20 in`),
      insetWithin([c.title], c.card, { left: 20, right: 20 }, 1.5, 1, `Title ${i + 1} is 260 wide, 20 in`),
      gapBetween([c.time], [c.title], "vertical", 8, 1.5, 1, `Title ${i + 1} starts 8 below its time`),
      gapBetween([c.title], [c.speaker], "vertical", 12, 1.5, 1, `Title ${i + 1} ends 12 above its speaker`),
    ]),
    fillsBox(CARD.map((c) => c.title), 0.98, 8, { label: "Every title is as large as it goes in its box" }),
    hugsText(CARD.flatMap((c) => [c.time, c.speaker]), 4, 4),
  ],
  judgeCriteria: ["Does every card read cleanly — time, title, speaker?", "Do the titles fill their cards without crowding them?"],
  maxTurns: 60,
});

// --- timeline ---------------------------------------------------------------

const EVENTS = [
  ["1998", "The first ford across the eastern channel", "A gravel bed, a gentle bank on each side, and a sign that said in large letters not to try it in April, which nobody read until the first spring."],
  ["2004", "A winter nobody planned for, and three weeks closed", "Three weeks with the crossing shut and the long way round through the pass every single day, in snow chains, with the post a day behind."],
  ["2011", "The festival comes, and every crate crosses the water", "A stage at nine thousand feet, and every crate, cable and speaker of it carried across the water by hand or by the one tractor that would start."],
  ["2019", "Patching becomes a habit we could not afford", "Seven repairs in five years, each one cheaper than the bridge would have been and not one of them still holding by the end of the following spring."],
  ["2025", "The spring melt takes the old ford forty metres east", "The river moved forty metres east in a single night in April and took the old ford, the sign and most of the eastern bank along with it."],
  ["2026", "Rock, not gravel: the crossing that should outlast us", "The new crossing, upstream and on rock, finished in October and built to outlast everybody who spent ten years arguing about whether to build it."],
] as const;
const EV = EVENTS.map((_, i) => ({ year: `year${i + 1}`, head: `event${i + 1}`, body: `note${i + 1}` }));

const timeline = (): Doc => {
  const els: Element[] = [header("Sixty years of the crossing")];
  els.push(rect({ id: "spine", x: 230, y: 200, w: 4, h: 600, z: 1, style: { fill: ACCENT } }));
  EVENTS.forEach(([year, head, body], i) => {
    const y = 210 + i * 175 + ((i * 31) % 40);
    const ids = EV[i]!;
    els.push(text({ id: ids.year, x: 60, y: y + 6, w: 150, h: 70, z: els.length, text: year, style: { fontSize: 44, fontWeight: "bold", color: ACCENT } }));
    els.push(text({ id: ids.head, x: 270, y, w: 700, h: 60, z: els.length, text: head, style: { fontSize: 32, fontWeight: "bold", color: INK } }));
    els.push(text({ id: ids.body, x: 270, y: y + 60, w: 740, h: 50, z: els.length, text: body, style: { fontSize: 26, color: MUTED, lineHeight: 1.4 } }));
  });
  return doc(els, { background: PAPER });
};

export const timelineTask = defineTask({
  id: "measure.timeline",
  title: "A timeline whose spine runs exactly as far as its entries",
  family: "fit",
  brief: [
    "Set this timeline. The header stays exactly as it is. Six events, in order — each a year, a headline and a",
    "note (year1, event1, note1 and so on) — and a spine, the thin red rule that runs down beside them.",
    "",
    "  - Years start at x = 60 and are 150 wide. Headlines and notes start at x = 260 and are 760 wide.",
    "  - Each year shares a top edge with its event's headline. The first headline starts at y = 200; each note",
    "    sits exactly 8 units below its headline; each next headline sits exactly 40 units below the note above.",
    "  - Headlines auto-fit: each on one line, as large as it will go on one line at the 760 width but never larger",
    "    than 48 (within 2% of whichever is smaller).",
    "  - Notes auto-fit too: each on exactly two lines, as large as it will go on two lines at the 760 width but",
    "    never larger than 30 (within 2% of whichever is smaller).",
    "  - Every box is no taller than its text needs, plus at most 4 units, and nothing goes below y = 1290.",
    "  - The spine keeps its 4 width and x = 230, and runs exactly from the top of the first headline's box to the",
    "    bottom of the last note's box.",
    "",
    "Years keep their type size, weight and line height; headlines keep their weight; notes keep their weight and",
    "line height.",
    "Keep every element and every word.",
  ].join("\n"),
  initial: timeline,
  checks: [
    geometryUnchanged(timeline(), ["header"], 1),
    geometryUnchanged(timeline(), ["spine"], 1, { fields: ["x", "width"] }),
    styleUnchanged(timeline(), EV.map((e) => e.year), 2, { keys: ["fontSize", "fontWeight", "lineHeight"] }),
    styleUnchanged(timeline(), EV.map((e) => e.body), 1, { keys: ["fontWeight", "lineHeight"] }),
    lineCount(EV.map((e) => e.body), 2, 3, "Every note is on two lines"),
    fillsMeasure(EV.map((e) => e.body), 2, 0.98, 6, "Every note is as large as it goes on two lines, up to 30", 30),
    styleUnchanged(timeline(), EV.map((e) => e.head), 1, { keys: ["fontWeight"] }),
    sizeIs(EV.map((e) => e.year), { width: 150 }, 1.5, 1, "Years are 150 wide"),
    edgeAt(EV.map((e) => e.year), "left", 60, 1.5, 1, "Years start at x = 60"),
    alignedOn("left", EV.map((e) => e.year), 1.5, 1),
    sizeIs(EV.flatMap((e) => [e.head, e.body]), { width: 760 }, 1.5, 3, "Headlines and notes are 760 wide"),
    edgeAt(EV.flatMap((e) => [e.head, e.body]), "left", 260, 1.5, 1, "Headlines and notes start at x = 260"),
    alignedOn("left", EV.flatMap((e) => [e.head, e.body]), 1.5, 1),
    edgeAt([EV[0]!.head], "top", 200, 1.5, 1, "The first headline starts at y = 200"),
    ...EV.map((e, i) => alignedOn("top", [e.year, e.head], 1.5, 1)),
    ...EV.map((e, i) => gapBetween([e.head], [e.body], "vertical", 8, 1.5, 1, `Note ${i + 1} sits 8 below its headline`)),
    ...EV.slice(0, -1).map((e, i) => gapBetween([e.body], [EV[i + 1]!.head], "vertical", 40, 1.5, 1, `Event ${i + 2} sits 40 below event ${i + 1}`)),
    lineCount(EV.map((e) => e.head), 1, 3, "Every headline is on one line"),
    fillsMeasure(EV.map((e) => e.head), 1, 0.98, 6, "Every headline is as large as it goes, up to 48", 48),
    hugsText(EV.flatMap((e) => [e.year, e.head, e.body]), 4, 4),
    // The spine's length is the sum of every hugged box and gap above it —
    // the measurement that ties the whole column together.
    alignedOn("top", ["spine", EV[0]!.head], 1.5, 2),
    alignedOn("bottom", ["spine", EV.at(-1)!.body], 1.5, 3),
    endsBy(EV.flatMap((e) => [e.year, e.head, e.body]), 1290),
  ],
  judgeCriteria: ["Does it read as a timeline — years down the left, events beside them, a spine joining them?", "Is the vertical rhythm even?"],
  maxTurns: 60,
});

export const measureTasks: Task[] = [
  contentsTask({ id: "measure.contents", entries: 16, columns: [60, 305, 550, 795], width: 225 }),
  menuTask,
  programmeTask,
  timelineTask,
];
