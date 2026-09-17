# Canvas agent bench

**Does an agent manipulate a visual document better through coordinate
primitives or through relational operations — and does the feedback it gets
matter more than either?**

That is the whole project. The document model, the renderer, the task set and
the scorer are scaffolding for answering it.

Three tool surfaces over one shared document model:

| Surface | The agent says | Tools |
|---|---|---|
| **Coordinate** | `move el_3 to x=340, y=1150` | `create`, `move`, `resize`, `set_style`, `delete` |
| **Relational** | `place el_3 below el_2 with a 50 unit gap` | `create`, `place`, `align`, `distribute`, `fit_text`, `fit_within`, `avoid_overlap`, `set_style`, `delete` |
| **Document-as-code** | here is the entire JSON, again | `read_document`, `write_document` |

Crossed with what the agent sees after each action: **nothing**, a **structured
description**, a **rendered screenshot**, or **both**. That axis is a
first-class variable rather than a flag, because the most interesting result
this study could produce is that it dominates the tool-surface choice.

What counts as a result is written down in
**[docs/PREREGISTRATION.md](docs/PREREGISTRATION.md)**, before any run.

---

## Quick start

Node 24 — `nvm use` picks it up from `.nvmrc`.

```bash
npm install
npm test                      # 360+ tests, no API key needed
npm run serve                 # live page at http://localhost:5173
```

The live page runs a recorded replay without an API key, so you can see the
interface immediately. Set `ANTHROPIC_API_KEY` (or run `ant auth login`) and
restart to drive a real model.

Other providers work too — `GOOGLE_GENERATIVE_AI_API_KEY` for Google,
`OPENAI_API_KEY` for OpenAI. These are the names the AI SDK reads, and the
only ones checked; if your key lives somewhere else, such as Google's own
`GEMINI_API_KEY`, point the variable above at it:

```bash
export GOOGLE_GENERATIVE_AI_API_KEY="$GEMINI_API_KEY"
```

Their model ids change on their own schedule, so this repo hardcodes none;
name the one you want and it joins the page's model menu:

```bash
CANVAS_EXTRA_MODELS='google:<model-id>' npm run serve
```

Models named that way are costed at zero and reported as unpriced — add a
checked price to `MODELS` in `src/agent/models.ts` to include them in cost
comparisons.

```bash
npm run cli -- tasks                        # the 18 tasks
npm run cli -- surfaces                     # the surfaces and their tools
npm run cli -- show repair.overlapping-stack  # a task's brief, start state and baseline
npm run cli -- render fit.long-headline     # render a starting document to PNG

npm run cli -- run --estimate               # matrix size, no spending
npm run cli -- run --dry-run --out runs/wiring   # full pipeline, scripted model, no API calls
npm run cli -- run --tasks fit --repeats 1 --out runs/pilot   # a real pilot
```

A sweep writes to `runs/<timestamp>/`: `report.md`, `report.json`,
`scores.jsonl`, a full record per run under `runs/`, and a PNG and SVG per run
under `renders/`. Run ids are derived from the cell, so an interrupted sweep
resumes without re-paying for finished work — just run the same command with
the same `--out`. Settings a run id does *not* encode (effort, token ceiling,
judge) are fingerprinted, and resuming after changing one is refused rather
than silently averaged.

---

## The live page

Type a brief, watch it build, and **switch the tool surface while the run is in
flight**. The document and the conversation carry over; only the vocabulary
changes from that turn on. The switch arrives the same way on every model — a
turn labelled `[operator notice]` — because a manipulation this study performs
mid-run must not be the thing that varies by provider.

That toggle is the shareable part. It is also the part most likely to be
misread, so: **the page measures nothing.** Its replay mode deliberately builds
the same layout on every surface. Scripting one surface into a mess would
spread a finding nobody measured. The comparison lives in
`npm run cli -- run` and nowhere else.

---

## Running it across providers

**One agent loop, on the Vercel AI SDK, for every provider — Claude included.**
Models are named `provider:model-id`:

```bash
npm run cli -- run --models 'anthropic:claude-opus-5,google:<id>,openai:<id>'
```

That single path is the point. A second, hand-written Anthropic loop used to
run alongside it, and two near-identical loops meant every cross-model number
carried a question: is this the model, or the harness? One loop cannot answer
that question wrongly, and there is nothing left to keep in step.

Note the explicit ids. `--models sweep` is one model per Claude tier, not one
per provider: Google's and OpenAI's ids change on their own schedule, and a
shorthand pointing at a retired one would either fail a sweep three turns in or
quietly run a different model than the write-up claims.

Reasoning effort uses the AI SDK's **provider-neutral `reasoning` scale**
(`none`…`xhigh`), which each provider maps itself. Matching effort across
providers by hand would have been the obvious validity hole; this way the
mapping is maintained upstream rather than invented here. Prompt caching
survives the move: the tools and the surface briefing are marked cacheable
through `providerOptions`, which providers without such a knob simply ignore.

Prices live in `MODELS` in `src/agent/models.ts`. A model that is not listed
still runs — its cost is reported as *unknown* and footnoted in the report,
rather than being silently wrong.

## Driving it over WebMCP

The surfaces are also published on `document.modelContext`, so any WebMCP agent
can drive the canvas with no agent loop from this repo involved:

```bash
npm run serve        # http://localhost:5173/webmcp.html
npm run e2e:webmcp   # 29 assertions, ~4s, no API key
```

All six feedback conditions work there, screenshots included: the browser
rasterizes through a canvas, and `executeTool` returning a `string` is no
obstacle because that string is serialized JSON, so base64 image data crosses
intact. The end-to-end test asserts the bytes decode to a real PNG and reach the
model as an image part rather than as base64 text.

This is what makes the bench usable from
[webmcp-evals](https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/webmcp-evals)
and anything else that speaks the protocol. **[docs/WEBMCP.md](docs/WEBMCP.md)**
covers what is exposed to an agent versus to a harness, why the scorer is
deliberately not a tool, the one-line conversion a harness must do with an image
part, and the remaining caveat — it runs on a polyfill, because no browser
ships WebMCP yet.

## How a run is scored

**Deterministic checks** carry the argument. Every check returns a graded 0–1
score rather than a pass/fail bit, because a study this size cannot afford to
throw away partial progress.

- Text occlusion — glyphs hidden behind something painted above them.
- Out-of-bounds area, measured exactly on rotated boxes.
- Text clipping — text that does not fit the box it was put in.
- WCAG contrast against the effective backdrop.
- Per-task checks: alignment, even spacing, margins, required copy, palette
  conformance, type hierarchy, preserved elements, canvas coverage.

**Overlap is measured as hidden ink, not as raw overlap area.** A headline
sitting on a card overlaps it by 100%, and that is good design. Scoring raw
overlap would reward scattering elements across the canvas — the metric would
be measuring "did the agent avoid stacking things", which is not what anyone
means by *fix this overlapping layout*.

**Scores are normalized against the starting document.** A run that changes
nothing already scores ~68% raw, because most checks measure defects it never
introduced. The headline metric is the share of available headroom closed: 0%
for changing nothing, 100% for satisfying everything, and negative for making
the document worse.

**A blinded judge** scores intent — does this read as a poster, is the
hierarchy sensible — and only intent. It never sees the surface, feedback
condition, model, turn count or cost. A stratified human-rated subset validates
it, with agreement reported **per surface**; the trust rule is in the
pre-registration.

---

## The document model

Deliberately tiny, and close to the Web Stories model: a fixed-size canvas
holding a flat list of absolutely-positioned elements.

```jsonc
{
  "width": 1080, "height": 1350, "background": "#101020",
  "elements": [
    { "id": "el_1", "type": "image", "src": "photo/mountains",
      "x": 0, "y": 0, "width": 1080, "height": 1350, "rotation": 0, "z": 0,
      "style": { "objectFit": "cover" } },
    { "id": "el_2", "type": "text", "text": "Ridgeline Festival",
      "x": 100, "y": 820, "width": 880, "height": 200, "rotation": 0, "z": 1,
      "style": { "fontSize": 92, "fontWeight": "bold", "color": "#f7f4ee", "align": "center" } }
  ]
}
```

No nesting, no groups, no rich text, no multi-page. Images come from a fixed
procedural library with honest intrinsic aspect ratios, so `objectFit` is a
real decision and the renderer stays a pure function.

Text layout is computed from advance widths read out of a vendored font, and
each painted line is pinned to its computed width with SVG `textLength`. Line
breaking is therefore identical in the scorer, the rasterizer and the browser —
which is what makes *did the text clip?* a fact about the document rather than
about whichever engine drew it.

The fonts are vendored so every clone renders identically, and subsetted to the
characters these tasks use: **111KB for both weights**, down from 825KB, with
no advance width moved. `scripts/subset-fonts.py` regenerates them and
`src/text/subset.test.ts` fails if a single measurement shifts.

Loading is split from use, so the document model, the tool surfaces, the
renderer and the scorer contain no Node at all. The whole surface layer bundles
with `--platform=browser` and runs in a browser — which is what would make
exposing the tools via WebMCP a packaging job rather than a rewrite.

---

## Deliberately not here

The cut list, kept because this is where projects like this die: no real-time
collaboration, no undo/redo semantics, no persistence or accounts, no
human-agent co-editing, no export formats, no mobile, no plugin API.

Two smaller ones worth naming:

- **Reference *images* for restyle tasks.** The reference is given as a written
  spec instead. An image reference would have to be shown in every condition
  including `feedback: none`, putting a picture into the no-picture cell and
  wrecking the feedback comparison.
- **Strict tool schemas.** They would make malformed tool calls impossible, and
  how often a surface provokes one is data.

---

## Layout

```
src/
  doc/        model, exact rotated-box geometry, occlusion, session, ops
  text/       TrueType metrics reader, layout and line breaking
  render/     doc -> SVG, SVG -> PNG, doc -> structured description
  surfaces/   the three tool surfaces (+ hybrid), and the executor
  feedback/   the feedback channel, six modes
  tasks/      18 tasks across five families
  eval/       checks, colour, blinded judge, scoring, human validation
  agent/      the agent loop, the model registry and pricing, events
  webmcp/     the polyfill, surface registration, and the host page
  runner/     sweep runner and report generation
  server/     the live page's server
web/          the live page (no build step) and the WebMCP host (bundled)
docs/         DESIGN.md, PREREGISTRATION.md, TASKS.md, WEBMCP.md
assets/fonts/ vendored Liberation Sans (SIL OFL 1.1)
```

Further reading: **[docs/DESIGN.md](docs/DESIGN.md)** for the decisions and
their reasoning, **[docs/TASKS.md](docs/TASKS.md)** for the task set,
**[docs/PREREGISTRATION.md](docs/PREREGISTRATION.md)** for the analysis plan,
**[docs/WEBMCP.md](docs/WEBMCP.md)** for driving it from an outside harness.

---

## Licence

Apache 2.0. The vendored fonts are Liberation Sans under the SIL Open Font
License 1.1; see `assets/fonts/LICENSE-LiberationSans.txt`.
