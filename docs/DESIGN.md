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

  That is not a hypothetical, and it went unnoticed for a while: relational
  could *create* a rotated element and could not rotate one that already
  existed, because `place` took no angle and `set_style` is appearance, text
  and paint order. "Straighten these four" was one `move` each on the
  coordinate surface and unreachable on the relational one. The equivalence
  tests only covered placement, so nothing caught it. `place` now takes a
  rotation, relational has a `rotate` that takes an angle or copies another
  element's, and the equivalence test reaches the same rotated document through
  all three surfaces. Had it survived into the runs, every rotation result
  would have been a power difference wearing a mechanism's clothes.
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

- For text, ink is the bounding box of the glyphs each laid-out line actually
  draws, clipped to the element box. Text already clipped away by its own box
  is a *text overflow* problem, counted separately.
- For images and rects, ink is the whole box.

A card behind a headline occludes nothing, because it is painted below. A rect
dropped on top of that headline occludes it. That matches what a reader sees.

**The rule applies to the occluder as well as to the occluded.** A text element
covers only the glyphs it paints, not the rectangle it was declared in — a
headline in a tall box would otherwise bury every caption that box happens to
span, which is neither what a reader sees nor a defect anyone would fix. The
exception is a text element with its own block fill, which really does cover
its whole box. Text that paints nothing — empty, or a fully transparent colour
— occludes nothing.

**Ink is the glyphs, not the line box.** A line box runs from the ascender to
the descender whatever the line contains — 1.12em in Liberation Sans — and a
row of capitals and digits inks 0.69em of it. Measuring the line box counted
that blank third as painted, and reported a heading as covered by a rule laid
in the air beneath its letters. So `src/text/ttf.ts` reads glyph bounding
boxes out of `loca`/`glyf` and `src/text/layout.ts` walks the same advances
the line was measured with, giving each line the box its letters occupy. A
face whose outlines this reader cannot bound — a CFF/OTTO face — falls back to
the line box, which is too generous rather than too tight.

The same box answers a different question for `marginAtLeast`: *does this
element crowd the canvas edge?* Measured on boxes, the most natural way to
centre a headline — a full-width text box set to `align: center` — scored zero
on every margin check in the suite, because the box touches both edges while
the letters sit hundreds of units from either. Measured on ink it scores what
a reader would say. An element whose paint runs from one side of the canvas to
the other is exempt: that is a bleed, which is a decision, not a crowded edge.

The structured feedback channel applies the same rule, and reports occlusion
for **text** only — covering text destroys the only thing it carries, while a
photo partly covered by a caption is ordinary composition. Non-text elements
are reported only when buried outright (≥ 90% hidden).

Computing it needs exact polygon subtraction, not bounding boxes:
`convexDifference` in `src/doc/geometry.ts` decomposes *subject minus clip*
into convex pieces by walking the clip's edges, so hidden area is exact for
rotated elements. Subtracting can split a piece up to four ways per clip, so
the piece list is capped; when the cap trips the result falls back on the union
bound, which under-reports visible area rather than over-reporting it. Erring
toward *more* occlusion is the safe direction for a metric whose job is to
catch hidden text.

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
`overflowX` check looks for. A newline *is* honoured, as a hard break.

### One form for a line break

Every text payload is normalized on the way in, on every surface: `\r\n` and a
bare `\r` become `\n`, and so do the two characters backslash-`n`. Models send
that pair constantly — a tool description reading "`\n` is a hard line break"
says, once the JSON is decoded, *emit these two characters*, and they oblige by
escaping the backslash. It rendered as a visible `\n` in the middle of a
poster. The models bright enough to notice split the copy into two elements
instead, which is worse: it turns a line break into a placement problem, on a
bench that is measuring placement.

The cost is that a document cannot hold a literal backslash followed by an `n`.
On a task set of posters, flyers and quote cards that is a trade worth making,
and it is the same trade on all four surfaces — which is what matters, since
they are meant to differ only in how elements get arranged.

Text is clipped to its element box when rendered, so the screenshot the agent
sees shows the same truncation the scorer measures.

### Copy cannot be blank

`create` has always refused an empty string: a text element carrying no words
is a deleted element wearing a disguise, and it still counts as preserved
against a brief that says to keep the copy. A space bar is the same act, so
whitespace-only copy is refused too — `"   "`, a tab, a lone line break. It laid
out, it validated, and it painted not one pixel, because whitespace has an
advance width and no outline.

Only *entirely* blank copy is refused. Padding around real words is the
author's business and alignment can depend on it, so `"  Ridgeline  "` is
stored exactly as sent.

This is the one invisibility the model forbids, and it is worth saying why the
others stay legal. A rect with a transparent fill is how you draw an
*outline* — omit a rect's fill entirely and the renderer paints it grey, so
`transparent` is the only way to get an unfilled box. Zero opacity is the end
of a range that exists for scrims. And an element can pass through invisible on
its way to being styled, which would land on the incremental surfaces and not
on document-as-code. Blank copy has none of that: `create` demands the text up
front, so there is no half-built state to protect, and nothing is expressible
only through a blank string. Everything else invisible is left to the checks,
which ignore what paints nothing rather than refusing to hold it.

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

**Graded, not binary.** Every check returns 0–1. With twenty-three tasks and
three repeats, binary scoring throws away most of the signal: "8 units out of bounds"
and "half the poster is off the canvas" are not the same failure.

**Normalized against the baseline.** A run that changes nothing scores ~56%
raw on average, because most checks measure defects it never introduced. That squeezes
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

Contrast is scored against the *effective backdrop*: the stack of layers that
actually cover the element's centre, composited bottom-up onto the canvas
background and stopping at the first opaque one. Computing it exactly would
mean sampling rendered pixels.

Two things that stack has to get right, because both are ordinary design:

- **A translucent scrim over a photo.** Compositing a 40%-white scrim onto the
  page background instead of onto the photo under it reports the contrast of a
  layout nobody is looking at. So the whole stack is composited, not just the
  topmost layer opaque enough to count.
- **A rotated card.** Its bounding box claims up to twice the area it paints,
  so coverage is tested against its real corners.

The approximation that remains is the single sample: it is wrong for text
straddling a hard edge between two fills — a headline half on a dark photo and
half on a light margin. The task set avoids that case rather than pretending
the metric handles it.

---

## Statistics

**Cluster by task.** Interval estimates resample *tasks*, not runs. Three
repeats of one task are not three independent observations — they share a
starting document, a difficulty and a set of checks. Resampling runs would
produce intervals that are too narrow and turn twenty-three tasks' worth of
evidence into eight hundred runs' worth of false confidence.

**Pair within task.** Tasks differ enormously in difficulty and every condition
sees every task, so pairing removes that variance instead of letting it swamp
the comparison.

**Seeded bootstrap.** Same scores, same intervals, every time. A report that
shifts slightly on each regeneration invites exactly the kind of re-rolling
this project should not do.

---

## The agent loop

**One loop, on the Vercel AI SDK, for every provider — Claude included.**

There were two for a while: `src/agent/loop.ts` spoke to the Anthropic SDK
directly and carried the confirmatory grid, and a second, near-identical loop
went through the AI SDK to reach every other provider. The duplication bought
one thing — Anthropic's own knobs on the confirmatory path — and cost three:
two implementations to keep in step, a parity test to prove they were, and a
pre-registered cross-loop check to bound what the difference between them was
doing to the results. The AI SDK reaches Claude perfectly well, including
prompt caching, so the second loop was removed rather than maintained. A
cross-model comparison that spans two harnesses can always be answered with
"or maybe that was the harness"; one that spans none cannot.

A manual loop rather than the SDK's own tool runner, for three reasons this
study needs: feedback blocks come from a channel the runner knows nothing
about; per-turn usage has to be recorded separately for the cost analysis; and
a refused or truncated turn has to be recorded as an outcome rather than
swallowed. Tools are therefore declared without an `execute`, so `generateText`
returns tool calls and the loop runs them itself.

Two things are deliberately **not** used:

- **Schema-enforced ("strict") tool calling.** It would make malformed tool
  calls impossible, and how often a surface provokes one is a measured outcome.
  Inputs are validated against the same Zod schema instead.
- **Automatic retries on a refusal.** Re-running a refused turn would silently
  corrupt the model variable. A refusal ends the run and is reported as one.

A turn that stops at the output limit also ends the run. Its tool input is
usually half-written, and running it would corrupt the document with something
the model never finished saying.

**No temperature.** It was removed from the current model generation, so runs
cannot be pinned to a fixed sample. Variance is handled by repeating cells and
reporting spread, not by pretending determinism.

**Prompt caching.** The tools and the surface briefing are stable for every run
on a surface, so the instructions carry a cache breakpoint and that prefix is
paid for once across a sweep rather than once per run. It is set through
`providerOptions`, which is namespaced per provider — the providers that have
no such knob never read it, so the portable path keeps the Anthropic-specific
saving.

The conversation carries a second breakpoint, on its newest message, and the
loop moves it forward every turn. Every turn re-sends every earlier one — the
brief, the JSON, each call and result, and under the screenshot conditions a
PNG per turn — so with only the prefix cached the input bill is quadratic in
the turn count; on a five-turn Opus pilot the re-sent conversation was two
thirds of the cell's cost. A breakpoint on the newest message lets the next
turn read everything before it at the cached rate. Only the newest message
carries one, because a provider allows four and a run has thirty turns, and
the provider finds the previous turn's entry as a prefix of the new one. A
cache read returns the same tokens, so nothing the model sees changes.

**Retries.** A request is retried up to six times, backing off from two
seconds to just over two minutes in total and honouring a `retry-after`
header, and only on the failures a retry can help — 408, 409, 429 and 5xx. The
SDK's default of two is right for an interactive call and wrong for a sweep:
at twelve workers against one provider a rate limit is a matter of when, and a
cell that dies six seconds into a 429 burst forfeits every turn it had paid
for and goes back in the queue to pay for them again. What survives the
retries is an `api_error`, which `docs/PREREGISTRATION.md` §5 keeps out of the
aggregates and the runner re-runs on the next pass.

**The output ceiling is not the same number on every model.** Every turn is
sent with `maxOutputTokens: 16000`, and the SDK's reasoning mapping turns that
into `max_tokens: 16000` with thinking inside it on a model with adaptive
thinking (Opus 5, Sonnet 5), and into `max_tokens: 54,400` with a 38,400-token
thinking budget on one that takes a budget instead (Haiku 4.5). Levelling it
would mean a per-provider thinking setting, which is the invented mapping the
pre-registration rules out, so it is stated there (§6, §8) as a confound of the
model ladder rather than fixed here.

**One structural wrinkle.** An `error-text` tool output carries no content
array, so in a turn where *every* call was rejected the feedback follows in a
user message instead of riding on the tool result. That costs one extra message
in exactly the turns where nothing changed.

### Switching surface mid-session

`surfaceProvider` is consulted at the start of every turn. A change swaps the
tool list while keeping the document and the conversation, and is announced as
a user turn labelled `[operator notice]`.

A `{role: "system"}` entry inside the conversation would have been the more
natural way to say *this came from the harness, not from the user*, and it was
the first implementation. It is not portable: across the providers the loop
reaches it is variously accepted, hoisted into the instructions, or rejected.
The switch is the one manipulation this study performs mid-run, so it cannot be
the thing that behaves differently per provider. A labelled user turn is worse
prose and better experimental hygiene.

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

The headroom ceiling is only half the question, though, and it is the easier
half. A task can start thoroughly broken and still be satisfiable without doing
the work its brief describes, and the cheap path is usually one call:

- **Shrink the type until it fits.** Available on every surface, and it solved
  the entire `fit` family. `fit.body-overflow` went from 40% to full marks at
  `fontSize: 9`.
- **Make the problem invisible.** Fade the shape that is covering the text, or
  the photograph that is painted over it, and every occlusion check is
  satisfied while the document stays exactly as wrong as it was found.
- **Shrink the problem.** A 1×1 decorative blot occludes nothing.
- **Pad with things nobody can see.** Copy at 2% opacity satisfies
  `containsText`; an image at 2% opacity satisfies "use this asset".
- **Place a rotated element by the box it declared.** A 760×130 banner at −14°
  paints 769×310, so a margin cleared on paper is broken on the page. The
  checks that measure margins and bounds read what an element paints, so this
  one costs rather than pays — which is the point of putting rotation in the
  task set at all.
- **Put everything in one text element.** A newline is a hard line break, so
  the whole brief fits in one box — at one size, which used to score full marks
  on `typeHierarchy`.

So the suite's tests assert the ordering directly, in two files.
`src/tasks/tasks.test.ts` asserts that for each cheap path, the honest fix
scores above it. `src/tasks/solvable.test.ts` holds a reference solution for
every task and asserts it scores full marks.

Both halves matter. Without the first, the study measures which surface finds
the shortcut fastest. Without the second, a check can quietly make its task
impossible, every cell records the same failure, and the surfaces tie — which
reads as "the surface does not matter", the one finding this design is most at
risk of manufacturing by accident. That is not hypothetical:
`restyle.palette-swap` asked for the button label in the palette's primary text
on the palette's accent fill, which is 2.97:1, and for 4.5:1 in the same brief.
`docs/TASKS.md` lists what is asserted.

The other half of the same fix lives in the briefs. Every constraint a check
scores is stated in the task's brief, because a constraint the agent cannot see
is not difficulty — it is a guessing game, and it would land unevenly across
the surfaces, which is the variable under study.

---

## What a check looks at: the page, or the document

Every deterministic check reads one of two things, and which one it reads is a
decision rather than an accident.

**What is on the page** — whether the required copy appears, whether an image
was used, whether the type has a hierarchy, what colours are in play, how much
of the canvas is covered, whether anything crowds an edge. These read only
elements that paint something.

They all used to read every element, and every one of them was gameable for it.
The worst: a poster missing half its required copy and set in a single type
size scored **full marks** by carrying the missing phrases in a text element at
`opacity: 0`. `containsText` found them, `typeHierarchy` got its size ratio,
and `minContrast` never objected, because it read `style.color` and a hidden
element's colour is perfectly legible. An image at `opacity: 0` satisfied "use
the photo/mountains asset as a background image" for 17 points. Three invisible
rects bought an "at least five elements" floor for 10.

Closing that door on `opacity: 0` left it open at `opacity: 0.02`, which is the
same page to a reader and a different number to a check, and colour alpha was a
second way through since `#ffffff05` and `opacity: 0.05` were never multiplied
together. So "paints something" is now a threshold rather than a test against
zero: `VISIBLE_ALPHA`, 5% of full strength, applied to the product of the two.
Contrast is measured on the colour that lands on the page for the same reason —
black copy at 3% opacity was scoring 21:1 — and the element floor is gone
entirely, because a newline is a hard line break and counting elements was
scoring how the copy had been divided up rather than what was on the page.

**What is in the document** — whether an element was kept, whether its box was
held still, whether the copy is verbatim, whether anything hangs off the
canvas. These read every element. Most of them name their elements by id, which
is a deliberate reference to a specific element rather than a question about
the render; "keep every element" must not be satisfiable by hiding one.

`inBounds` is the one that could have gone either way. It stays unfiltered
deliberately: it can only ever *add* a penalty, so there is nothing to gain by
hiding an element from it, while filtering would make "bring the stray elements
back on canvas" satisfiable by hiding the stray instead of moving it — a worse
layout scoring better. `noTextClipping` looks like its twin and is not: it
scores the *share* of lines hidden, so an invisible text element that fits pads
the denominator and dilutes a real failure. It takes the filter.

`src/tasks/tasks.test.ts` asserts the property across every task rather than
check by check: adding an invisible rect, an invisible text and an invisible
image to a task's starting document changes its score by nothing at all. A
check added later that starts counting what nobody can see fails there. It
caught two leaks the check-by-check pass missed — `coverage` testing its
canvas for `elements.length === 0` rather than for anything painted, and the
clipping ratio above.

This is also why `typeBudget` can stop penalising an invisible rect, which it
used to do. That penalty was the same box-counting accident producing a right
answer by luck, and it is not needed once the reward is gone.

---

## Things that are approximations, stated plainly

- **Contrast backdrop**, as above.
- **`avoid_overlap`** separates axis-aligned bounding boxes, not rotated
  shapes. Exact separation would need a full SAT solve, and "not touching on
  screen" is what is being asked for. When the canvas is too small to separate
  everything, it says so rather than silently giving up.
- **`marginAtLeast` reads a rotated element that pokes out at both edges as a
  bleed**, because it runs edge to edge on that axis and bleeding is a
  decision. On `repair.tilted-stack` — a card tilted until both its sides hang
  off — the margin check is therefore silent and `inBounds` is what catches it.
  Narrowing the bleed exemption to *unrotated* elements would fix that case and
  break the one it exists for, so the task's weights carry the load instead.
- **`coverage`** unions bounding boxes on a 60×60 occupancy grid rather than by
  exact polygon union, and the grid rounds each element outward to whole cells.
  It is a sanity check on "does this look composed", not a precision
  instrument. Two kinds of element are left out of the union. An element
  covering the canvas outright: a full-bleed background saturates the grid by
  itself, and once it has, a composed page, a bare one and one with every
  element in a corner all measure 100% and score the same — the check was
  reading the background rather than the composition. And anything that paints
  nothing, by `paintedPolygons`: counting invisible boxes made "does this look
  composed" answerable with one element nobody can see, which took a bare page
  from failing this check to passing it outright. A visible element still
  contributes its whole box rather than its ink, because a block of type does
  occupy its box on the page. The full-canvas exemption is narrower than the
  one `marginAtLeast` makes, because the questions differ: a full-width band
  across the lower third crowds no edge, but it does fill that third.
- **Asset average colour** for contrast against an image is the midpoint of its
  two gradient stops.
- **Contrast ignores element opacity.** `minContrast` reads `style.color`
  against the backdrop, so text at `opacity: 0.1` is scored as though it were
  fully painted. Only fully invisible text is excluded, by the rule above.
  Doing it properly means compositing the glyph colour with the backdrop at the
  element's opacity, which would also change the score of every legitimately
  translucent caption — a bigger change than the failure justifies, since
  nothing in the task set asks for faint type.
- **Glyph ink** is the bounding box of a line's glyphs, read from `glyf`, not
  the outlines themselves — the counters and the gaps between letters count as
  ink. Tight enough that a rule passing through the blank band under a line of
  capitals is no longer reported as covering it; not so tight that a check has
  to reason about letterforms.

Each is a deliberate trade, and each is in a place where more precision would
not change which surface wins.
