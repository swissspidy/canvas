# The task set

Twenty-one tasks across five families. Enough that a per-family breakdown has
something to say; few enough that a full sweep across surfaces, feedback
conditions, models and repeats stays affordable.

Every task is a brief, a hand-built starting document, a set of deterministic
checks, and the criteria the judge is asked about. **The agent only ever sees
the brief and the starting document.** Check definitions and judge criteria
never reach it — otherwise the task degenerates into "satisfy this rubric" and
stops telling you anything about laying out a document.

The corollary, and it is load-bearing: **every constraint that is scored is
stated in the brief.** A check the agent cannot see is not difficulty, it is a
guessing game, and it would land unevenly across the surfaces this study is
comparing. When a task got harder, its brief got longer.

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
| compose | `compose.festival-poster` | 37.5% | 30 | 14 |
| compose | `compose.event-flyer` | 37.5% | 30 | 15 |
| compose | `compose.quote-card` | 53.3% | 25 | 13 |
| compose | `compose.product-card` | 31.6% | 30 | 15 |
| compose | `compose.title-card` | 60.0% | 25 | 13 |
| repair | `repair.overlapping-stack` | 64.0% | 30 | 11 |
| repair | `repair.off-canvas` | 61.8% | 30 | 12 |
| repair | `repair.buried-text` | 71.4% | 25 | 12 |
| repair | `repair.z-order` | 57.4% | 20 | 10 |
| repair | `repair.crowded-margins` | 67.2% | 30 | 10 |
| repair | `repair.mixed-defects` | 54.0% | 35 | 14 |
| fit | `fit.long-headline` | 65.0% | 20 | 11 |
| fit | `fit.body-overflow` | 63.2% | 20 | 10 |
| fit | `fit.three-overflowing` | 66.7% | 25 | 11 |
| fit | `fit.caption-under-image` | 63.2% | 20 | 9 |
| fit | `fit.two-column` | 69.6% | 25 | 13 |
| restyle | `restyle.palette-swap` | 69.6% | 25 | 11 |
| restyle | `restyle.dark-mode` | 66.7% | 25 | 12 |
| arrange | `arrange.ragged-column` | 44.4% | 25 | 10 |
| arrange | `arrange.uneven-row` | 50.1% | 25 | 11 |
| arrange | `arrange.card-grid` | 39.5% | 30 | 18 |

Baselines are nowhere near zero because most checks measure defects the
starting document does not have. A `fit` task starts in the sixties because
everything about it is fine except the one block of text that does not fit —
which is exactly the point of the task. This is why the headline metric is
normalized against the baseline rather than reported raw.

The check count includes the four universal checks, and several tasks declare
a second, more heavily weighted copy of the universal check that is the point
of the task: `noTextClipping` carries weight 6 on every `fit` task.

The task suite asserts in CI that no baseline exceeds 0.9. A task that starts
nearly solved wastes every cell it appears in.

---

## Two facts about the document model the checks have to respect

Both of these were being got wrong, in opposite directions, and between them
they account for most of what changed when the task set was hardened.

**A newline is a hard line break.** One text element can hold a title over two
lines, or a date, a venue and a call to action as three. The system prompt says
so in as many words. So a check that demands "at least five elements" is
scoring a particular way of *dividing the copy up*, which is not a property of
a good poster — and it was satisfiable by adding a rect nobody asked for. Every
element floor is gone. What those tasks meant is measured directly instead:
`coverage`, `typeHierarchy`, `marginAtLeast`, and region checks keyed on the
copy. Ceilings stay, because "at most one decorative shape" is a real
constraint however the copy is set.

The other half of the same fact: a document whose copy is *all* in one element
has one font size and therefore no hierarchy at all. `typeHierarchy` used to
score that at 1.0, on the reasoning that a single size cannot contradict
itself, which paid an agent to pour the whole brief into one box and stop. It
now scores 0.

**An element can be transparent, and nearly-transparent is the same thing.**
Invisible elements were the cheapest loophole in the suite, and closing the
door on `opacity: 0` left `opacity: 0.02` open: a poster whose every element —
background photograph, title, dates, venue, ticket line — is set at 2% opacity
is a blank canvas to any reader, and it scored 93.8% against a starting
document that scores 37.5%. Nine tenths of the available improvement, for
painting nothing. Colour alpha was a second way in, since `#ffffff05` and
`opacity: 0.05` were never multiplied together.

So there is one threshold, `VISIBLE_ALPHA`, set at 5% of full strength, and
opacity multiplies colour alpha before it is applied. Below it an element
paints nothing, and the checks that ask what is *on the page* do not see it.
Contrast is measured on the colour that lands on the page rather than the one
declared, for the same reason: black copy at 3% opacity was scoring 21:1.

None of this touches the checks that ask what is *in the document* —
`preservesElements`, `geometryUnchanged`, `inBounds`. Hiding an element must
never be a way to satisfy "keep every element", and making something invisible
must never be a way to dodge a penalty.

---

## Families

### `compose` — build from a brief (5 tasks)

Start near-empty. Every element's position has to be decided from nothing;
there is no existing layout to imitate and no id to align to. This is where the
surfaces should differ most, and where the relational surface's `create` has to
carry a relational placement rather than an x and a y.

Checks cannot name ids, since the agent invents them — but they can name
**copy**, which the brief gives verbatim. `withText` finds whichever element
ended up carrying a phrase, so "the ticket line sits in the bottom fifth" and
"the title is set larger than the dates" are scorable facts rather than things
only the judge can see. Before that, composition was scored in aggregate only,
and a poster that set the venue at twice the size of the festival's name
satisfied "the title should dominate" completely.

`compose.product-card` also asks whether the button label sits on a filled
shape (`textOnFilledShape`), which is the id-free form of "does this read as a
button".

### `repair` — fix a broken layout (6 tasks)

Each starting document breaks in one specific way, so a failure is
attributable: elements piled on each other, elements drifted off-canvas, text
buried under a decorative shape, an inverted stacking order, everything jammed
against the edges.

Each carries copy the agent must keep, so "fix it by deleting the problem"
scores zero on `preservesElements` — and, where the brief says to keep the copy
as it is, `textUnchanged` compares it verbatim, because shortening the body
text is the cheapest way to clear an occlusion without doing any layout work.
Several also pin what must *not* move, via `geometryUnchanged`.

Each now also pins the cheap escape that is not a repair, because every one of
them was available and worth full marks: shrinking the shape that is in the way
until it covers nothing, squashing the photograph that will not fit rather than
moving it, fading out the layer that is on top. `repair.z-order` scores the
stacking itself (`paintOrder`) rather than only the occlusion it causes, since
occlusion has a second cure — make the top layer invisible — that leaves the
document exactly as wrong as it was found.

`repair.mixed-defects` is the deliberate exception to the one-defect rule: an
opener that is off-canvas, mis-stacked and crowded at once, where fixing one
defect in the obvious way reintroduces another. Attribution survives it,
because the checks are still one per defect.

### `fit` — text that does not fit its box (5 tasks)

The purest test of the relational hypothesis. The coordinate surface has to
reason about font metrics it cannot see. The relational surface has one call
(`fit_text`) that solves it exactly. Document-as-code has to guess a number
and check.

If relational operations ever pay off, they pay off here. If they do not pay
off here either, that is a strong result in its own right.

**Every task in this family states a minimum type size**, and without it the
whole family was trivial: shrinking the text until it fits is available on
every surface, takes one call, and works. `fit.body-overflow` went from 40% to
full marks at `fontSize: 9` — four hundred words of 9-unit type on a 1080-unit
canvas. With a floor, the agent has to find the room instead, which is the
problem the family exists to pose.

`fit.caption-under-image` is the hard one: the caption cannot simply grow
downwards, because the rule and the footer are directly beneath it and must not
move. It cannot grow upwards either — `notCovered` watches the photograph,
which the occlusion check never did, because that one only ever asked about
text.

`fit.three-overflowing` and `fit.two-column` add the constraint that makes this
family more than three separate one-liners: the blocks have to end up at *one*
size. Fixing each block by however much it happens to overflow leaves three
sizes in one column, which is three fixes rather than one treatment —
`fit_text` applied per element gets this wrong.

### `restyle` — change appearance, keep layout (2 tasks)

No geometry involved, which makes this the family where the relational surface
should have *no* advantage. It is the control on the family breakdown: an
advantage that shows up here as well would suggest the effect is not the
mechanism H1 claims. So it matters that every geometric lever here is pinned
shut and the difficulty is colour reasoning alone.

**The reference is a written specification, not a reference image.** An image
reference would have to be shown to the agent in every condition including
`feedback: none` — putting a picture into the no-picture cell and wrecking the
feedback comparison. Describing the target in words costs some realism and buys
a clean feedback axis; that is the right trade for this study.

Because the target is written down, it can be scored exactly. `usesPalette`
asks whether the colours came from the list, which a brief that says *which
colour goes where* is not asking: a card painted entirely in the accent red is
completely on-palette and has thrown the hierarchy away. `colorRoles` reads the
assignment the brief spells out.

`restyle.dark-mode` needed absolute-luminance checks to work at all. Contrast
ratio is invariant under inversion, so a light layout and its dark counterpart
score identically on contrast — no check could tell them apart, and the task
scored a perfect 1.0 at baseline until `surfacesNoLighterThan` and
`textNoDarkerThan` were added. It also holds the photograph's style still,
because dimming the picture to 10% is the cheapest way to make a page look dark
and is not what "convert this to a dark theme" means.

### `arrange` — alignment and spacing (3 tasks)

The narrowest family, and the one where relational operations have the most
direct advantage: `align` and `distribute` are single calls for what the
coordinate surface must compute element by element. Deliberately included as a
check on whether the advantage shows up where the mechanism predicts.

Three tasks rather than two, because this family carries H4 and two tasks is a
thin basis for a per-family claim. `arrange.card-grid` is the one that
separates a surface with `align` and `distribute` from one without: six cards,
two axes to reconcile at once, and getting the rows right does not get the
columns right.

The tolerances here are tight on purpose. `alignedOn` and `evenlySpaced` used
to bottom out at 40 units of spread, which on a 1080-unit canvas is a rag
anyone would see across a room — and the ragged column was collecting half
marks for it before anything had been done.

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
| `inRegion` | An element's centre — or, with `whole`, its entire box — lies in a fractional region |
| `geometryUnchanged` | Boxes held still where a brief forbids moving or resizing |
| `styleUnchanged` | Appearance held still, an image's asset included |
| `textUnchanged` | Copy held verbatim where a brief forbids rewriting it |
| `outerMarginsBalanced` | The gap at each end of a row or column matches the other |
| `typeBudget` | Per-type element caps, for a brief that says "no images" |
| `elementCount` | How many things are on the page. Ceilings only — see above |
| `typeHierarchy` | Ratio of largest to smallest font size, id-free |
| `textSizeOrder` | Named *copy* in decreasing font size — `fontSizeOrder` without the ids |
| `fontSizeOrder` | Named elements in decreasing font size |
| `fontSizeAtLeast` | Nothing set below a legible size |
| `sameFontSize` | A group of blocks treated as one, at one size |
| `coverage` | Fraction of canvas occupied, via a 60×60 occupancy grid, ignoring a full-canvas background and anything invisible |
| `usesImage` | An image element from a named set |
| `usesPalette` | Colours drawn from a given palette, counted once per distinct colour |
| `colorRoles` | The exact colour assignment a brief spells out |
| `aspectPreserved` | Images not stretched (`objectFit: cover` exempt — it crops) |
| `notCovered` | Named elements — images and shapes included — not painted over |
| `noOverlap` | Elements in a group not painted across each other |
| `verticalOrder` | The named elements still read top to bottom in order |
| `paintOrder` | The stacking itself, rather than the occlusion it causes |
| `textOnFilledShape` | A piece of copy sits on a filled shape — "does it read as a button" |
| `surfacesNoLighterThan` | Large painted surfaces are dark enough |
| `textNoDarkerThan` | Text is light enough, measured against its backdrop |

All graded 0–1, all weighted per task.

Two selectors exist for the id-free case: `withText(phrase)` matches the
visible text element carrying a phrase, and `visibleText` / `visibleImage`
match by type. The compose family uses those rather than `isText` / `isImage`,
because `select` does not filter a predicate's matches — deliberately, since
the id-based checks are asking about the document rather than the render — and
the unfiltered pair let an image at `opacity: 0` satisfy "nothing is painted
over the photograph" on a page with no visible photograph in it.

---

## The suite's own tests

Two files, asking the two halves of the same question: can this task be scored
badly for the right reasons, and can it be scored well at all.

`src/tasks/solvable.test.ts` holds a reference solution for every task — the
document a competent designer would produce — and asserts each one scores full
marks. Without it, a task can be quietly impossible and nothing says so: every
run in every cell records the same failure, the surfaces all tie, and the
result reads as "the surface does not matter", which is the finding this study
is most at risk of manufacturing by accident. It caught exactly that.
`restyle.palette-swap` assigned the button label the palette's primary text and
put it on the palette's accent fill, which is 2.97:1, while the same brief
asked for 4.5:1 — the two checks could not both be satisfied, and every run
would have lost the same three points forever.

`src/tasks/tasks.test.ts` is where a loophole goes once it has been found. Each
test is a cheap way to score well without doing the work, asserted to cost
something:

- Elements nobody can see — at `opacity: 0`, at `opacity: 0.02`, or with a
  near-transparent colour — gain nothing on *any* task. Asserted across the
  whole set, so a check added later that starts counting them fails here.
- An invisible element is still present and still unmoved, which is the other
  side of the same boundary.
- Shortening copy a brief says to keep costs more than the occlusion it clears.
- Shrinking type out of legibility scores below finding the room.
- Three different fixes score below one treatment.
- Fitting a caption by burying the photograph scores below fitting it in the
  gap.
- A single text block holding every line scores zero on hierarchy — and a
  composition that uses a newline to break a title is not charged for it.
- Hiding the photograph scores below restacking it.
- A palette applied to the wrong elements scores below the assignment the brief
  gives.

---

## Adding a task

1. Write it in the right family file under `src/tasks/`, using `defineTask`.
2. Give it a brief that states the goal, any required copy verbatim, **and
   every constraint that will be scored** — type floors, margins, order,
   what must not move.
3. Build the starting document with the helpers in `src/tasks/helpers.ts`.
4. Add checks that fail on the starting document. The suite will tell you if
   they do not.
5. Ask what the cheapest way to satisfy those checks is, and whether it is a
   layout you would accept. If it is not, the check for it goes in
   `tasks.test.ts` as a loophole test.
6. Write at least three judge criteria, covering things the deterministic
   checks cannot see.
7. Run `npm test`. The task suite checks the schema validates, the document
   renders, the baseline leaves headroom, and every check produces a result.
