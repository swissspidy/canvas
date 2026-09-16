# The task set

Eighteen tasks across five families. Enough that a per-family breakdown has
something to say; few enough that a full sweep across surfaces, feedback
conditions, models and repeats stays affordable.

Every task is a brief, a hand-built starting document, a set of deterministic
checks, and the criteria the judge is asked about. **The agent only ever sees
the brief and the starting document.** Check definitions and judge criteria
never reach it — otherwise the task degenerates into "satisfy this rubric" and
stops telling you anything about laying out a document.

```bash
npm run cli -- tasks                            # list them
npm run cli -- show repair.overlapping-stack    # brief, start state, baseline, criteria
npm run cli -- render fit.long-headline         # render the starting document
```

---

## Baselines

The baseline is what the *starting* document scores on the deterministic
checks. It is the floor a run has to beat, and the denominator for the
headline improvement metric.

| Family | Task | Baseline | Budget | Checks |
|---|---|---|---|---|
| compose | `compose.festival-poster` | 45.5% | 30 | 10 |
| compose | `compose.event-flyer` | 50.0% | 30 | 9 |
| compose | `compose.quote-card` | 55.6% | 25 | 8 |
| compose | `compose.product-card` | 50.0% | 30 | 9 |
| compose | `compose.title-card` | 58.3% | 25 | 8 |
| repair | `repair.overlapping-stack` | 63.6% | 30 | 8 |
| repair | `repair.off-canvas` | 61.5% | 30 | 10 |
| repair | `repair.buried-text` | 63.6% | 25 | 8 |
| repair | `repair.z-order` | 45.5% | 20 | 7 |
| repair | `repair.crowded-margins` | 74.4% | 30 | 9 |
| fit | `fit.long-headline` | 64.3% | 20 | 8 |
| fit | `fit.body-overflow` | 70.0% | 20 | 7 |
| fit | `fit.three-overflowing` | 69.7% | 25 | 8 |
| fit | `fit.caption-under-image` | 77.3% | 20 | 8 |
| restyle | `restyle.palette-swap` | 71.1% | 25 | 8 |
| restyle | `restyle.dark-mode` | 60.0% | 25 | 9 |
| arrange | `arrange.ragged-column` | 63.4% | 25 | 8 |
| arrange | `arrange.uneven-row` | 60.7% | 25 | 8 |

Baselines are nowhere near zero because most checks measure defects the
starting document does not have. `fit.caption-under-image` starts at 77%
because everything about it is fine except the one clipped caption — which is
exactly the point of the task. This is why the headline metric is normalized
against the baseline rather than reported raw.

The task suite asserts in CI that no baseline exceeds 0.9. A task that starts
nearly solved wastes every cell it appears in.

---

## Families

### `compose` — build from a brief (5 tasks)

Start near-empty. Every element's position has to be decided from nothing;
there is no existing layout to imitate and no id to align to. This is where the
surfaces should differ most, and where the relational surface's `create` has to
carry a relational placement rather than an x and a y.

Checks are necessarily id-free, since the agent invents its own ids: required
copy present, type hierarchy (largest text ≥ N× the smallest), margins, canvas
coverage, asset used, element count.

### `repair` — fix a broken layout (5 tasks)

Each starting document breaks in one specific way, so a failure is
attributable: elements piled on each other, elements drifted off-canvas, text
buried under a decorative shape, an inverted stacking order, everything jammed
against the edges.

Each carries copy the agent must keep, so "fix it by deleting the problem"
scores zero on `preservesElements`. Several also pin what must *not* move, via
`inRegion` checks — `repair.z-order` is purely a restacking task and the checks
say so.

### `fit` — text that does not fit its box (4 tasks)

The purest test of the relational hypothesis. The coordinate surface has to
reason about font metrics it cannot see. The relational surface has one call
(`fit_text`) that solves it exactly. Document-as-code has to guess a number and
check.

If relational operations ever pay off, they pay off here. If they do not pay
off here either, that is a strong result in its own right.

`fit.caption-under-image` is the hard one: the caption cannot simply grow
downwards, because the footer is directly beneath it and must not move.

### `restyle` — change appearance, keep layout (2 tasks)

No geometry involved, which makes this the family where the relational surface
should have *no* advantage. It is the control on the family breakdown: an
advantage that shows up here as well would suggest the effect is not the
mechanism H1 claims.

**The reference is a written specification, not a reference image.** An image
reference would have to be shown to the agent in every condition including
`feedback: none` — putting a picture into the no-picture cell and wrecking the
feedback comparison. Describing the target in words costs some realism and buys
a clean feedback axis; that is the right trade for this study.

`restyle.dark-mode` needed absolute-luminance checks to work at all. Contrast
ratio is invariant under inversion, so a light layout and its dark counterpart
score identically on contrast — no check could tell them apart, and the task
scored a perfect 1.0 at baseline until `surfacesNoLighterThan` and
`textNoDarkerThan` were added.

### `arrange` — alignment and spacing (2 tasks)

The narrowest family, and the one where relational operations have the most
direct advantage: `align` and `distribute` are single calls for what the
coordinate surface must compute element by element. Deliberately included as a
check on whether the advantage shows up where the mechanism predicts.

---

## The check library

Universal checks run on every task, whatever else it asks for:

| Check | What it measures |
|---|---|
| `noTextOcclusion` | Glyph area hidden behind something painted above |
| `inBounds` | Element area outside the canvas, exact on rotated boxes |
| `noTextClipping` | Lines hidden by the element's own box, plus horizontal overflow |
| `minContrast` | WCAG ratio against the effective backdrop |

Task-specific checks:

| Check | What it measures |
|---|---|
| `containsText` | Required copy, case- and whitespace-insensitive |
| `preservesElements` | Named elements survived the edit |
| `alignedOn` | Spread of a shared edge across a group |
| `evenlySpaced` | Spread of gaps between consecutive elements |
| `marginAtLeast` | Smallest distance to a canvas edge (full-bleed elements exempt) |
| `inRegion` | An element's centre lies in a fractional region — used to pin what must not move |
| `typeHierarchy` | Ratio of largest to smallest font size, id-free |
| `coverage` | Fraction of canvas occupied, via a 60×60 occupancy grid |
| `usesImage` | An image element from a named set |
| `usesPalette` | Colours drawn from a given palette |
| `aspectPreserved` | Images not stretched (`objectFit: cover` exempt — it crops) |
| `fontSizeOrder` | Named elements in decreasing font size |
| `surfacesNoLighterThan` | Large painted surfaces are dark enough |
| `textNoDarkerThan` | Text is light enough |

All graded 0–1, all weighted per task.

---

## Adding a task

1. Write it in the right family file under `src/tasks/`, using `defineTask`.
2. Give it a brief that states the goal and any required copy verbatim.
3. Build the starting document with the helpers in `src/tasks/helpers.ts`.
4. Add checks that fail on the starting document. The suite will tell you if
   they do not.
5. Write at least three judge criteria, covering things the deterministic
   checks cannot see.
6. Run `npm test`. The task suite checks the schema validates, the document
   renders, the baseline leaves headroom, and every check produces a result.
