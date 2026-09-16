/**
 * The human-rated subset that validates the judge.
 *
 * Without it, every intent score in the write-up rests on an unchecked
 * assumption: that a model's taste tracks a person's. This draws a stratified
 * sample, produces a blinded rating sheet, and reports how well the two agree.
 *
 * The sheet is blinded the same way the judge is — a rater sees the brief, the
 * criteria and the image, and nothing about which surface or feedback
 * condition produced it. The stratification deliberately spreads the sample
 * across conditions so agreement can be checked *within* condition too: a
 * judge that agrees with people on coordinate runs but not on relational ones
 * would quietly manufacture the headline result.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunScore } from "./score.js";
import { getTask } from "../tasks/index.js";

export interface RatingItem {
  runId: string;
  /** Held back from the sheet; recorded so agreement can be split by condition. */
  surfaceId: string;
  feedbackMode: string;
  model: string;
  taskId: string;
  brief: string;
  criteria: string[];
  /** The judge's overall rating, 1..5. Never shown to the rater. */
  judgeOverall: number | null;
  renderPath: string;
}

/** Deterministic PRNG, so the same sweep always yields the same sample. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SAMPLE_SEED = 481625;

/**
 * Stratified across surface x feedback, so no condition is missing from the
 * validation set, then filled out at random up to `n`.
 */
export function sampleForRating(scores: RunScore[], n = 40): RatingItem[] {
  const judged = scores.filter((s) => s.judgeOverallScore !== null);
  const pool = judged.length > 0 ? judged : scores;
  if (pool.length === 0) return [];

  const rand = mulberry32(SAMPLE_SEED);
  const strata = new Map<string, RunScore[]>();
  for (const score of pool) {
    const key = `${score.surfaceId}|${score.feedbackMode}`;
    strata.set(key, [...(strata.get(key) ?? []), score]);
  }

  const shuffled = (items: RunScore[]): RunScore[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  };

  const queues = [...strata.values()].map(shuffled);
  const picked: RunScore[] = [];
  // Round-robin across strata until the quota is filled or the pool runs out.
  for (let round = 0; picked.length < n; round++) {
    let tookAny = false;
    for (const queue of queues) {
      if (picked.length >= n) break;
      const next = queue[round];
      if (next) {
        picked.push(next);
        tookAny = true;
      }
    }
    if (!tookAny) break;
  }

  return picked.map((score) => {
    const task = getTask(score.taskId);
    return {
      runId: score.runId,
      surfaceId: score.surfaceId,
      feedbackMode: score.feedbackMode,
      model: score.model,
      taskId: score.taskId,
      brief: task.brief,
      criteria: task.judgeCriteria,
      judgeOverall: score.judgeOverallScore === null ? null : Math.round(score.judgeOverallScore * 4 + 1),
      renderPath: join("renders", `${score.runId}.png`),
    };
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * A self-contained rating sheet. Images are inlined as data URIs so the file
 * can be emailed to a rater without shipping a directory alongside it.
 */
export function buildRatingSheet(items: RatingItem[], sweepDir: string): string {
  const cards = items
    .map((item, i) => {
      let img = "";
      try {
        img = `data:image/png;base64,${readFileSync(join(sweepDir, item.renderPath)).toString("base64")}`;
      } catch {
        img = "";
      }
      return `
  <section class="card" data-run="${escapeHtml(item.runId)}">
    <header><span class="n">${i + 1} / ${items.length}</span></header>
    <div class="body">
      <div class="shot">${img ? `<img src="${img}" alt="rendered result">` : `<p class="missing">Render missing</p>`}</div>
      <div class="detail">
        <h3>Brief</h3>
        <pre>${escapeHtml(item.brief)}</pre>
        <h3>Assess</h3>
        <ul>${item.criteria.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
        <h3>Overall, 1 to 5</h3>
        <div class="scale">
          ${[1, 2, 3, 4, 5]
            .map(
              (v) =>
                `<label><input type="radio" name="r_${escapeHtml(item.runId)}" value="${v}"><span>${v}</span></label>`,
            )
            .join("")}
        </div>
        <p class="hint">1 = does not meet the brief at all. 3 = partially. 5 = you would ship it.</p>
      </div>
    </div>
  </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rating sheet — ${items.length} layouts</title>
<style>
  :root { color-scheme: light dark; --bg: #faf8f5; --fg: #1d1d2b; --muted: #5f5f78; --line: #e2ddd4; --card: #ffffff; --accent: #2b3a67; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #14141f; --fg: #eceaf4; --muted: #a09db8; --line: #2c2c3f; --card: #1c1c2a; --accent: #8fa6e0; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px 120px; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--fg); }
  .wrap { max-width: 1080px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  .lede { color: var(--muted); margin: 0 0 28px; max-width: 60ch; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; margin-bottom: 20px; overflow: hidden; }
  .card header { padding: 10px 16px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 0.85rem; }
  .body { display: grid; grid-template-columns: minmax(0, 340px) minmax(0, 1fr); gap: 20px; padding: 16px; }
  @media (max-width: 720px) { .body { grid-template-columns: 1fr; } }
  .shot img { width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--line); display: block; }
  .missing { color: var(--muted); font-style: italic; }
  h3 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0 0 6px; }
  pre { white-space: pre-wrap; font: inherit; background: transparent; margin: 0 0 16px; }
  ul { margin: 0 0 16px; padding-left: 20px; }
  .scale { display: flex; gap: 8px; }
  .scale label { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border: 1px solid var(--line); border-radius: 8px; cursor: pointer; }
  .scale label:has(input:checked) { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .hint { color: var(--muted); font-size: 0.85rem; margin: 8px 0 0; }
  .bar { position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 16px; background: var(--card); border-top: 1px solid var(--line); display: flex; gap: 12px; align-items: center; justify-content: center; }
  button { font: inherit; padding: 10px 18px; border-radius: 8px; border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; }
  button[disabled] { opacity: 0.5; cursor: not-allowed; }
  .count { color: var(--muted); }
</style>
</head>
<body>
<div class="wrap">
  <h1>Rate these layouts</h1>
  <p class="lede">
    Each card shows a brief and the layout that was produced from it. Rate how well the result meets the
    brief, 1 to 5. You are not told how any of them were made, and you should not try to guess — rate what
    you see. When you are done, export and send back the JSON file.
  </p>
${cards}
</div>
<div class="bar">
  <span class="count" id="count">0 rated</span>
  <button id="export" disabled>Export ratings</button>
</div>
<script>
  const total = ${items.length};
  const countEl = document.getElementById('count');
  const exportEl = document.getElementById('export');

  function collect() {
    const out = {};
    for (const card of document.querySelectorAll('.card')) {
      const checked = card.querySelector('input:checked');
      if (checked) out[card.dataset.run] = Number(checked.value);
    }
    return out;
  }

  function refresh() {
    const n = Object.keys(collect()).length;
    countEl.textContent = n + ' of ' + total + ' rated';
    exportEl.disabled = n === 0;
  }

  document.addEventListener('change', refresh);

  exportEl.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(collect(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'human-ratings.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  refresh();
</script>
</body>
</html>`;
}

export interface AgreementReport {
  n: number;
  /** Rank correlation between the judge's and the raters' 1..5 scores. */
  spearman: number;
  pearson: number;
  /** Mean absolute difference on the 1..5 scale. */
  meanAbsoluteError: number;
  exactAgreement: number;
  withinOne: number;
  /** The same statistics restricted to each surface, to catch a biased judge. */
  bySurface: Record<string, { n: number; spearman: number; meanAbsoluteError: number }>;
  note: string;
}

function rank(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1]!.v === indexed[i]!.v) j++;
    // Average rank for ties, which a 5-point scale produces constantly.
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k]!.i] = avg;
    i = j + 1;
  }
  return ranks;
}

export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export function spearman(a: number[], b: number[]): number {
  return pearson(rank(a), rank(b));
}

export function computeAgreement(scores: RunScore[], humanRatings: Record<string, number>): AgreementReport {
  const byId = new Map(scores.map((s) => [s.runId, s]));
  const pairs: { runId: string; surface: string; judge: number; human: number }[] = [];

  for (const [runId, human] of Object.entries(humanRatings)) {
    const score = byId.get(runId);
    if (!score || score.judgeOverallScore === null) continue;
    pairs.push({
      runId,
      surface: score.surfaceId,
      judge: score.judgeOverallScore * 4 + 1,
      human,
    });
  }

  const judge = pairs.map((p) => p.judge);
  const human = pairs.map((p) => p.human);
  const absErrors = pairs.map((p) => Math.abs(p.judge - p.human));

  const bySurface: AgreementReport["bySurface"] = {};
  for (const surface of new Set(pairs.map((p) => p.surface))) {
    const subset = pairs.filter((p) => p.surface === surface);
    bySurface[surface] = {
      n: subset.length,
      spearman: spearman(subset.map((p) => p.judge), subset.map((p) => p.human)),
      meanAbsoluteError: subset.reduce((s, p) => s + Math.abs(p.judge - p.human), 0) / (subset.length || 1),
    };
  }

  return {
    n: pairs.length,
    spearman: spearman(judge, human),
    pearson: pearson(judge, human),
    meanAbsoluteError: absErrors.length ? absErrors.reduce((s, v) => s + v, 0) / absErrors.length : 0,
    exactAgreement: pairs.length ? pairs.filter((p) => Math.round(p.judge) === p.human).length / pairs.length : 0,
    withinOne: pairs.length ? absErrors.filter((e) => e <= 1).length / pairs.length : 0,
    bySurface,
    note:
      pairs.length < 20
        ? "Fewer than 20 rated pairs: treat these as directional only."
        : "Per-surface agreement is the one to watch — a judge that agrees with people on one surface and not another would bias the headline result.",
  };
}
