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
import type { SurfaceId } from "../surfaces/types.js";

/**
 * The layout, as stages. Every surface builds these, in this order, so a
 * mid-run switch can pick up at the first one nobody has done — and so the
 * element ids line up whichever surface created them.
 */
const STAGES = ["background", "scrim", "headline", "details", "cta", "polish"] as const;
type Stage = (typeof STAGES)[number];

/** A replay turn, and the stages it completes. No stages means it is the sign-off. */
interface ReplayTurn {
  stages: Stage[];
  turn: ScriptedTurn;
}

const say = (text: string): ReplayTurn => ({ stages: [], turn: { text } });

const COORDINATE: ReplayTurn[] = [
  {
    stages: ["background"],
    turn: {
      text: "Starting with a full-bleed background image.",
      tools: [{ name: "create", input: { type: "image", src: "photo/mountains", x: 0, y: 0, width: 1080, height: 1350, style: { objectFit: "cover" } } }],
    },
  },
  {
    stages: ["scrim"],
    turn: {
      text: "A scrim across the lower half so the type has something to sit on.",
      tools: [{ name: "create", input: { type: "rect", x: 0, y: 700, width: 1080, height: 650, style: { fill: "#0e1726cc" } } }],
    },
  },
  {
    stages: ["headline"],
    turn: {
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
  },
  {
    stages: ["details"],
    turn: {
      text: "Dates below the headline.",
      tools: [
        {
          name: "create",
          input: {
            type: "text",
            text: "September 12-14  \u00b7  Alpine Meadow, Colorado",
            x: 100,
            y: 1040,
            width: 880,
            height: 60,
            style: { fontSize: 34, color: "#c9c6e0", align: "center" },
          },
        },
      ],
    },
  },
  {
    stages: ["cta"],
    turn: {
      text: "Then the call to action.",
      tools: [
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
  },
  say("Done \u2014 background, scrim, headline, details and a ticket chip."),
];

const RELATIONAL: ReplayTurn[] = [
  {
    stages: ["background"],
    turn: {
      text: "Background first, filling the canvas.",
      tools: [{ name: "create", input: { type: "image", src: "photo/mountains", width: 1080, height: 1350, relation: "fill_canvas", style: { objectFit: "cover" } } }],
    },
  },
  {
    stages: ["scrim"],
    turn: {
      text: "A scrim pinned to the bottom of the canvas.",
      tools: [{ name: "create", input: { type: "rect", width: 1080, height: 650, relation: "canvas_bottom", style: { fill: "#0e1726cc" } } }],
    },
  },
  {
    stages: ["headline"],
    turn: {
      text: "Headline centred on the scrim \u2014 no arithmetic needed.",
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
  },
  {
    stages: ["details"],
    turn: {
      text: "Details below the headline.",
      tools: [
        {
          name: "create",
          input: {
            type: "text",
            text: "September 12-14  \u00b7  Alpine Meadow, Colorado",
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
  },
  {
    stages: ["cta"],
    turn: {
      text: "Then the chip below those.",
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
  },
  {
    stages: ["polish"],
    turn: {
      text: "Making sure the headline actually fits its box.",
      tools: [{ name: "fit_text", input: { id: "el_3", mode: "shrink_to_fit" } }],
    },
  },
  say("Done \u2014 every position came from a relation rather than a number."),
];

/**
 * One write covers every stage, which is the whole point of this surface. It
 * fires while any stage is still outstanding and writes the finished document;
 * once everything is done there is nothing left for it to say.
 */
const DOCUMENT: ReplayTurn[] = [
  {
    stages: ["background", "scrim", "headline", "details", "cta"],
    turn: {
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
                { id: "details", type: "text", text: "September 12-14  \u00b7  Alpine Meadow, Colorado", x: 100, y: 1040, width: 880, height: 60, rotation: 0, z: 3, style: { fontSize: 34, color: "#c9c6e0", align: "center" } },
                { id: "cta", type: "text", text: "Tickets at ridgeline.fm", x: 340, y: 1150, width: 400, height: 80, rotation: 0, z: 4, style: { fontSize: 32, fontWeight: "bold", color: "#12121f", fill: "#f3c969", align: "center", valign: "middle", radius: 40 } },
              ],
            },
          },
        },
      ],
    },
  },
  say("Done \u2014 one write, whole document."),
];

const SCRIPTS: Record<SurfaceId, ReplayTurn[]> = {
  coordinate: COORDINATE,
  relational: RELATIONAL,
  document: DOCUMENT,
  hybrid: COORDINATE,
};

export const DEMO_NOTICE =
  "Replay mode: no model is running. These are recorded tool calls that build the same layout three ways, " +
  "so you can see how each surface expresses it. Nothing here measures anything — run the sweep for that.";

/**
 * Replay a build, surviving a surface switch at any point.
 *
 * Indexing each script by the *global* turn number is the obvious thing and it
 * is wrong: the three scripts have different lengths, so switching to the
 * document surface on turn 3 played its turn 3 — which does not exist — and
 * the layout was never built. Switching the other way replayed steps whose
 * work was already done and created the elements twice.
 *
 * So a replay turn is keyed by the *stage* of the layout it produces, not by
 * its position. Each surface expresses a stage its own way, one write covers
 * five of them on the document surface, and a switch simply continues from the
 * first stage nobody has done yet. The ids line up because every script builds
 * the stages in the same order.
 */
export function demoPolicy(surfaceFor: () => SurfaceId): ScriptedPolicy {
  const done = new Set<Stage>();
  return () => {
    const script = SCRIPTS[surfaceFor()] ?? COORDINATE;
    const next = script.find((t) => t.stages.length > 0 && t.stages.some((s) => !done.has(s)));
    if (!next) return script.find((t) => t.stages.length === 0)?.turn ?? { text: "Done." };
    for (const stage of next.stages) done.add(stage);
    return next.turn;
  };
}
