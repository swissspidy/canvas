import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FONT_DIR, FONT_FILES, getFont } from "./fonts.js";
import { parseFont } from "./ttf.js";
import { layoutTextElement, measureText, wrapText } from "./layout.js";
import { getTask } from "../tasks/index.js";

/**
 * The vendored fonts are subsetted (see `scripts/subset-fonts.py`), which took
 * them from ~825KB to ~111KB. That is only safe if it changed nothing: every
 * advance width has to survive exactly, or every line break in the project
 * moves and the baselines recorded in `docs/TASKS.md` quietly become wrong.
 *
 * These goldens were computed against the *full upstream faces* before
 * subsetting. If a future re-subset (a wider character range, a different
 * source font) shifts a single number, this fails.
 */

const regular = getFont("regular");
const bold = getFont("bold");

/** The ranges `scripts/subset-fonts.py` keeps. */
const KEPT_RANGES: [number, number][] = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x100, 0x17f],
  [0x2000, 0x206f],
  [0x20a0, 0x20bf],
  [0x2190, 0x2193],
  [0x2212, 0x2212],
  [0xfffd, 0xfffd],
];

const UPSTREAM_DIR = "/usr/share/fonts/truetype/liberation";
const hasUpstream = existsSync(join(UPSTREAM_DIR, FONT_FILES.regular));

describe("vendored font subset", () => {
  it("stays small", () => {
    for (const file of Object.values(FONT_FILES)) {
      const bytes = statSync(join(FONT_DIR, file)).size;
      expect(bytes).toBeLessThan(120_000);
      // A file this small would mean the subset dropped something it should not.
      expect(bytes).toBeGreaterThan(20_000);
    }
  });

  it("keeps the vertical metrics the layout engine depends on", () => {
    for (const font of [regular, bold]) {
      expect(font.unitsPerEm).toBe(2048);
      expect(font.ascender).toBe(1854);
      expect(font.descender).toBe(-434);
      expect(font.lineGap).toBe(67);
    }
  });

  it("covers the characters the task set and a typed brief will use", () => {
    // Anything unmapped falls back to .notdef, whose advance differs, so a
    // missing glyph would show up as a width change rather than silently.
    const notdef = regular.advanceOf(0x0001);
    for (const ch of "AZaz09 .,:;!?'\"()-—–…·%$&@/#*+") {
      expect(regular.advanceOf(ch.codePointAt(0)!)).not.toBe(notdef);
    }
    for (const ch of "àéîöüñçåøßŁœĞ€£") {
      expect(regular.advanceOf(ch.codePointAt(0)!)).not.toBe(notdef);
    }
  });
});

describe("advance widths are unchanged by subsetting", () => {
  it.skipIf(!hasUpstream)("matches the upstream faces on every kept codepoint", () => {
    for (const [weight, file] of Object.entries(FONT_FILES)) {
      const upstream = parseFont(new Uint8Array(readFileSync(join(UPSTREAM_DIR, file))), "upstream");
      const vendored = getFont(weight as keyof typeof FONT_FILES);
      const differences: string[] = [];
      for (const [lo, hi] of KEPT_RANGES) {
        for (let cp = lo; cp <= hi; cp++) {
          if (upstream.advanceOf(cp) !== vendored.advanceOf(cp)) {
            differences.push(`${weight} U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
          }
        }
      }
      expect(differences).toEqual([]);
      expect(vendored.unitsPerEm).toBe(upstream.unitsPerEm);
      expect(vendored.ascender).toBe(upstream.ascender);
      expect(vendored.descender).toBe(upstream.descender);
    }
  });

  it("measures strings to the widths recorded before subsetting", () => {
    expect(measureText(regular, "Hamburgefonstiv", 32)).toBeCloseTo(241.890625, 9);
    expect(measureText(bold, "Hamburgefonstiv", 32)).toBeCloseTo(263.140625, 9);
    expect(measureText(regular, "Ridgeline Festival", 92)).toBeCloseTo(726.1171875, 9);
  });

  it("breaks a paragraph at exactly the same points", () => {
    const paragraph =
      "There is a version of maintenance that is really just deferral: you patch the thing, " +
      "the patch holds for a season.";
    const lines = wrapText(paragraph, { fontSize: 28, maxWidth: 400, font: regular });
    expect(lines.map((l) => l.text)).toEqual([
      "There is a version of",
      "maintenance that is really just",
      "deferral: you patch the thing,",
      "the patch holds for a season.",
    ]);
    expect(lines.map((l) => Math.round(l.width * 1000) / 1000)).toEqual([253.668, 368.854, 354.895, 359.57]);
  });

  it("lays out a real task element identically", () => {
    const headline = getTask("fit.long-headline")
      .initial()
      .elements.find((el) => el.id === "headline")!;
    const layout = layoutTextElement(headline);
    expect(layout.lines).toHaveLength(4);
    expect(layout.blockHeight).toBeCloseTo(380, 9);
    expect(layout.overflowY).toBeCloseTo(200, 9);
    expect(layout.overflowX).toBe(0);
    expect(layout.visibleLines).toBe(1);
  });
});
