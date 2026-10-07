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
import { largestFittingFontSize, requiredHeight } from "../text/layout.js";

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
    // Narrowed to clear the badge, which takes the panel's bottom-right corner.
    const body = hug({ ...get("body"), x: 100, y: bottom(subhead) + 28, width: 560 });
    const badge = { ...get("badge"), x: 680, y: 560 };
    return { ...doc, elements: [get("panel"), headline, subhead, body, badge] };
  },

  "repair.off-canvas": () => {
    const doc = getTask("repair.off-canvas").initial();
    const get = (id: string) => doc.elements.find((e) => e.id === id)!;
    const photo = { ...get("photo"), x: 40, y: 40 };
    const caption = hug({ ...get("caption"), x: 40, y: bottom(photo) + 24, width: 1000 });
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
    const note = hug({ ...get("note"), z: 3 });
    const top = 610 - (title.height + 24 + note.height) / 2;
    title.y = top;
    note.y = bottom(title) + 24;
    const blot = { ...get("blot"), x: 540 - 320, y: 610 - 210, z: 1 };
    return { ...doc, elements: [{ ...get("card"), z: 0 }, blot, title, note] };
  },

  "repair.z-order": () =>
    edit("repair.z-order", (el) => {
      const z: Record<string, number> = { hero_photo: 0, scrim: 1, rule: 2, hero_title: 3, hero_sub: 4, badge: 5, badge_label: 6 };
      if (el.id === "scrim") return { ...el, z: 1, x: 0, y: 860, width: W, height: H - 860 };
      return { ...el, z: z[el.id]! };
    }),

  "repair.crowded-margins": () => {
    const doc = getTask("repair.crowded-margins").initial();
    const get = (id: string) => doc.elements.find((e) => e.id === id)!;
    const kicker = hug({ ...get("kicker"), x: 60, y: 60, width: 960 });
    const title = hug({ ...get("title"), x: 60, y: bottom(kicker) + 12, width: 960, style: { ...get("title").style, fontSize: 124 } });
    const footer = endAt(hug({ ...get("footer"), x: 60, width: 960 }), 1290);
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
    const title = hug({ ...get("title"), x: 300, y: 330, width: 480, rotation: 0 });
    const body = hug({ ...get("body"), x: 300, y: bottom(title) + 24, width: 480, rotation: 0 });
    const stamp = { ...get("stamp"), x: 420, y: bottom(body) + 24, rotation: 0 };
    return { ...doc, elements: [card, title, body, stamp] };
  },

  "repair.mixed-defects": () => {
    const doc = getTask("repair.mixed-defects").initial();
    const get = (id: string) => doc.elements.find((e) => e.id === id)!;
    const cover = { ...get("cover"), x: 40, y: 40, z: 0 };
    const plateTop = bottom(cover) + 24;
    const lead = hug({ ...get("lead"), x: 80, y: plateTop + 40, width: 920, z: 2 });
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
        };
        const [prop, value] = colour[el.id]!;
        return { ...el, style: { ...el.style, [prop]: value } };
      },
      "#12121f",
    ),

  // Sheet #101018 is 0.0055 luminance; the callout is 1.36:1 on it, the chip
  // 1.74:1, the divider 1.87:1 and the button 3.38:1, and the light text
  // clears 7:1 on every one of them it sits on.
  "restyle.dark-mode": () =>
    edit(
      "restyle.dark-mode",
      (el) => {
        const style = { ...el.style };
        if (el.id === "sheet") style.fill = "#101018";
        if (el.id === "title") style.color = "#f4f1ea";
        if (el.id === "standfirst") style.color = "#d8d4e6";
        if (el.id === "byline") style.color = "#c4c0d6";
        if (el.id === "tag") style.fill = "#3a3a5a";
        if (el.id === "tag_label") style.color = "#f4f1ea";
        if (el.id === "divider") style.fill = "#3f3f5c";
        if (el.id === "callout") style.fill = "#2a2a40";
        if (el.id === "callout_text") style.color = "#f4f1ea";
        if (el.id === "button") style.fill = "#6b5bb0";
        if (el.id === "button_label") style.color = "#f4f1ea";
        return { ...el, style };
      },
      "#0a0a10",
    ),

  // --- arrange: one gap, one edge ------------------------------------------

  "arrange.ragged-column": () => {
    const doc = getTask("arrange.ragged-column").initial();
    const rows = doc.elements.map((el) => hug({ ...el, x: 140 }));
    const total = rows.reduce((h, el) => h + el.height, 0) + 36 * (rows.length - 1);
    let y = (H - total) / 2;
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
      const cap = hug({ ...doc.elements.find((e) => e.id === id)! });
      return { ...cap, x: card.x + card.width / 2 - cap.width / 2, y: bottom(card) + 16 };
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
      return { ...el, x: cx + 111 - el.width / 2, y: cy + 150 - el.height / 2 };
    });
    return { ...doc, elements };
  },
};

