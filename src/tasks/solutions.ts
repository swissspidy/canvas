/**
 * Reference solutions: for every task, a document a competent designer would
 * produce, scoring full marks.
 *
 * They exist to prove each task can be finished (`solvable.test.ts`) and to
 * give the loophole tests an honest fix to measure a cheap one against
 * (`tasks.test.ts`). No agent ever sees them.
 *
 * Task set v2 briefs state measures, gaps and how large type goes, so most of
 * these are built from the same layout code the checks measure with — `hug`
 * sizes a box to its text — rather than written out as literals.
 */

import { getTask } from "./index.js";
import type { Doc, Element } from "../doc/types.js";
import { largestFittingFontSize, largestFontSizeForLines, requiredHeight } from "../text/layout.js";

/** A solution built by editing the starting document, which is most of them. */
function edit(taskId: string, fn: (el: Element) => Element, background?: string): Doc {
  const doc = getTask(taskId).initial();
  return { ...doc, ...(background ? { background } : {}), elements: doc.elements.map(fn) };
}

const text = (
  id: string,
  body: string,
  box: { x: number; y: number; w: number; h: number; z: number },
  style: Element["style"],
): Element => ({
  id,
  type: "text",
  x: box.x,
  y: box.y,
  width: box.w,
  height: box.h,
  rotation: 0,
  z: box.z,
  text: body,
  style,
});

const W = 1080;
const H = 1350;

/** Size a text box to exactly the height its text needs. */
function hug(el: Element): Element {
  return { ...el, height: requiredHeight(el) };
}

const bottom = (el: Element) => el.y + el.height;

/** Set a text element as large as fits its box. */
function fillTo(el: Element): Element {
  return { ...el, style: { ...el.style, fontSize: largestFittingFontSize(el)! } };
}

/** Set a text element as large as it goes on `lines` lines at its width. */
function onLines(el: Element, lines: number): Element {
  return { ...el, style: { ...el.style, fontSize: largestFontSizeForLines(el, lines)! } };
}

const onOneLine = (el: Element) => onLines(el, 1);

/** Place an element so its box ends at `y`. */
function endAt(el: Element, y: number): Element {
  return { ...el, y: y - el.height };
}

/**
 * One reference solution per task. Where the fix is an edit of the starting
 * document it is written as one, so the diff from the broken state is the
 * point rather than a wall of literals.
 */
export const SOLUTIONS: Record<string, () => Doc> = {
  // --- compose: built from nothing ----------------------------------------

  // v2 briefs state the measure, the gaps and how large the headline goes,
  // so these are built from the same layout code the checks measure with:
  // `hug` sizes a box to its text, and every gap is stated arithmetic.
  "compose.festival-poster": () => {
    const title = hug(text("title", "Ridgeline Festival", { x: 80, y: 80, w: 920, h: 0, z: 2 }, { fontSize: 200, fontWeight: "bold", color: "#ffffff" }));
    const dates = hug(text("dates", "September 12-14", { x: 80, y: bottom(title) + 40, w: 920, h: 0, z: 3 }, { fontSize: 64, color: "#f6e7c1" }));
    const venue = hug(text("venue", "Alpine Meadow, Colorado", { x: 80, y: bottom(dates) + 12, w: 920, h: 0, z: 4 }, { fontSize: 42, color: "#e6e6f2" }));
    const cta = endAt(hug(text("cta", "Tickets at ridgeline.fm", { x: 80, y: 0, w: 920, h: 0, z: 5 }, { fontSize: 40, color: "#ffffff" })), 1270);
    return {
      width: W,
      height: H,
      background: "#101020",
      elements: [
        { id: "bg", type: "image", x: 0, y: 0, width: W, height: H, rotation: 0, z: 0, src: "photo/mountains", style: {} },
        { id: "scrim", type: "rect", x: 0, y: 0, width: W, height: H, rotation: 0, z: 1, style: { fill: "#0b0b18aa" } },
        title,
        dates,
        venue,
        cta,
      ],
    };
  },

  "compose.event-flyer": () => {
    const head = hug(text("head", "Saturday Coffee Morning", { x: 60, y: 60, w: 960, h: 0, z: 0 }, { fontSize: 128, fontWeight: "bold", color: "#3a2417" }));
    const photo: Element = { id: "photo", type: "image", x: 60, y: bottom(head) + 32, width: 960, height: 540, rotation: 0, z: 1, src: "photo/coffee", style: { radius: 16 } };
    const when = hug(text("when", "Every Saturday, 9am to noon", { x: 60, y: bottom(photo) + 32, w: 960, h: 0, z: 2 }, { fontSize: 44, color: "#4a3121" }));
    const where = hug(text("where", "Corner of Fifth and Pine", { x: 60, y: bottom(when) + 12, w: 960, h: 0, z: 3 }, { fontSize: 36, color: "#5a3d28" }));
    const signoff = endAt(hug(text("signoff", "All welcome. Bring a friend.", { x: 60, y: 0, w: 960, h: 0, z: 4 }, { fontSize: 32, color: "#6a4a30" })), 1290);
    return { width: W, height: H, background: "#fdf6ec", elements: [head, photo, when, where, signoff] };
  },

  "compose.quote-card": () => {
    const quote = hug(text("quote", "We shape our buildings; thereafter they shape us.", { x: 120, y: 0, w: 840, h: 0, z: 1 }, { fontSize: 120, fontWeight: "bold", color: "#f4f1ea" }));
    const who = hug(text("who", "Winston Churchill, 1943", { x: 120, y: 0, w: 840, h: 0, z: 2 }, { fontSize: 34, color: "#a8a3c0" }));
    const top = (H - (quote.height + 40 + who.height)) / 2;
    quote.y = top;
    who.y = bottom(quote) + 40;
    const rule: Element = { id: "rule", type: "rect", x: 120, y: top - 32 - 8, width: 120, height: 8, rotation: 0, z: 0, style: { fill: "#e3a35b" } };
    return { width: W, height: H, background: "#1b1b28", elements: [rule, quote, who] };
  },

  "compose.product-card": () => {
    const name = hug(text("name", "Ridge Roast", { x: 64, y: 648, w: 600, h: 0, z: 1 }, { fontSize: 100, fontWeight: "bold", color: "#22223b" }));
    const price = hug(text("price", "$18.00", { x: 716, y: 648, w: 300, h: 0, z: 2 }, { fontSize: 64, fontWeight: "bold", color: "#2b3a67", align: "right" }));
    const desc = hug(text("desc", "A dark, cocoa-forward blend from three Colorado farms. Roasted weekly.", { x: 64, y: Math.max(bottom(name), bottom(price)) + 24, w: 952, h: 0, z: 3 }, { fontSize: 54, color: "#4a4a63" }));
    // Dark enough that the white label clears 4.5:1 on it.
    const button: Element = { id: "button", type: "rect", x: 64, y: bottom(desc) + 48, width: 400, height: 104, rotation: 0, z: 4, style: { fill: "#a8352a", radius: 52 } };
    const label = hug(text("button_label", "Add to basket", { x: 64, y: 0, w: 400, h: 0, z: 5 }, { fontSize: 34, fontWeight: "bold", color: "#ffffff", align: "center" }));
    label.y = button.y + (button.height - label.height) / 2;
    return {
      width: W,
      height: H,
      background: "#ffffff",
      elements: [
        { id: "photo", type: "image", x: 0, y: 0, width: W, height: 600, rotation: 0, z: 0, src: "photo/coffee", style: {} },
        name,
        price,
        desc,
        button,
        label,
      ],
    };
  },

  // The ribbon: 995.7 wide at -14 degrees paints 995.7 cos 14 + 140 sin 14
  // = 1000 units across, so centred it lands 40 in from each side edge.
  "compose.sale-card": () => {
    const head = hug(text("head", "Everything Must Go", { x: 60, y: 60, w: 960, h: 0, z: 0 }, { fontSize: 182, fontWeight: "bold", color: "#1d1d2b" }));
    const shop = hug(text("shop", "Ridgeline Supply Co.", { x: 60, y: bottom(head) + 24, w: 960, h: 0, z: 1 }, { fontSize: 48, color: "#2b3a67" }));
    const detail = hug(text("detail", "Last day Sunday the 26th", { x: 60, y: bottom(shop) + 8, w: 960, h: 0, z: 2 }, { fontSize: 32, color: "#55556b" }));
    const ribbonW = (1000 - 140 * Math.sin((14 * Math.PI) / 180)) / Math.cos((14 * Math.PI) / 180);
    const ribbon: Element = { id: "ribbon", type: "rect", x: 540 - ribbonW / 2, y: 1080 - 70, width: ribbonW, height: 140, rotation: -14, z: 3, style: { fill: "#c0392b" } };
    const label = hug(text("label", "HALF PRICE", { x: 190, y: 0, w: 700, h: 0, z: 4 }, { fontSize: 96, fontWeight: "bold", color: "#ffffff", align: "center" }));
    label.y = 1080 - label.height / 2;
    label.rotation = -14;
    return { width: W, height: H, background: "#f7f4ee", elements: [head, shop, detail, ribbon, label] };
  },

  // The gradient runs from #ff7a59 to #ffd166, so white type on it is 1.9:1
  // and the readable answer is dark ink.
  "compose.title-card": () => {
    const talk = hug(text("talk", "Interfaces That Explain Themselves", { x: 100, y: 0, w: 880, h: 0, z: 1 }, { fontSize: 90, fontWeight: "bold", color: "#1a1208" }));
    const speaker = hug(text("speaker", "Dana Okonkwo", { x: 100, y: 0, w: 880, h: 0, z: 2 }, { fontSize: 52, color: "#2a1c10" }));
    const event = hug(text("event", "Layout Conf 2026", { x: 100, y: 0, w: 880, h: 0, z: 3 }, { fontSize: 36, color: "#33220f" }));
    talk.y = (H - (talk.height + 32 + speaker.height + 8 + event.height)) / 2;
    speaker.y = bottom(talk) + 32;
    event.y = bottom(speaker) + 8;
    return {
      width: W,
      height: H,
      background: "#ffffff",
      elements: [{ id: "bg", type: "image", x: 0, y: 0, width: W, height: H, rotation: 0, z: 0, src: "texture/gradient", style: {} }, talk, speaker, event],
    };
  },

  // --- repair: edits of the broken document --------------------------------

  "repair.overlapping-stack": () => {
    const doc = getTask("repair.overlapping-stack").initial();
    const get = (id: string) => doc.elements.find((e) => e.id === id)!;
    const headline = hug({ ...get("headline"), x: 100, y: 240 });
    const subhead = hug({ ...get("subhead"), x: 100, y: bottom(headline) + 12 });
    // Beside the badge, which takes the panel's bottom-right corner: from
    // x = 100 to 40 short of the badge at 680, and down to 40 above 900.
    const bodyTop = bottom(subhead) + 28;
    const body = fillTo({ ...get("body"), x: 100, y: bodyTop, width: 540, height: 860 - bodyTop });
    const badge = { ...get("badge"), x: 680, y: 560 };
    return { ...doc, elements: [get("panel"), headline, subhead, body, badge] };
  },

  "repair.off-canvas": () => {
    const doc = getTask("repair.off-canvas").initial();
    const get = (id: string) => doc.elements.find((e) => e.id === id)!;
    const photo = { ...get("photo"), x: 40, y: 40 };
    const caption = hug(onOneLine({ ...get("caption"), x: 40, y: bottom(photo) + 24, width: 1000 }));
    const credit = hug({ ...get("credit"), x: 40, y: bottom(caption) + 8, width: 1000 });
    const tagA = { ...get("tag_a"), x: (W - 624) / 2, y: 1270 - 90 };
    const tagB = { ...get("tag_b"), x: (W - 624) / 2 + 324, y: 1270 - 90 };
    return { ...doc, elements: [photo, caption, credit, tagA, tagB] };
  },

  // The card spans 80..1000 by 300..920, so its centre is (540, 610).
  "repair.buried-text": () => {
    const doc = getTask("repair.buried-text").initial();
    const get = (id: string) => doc.elements.find((e) => e.id === id)!;
    const title = hug({ ...get("title"), z: 2 });
    const note = hug(onLines({ ...get("note"), z: 3 }, 5));
    const top = 610 - (title.height + 24 + note.height) / 2;
    title.y = top;
    note.y = bottom(title) + 24;
    const blot = { ...get("blot"), x: 540 - 320, y: 610 - 210, z: 1 };
    return { ...doc, elements: [{ ...get("card"), z: 0 }, blot, title, note] };
  },

  "repair.z-order": () => {
    const doc = getTask("repair.z-order").initial();
    const z: Record<string, number> = { hero_photo: 0, scrim: 1, rule: 2, hero_title: 3, hero_sub: 4, badge: 5, badge_label: 6 };
    const title = hug(onOneLine({ ...doc.elements.find((e) => e.id === "hero_title")!, z: 3 }));
    const elements = doc.elements.map((el) => {
      if (el.id === "scrim") return { ...el, z: 1, x: 0, y: 860, width: W, height: H - 860 };
      if (el.id === "hero_title") return title;
      if (el.id === "hero_sub") return { ...el, z: 4, y: bottom(title) + 16 };
      return { ...el, z: z[el.id]! };
    });
    return { ...doc, elements };
  },

  "repair.crowded-margins": () => {
    const doc = getTask("repair.crowded-margins").initial();
    const get = (id: string) => doc.elements.find((e) => e.id === id)!;
    const kicker = hug({ ...get("kicker"), x: 60, y: 60, width: 960 });
    const title = hug({ ...get("title"), x: 60, y: bottom(kicker) + 12, width: 960, style: { ...get("title").style, fontSize: 124 } });
    const footer = endAt(hug(onOneLine({ ...get("footer"), x: 60, width: 960 })), 1290);
    const artTop = bottom(title) + 40;
    const art = { ...get("art"), x: 60, y: artTop, width: 960, height: footer.y - 40 - artTop };
    return { ...doc, elements: [kicker, title, art, footer] };
  },

  // Painted width of a w x h box at 12 degrees is w cos 12 + h sin 12; with
  // h = w * 1040 / 960 and a painted width of 1080 - 2 * 40, w = 831.1.
  // Everything upright then has to fit inside the tilted outline.
  "repair.tilted-stack": () => {
    const doc = getTask("repair.tilted-stack").initial();
    const get = (id: string) => doc.elements.find((e) => e.id === id)!;
    const rad = (12 * Math.PI) / 180;
    const w = 1000 / (Math.cos(rad) + (1040 / 960) * Math.sin(rad));
    const h = (w * 1040) / 960;
    const card = { ...get("card"), x: 540 - w / 2, y: 680 - h / 2, width: w, height: h, rotation: -12 };
    const title = hug(onLines({ ...get("title"), x: 280, y: 300, width: 520, rotation: 0 }, 2));
    const body = hug({ ...get("body"), x: 280, y: bottom(title) + 24, width: 520, rotation: 0 });
    // Found by search: low on the card, which leans left as it goes down.
    const stamp = { ...get("stamp"), x: 260, y: 890, rotation: 0 };
    return { ...doc, elements: [card, title, body, stamp] };
  },

  "repair.mixed-defects": () => {
    const doc = getTask("repair.mixed-defects").initial();
    const get = (id: string) => doc.elements.find((e) => e.id === id)!;
    const cover = { ...get("cover"), x: 40, y: 40, z: 0 };
    const plateTop = bottom(cover) + 24;
    const lead = hug(onLines({ ...get("lead"), x: 80, y: plateTop + 40, width: 920, z: 2 }, 2));
    const standfirst = hug({ ...get("standfirst"), x: 80, y: bottom(lead) + 16, width: 920, z: 3 });
    const plate = { ...get("plate"), x: 40, y: plateTop, width: 1000, height: bottom(standfirst) + 40 - plateTop, z: 1 };
    const byline = hug({ ...get("byline"), x: 40, y: bottom(plate) + 24, z: 4 });
    return { ...doc, elements: [cover, plate, lead, standfirst, byline] };
  },

  // --- fit: find the room, do not shrink the type out of legibility --------

  "fit.long-headline": () => {
    const doc = getTask("fit.long-headline").initial();
    const card = doc.elements.find((e) => e.id === "card")!;
    const headline = hug({ ...doc.elements.find((e) => e.id === "headline")!, style: { fontSize: 72, fontWeight: "bold", color: "#1d1d2b" } });
    const para = hug({ ...doc.elements.find((e) => e.id === "para")!, y: bottom(headline) + 32, style: { fontSize: 40, color: "#3d3d56", lineHeight: 1.45 } });
    return { ...doc, elements: [card, headline, para] };
  },

  // The page had 660 units of unused space between the body and the caption;
  // v2 asks for all of it, and for the body to fill it.
  "fit.body-overflow": () =>
    edit("fit.body-overflow", (el) => (el.id === "body" ? fillTo({ ...el, height: 1180 - 40 - el.y }) : el)),

  "fit.three-overflowing": () => {
    const doc = getTask("fit.three-overflowing").initial();
    const blocks = ["one", "two", "three"].map((id) => doc.elements.find((e) => e.id === id)!);
    const at = (size: number) => blocks.map((el) => hug({ ...el, style: { ...el.style, fontSize: size } }));
    let size = 200;
    while (at(size).reduce((h, el) => h + el.height, 0) > 1270 - 120 - 2 * 60) size--;
    const [one, two, three] = at(size);
    one!.y = 120;
    two!.y = bottom(one!) + 60;
    three!.y = bottom(two!) + 60;
    return { ...doc, elements: [one!, two!, three!] };
  },

  "fit.caption-under-image": () =>
    edit("fit.caption-under-image", (el) => (el.id === "caption" ? fillTo({ ...el, y: 820 + 32, height: 1180 - 32 - 852 }) : el)),

  // The longer column decides the size, and the shorter one takes it too.
  "fit.two-column": () =>
    edit("fit.two-column", (el) => {
      if (el.id !== "left_col" && el.id !== "right_col") return el;
      const boxed = { ...el, height: 1180 - 40 - el.y };
      const doc = getTask("fit.two-column").initial();
      const size = Math.min(
        ...["left_col", "right_col"].map((id) => largestFittingFontSize({ ...doc.elements.find((e) => e.id === id)!, height: boxed.height })!),
      );
      return { ...boxed, style: { ...el.style, fontSize: size } };
    }),

  // --- restyle: colour only ------------------------------------------------

  "restyle.palette-swap": () =>
    edit(
      "restyle.palette-swap",
      (el) => {
        const colour: Record<string, [keyof Element["style"], string]> = {
          panel: ["fill", "#1e1e33"],
          heading: ["color", "#f4f1ea"],
          price: ["color", "#f4f1ea"],
          description: ["color", "#a8a3c0"],
          divider: ["fill", "#4a4a6a"],
          tag: ["fill", "#34345a"],
          tag_label: ["color", "#f4f1ea"],
          button: ["fill", "#e3655b"],
          button_label: ["color", "#12121f"],
          outline: ["strokeColor", "#e3655b"],
          outline_label: ["color", "#e3655b"],
          footnote: ["color", "#f4f1ea"],
          chip_roast: ["fill", "#e3655b"],
          chip_roast_label: ["color", "#12121f"],
          chip_organic: ["fill", "#4a4a6a"],
          chip_organic_label: ["color", "#f4f1ea"],
          chip_limited: ["fill", "#a8a3c0"],
          chip_limited_label: ["color", "#12121f"],
        };
        const [prop, value] = colour[el.id]!;
        return { ...el, style: { ...el.style, [prop]: value } };
      },
      "#12121f",
    ),

  // Sheet #101018 is 0.0055 luminance; the callout is 1.36:1 on it, the chip
  // 1.74:1, the divider 1.87:1 and the button 3.38:1.
  "restyle.dark-mode": () =>
    edit(
      "restyle.dark-mode",
      (el) => {
        const style = { ...el.style };
        if (el.id === "sheet") style.fill = "#101018";
        // 7-9:1 is a different grey on each surface: about 8.5:1 on the sheet,
        // 7.9:1 on the chip, 7.7:1 on the callout.
        if (el.id === "title") style.color = "#aeaeae";
        if (el.id === "standfirst") style.color = "#aeaeae";
        if (el.id === "byline") style.color = "#aeaeae";
        if (el.id === "tag") style.fill = "#3a3a5a";
        if (el.id === "tag_label") style.color = "#dbdbdb";
        if (el.id === "divider") style.fill = "#3f3f5c";
        if (el.id === "callout") style.fill = "#2a2a40";
        if (el.id === "callout_text") style.color = "#c0c0c0";
        if (el.id === "button") style.fill = "#6b5bb0";
        if (el.id === "button_label") style.color = "#f4f1ea";
        return { ...el, style };
      },
      "#0a0a10",
    ),

  // --- arrange: one gap, one edge ------------------------------------------

  // One size for all five: the largest at which the hugged stack, with its
  // four 36-unit gaps, still ends by 1230.
  "arrange.ragged-column": () => {
    const doc = getTask("arrange.ragged-column").initial();
    const at = (size: number) => doc.elements.map((el) => hug({ ...el, x: 140, style: { ...el.style, fontSize: size } }));
    let size = 200;
    while (at(size).reduce((h, el) => h + el.height, 0) + 36 * 4 > 1230 - 120) size--;
    const rows = at(size);
    let y = 120;
    for (const row of rows) {
      row.y = y;
      y = bottom(row) + 36;
    }
    return { ...doc, elements: rows };
  },

  // Cards 160 + 240 + 200 + 280 = 880 wide, so five equal spaces of 40.
  "arrange.uneven-row": () => {
    const doc = getTask("arrange.uneven-row").initial();
    const cards = ["c1", "c2", "c3", "c4"].map((id) => ({ ...doc.elements.find((e) => e.id === id)! }));
    let x = 40;
    for (const card of cards) {
      card.x = x;
      card.y = 480;
      x += card.width + 40;
    }
    const captions = ["k1", "k2", "k3", "k4"].map((id, i) => {
      const card = cards[i]!;
      return hug(onOneLine({ ...doc.elements.find((e) => e.id === id)!, x: card.x, y: bottom(card) + 16, width: card.width }));
    });
    return { ...doc, elements: [...cards, ...captions] };
  },

  // (960 - 3 * 24) / 4 = 222 wide; 3 * 300 + 2 * 24 = 948 tall, centred.
  "arrange.card-grid": () => {
    const doc = getTask("arrange.card-grid").initial();
    const top = (H - 948) / 2;
    const elements = doc.elements.map((el) => {
      const card = /^g(\d+)$/.exec(el.id);
      const name = /^n(\d+)$/.exec(el.id);
      const i = Number((card ?? name)![1]) - 1;
      const cx = 60 + (i % 4) * 246;
      const cy = top + Math.floor(i / 4) * 324;
      if (card) return { ...el, x: cx, y: cy, width: 222, height: 300 };
      const sized = hug(onOneLine({ ...el, x: cx + 24, width: 174 }));
      return { ...sized, y: cy + 150 - sized.height / 2 };
    });
    return { ...doc, elements };
  },
};


// --- prototypes ---------------------------------------------------------------

const shape = (id: string, box: { x: number; y: number; w: number; h: number }, style: Element["style"], rotation = 0, z = 0): Element => ({
  id,
  type: "rect",
  x: box.x,
  y: box.y,
  width: box.w,
  height: box.h,
  rotation,
  z,
  style,
});

/** A rect `w` by `h` whose centre sits `r` from (cx, cy) at `deg` clockwise from up, turned to point along it. */
function radial(id: string, cx: number, cy: number, r: number, deg: number, w: number, h: number, style: Element["style"], z: number): Element {
  const a = (deg * Math.PI) / 180;
  return shape(id, { x: cx + Math.sin(a) * r - w / 2, y: cy - Math.cos(a) * r - h / 2, w, h }, style, deg, z);
}

export const PROTOTYPE_SOLUTIONS: Record<string, () => Doc> = {
  "proto.sunburst": () => {
    const rays = Array.from({ length: 12 }, (_, i) => radial(`ray_${i}`, 540, 480, 240 + 24 + 75, i * 30, 36, 150, { fill: "#ffd166" }, 1));
    // The ray at 180 degrees reaches 480 + 264 + 150 = 894.
    const title = hug(onOneLine(text("title", "MIDSUMMER", { x: 100, y: 894 + 40, w: 880, h: 0, z: 4 }, { fontWeight: "bold", color: "#fff3d6", align: "center" })));
    const date = hug(text("date", "June 21, Ridgeline Meadow", { x: 100, y: bottom(title) + 12, w: 880, h: 0, z: 5 }, { fontSize: 40, color: "#ffd166", align: "center" }));
    return {
      width: W,
      height: H,
      background: "#1b1b3a",
      elements: [
        ...rays,
        shape("disc", { x: 300, y: 240, w: 480, h: 480 }, { shape: "ellipse", fill: "#ffb347", fillTo: "#ff5e62" }, 0, 2),
        shape("star", { x: 410, y: 350, w: 260, h: 260 }, { shape: "star", fill: "#fff3d6" }, 0, 3),
        title,
        date,
      ],
    };
  },

  // Ten past ten: the hour hand at 300 + 5 = 305 degrees, the minute hand at
  // 60, each centred half its length out from the clock's centre.
  "proto.clock": () => {
    const ticks = Array.from({ length: 12 }, (_, i) => radial(`tick_${i}`, 540, 560, 336, i * 30, 12, 48, { fill: "#1d1d2b" }, 1));
    const numerals = ["12", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"].map((n, i) => {
      const a = (i * 30 * Math.PI) / 180;
      const t = hug(text(`n_${n}`, n, { x: 0, y: 0, w: 120, h: 0, z: 2 }, { fontSize: 64, fontWeight: "bold", color: "#1d1d2b", align: "center" }));
      return { ...t, x: 540 + Math.sin(a) * 260 - 60, y: 560 - Math.cos(a) * 260 - t.height / 2 };
    });
    const title = hug(onOneLine(text("title", "Ridgeline Clockworks", { x: 100, y: 940 + 48, w: 880, h: 0, z: 6 }, { fontWeight: "bold", color: "#1d1d2b", align: "center" })));
    return {
      width: W,
      height: H,
      background: "#f4f1ea",
      elements: [
        shape("face", { x: 160, y: 180, w: 760, h: 760 }, { shape: "ellipse", fill: "#ffffff", strokeColor: "#1d1d2b", strokeWidth: 12 }, 0, 0),
        ...ticks,
        ...numerals,
        radial("hour", 540, 560, 80, 305, 24, 160, { fill: "#2b3a67" }, 3),
        radial("minute", 540, 560, 110, 60, 16, 220, { fill: "#457b9d" }, 4),
        shape("cap", { x: 520, y: 540, w: 40, h: 40 }, { shape: "ellipse", fill: "#d62828" }, 0, 5),
        title,
      ],
    };
  },

  // The square's half-diagonal is 150 * sqrt(2) = 212.1, so its centre sits
  // at 1000 - 212.1 and its bottom corner at 300 + 212.1.
  "proto.bauhaus": () => {
    const half = 150 * Math.SQRT2;
    const title = endAt(hug(onOneLine(text("title", "WEIMAR 1919", { x: 600, y: 0, w: 400, h: 0, z: 5 }, { fontWeight: "bold", color: "#111111", align: "right" }))), 1270);
    return {
      width: W,
      height: H,
      background: "#f2ede4",
      elements: [
        shape("bar", { x: 80, y: 300 + half, w: 920, h: 24 }, { fill: "#111111" }, 0, 0),
        shape("circle", { x: 80, y: 80, w: 440, h: 440 }, { shape: "ellipse", fill: "#d62828" }, 0, 1),
        shape("triangle", { x: 80, y: 520, w: 440, h: 750 }, { shape: "polygon", sides: 3, fill: "#f6bd60" }, 0, 2),
        shape("square", { x: 1000 - half - 150, y: 150, w: 300, h: 300 }, { fill: "#1d3557" }, 45, 3),
        title,
      ],
    };
  },

  // Rows of 3, 3, 3 and 2: each row's height is what makes its photos, at
  // their own proportions, fill 960 less the gutters.
  "proto.gallery": () => {
    const doc = getTask("proto.gallery").initial();
    const rows = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10]];
    const out: Element[] = [];
    let y = 60;
    for (const row of rows) {
      const els = row.map((i) => doc.elements[i]!);
      const h = (960 - 12 * (els.length - 1)) / els.reduce((s, e) => s + e.width / e.height, 0);
      let x = 60;
      for (const el of els) {
        const w = (el.width / el.height) * h;
        out.push({ ...el, x, y, width: w, height: h });
        x += w + 12;
      }
      y += h + 12;
    }
    return { ...doc, elements: out };
  },

  "measure.contents": () => contentsSolution("measure.contents", [60, 570], 450, 3),
  "measure.contents-wide": () => contentsSolution("measure.contents-wide", [60, 390, 720], 300, 3),

  "measure.menu": () => {
    const doc = getTask("measure.menu").initial();
    const get = (eid: string) => doc.elements.find((e) => e.id === eid)!;
    const out: Element[] = [get("header")];
    let y = 200;
    let dish = 1;
    for (const [s, count] of [[1, 3], [2, 4]] as const) {
      const heading = hug({ ...get(`section${s}`), x: 60, y, width: 760 });
      out.push(heading);
      y = bottom(heading) + 16;
      for (let k = 0; k < count; k++, dish++) {
        const nameEl = get(`dish${dish}`);
        const fit = largestFontSizeForLines({ ...nameEl, width: 760 }, 1)!;
        const name = hug({ ...nameEl, x: 60, y, width: 760, style: { ...nameEl.style, fontSize: Math.min(44, fit) } });
        const price = hug({ ...get(`price${dish}`), x: 840, y, width: 180 });
        const desc = hug({ ...get(`desc${dish}`), x: 60, y: bottom(name) + 6, width: 760 });
        out.push(name, price, desc);
        y = bottom(desc) + 28;
      }
      y = y - 28 + 48;
    }
    return { ...doc, elements: out };
  },

  "measure.programme": () => {
    const doc = getTask("measure.programme").initial();
    const get = (eid: string) => doc.elements.find((e) => e.id === eid)!;
    const out: Element[] = [get("header")];
    for (let i = 1; i <= 12; i++) {
      const card = get(`card${i}`);
      const time = hug({ ...get(`time${i}`), x: card.x + 20, y: card.y + 20 });
      const speaker = endAt(hug({ ...get(`speaker${i}`), x: card.x + 20 }), card.y + card.height - 20);
      const top = bottom(time) + 8;
      const title = fillTo({ ...get(`session${i}`), x: card.x + 20, y: top, width: 260, height: speaker.y - 12 - top });
      out.push(card, time, title, speaker);
    }
    return { ...doc, elements: out };
  },

  "measure.timeline": () => {
    const doc = getTask("measure.timeline").initial();
    const get = (eid: string) => doc.elements.find((e) => e.id === eid)!;
    const out: Element[] = [get("header")];
    let y = 200;
    let last = 0;
    for (let i = 1; i <= 6; i++) {
      const headEl = get(`event${i}`);
      const fit = largestFontSizeForLines({ ...headEl, width: 760 }, 1)!;
      const head = hug({ ...headEl, x: 260, y, width: 760, style: { ...headEl.style, fontSize: Math.min(48, fit) } });
      const year = hug({ ...get(`year${i}`), x: 60, y, width: 150 });
      const note = hug({ ...get(`note${i}`), x: 260, y: bottom(head) + 8, width: 760 });
      out.push(year, head, note);
      last = bottom(note);
      y = last + 40;
    }
    out.push({ ...get("spine"), y: 200, height: last - 200 });
    return { ...doc, elements: out };
  },
};

function contentsSolution(id: string, columns: number[], width: number, perColumn: number): Doc {
  const doc = getTask(id).initial();
  const get = (eid: string) => doc.elements.find((e) => e.id === eid)!;
  const out: Element[] = [get("header")];
  columns.forEach((x, c) => {
    let y = 200;
    for (let r = 0; r < perColumn; r++) {
      const i = c * perColumn + r + 1;
      const num = hug({ ...get(`num${i}`), x, y, width });
      const title = hug(onLines({ ...get(`title${i}`), x, y: bottom(num) + 8, width }, 2));
      const teaser = hug({ ...get(`teaser${i}`), x, y: bottom(title) + 12, width });
      out.push(num, title, teaser);
      y = bottom(teaser) + 48;
    }
  });
  return { ...doc, elements: out };
}
