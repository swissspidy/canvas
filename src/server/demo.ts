/**
 * Canned replays for the live page when no API key is configured.
 *
 * A word on honesty: these are *not* meant to demonstrate a result. It would
 * be easy — and dishonest — to script the coordinate surface into a mess and
 * the relational surface into a clean layout, and anyone screenshotting the
 * toggle would spread a finding nobody measured. So each surface's replay
 * builds the *same* layout by the means that surface offers, and the page
 * labels the whole thing as a replay with no model involved.
 *
 * The real comparison comes from `npm run cli -- run`, and only from there.
 */

import type { ScriptedPolicy, ScriptedTurn } from "../agent/scripted.js";
import { fixedScript } from "../agent/scripted.js";
import type { SurfaceId } from "../surfaces/types.js";

const COORDINATE: ScriptedTurn[] = [
  {
    text: "Starting with a full-bleed background image.",
    tools: [{ name: "create", input: { type: "image", src: "photo/mountains", x: 0, y: 0, width: 1080, height: 1350, style: { objectFit: "cover" } } }],
  },
  {
    text: "A scrim across the lower half so the type has something to sit on.",
    tools: [{ name: "create", input: { type: "rect", x: 0, y: 700, width: 1080, height: 650, style: { fill: "#0e1726cc" } } }],
  },
  {
    text: "Headline, centred: (1080 - 880) / 2 = 100.",
    tools: [
      {
        name: "create",
        input: {
          type: "text",
          text: "Ridgeline Festival",
          x: 100,
          y: 820,
          width: 880,
          height: 200,
          style: { fontSize: 92, fontWeight: "bold", color: "#f7f4ee", align: "center" },
        },
      },
    ],
  },
  {
    text: "Dates below the headline, then the call to action.",
    tools: [
      {
        name: "create",
        input: {
          type: "text",
          text: "September 12-14  ·  Alpine Meadow, Colorado",
          x: 100,
          y: 1040,
          width: 880,
          height: 60,
          style: { fontSize: 34, color: "#c9c6e0", align: "center" },
        },
      },
      {
        name: "create",
        input: {
          type: "text",
          text: "Tickets at ridgeline.fm",
          x: 340,
          y: 1150,
          width: 400,
          height: 80,
          style: { fontSize: 32, fontWeight: "bold", color: "#12121f", fill: "#f3c969", align: "center", valign: "middle", radius: 40 },
        },
      },
    ],
  },
  { text: "Done — background, scrim, headline, details and a ticket chip." },
];

const RELATIONAL: ScriptedTurn[] = [
  {
    text: "Background first, filling the canvas.",
    tools: [{ name: "create", input: { type: "image", src: "photo/mountains", width: 1080, height: 1350, relation: "fill_canvas", style: { objectFit: "cover" } } }],
  },
  {
    text: "A scrim pinned to the bottom of the canvas.",
    tools: [{ name: "create", input: { type: "rect", width: 1080, height: 650, relation: "canvas_bottom", style: { fill: "#0e1726cc" } } }],
  },
  {
    text: "Headline centred on the scrim — no arithmetic needed.",
    tools: [
      {
        name: "create",
        input: {
          type: "text",
          text: "Ridgeline Festival",
          width: 880,
          height: 200,
          relation: "centered_on",
          target: "el_2",
          style: { fontSize: 92, fontWeight: "bold", color: "#f7f4ee", align: "center" },
        },
      },
    ],
  },
  {
    text: "Details below the headline, then the chip below those.",
    tools: [
      {
        name: "create",
        input: {
          type: "text",
          text: "September 12-14  ·  Alpine Meadow, Colorado",
          width: 880,
          height: 60,
          relation: "below",
          target: "el_3",
          gap: 20,
          style: { fontSize: 34, color: "#c9c6e0", align: "center" },
        },
      },
    ],
  },
  {
    tools: [
      {
        name: "create",
        input: {
          type: "text",
          text: "Tickets at ridgeline.fm",
          width: 400,
          height: 80,
          relation: "below",
          target: "el_4",
          gap: 50,
          style: { fontSize: 32, fontWeight: "bold", color: "#12121f", fill: "#f3c969", align: "center", valign: "middle", radius: 40 },
        },
      },
    ],
  },
  {
    text: "Making sure the headline actually fits its box.",
    tools: [{ name: "fit_text", input: { id: "el_3", mode: "shrink_to_fit" } }],
  },
  { text: "Done — every position came from a relation rather than a number." },
];

const DOCUMENT: ScriptedTurn[] = [
  {
    text: "Writing the whole document in one go.",
    tools: [
      {
        name: "write_document",
        input: {
          document: {
            width: 1080,
            height: 1350,
            background: "#101020",
            elements: [
              { id: "bg", type: "image", src: "photo/mountains", x: 0, y: 0, width: 1080, height: 1350, rotation: 0, z: 0, style: { objectFit: "cover" } },
              { id: "scrim", type: "rect", x: 0, y: 700, width: 1080, height: 650, rotation: 0, z: 1, style: { fill: "#0e1726cc" } },
              { id: "title", type: "text", text: "Ridgeline Festival", x: 100, y: 820, width: 880, height: 200, rotation: 0, z: 2, style: { fontSize: 92, fontWeight: "bold", color: "#f7f4ee", align: "center" } },
              { id: "details", type: "text", text: "September 12-14  ·  Alpine Meadow, Colorado", x: 100, y: 1040, width: 880, height: 60, rotation: 0, z: 3, style: { fontSize: 34, color: "#c9c6e0", align: "center" } },
              { id: "cta", type: "text", text: "Tickets at ridgeline.fm", x: 340, y: 1150, width: 400, height: 80, rotation: 0, z: 4, style: { fontSize: 32, fontWeight: "bold", color: "#12121f", fill: "#f3c969", align: "center", valign: "middle", radius: 40 } },
            ],
          },
        },
      },
    ],
  },
  { text: "Done — one write, whole document." },
];

const SCRIPTS: Record<SurfaceId, ScriptedTurn[]> = {
  coordinate: COORDINATE,
  relational: RELATIONAL,
  document: DOCUMENT,
  hybrid: COORDINATE,
};

export const DEMO_NOTICE =
  "Replay mode: no model is running. These are recorded tool calls that build the same layout three ways, " +
  "so you can see how each surface expresses it. Nothing here measures anything — run the sweep for that.";

export function demoPolicy(surfaceFor: () => SurfaceId): ScriptedPolicy {
  return (messages, turn) => {
    const script = SCRIPTS[surfaceFor()] ?? COORDINATE;
    return fixedScript(script)(messages, turn);
  };
}
