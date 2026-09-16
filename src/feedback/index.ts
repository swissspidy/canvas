/**
 * The feedback channel — the second independent variable, and the one most
 * likely to dominate the results.
 *
 * It is a first-class object rather than a flag threaded through the agent
 * loop, because the interesting analysis is surface x feedback, and that only
 * works if the two vary independently. The loop knows nothing about what a
 * channel produces; it asks for blocks and appends them.
 *
 * Six modes. The four the study headlines are `none`, `structured`,
 * `screenshot` and `both`. The two `_plain` variants swap the structured
 * description for its geometry-only form, dropping the derived layout notes
 * (overlaps, out-of-bounds, contrast). They exist because "structured
 * feedback" that reports overlaps is quietly doing relational work for the
 * agent, which would blur the very contrast the surfaces are meant to expose.
 * Without them the headline feedback comparison has a confound; with them it
 * has a control.
 */

import type { Doc } from "../doc/types.js";
import { describeDoc } from "../render/describe.js";
import { rasterize, DEFAULT_SCREENSHOT_WIDTH } from "../render/raster.js";

export const FEEDBACK_MODES = [
  "none",
  "structured",
  "screenshot",
  "both",
  "structured_plain",
  "both_plain",
] as const;
export type FeedbackMode = (typeof FEEDBACK_MODES)[number];

/** The four conditions the headline analysis compares. */
export const HEADLINE_FEEDBACK: FeedbackMode[] = ["none", "structured", "screenshot", "both"];

export type FeedbackBlock =
  | { type: "text"; text: string }
  | { type: "image"; png: Buffer; mediaType: "image/png" };

export interface FeedbackOptions {
  /** Pixel width of screenshots handed to the model. */
  screenshotWidth?: number;
}

export interface FeedbackChannel {
  mode: FeedbackMode;
  /** True when the model sees a rendering of its work. */
  showsImage: boolean;
  /** True when the model sees derived layout analysis. */
  showsAnalysis: boolean;
  /** Blocks to append after an action, or `[]` for the no-feedback condition. */
  after(doc: Doc): FeedbackBlock[];
}

function wantsImage(mode: FeedbackMode): boolean {
  return mode === "screenshot" || mode === "both" || mode === "both_plain";
}

function wantsText(mode: FeedbackMode): boolean {
  return mode !== "none" && mode !== "screenshot";
}

function wantsAnalysis(mode: FeedbackMode): boolean {
  return mode === "structured" || mode === "both";
}

export function createFeedbackChannel(
  mode: FeedbackMode,
  opts: FeedbackOptions = {},
): FeedbackChannel {
  const width = opts.screenshotWidth ?? DEFAULT_SCREENSHOT_WIDTH;
  const showsImage = wantsImage(mode);
  const showsText = wantsText(mode);
  const showsAnalysis = wantsAnalysis(mode);

  return {
    mode,
    showsImage,
    showsAnalysis,
    after(doc: Doc): FeedbackBlock[] {
      const blocks: FeedbackBlock[] = [];
      if (showsText) {
        blocks.push({
          type: "text",
          text:
            `Current document:\n` +
            describeDoc(doc, { level: showsAnalysis ? "analysis" : "geometry" }),
        });
      }
      if (showsImage) {
        blocks.push({ type: "image", png: rasterize(doc, { pixelWidth: width }), mediaType: "image/png" });
      }
      return blocks;
    },
  };
}

/** Human-readable label for reports and the live page. */
export function feedbackLabel(mode: FeedbackMode): string {
  switch (mode) {
    case "none":
      return "No feedback";
    case "structured":
      return "Structured description";
    case "screenshot":
      return "Rendered screenshot";
    case "both":
      return "Screenshot + description";
    case "structured_plain":
      return "Structured description (geometry only)";
    case "both_plain":
      return "Screenshot + geometry only";
  }
}
