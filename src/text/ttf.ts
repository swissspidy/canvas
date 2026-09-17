/**
 * A minimal TrueType reader: `head`, `hhea`, `hmtx`, `cmap`, `OS/2`, and the
 * glyph bounding boxes in `loca`/`glyf`.
 *
 * Why parse the font instead of pulling in a font library or measuring in a
 * browser: line breaking has to be *identical* everywhere. The eval scorer,
 * the SVG renderer and the live page must agree on where a line wraps, or
 * "did the text clip?" stops being a deterministic check. Reading advance
 * widths straight from `hmtx` gives one answer that every consumer shares.
 *
 * No kerning, no shaping, no ligatures. The renderer then pins each painted
 * line to the width computed here with SVG `textLength`, so paint and layout
 * agree by construction rather than by hoping two shaping engines match.
 *
 * Outlines are not rasterized, but their *bounding boxes* are read, because
 * several checks ask where the glyphs actually land rather than where the line
 * box is. The line box runs from the ascender to the descender — 1.12em in
 * Liberation Sans — while a line of capitals and digits inks only 0.69em of
 * it. Treating that empty third as painted is what made "is this text covered?"
 * and "does this element crowd the edge?" report defects a reader cannot see.
 */

/**
 * A glyph's outline bounds, in font units, relative to the pen origin and the
 * baseline. `y` is positive *up*, as the font stores it: a descender's `yMin`
 * is negative.
 */
export interface GlyphBounds {
  /** Left edge of the outline, i.e. the left side bearing. */
  xMin: number;
  /** Right edge of the outline. Always `>= xMin`. */
  xMax: number;
  /** Bottom of the outline. Negative below the baseline. */
  yMin: number;
  /** Top of the outline. */
  yMax: number;
}

export interface FontMetrics {
  family: string;
  unitsPerEm: number;
  /** Typographic ascender, font units (positive, up). */
  ascender: number;
  /** Typographic descender, font units (negative, down). */
  descender: number;
  lineGap: number;
  /** True when the face carries glyph outlines this reader can bound. */
  hasOutlines: boolean;
  /** Advance width in font units for a Unicode code point. */
  advanceOf(codePoint: number): number;
  /**
   * Outline bounds for a code point, or `null` when it draws nothing — a
   * space, an unmapped code point, or any glyph in a face without `glyf`
   * (a CFF/OTTO face, whose outlines this reader does not parse).
   */
  inkOf(codePoint: number): GlyphBounds | null;
}

const u16 = (dv: DataView, o: number) => dv.getUint16(o, false);
const i16 = (dv: DataView, o: number) => dv.getInt16(o, false);
const u32 = (dv: DataView, o: number) => dv.getUint32(o, false);

interface TableRecord {
  offset: number;
  length: number;
}

function readTableDirectory(dv: DataView): Map<string, TableRecord> {
  const tag = u32(dv, 0);
  // 0x00010000 (TrueType), 'OTTO' (CFF), 'true'/'typ1' (legacy Apple).
  if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) {
    throw new Error(`Unsupported font: sfntVersion 0x${tag.toString(16)}`);
  }
  const numTables = u16(dv, 4);
  const tables = new Map<string, TableRecord>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const name = String.fromCharCode(
      dv.getUint8(rec),
      dv.getUint8(rec + 1),
      dv.getUint8(rec + 2),
      dv.getUint8(rec + 3),
    );
    tables.set(name, { offset: u32(dv, rec + 8), length: u32(dv, rec + 12) });
  }
  return tables;
}

/** Build a code point -> glyph id map from the best available cmap subtable. */
function readCmap(dv: DataView, base: number): Map<number, number> {
  const map = new Map<number, number>();
  const numTables = u16(dv, base + 2);

  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = base + 4 + i * 8;
    const platformId = u16(dv, rec);
    const encodingId = u16(dv, rec + 2);
    const offset = u32(dv, rec + 4);
    // Prefer full Unicode (3,10), then BMP (3,1), then any Unicode platform.
    let score = -1;
    if (platformId === 3 && encodingId === 10) score = 3;
    else if (platformId === 3 && encodingId === 1) score = 2;
    else if (platformId === 0) score = 1;
    if (score > bestScore) {
      bestScore = score;
      best = base + offset;
    }
  }
  if (best < 0) return map;

  const format = u16(dv, best);
  if (format === 4) {
    const segCount = u16(dv, best + 6) / 2;
    const endBase = best + 14;
    const startBase = endBase + segCount * 2 + 2;
    const deltaBase = startBase + segCount * 2;
    const rangeBase = deltaBase + segCount * 2;
    for (let s = 0; s < segCount; s++) {
      const end = u16(dv, endBase + s * 2);
      const start = u16(dv, startBase + s * 2);
      const delta = i16(dv, deltaBase + s * 2);
      const rangeOffset = u16(dv, rangeBase + s * 2);
      if (start > end) continue;
      for (let c = start; c <= end && c !== 0xffff + 1; c++) {
        let gid: number;
        if (rangeOffset === 0) {
          gid = (c + delta) & 0xffff;
        } else {
          const gidAddr = rangeBase + s * 2 + rangeOffset + (c - start) * 2;
          if (gidAddr + 1 >= dv.byteLength) continue;
          gid = u16(dv, gidAddr);
          if (gid !== 0) gid = (gid + delta) & 0xffff;
        }
        if (gid !== 0) map.set(c, gid);
      }
    }
  } else if (format === 12) {
    const nGroups = u32(dv, best + 12);
    for (let g = 0; g < nGroups; g++) {
      const rec = best + 16 + g * 12;
      const start = u32(dv, rec);
      const end = u32(dv, rec + 4);
      const startGid = u32(dv, rec + 8);
      // Guard against pathological fonts declaring enormous ranges.
      const span = Math.min(end - start, 0x10ffff);
      for (let k = 0; k <= span; k++) map.set(start + k, startGid + k);
    }
  } else {
    throw new Error(`Unsupported cmap format ${format}`);
  }
  return map;
}

/** Parse the metrics tables of a TrueType/OpenType font. */
export function parseFont(data: Uint8Array, family: string): FontMetrics {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tables = readTableDirectory(dv);

  const head = tables.get("head");
  const hhea = tables.get("hhea");
  const hmtx = tables.get("hmtx");
  const cmapT = tables.get("cmap");
  if (!head || !hhea || !hmtx || !cmapT) {
    throw new Error("Font is missing one of head/hhea/hmtx/cmap");
  }

  const unitsPerEm = u16(dv, head.offset + 18);
  let ascender = i16(dv, hhea.offset + 4);
  let descender = i16(dv, hhea.offset + 6);
  let lineGap = i16(dv, hhea.offset + 8);
  const numberOfHMetrics = u16(dv, hhea.offset + 34);

  // OS/2 typo metrics are the better line box when USE_TYPO_METRICS is set;
  // they are also what browsers prefer for most modern fonts.
  const os2 = tables.get("OS/2");
  if (os2 && os2.length >= 78) {
    const fsSelection = u16(dv, os2.offset + 62);
    const useTypo = (fsSelection & 0x80) !== 0;
    const typoAsc = i16(dv, os2.offset + 68);
    const typoDesc = i16(dv, os2.offset + 70);
    const typoGap = i16(dv, os2.offset + 72);
    if (useTypo && typoAsc !== 0) {
      ascender = typoAsc;
      descender = typoDesc;
      lineGap = typoGap;
    }
  }

  const cmap = readCmap(dv, cmapT.offset);

  const advances: number[] = new Array(numberOfHMetrics);
  for (let i = 0; i < numberOfHMetrics; i++) {
    advances[i] = u16(dv, hmtx.offset + i * 4);
  }
  const lastAdvance = advances[numberOfHMetrics - 1] ?? unitsPerEm / 2;
  const notdef = advances[0] ?? unitsPerEm / 2;

  const cache = new Map<number, number>();

  function advanceOf(codePoint: number): number {
    const hit = cache.get(codePoint);
    if (hit !== undefined) return hit;
    const gid = cmap.get(codePoint);
    let adv: number;
    if (gid === undefined) {
      adv = notdef;
    } else if (gid < numberOfHMetrics) {
      adv = advances[gid]!;
    } else {
      adv = lastAdvance;
    }
    cache.set(codePoint, adv);
    return adv;
  }

  const readGlyphBounds = makeGlyphBoundsReader(dv, tables, head.offset, hmtx.offset, numberOfHMetrics);
  const inkCache = new Map<number, GlyphBounds | null>();

  function inkOf(codePoint: number): GlyphBounds | null {
    const hit = inkCache.get(codePoint);
    if (hit !== undefined) return hit;
    const gid = cmap.get(codePoint);
    const bounds = gid === undefined || !readGlyphBounds ? null : readGlyphBounds(gid);
    inkCache.set(codePoint, bounds);
    return bounds;
  }

  return {
    family,
    unitsPerEm,
    ascender,
    descender,
    lineGap,
    hasOutlines: readGlyphBounds !== null,
    advanceOf,
    inkOf,
  };
}

/**
 * A reader for one glyph's outline bounds, or `null` for a face this cannot
 * bound — a CFF/OTTO face has no `glyf`, and its outlines live in a format
 * this module deliberately does not parse.
 *
 * The bounding box in a glyph's own header is authoritative for both simple
 * and composite glyphs, so no outline has to be walked. It is stated in glyph
 * space; `hmtx`'s left side bearing is what places it against the pen, and the
 * two agree only when `head.flags` bit 1 says so. Shifting by the bearing
 * rather than trusting `xMin` costs two bytes a glyph and is right either way.
 */
function makeGlyphBoundsReader(
  dv: DataView,
  tables: Map<string, TableRecord>,
  headOffset: number,
  hmtxOffset: number,
  numberOfHMetrics: number,
): ((gid: number) => GlyphBounds | null) | null {
  const loca = tables.get("loca");
  const glyf = tables.get("glyf");
  if (!loca || !glyf) return null;

  // 0 selects uint16 offsets stored halved; 1 selects uint32 offsets.
  const longLoca = i16(dv, headOffset + 50) !== 0;
  const stride = longLoca ? 4 : 2;
  // Clamped to the buffer rather than trusting the declared length: a
  // truncated face should lose its glyph bounds, not throw out of layout.
  const entries = Math.max(
    0,
    Math.floor((Math.min(loca.offset + loca.length, dv.byteLength) - loca.offset) / stride),
  );
  const offsetAt = (i: number) =>
    longLoca ? u32(dv, loca.offset + i * 4) : u16(dv, loca.offset + i * 2) * 2;

  const leftSideBearing = (gid: number): number => {
    if (gid < numberOfHMetrics) return i16(dv, hmtxOffset + gid * 4 + 2);
    const extra = hmtxOffset + numberOfHMetrics * 4 + (gid - numberOfHMetrics) * 2;
    return extra + 1 < dv.byteLength ? i16(dv, extra) : 0;
  };

  return (gid: number): GlyphBounds | null => {
    if (gid < 0 || gid + 1 >= entries) return null;
    const start = offsetAt(gid);
    // An empty range is a glyph with no outline at all — a space.
    if (offsetAt(gid + 1) <= start) return null;
    const at = glyf.offset + start;
    if (at + 10 > glyf.offset + glyf.length || at + 10 > dv.byteLength) return null;
    const xMin = i16(dv, at + 2);
    const yMin = i16(dv, at + 4);
    const xMax = i16(dv, at + 6);
    const yMax = i16(dv, at + 8);
    const lsb = leftSideBearing(gid);
    return { xMin: lsb, xMax: lsb + Math.max(0, xMax - xMin), yMin, yMax };
  };
}

/** Width of a string in font units. */
export function measureUnits(font: FontMetrics, s: string): number {
  let total = 0;
  for (const ch of s) total += font.advanceOf(ch.codePointAt(0)!);
  return total;
}
