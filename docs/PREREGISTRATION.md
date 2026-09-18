# Pre-registration

**Status:** written before any run against a real model. Nothing below was
chosen after seeing results.

The point of writing this first is narrow and specific: the most likely outcome
of this project is that the tool surface does not matter much. If the analysis
plan is only decided once the numbers are in, that outcome quietly becomes a
failed project, the grid gets re-cut until something is significant, and the
write-up reports a difference that is really a garden of forking paths. Fixing
the plan in advance makes "tool design is not the lever" a result the project
can finish on, rather than a disappointment it has to escape.

---

## 1. The question

Does an agent manipulate a visual document better through **coordinate
primitives** or through **relational operations** — and is either effect large
compared with the **feedback** the agent receives after each action?

The document model, the renderer, the task set and the scorer all exist to
answer that and nothing else.

---

## 2. Hypotheses

Stated with directions, so that being wrong is visible.

**H1 — Surface.** Relational operations beat coordinate primitives on
constraint improvement, because they make a class of arithmetic error
unrepresentable.
*Predicted effect:* relational > coordinate by ≥ 10 improvement points,
concentrated in the `arrange` and `fit` families.

**H2 — Feedback.** Feedback dominates the surface. Moving from no feedback to
screenshot-plus-description moves the score more than moving between any two
surfaces does.
*Predicted effect:* the spread across feedback conditions exceeds the spread
across surfaces.

**H3 — The null hypothesis, taken seriously.** Document-as-code is competitive
with both incremental surfaces on quality, at higher token cost and fewer
turns.
*Predicted effect:* document-as-code within 10 points of the best incremental
surface on improvement, at ≥ 1.5× the tokens per run.

**H4 — Where relational should win, if it wins anywhere.** The relational
advantage is largest on `fit` (text against a box, where the agent cannot
measure text) and `arrange` (alignment and distribution, where a single call
replaces per-element arithmetic), and smallest on `restyle` (no geometry
involved).

**H5 — Where a picture should pay for itself.** The feedback advantage is
largest where the document's numbers and its appearance come apart, and
rotation is that case. Every angle is in the description the agent is given;
what the angles *imply* — that a 760×130 banner at −14° paints 769 wide and
310 tall, that two labels at 6° and −5° swing into each other at their ends,
that a card inset 60 units hangs off both edges once it is tilted — is
trigonometry the agent has to do in its head, or read off a picture.
*Predicted effect:* on the two rotation tasks, the gap between `screenshot`
and `structured_plain` is larger than the same gap pooled across the other
twenty-one.

The comparison is against `structured_plain` — geometry only — and not against
`structured`, deliberately. The analysis level *computes* out-of-bounds and
overlap and hands the answers over, which is a substitute for looking at the
page rather than a weaker version of it. Against `structured` the prediction
would be testing whether a picture beats a solver, which is a different
question and one this design cannot answer.

If H4 fails while H1 holds, the H1 result is suspect: an advantage that does
not appear where the mechanism predicts it is probably not the mechanism. H5
stands to H2 the same way.

---

## 3. Design

### Independent variables

| Variable | Levels | Notes |
|---|---|---|
| Tool surface | `coordinate`, `relational`, `document` | `hybrid` is exploratory, not in the confirmatory grid |
| Feedback | `none`, `structured`, `screenshot`, `both` | `structured_plain` / `both_plain` are the confound control (§8) |
| Model | `anthropic:claude-opus-5` confirmatory; a cross-provider set in a reduced grid | Provider-qualified (`provider:model-id`) throughout |
| Task | 23 tasks across 5 families | Every condition sees every task |
| Repeat | 3 | Sampling cannot be pinned; see §7 |

### Dependent variables

**Primary:** `normalizedScore` — the share of available constraint headroom the
run closed, `(constraint − baseline) / (1 − baseline)`. Not clamped below zero,
so making a document worse is recorded as such.

**Secondary, all pre-registered, all reported whatever they show:**

1. Judge criteria score (0–1), reported raw. A judgement whose returned
   criteria do not line up one-for-one with the criteria it was asked for is
   discarded rather than averaged: a run scored against three criteria is not
   comparable with one scored against five, and the number would not show it.
   The discard rate is reported.
2. Cost per run, in dollars, and improvement per dollar.
3. Tool-call failure rate — the share of calls rejected as invalid.
4. Turns to completion.
5. Stop-reason distribution, especially `max_turns`.

`composite` (0.6 × constraint + 0.4 × judge) exists for ranking convenience.
**The weighting is fixed here, in advance.** It is not the primary outcome and
will not be re-weighted after the fact.

---

## 4. Analysis plan

1. **Pairing.** Every comparison is paired within task. Tasks differ enormously
   in difficulty, and every condition sees every task, so pairing removes that
   variance rather than letting it swamp the effect.
2. **Clustering.** Interval estimates resample **tasks**, not runs. Three
   repeats of one task are not three independent observations; treating them as
   such would produce intervals that are too narrow and manufacture resolved
   differences out of twenty-three tasks' worth of evidence.
   (`clusterBootstrapCI` in `src/runner/report.ts`.)
3. **Intervals.** Percentile bootstrap, 2000 iterations, seeded. Regenerating a
   report gives the same numbers; there is no re-rolling.
4. **Primary comparisons.** Three pairwise surface contrasts on the primary
   outcome, pooled across feedback conditions.
5. **Interaction.** The spread of surface means versus the spread of feedback
   means, on the primary outcome (H2).
6. **Family breakdown.** Surface × family, to test H4.
7. **Rotation breakdown.** Feedback × the two rotation tasks versus feedback ×
   the rest, on the primary outcome, comparing `screenshot` with
   `structured_plain` (H5). Two tasks is a narrow base and the interval will
   say so; it is pre-registered as a confirmatory comparison anyway, because
   deciding afterwards whether two tasks were enough is exactly the move this
   document exists to prevent.

No multiple-comparison correction is applied, because the confirmatory set is
small and fixed in advance. It is listed here in full so that nobody has to
take that on trust: three surface contrasts, one interaction comparison, one
family breakdown, one rotation breakdown, one cost comparison.

---

## 5. Decision rules

Fixed in advance so the write-up cannot negotiate with itself later.

- **Resolved.** A difference counts as real only if the 95% interval of the
  paired difference excludes zero. Overlapping intervals are reported as
  unresolved, whatever the means suggest.
- **Practically meaningful.** A resolved difference below **5 improvement
  points** is reported as resolved but not practically meaningful. A tool
  surface worth rebuilding an editor around should be worth more than that.
- **Judge trust.** Judge scores are only reported as evidence if the human
  agreement check (§9) reaches Spearman ρ ≥ 0.6 overall **and** shows no
  surface where per-surface ρ falls below 0.4. A judge that agrees with people
  on one surface but not another would manufacture exactly the headline this
  study is looking for. If the check fails, the judge is reported as an
  unvalidated secondary measure and the constraint score carries the argument.
- **Incomplete runs** are scored on the document they left behind. They are not
  dropped, and `max_turns` rates are reported per surface — a surface that
  routinely runs out of turns has told us something.

---

## 6. Effort across providers

Effort is the one setting that could not be matched by hand across providers
without inventing a mapping, and an invented mapping is a criticism vector.

The cross-provider runs therefore use the **AI SDK's provider-neutral
`reasoning` scale** (`provider-default`, `none`, `minimal`, `low`, `medium`,
`high`, `xhigh`), which each provider maps to its own mechanism. The mapping is
maintained upstream rather than here. This project's `effort` levels map onto it
one-to-one except that `max` has no counterpart and saturates at `xhigh`
(`reasoningFor` in `src/agent/models.ts`).

Every confirmatory run is fixed at `high`. Anything else would let a
quality-cost lever vary silently.

This is a real limitation and it is stated rather than papered over: "the same
reasoning level" across two providers means "the level each provider's own
adapter calls `high`", not a matched compute budget. A cross-provider
difference in reasoning depth is therefore **confounded with** the model
difference, and the write-up must say so wherever a cross-provider comparison
appears.

---

## 7. What "we could not pin the sampling" means

`temperature` was removed from the current model generation, so runs cannot be
made deterministic by setting it to zero. This is a real limitation and it is
handled by measurement rather than by pretending otherwise:

- 3 repeats per cell, with within-cell variance reported alongside the mean.
- Task-clustered intervals, which absorb repeat-level noise correctly.
- Fixed `effort` (`high`) across every confirmatory run, since effort is a
  quality-cost lever that would otherwise vary silently.

Server-side refusal fallbacks are **deliberately not enabled**. They would
re-run a refused turn on a different model inside the same call, which would
silently corrupt the model variable. A refusal ends the run and is recorded as
a refusal.

---

## 8. Known confounds, and what is done about each

| Confound | Control |
|---|---|
| Structured feedback that reports overlaps is doing relational work for the agent | `structured_plain` / `both_plain` supply the same description with derived layout notes removed. The headline feedback comparison is re-run against them. |
| Surfaces differ in prose quality, not capability | The base system prompt is byte-identical; only the briefing differs. A test asserts the opening user message is identical across surfaces. |
| Surfaces differ in error message quality | All errors are produced by one shared formatter with shared wording. |
| Surfaces differ in raw power | Each surface can reach the same document states. Tested directly: the same intent through coordinate arithmetic, relational placement, and a whole-document write produces identical documents — for position, size, style, paint order **and rotation**. Rotation was the hole: `create` took an angle everywhere, but rotating an element that already existed was a `move` on the coordinate surface and unreachable on the relational one, where `place` took no angle and `set_style` is appearance, text and order. Relational now has `rotate`, `place` takes an angle, and the equivalence test covers it. |
| Document-as-code sees the JSON and others do not | Every surface gets the exact starting JSON *and* the geometry description in the opening message. |
| Tool-call arity differs (relational has more tools) | Cost and token counts are reported per surface; quality-per-dollar is a pre-registered secondary outcome. |
| Strict tool schemas would hide malformed calls | Schema-enforced tool calling is deliberately not used. Rejected calls are a measured outcome. |
| A judge that knows the condition | The judge is built from the task and the render only. Surface, feedback, model, turns and cost never enter its prompt. |
| The harness differing between models | There is one agent loop, on the AI SDK, and every model goes through it — Claude included. No comparison in this study spans two harnesses, so there is no harness difference left to bound. |
| Tool-calling reliability differing by provider | Tool-call failure rate is already a pre-registered secondary outcome; it is reported per provider as well as per surface. A provider whose rate is an outlier is named as a confound rather than left to ride. |
| Cost comparisons across unpriced models | A model absent from `MODELS` is reported with `pricingKnown: false` and footnoted in the report, rather than costed at zero in silence. |
| Tasks that are already nearly solved | The task suite fails CI if any starting document scores above 0.9. |
| A task satisfiable without doing the work it describes | Every cheap path found so far — invisible elements, shrinking type out of legibility, shortening copy, hiding the layer that is in the way — is asserted in `src/tasks/tasks.test.ts` to score below the honest fix. |
| A scored constraint the agent was never told about | Every constraint a check scores is stated in the task's brief. An unstated one would land unevenly across surfaces, which is the variable under study. |

---

## 9. Judge validation

A stratified sample of 40 runs, spread across every surface × feedback cell, is
rated 1–5 by a human against the same criteria the judge sees, in a blinded
sheet. Agreement is reported as Spearman ρ, mean absolute error, exact
agreement and within-one agreement, **overall and per surface**. The per-surface
breakdown is the one that matters; see the judge-trust rule in §5.

---

## 10. Sample size and cost

Confirmatory grid: 23 tasks × 3 surfaces × 4 feedback conditions × 1 model ×
3 repeats = **828 runs**, plus 828 judge calls.

Exploratory additions, run only after the confirmatory grid:

- Model sweep: 2 further models × 3 surfaces × 2 feedback conditions
  (`none`, `both`) × 23 tasks × 2 repeats = 552 runs.
- Confound control: 3 surfaces × 2 plain feedback conditions × 23 tasks ×
  3 repeats = 414 runs. **H5 is tested here rather than in the confirmatory
  grid**, since `structured_plain` is one of these two conditions; it is
  pre-registered as confirmatory and the confound-control block is promoted to
  run alongside the main grid rather than after it.
- `hybrid` surface: 1 surface × 4 feedback conditions × 23 tasks × 3 repeats
  = 276 runs.

**Run a pilot before committing to the full grid.** Per-run cost depends on how
many turns each surface takes, which is itself one of the findings, so it
cannot be estimated honestly in advance:

```bash
npm run cli -- run --tasks fit --repeats 1 --out runs/pilot
```

That is 48 runs; multiply its reported mean cost by the grid sizes above.
`--estimate` prints cell counts without spending anything.

---

## 11. Explicitly exploratory

Reported as exploratory, never as confirmatory, however tempting the numbers:

- The `hybrid` surface, including which vocabulary agents reach for when given
  both. This is descriptive.
- Per-task results, as opposed to per-family.
- Anything about *why* a surface failed, drawn from reading transcripts.
- Anything obtained by driving the surfaces over WebMCP. Every feedback
  condition is enforceable there, but it runs on a polyfill rather than a
  browser implementation, and whether a screenshot reaches the model depends on
  the driving harness unpacking the image part (`docs/WEBMCP.md`).
- Any comparison not listed in §4.

---

## 12. Would we be happy with "document-as-code wins"?

Yes, and the plan is built so that the answer does not depend on mood:

- H3 states that outcome as a hypothesis with a predicted effect size, so
  confirming it is a result rather than an absence of one.
- The primary outcome is paired with a cost measure, so "document-as-code wins
  on quality and loses on cost" and "wins on both" are different findings, and
  both are interesting to anyone building an editor.
- The surface-level failure data — rejected calls, `max_turns` rates, which
  tools got used — says something about *why*, regardless of which surface
  wins.
- The feedback axis is a second, independent question. Even if every surface
  ties, H2 still has an answer, and it is the more useful one for anyone
  designing an agent-facing tool.

The outcome that would genuinely waste the month is one where every cell ties
and nothing separates anything — including feedback. That is worth naming as
the real risk, and the pilot in §10 is where it would first show up.

---

## 13. Deviations

Any departure from this document gets appended here, dated, with a reason,
*before* the affected analysis is run.

**2026-09-18 (second entry) — rotation.** Written before any run against a
real model.

Rotation was in the document model, the renderer, the geometry and the
structured description from the beginning, and no task ever set a non-zero
angle and no check ever scored one. Two tasks now do: `repair.tilted-stack`
(four elements knocked askew, every box already where it belongs, so
straightening is the whole repair) and `compose.sale-card` (a ribbon that must
run at −14° and stay inside a 32-unit margin, which its declared width and
height do not tell you how to do). H5 in §2 states what they are for, §4 adds
the breakdown, and §10 moves the confound-control block alongside the main grid
because `structured_plain` is where H5 is measured.

The surfaces had to be levelled first, and this is the part that matters
independently of the hypothesis: **relational could not rotate an element that
already existed.** `create` took an angle, `place` did not, and `set_style` is
appearance, text and paint order — so "straighten these four" was one `move`
per element on the coordinate surface and unreachable on the relational one.
§8 claimed the three surfaces reach the same document states and the
equivalence tests only ever checked placement. `place` now takes a rotation and
relational has a `rotate` op that takes an angle or copies another element's;
`surfaces.test.ts` tests all three surfaces reaching the same rotated document.
Had this been found after the runs, every rotation result would have been a
power difference wearing a mechanism's clothes.

Two new checks, `rotationWithin` and `sameRotation`, and a rotation option on
`textOnFilledShape` so a tilted label on an upright rect is not scored as a
ribbon. The confirmatory grid grows from 756 runs to 828.

**2026-09-18 (third entry) — per-check weights, and the discretion in them.**
Recorded because §3 fixes the composite weighting in advance and says nothing
about the weights *inside* the constraint score, and both entries above changed
many of them.

They were set by hand, before any run, by watching what each starting document
scored and adjusting until the failing checks carried the task rather than the
"do not break this" checks around them. `noTextClipping` carries weight 6 on
every `fit` task; `rotationWithin` carries 8 on `repair.tilted-stack`;
`surfacesNoLighterThan` and `textNoDarkerThan` carry 4 each on
`restyle.dark-mode`. The reasoning is in the task files, check by check, and it
is a defensible way to spend the discretion — but it is discretion, exercised
on the metric, by someone who could see the baselines move.

Three things bound it, and they are the reason this is a disclosure rather than
a problem:

1. It happened before any run against a real model, so no result could have
   informed it.
2. The primary outcome normalizes against the baseline, so moving a weight
   moves the floor and the ceiling together; it changes resolution, not rank.
3. Every weight is in version control with a comment saying what it is for.

**The weights are frozen as of this entry.** Changing one after the first
confirmatory run is a deviation and gets its own entry here, with the affected
analysis re-run from scratch. If a weight turns out to be wrong, the honest
move is to say so in the write-up, not to re-cut the score.

**2026-09-18 — the task set hardened, and three tasks added.** Written before
any run against a real model, so nothing below was chosen after seeing results.

The task set and the deterministic checks were reworked to close paths that
scored well without doing the work the brief describes. The three that mattered
most: a document could carry its required copy, its photograph and its element
count in elements at 2% opacity and collect three quarters of the available
improvement for painting nothing; every task in the `fit` family had a
one-call solution in shrinking the type until it fitted, at any size; and
`typeHierarchy` gave full marks to a document whose entire copy sat in one text
element at one size, which is no hierarchy at all. Grading tolerances on
alignment, spacing, occlusion, bounds and clipping were tightened, and every
new constraint was written into the brief that is scored against it.

Three tasks were added — `repair.mixed-defects`, `fit.two-column` and
`arrange.card-grid` — taking the set from 18 to 21. The last two are in the two
families H4 names, where two tasks was a thin basis for a per-family claim.
§3 and §10 are updated for the new count; the confirmatory grid grows from 648
runs to 756.

Nothing in the question, the hypotheses, the primary outcome, the analysis plan
or the decision rules changes. Baselines move — they are recomputed per task
from the starting document, and `docs/TASKS.md` carries the new table — and the
primary outcome normalizes against them, so the metric is unaffected by the
shift. No comparison in §4 is added, removed or re-cut.

**2026-09-17 — one harness, and the cross-loop check withdrawn.** The two agent
loops were collapsed into one, on the Vercel AI SDK, which every model now runs
through including Claude. The harness row in §3 and the cross-loop check in §8
existed only to bound the difference between the two loops; with one loop there
is no such difference to bound, and 324 runs' worth of budget is freed. Nothing
in the hypotheses, the primary outcome, the analysis plan or the decision rules
changes, and no run against a real model had been made when this was written.
