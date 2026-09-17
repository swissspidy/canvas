/**
 * Prompt construction.
 *
 * The base prompt is byte-identical across surfaces; only the surface briefing
 * differs. That is load-bearing — a study comparing tool surfaces cannot let
 * the surrounding prose vary, or it ends up comparing prompts.
 *
 * What the model is told about the document model is also held constant, and
 * includes the one thing it cannot work out for itself: that text wraps and
 * clips inside its box. It is *not* told any font metrics, because estimating
 * how much text fits in a box is precisely the difficulty the `fit` family is
 * built around.
 */

import type { Doc } from "../doc/types.js";
import type { ToolSurface } from "../surfaces/types.js";
import type { Task } from "../tasks/types.js";
import { assetCatalogue } from "../doc/assets.js";
import { describeDoc } from "../render/describe.js";
import { documentJson } from "../surfaces/document.js";
import type { FeedbackChannel, FeedbackBlock } from "../feedback/index.js";
import { rasterizeDoc } from "../render/rasterizer.js";

export const BASE_SYSTEM = [
  "You lay out visual documents on a fixed-size canvas.",
  "",
  "The document is a flat list of elements. There are no groups, no nesting and no pages.",
  "Every element is a text, rect or image with a position, a size, a rotation, a paint order (z)",
  "and a small style bag. Coordinates are in canvas units measured from the top-left corner:",
  "x runs right, y runs down. An element's x and y are the top-left corner of its unrotated box,",
  "and rotation turns that box about its own center. Higher z is painted later, so it appears in front.",
  "",
  "Text wraps at word boundaries within its element's box and is clipped to that box:",
  "anything that does not fit is simply not visible. A single word wider than the box overflows",
  "rather than breaking. Padding insets the text from the box edges.",
  "",
  "You cannot upload images. Image elements reference this fixed library:",
  assetCatalogue(),
  "",
  "Work until the brief is satisfied, then stop and briefly say what you did.",
  "Nobody is available to answer questions, so make reasonable decisions and proceed.",
].join("\n");

export function systemPrompt(surface: ToolSurface): string {
  return [BASE_SYSTEM, "", `--- Your tools: ${surface.title} ---`, surface.briefing].join("\n");
}

/**
 * The opening user message.
 *
 * Every condition gets the exact starting state — the geometry description and
 * the raw JSON — because a repair task is impossible without it, and because
 * letting the presentation vary by surface would hand one of them an
 * information advantage at turn zero. Only the *screenshot* is gated on the
 * feedback condition. What the feedback channel actually controls is what
 * comes back after each action, which is the part under study.
 */
export async function initialUserBlocks(
  task: Task,
  doc: Doc,
  feedback: FeedbackChannel,
): Promise<FeedbackBlock[]> {
  const blocks: FeedbackBlock[] = [
    {
      type: "text",
      text: [
        "# Brief",
        "",
        task.brief,
        "",
        "# Starting document",
        "",
        describeDoc(doc, { level: "geometry" }),
        "",
        "As JSON:",
        "",
        "```json",
        documentJson(doc),
        "```",
      ].join("\n"),
    },
  ];
  if (feedback.showsImage) {
    blocks.push({
      type: "image",
      png: await rasterizeDoc(doc, { pixelWidth: feedback.screenshotWidth }),
      mediaType: "image/png",
    });
    blocks.push({ type: "text", text: "The image above is the document as it currently renders." });
  }
  return blocks;
}
