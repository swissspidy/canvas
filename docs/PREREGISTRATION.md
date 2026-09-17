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

If H4 fails while H1 holds, the H1 result is suspect: an advantage that does
not appear where the mechanism predicts it is probably not the mechanism.

---

## 3. Design

### Independent variables

| Variable | Levels | Notes |
|---|---|---|
| Tool surface | `coordinate`, `relational`, `document` | `hybrid` is exploratory, not in the confirmatory grid |
| Feedback | `none`, `structured`, `screenshot`, `both` | `structured_plain` / `both_plain` are the confound control (§8) |
| Model | `claude-opus-5` confirmatory; a cross-provider set in a reduced grid | Provider-qualified (`provider:model-id`) on the `aisdk` runner |
| Harness | `anthropic` confirmatory; `aisdk` for every cross-model run | Not a variable of interest — a nuisance factor to be bounded, see §8 |
| Task | 18 tasks across 5 families | Every condition sees every task |
| Repeat | 3 | Sampling cannot be pinned; see §7 |

### Dependent variables

**Primary:** `normalizedScore` — the share of available constraint headroom the
run closed, `(constraint − baseline) / (1 − baseline)`. Not clamped below zero,
so making a document worse is recorded as such.

**Secondary, all pre-registered, all reported whatever they show:**

1. Judge criteria score (0–1), reported raw.
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
   differences out of eighteen tasks' worth of evidence.
   (`clusterBootstrapCI` in `src/runner/report.ts`.)
3. **Intervals.** Percentile bootstrap, 2000 iterations, seeded. Regenerating a
   report gives the same numbers; there is no re-rolling.
4. **Primary comparisons.** Three pairwise surface contrasts on the primary
   outcome, pooled across feedback conditions.
5. **Interaction.** The spread of surface means versus the spread of feedback
   means, on the primary outcome (H2).
6. **Family breakdown.** Surface × family, to test H4.

No multiple-comparison correction is applied, because the confirmatory set is
small and fixed in advance. It is listed here in full so that nobody has to
take that on trust: three surface contrasts, one interaction comparison, one
family breakdown, one cost comparison.

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
(`reasoningFor` in `src/agent/providers.ts`).

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
| Surfaces differ in raw power | Each surface can reach the same document states. Tested directly: the same intent through coordinate arithmetic, relational placement, and a whole-document write produces identical documents. |
| Document-as-code sees the JSON and others do not | Every surface gets the exact starting JSON *and* the geometry description in the opening message. |
| Tool-call arity differs (relational has more tools) | Cost and token counts are reported per surface; quality-per-dollar is a pre-registered secondary outcome. |
| Strict tool schemas would hide malformed calls | Tools are deliberately not `strict`. Rejected calls are a measured outcome. |
| A judge that knows the condition | The judge is built from the task and the render only. Surface, feedback, model, turns and cost never enter its prompt. |
| Two agent loops behaving differently | Every cross-model run uses the `aisdk` loop, Claude included, so no model comparison spans harnesses. A test asserts both loops reach an identical document from identical tool calls, and the cross-loop check below bounds the rest. |
| Tool-calling reliability differing by provider | Tool-call failure rate is already a pre-registered secondary outcome; it is reported per provider as well as per surface. A provider whose rate is an outlier is named as a confound rather than left to ride. |
| Cost comparisons across unpriced models | A model absent from `PRICING` is reported with `pricingKnown: false` and footnoted in the report, rather than costed at zero in silence. |
| Tasks that are already nearly solved | The task suite fails CI if any starting document scores above 0.9. |

---

### The cross-loop check

Before any cross-model claim, `claude-opus-5` is run on the full task set
through **both** loops at `feedback: both`, 3 repeats — 108 runs on each side.

The two are compared on the primary outcome with the same paired, task-clustered
procedure as everything else. If the paired difference between harnesses is
resolved and exceeds the 5-point practical threshold, the harness is a
first-order effect and every cross-model result is reported with that magnitude
stated alongside it. If it is unresolved, the write-up says so and treats the
loops as interchangeable for this purpose.

This check is run and reported **whatever it shows**. Discovering that the
harness matters as much as the model would be an unwelcome result and an
important one.

---

## 9. Judge validation

A stratified sample of 40 runs, spread across every surface × feedback cell, is
rated 1–5 by a human against the same criteria the judge sees, in a blinded
sheet. Agreement is reported as Spearman ρ, mean absolute error, exact
agreement and within-one agreement, **overall and per surface**. The per-surface
breakdown is the one that matters; see the judge-trust rule in §5.

---

## 10. Sample size and cost

Confirmatory grid: 18 tasks × 3 surfaces × 4 feedback conditions × 1 model ×
3 repeats = **648 runs**, plus 648 judge calls.

Exploratory additions, run only after the confirmatory grid:

- Cross-loop check: 18 tasks × 3 surfaces × 1 feedback (`both`) × 3 repeats ×
  2 harnesses = 324 runs.
- Model sweep, on the `aisdk` runner: 2 further models × 3 surfaces ×
  2 feedback conditions (`none`, `both`) × 18 tasks × 2 repeats = 432 runs.
- Confound control: 3 surfaces × 2 plain feedback conditions × 18 tasks ×
  3 repeats = 324 runs.
- `hybrid` surface: 1 surface × 4 feedback conditions × 18 tasks × 3 repeats
  = 216 runs.

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
- Anything obtained by driving the surfaces over WebMCP. That track cannot
  enforce the screenshot feedback conditions (`docs/WEBMCP.md`), and at present
  it runs on a polyfill rather than a browser implementation.
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

_(none yet)_
