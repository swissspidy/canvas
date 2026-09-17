#!/usr/bin/env python3
"""Subset the vendored fonts down to the characters this project can render.

The full Liberation Sans faces are ~410KB each, and almost all of that is glyph
outlines and positioning tables for scripts these tasks never use. The layout
engine only reads `hmtx`, `cmap`, `head`, `hhea` and `OS/2` — about 15KB — and
the outlines exist purely so the rasterizer and the browser can paint.

Two things this deliberately drops:

  `post` glyph names — never read by anything here.
  `GPOS` / `kern`   — the layout engine ignores kerning, and the renderer pins
                      every painted line to its computed width with SVG
                      `textLength`. Dropping the tables makes what is painted
                      agree with what was measured, rather than relying on
                      `textLength` to absorb the difference.

What it must NOT change is `hmtx`. Every advance width has to survive exactly,
or every line break in the project moves and the recorded baselines become
wrong. `src/text/subset.test.ts` asserts that, comparing the subset against the
upstream file.

Usage:
    pip install fonttools
    python3 scripts/subset-fonts.py /usr/share/fonts/truetype/liberation
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FONT_DIR = REPO / "assets" / "fonts"

FACES = ["LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf"]

# Latin plus the punctuation and symbols a brief is likely to contain. Widen
# this and re-run if the task set ever needs Greek, Cyrillic or anything else
# the upstream face carries.
UNICODE_RANGES = ",".join(
    [
        "U+0020-007E",  # Basic Latin
        "U+00A0-00FF",  # Latin-1 Supplement
        "U+0100-017F",  # Latin Extended-A
        "U+2000-206F",  # General Punctuation: en/em dash, curly quotes, bullet, ellipsis
        "U+20A0-20BF",  # Currency symbols
        "U+2190-2193",  # Arrows
        "U+2212",  # Minus sign
        "U+FFFD",  # Replacement character
    ]
)


def subset(source: Path, target: Path) -> None:
    subprocess.run(
        [
            sys.executable,
            "-m",
            "fontTools.subset",
            str(source),
            f"--unicodes={UNICODE_RANGES}",
            f"--output-file={target}",
            "--layout-features=",  # drop GSUB/GPOS features
            "--drop-tables+=GPOS,GSUB,kern",
            "--no-glyph-names",  # strip `post` names
            "--notdef-outline",  # keep a visible box for anything unmapped
            "--recalc-bounds",
        ],
        check=True,
    )


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    source_dir = Path(sys.argv[1])

    for face in FACES:
        source = source_dir / face
        if not source.exists():
            print(f"missing source font: {source}", file=sys.stderr)
            return 1
        target = FONT_DIR / face
        before = source.stat().st_size
        subset(source, target)
        after = target.stat().st_size
        print(f"{face}: {before // 1024}KB -> {after // 1024}KB ({after * 100 // before}%)")

    print("\nRun `npm test` — src/text/subset.test.ts checks every advance width survived.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
