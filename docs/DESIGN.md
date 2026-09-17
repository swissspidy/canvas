# Design notes

Why the pieces are the way they are. Most of these decisions exist to stop the
study measuring something other than what it claims to measure.

---

## The comparison has to be fair, or it measures nothing

Three surfaces are compared. They must differ in the operations they offer and
in nothing else, so several things are held constant by construction:

**One mutation layer.** Every tool on every surface funnels through
`src/doc/ops.ts`. If `align` and a hand-computed `move` could reach different
document states, the comparison would be measuring the implementation.
`src/surfaces/surfaces.test.ts` asserts this directly: centring an element by
arithmetic, by `place(canvas_center)`, and by writing the whole document each
produce an identical element.

**One prompt, one briefing.** The base system prompt is byte-identical across
surfaces; only the tool briefing differs. The opening user message is identical
for all three — a test asserts it. Otherwise a surface could win on prose.

**One error formatter.** `src/surfaces/execute.ts` shapes every failure the
same way: what went wrong, then how to recover. Error quality is a real lever
on agent performance, so it is held constant rather than left to whatever each
tool happened to throw.

**Equal power.** Every surface can reach the same document states. This forced
two decisions that read oddly against the original five-primitive sketch:

- Rotation rides on coordinate's `move`, and paint order and text content ride
  on `set_style`. They have to live somewhere; a surface missing them would be
  strictly weaker and the comparison would measure that gap.
- Relational's `place_below(target, gap)` is generalized to
  `place(id, relation, target, gap)` with `below` among the relations, and
  `fit_within` is split into `fit_text` (text against its box) and `fit_within`
  (a box inside another box). A surface that could place things below but not
  beside them would lose on expressiveness rather than on the question asked.

**Equal information at turn zero.** Every condition gets the exact starting
document — the geometry description *and* the raw JSON. A repair task is
impossible without it, and giving document-as-code the JSON while others got
only prose would hand it an advantage at turn zero. The feedback condition
governs what comes back *after each action*, which is the part under study.

---

## Occlusion, not overlap

The obvious metric for "fix this overlapping layout" is pairwise overlap area.
It is the wrong metric. A headline on a card overlaps it by 100%; a caption on
a photo overlaps it entirely. Scoring raw overlap would punish every competent
layout and reward scattering elements apart — it would measure "did the agent
avoid stacking things".

So the defect is defined as **ink that something painted above it covers**:

- For text, ink is the glyph envelope of each laid-out line, clipped to the
  element box. Text already clipped away by its own box is a *text overflow*
  problem, counted separately.
- For images and rects, ink is the whole box.

A card behind a headline occludes nothing, because it is painted below. A rect
dropped on top of that headline occludes it. That matches what a reader sees.

The structured feedback channel applies the same rule, and reports occlusion
for **text** only — covering text destroys the only thing it carries, while a
photo partly covered by a caption is ordinary composition. Non-text elements
are reported only when buried outright (≥ 90% hidden).

Computing it needs exact polygon subtraction, not bounding boxes:
`convexDifference` in `src/doc/geometry.ts` decomposes *subject minus clip*
into convex pieces by walking the clip's edges, so hidden area is exact for
rotated elements.

---

## Text layout is ours, not the renderer's

Line breaking has to be identical in the scorer, the rasterizer and the
browser, or "did the text clip?" stops being a deterministic fact.

So `src/text/ttf.ts` reads advance widths straight out of a vendored font's
`hmtx` table, `src/text/layout.ts` does greedy word wrapping with those widths,
and the renderer emits one `<text>` per laid-out line with an explicit
`textLength`. Paint and layout then agree *by construction* rather than by
hoping two shaping engines match.

Deliberately simple, and worth knowing about: no kerning, no hyphenation, no
bidi, no shaping. Words never break mid-word — a word wider than its box
overflows horizontally, which is what a real canvas editor does and what the
`overflowX` check looks for.

Text is clipped to its element box when rendered, so the screenshot the agent
sees shows the same truncation the scorer measures.

### Why there are font binaries in the repo, and why they are small

Layout needs real advance widths, and the rasterizer needs real outlines, on
every machine that clones this. A CDN webfont would add a network dependency to
the eval; a system font stack would make renders differ per machine, which
matters because the judge scores images.

So the faces are vendored — but subsetted. The full Liberation Sans faces are
~410KB each, of which the layout engine reads about 15KB (`hmtx`, `cmap`,
`head`, `hhea`, `OS/2`); the rest is glyph outlines and positioning tables for
scripts these tasks never use. `scripts/subset-fonts.py` cuts them to the Latin
ranges plus the punctuation a brief is likely to contain: **825KB → 111KB**, no
advance width moved, every recorded baseline unchanged.

It also drops `GPOS` and `kern`. The layout engine ignores kerning and the
renderer pins each line to its computed width with `textLength`, so removing
the tables makes what is painted agree with what was measured, rather than
relying on `textLength` to absorb the difference.

`src/text/subset.test.ts` guards this. It holds goldens computed against the
*full upstream faces* — measured widths, exact line-break positions, a real
task element's layout — and compares exhaustively against the system-installed
originals when they are present. A re-subset that shifts one number fails.

### Loading is split from use

`src/text/font-registry.ts` holds parsed metrics and knows nothing about where
bytes came from. `src/text/fonts.ts` is the Node loader that reads them off
disk and installs itself into the registry on import.

That split exists because everything else in the layout, render, scoring and
tool-surface path is already pure — reading a file was the only thing tying it
to a server. With the split, the whole surface layer bundles and runs in a
browser unchanged, which is what makes exposing the tools via WebMCP a
packaging job rather than a rewrite. Verified, not assumed: the layer bundles
with `--platform=browser` and executes in Chromium, running tool calls,
rejecting a malformed one with the right message, rendering SVG and scoring the
result.

The Node loader is installed by importing `src/text/fonts.js`, which the CLI,
the server and the rasterizer all do transitively, and which vitest installs
via `setupFiles`. Asking for a weight with nothing registered throws an error
that says exactly which of the two paths to take.

---

## The feedback channel is an object, not a flag

`src/feedback/index.ts` is a first-class channel that the loop knows nothing
about — it asks for blocks and appends them. That is what keeps surface and
feedback independently variable, which is the whole point of the interaction
analysis.

Six modes. Four are the headline conditions (`none`, `structured`,
`screenshot`, `both`). Two are a confound control.

The control matters. A structured description that reports overlaps and
out-of-bounds elements is doing *relational computation on the agent's behalf*.
Hand that to a coordinate-surface agent and you have narrowed the very gap the
study is trying to measure. So the description has two levels — geometry-only
facts, and geometry plus derived layout notes — and `structured_plain` /
`both_plain` supply the geometry-only form. Without them the headline feedback
comparison has a confound; with them it has a control.

Feedback attaches to the **last tool result** of a turn rather than a separate
message: it describes the state after all of that turn's calls, and riding on
the tool result keeps the message count down.

---

## Scoring

**Graded, not binary.** Every check returns 0–1. With eighteen tasks and three
repeats, binary scoring throws away most of the signal: "8 units out of bounds"
and "half the poster is off the canvas" are not the same failure.

**Normalized against the baseline.** A run that changes nothing scores ~68%
raw, because most checks measure defects it never introduced. That squeezes
every real difference into the top third of the scale. The headline metric is
`(constraint − baseline) / (1 − baseline)`: 0 for changing nothing, 1 for
satisfying everything. It is not clamped below zero, because a run that makes
the document worse has told us something.

Normalization is constraint-only. There is no judge score for a starting
document to normalize against, and judging every baseline would spend money to
blur two different measurements together. The judge score is reported raw.

**Two scores, always reported separately.** The composite (0.6 constraint / 0.4
judge) exists for ranking convenience and its weighting is fixed in the
pre-registration. Keeping the two independent is what makes a disagreement
between them informative rather than noise.

**Incomplete runs are scored on what they left behind.** Blanking them would
hide the difference between "crashed immediately" and "ran out of turns with
the layout nearly right" — exactly the difference between surfaces this study
is looking for.

### The contrast approximation

Contrast is scored against the *effective backdrop*: the element's own fill if
opaque, otherwise the topmost opaque thing under its centre, otherwise the
canvas background. Computing it exactly would mean sampling rendered pixels.

The approximation is wrong for text straddling a hard edge between two fills —
a headline half on a dark photo and half on a light margin. The task set avoids
that case rather than pretending the metric handles it.

---

## Statistics

**Cluster by task.** Interval estimates resample *tasks*, not runs. Three
repeats of one task are not three independent observations — they share a
starting document, a difficulty and a set of checks. Resampling runs would
produce intervals that are too narrow and turn eighteen tasks' worth of
evidence into six hundred runs' worth of false confidence.

**Pair within task.** Tasks differ enormously in difficulty and every condition
sees every task, so pairing removes that variance instead of letting it swamp
the comparison.

**Seeded bootstrap.** Same scores, same intervals, every time. A report that
shifts slightly on each regeneration invites exactly the kind of re-rolling
this project should not do.

---

## The agent loop

A manual loop rather than the SDK's tool runner, for three reasons this study
needs: feedback blocks come from a channel the runner knows nothing about;
per-turn usage has to be recorded separately for the cost analysis; and a
refused or truncated turn has to be recorded as an outcome rather than
swallowed.

Two things are deliberately **not** used:

- **`strict: true` on tool definitions.** It would make malformed tool calls
  impossible, and how often a surface provokes one is a measured outcome.
  Inputs are validated against the same Zod schema instead.
- **Server-side refusal fallbacks.** Re-running a refused turn on a different
  model inside the same call would silently corrupt the model variable. A
  refusal ends the run and is reported as one.

A turn that stops at `max_tokens` also ends the run. Its tool input is usually
half-written, and running it would corrupt the document with something the
model never finished saying.

**No temperature.** It was removed from the current model generation, so runs
cannot be pinned to a fixed sample. Variance is handled by repeating cells and
reporting spread, not by pretending determinism.

**Prompt caching.** The tools and system prompt are stable for every run on a
surface, so a `cache_control` breakpoint on the system block caches that prefix
across the whole sweep.

### Two loops, on purpose

`src/agent/loop.ts` talks to the Anthropic SDK directly. `src/agent/aisdk-loop.ts`
goes through the Vercel AI SDK and reaches every provider. They are structural
near-copies — same turn budget, same feedback attachment, same stop reasons,
same `RunResult` — and a test asserts they reach an identical document from
identical tool calls.

The duplication is deliberate. The native loop has prompt caching, adaptive
thinking and mid-conversation system messages, and carries the confirmatory
grid. The AI SDK loop exists so that a cross-model comparison runs every model
through *one* code path; splitting Claude and Gemini across two harnesses would
make any difference between them ambiguous. The cost of keeping both is that
they can drift, which the parity test and the pre-registered cross-loop check
are there to catch.

They differ in exactly one structural way, and only in a turn where nothing
changed: an AI SDK `error-text` tool output carries no content array, so when
*every* call in a turn was rejected, feedback follows in a user message instead
of riding on the tool result.

### Switching surface mid-session

`surfaceProvider` is consulted at the start of every turn. A change swaps the
tool list while keeping the document and the conversation, and is announced as
a mid-conversation system message on models that accept one — an operator
instruction, clearly distinct from anything the user said — falling back to a
user turn elsewhere.

It costs a prompt-cache miss, because tools render before the system prompt.
That is unavoidable and not worth working around for a demo.

---

## Running in a browser

Two registries make the whole bench browser-portable, and both exist for the
same reason: the document model, the surfaces, the renderer and the scorer are
pure, and only two things reached for Node.

`src/text/font-registry.ts` holds parsed font metrics; `src/text/fonts.ts` is
the Node loader that reads them off disk. `src/render/rasterizer.ts` holds the
SVG-to-PNG implementation; `src/render/raster.ts` registers the resvg one.

In a browser the fonts are fetched and registered, and `browser-raster.ts`
installs a canvas rasterizer, so every feedback condition works there too. If
nothing is registered, asking for a screenshot throws rather than quietly
returning text — a feedback condition that silently stopped sending screenshots
would corrupt the variable this study is built around.

The browser rasterizer draws the SVG into an `<img>`, paints it onto a canvas
and reads back PNG bytes. An SVG loaded as an image is an isolated document and
cannot reach the host page's stylesheets, so the font face is inlined into the
SVG as a data URI; otherwise text would paint in a fallback typeface. Layout
would survive either way — every line is pinned with `textLength` — but the
screenshot the agent sees should be the document the scorer measured, in the
same face. The end-to-end test renders with and without the embedded face and
asserts they differ, since that is the only way to know embedding works.

Making the feedback channel `async` is the cost. Every caller was already in an
async context, so it is paid once at the type level and nowhere at runtime.

What all of this buys is `src/webmcp/`: the surfaces published on
`document.modelContext`, drivable by any WebMCP agent, with every call still
going through `executeToolCall`. See `docs/WEBMCP.md`. One caveat remains, and
it is not about the protocol: no browser ships WebMCP yet, so it runs on a
polyfill.

## The task set tests itself

`src/tasks/tasks.test.ts` fails if any task's starting document already scores
above 0.9. A task that starts nearly solved teaches nothing: every surface
passes and the cell is wasted.

This caught a real problem. `restyle.dark-mode` scored a perfect 1.0 at
baseline, because the starting layout is a valid *light* layout and contrast
ratio is invariant under inversion — no check could tell light from dark. It
needed absolute-luminance checks (`surfacesNoLighterThan`, `textNoDarkerThan`)
to become a real task.

---

## Things that are approximations, stated plainly

- **Contrast backdrop**, as above.
- **`avoid_overlap`** separates axis-aligned bounding boxes, not rotated
  shapes. Exact separation would need a full SAT solve, and "not touching on
  screen" is what is being asked for. When the canvas is too small to separate
  everything, it says so rather than silently giving up.
- **`coverage`** unions bounding boxes on a 60×60 occupancy grid rather than by
  exact polygon union. It is a sanity check on "does this look composed", not a
  precision instrument.
- **Asset average colour** for contrast against an image is the midpoint of its
  two gradient stops.
- **Glyph ink** is the line's advance width by the font's ascent-to-descent
  envelope, not per-glyph outlines.

Each is a deliberate trade, and each is in a place where more precision would
not change which surface wins.
