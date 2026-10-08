import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { combineOrders, drawPairs, judgePair, tallyPairs, type PairCandidate } from "./pairwise.js";
import { mulberry32 } from "../runner/report.js";
import { getTask } from "../tasks/index.js";
import { SOLUTIONS } from "../tasks/solutions.js";

/** A judge that answers each call in turn from a list of verdicts. */
function judgeSaying(...verdicts: string[]): MockLanguageModelV4 {
  let i = 0;
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: "judge",
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify({ differences: "Because.", better: verdicts[i++] }) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 100, text: 100, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

describe("combining the two orders", () => {
  it("gives a page the pair only when it wins in both positions", () => {
    expect(combineOrders("first", "second")).toBe("a");
    expect(combineOrders("second", "first")).toBe("b");
    // Picking the same position both times is position bias, not a preference.
    expect(combineOrders("first", "first")).toBe("tie");
    expect(combineOrders("second", "second")).toBe("tie");
    expect(combineOrders("tie", "second")).toBe("tie");
  });
});

describe("judgePair", () => {
  const task = getTask("fit.long-headline");
  const input = (languageModel: MockLanguageModelV4) => ({
    brief: task.brief,
    initialDoc: task.initial(),
    a: SOLUTIONS[task.id]!(),
    b: task.initial(),
    model: "anthropic:claude-sonnet-5-5",
    languageModel,
  });

  it("asks twice with the order swapped, and bills both calls", async () => {
    const model = judgeSaying("first", "second");
    const result = await judgePair(input(model));
    expect(result.error).toBeUndefined();
    expect(result.winner).toBe("a");
    expect(result.verdicts).toEqual(["first", "second"]);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(result.usage.input).toBe(2000);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("shows the brief, the starting layout and both pages — and nothing about the runs", async () => {
    const model = judgeSaying("tie", "tie");
    await judgePair(input(model));
    const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt);
    expect(prompt).toContain(task.brief.slice(0, 40));
    expect(prompt.match(/"type":"file"/g)).toHaveLength(3);
    // Image bytes stripped first: base64 spells short words by chance.
    const text = prompt.replace(/"data":"[A-Za-z0-9+/=]{200,}"/g, '"data":""');
    expect(text).not.toMatch(/coordinate|relational|feedback|screenshot condition|turns|opus|sonnet|gpt/i);
  });

  it("reports an error rather than a winner when the judge answers nothing usable", async () => {
    const result = await judgePair(input(judgeSaying("neither", "neither")));
    expect(result.error).toBeTruthy();
    expect(result.winner).toBe("tie");
  });
});

describe("drawing pairs", () => {
  const runs: PairCandidate[] = [
    ...["x1", "x2", "x3"].map((id) => ({ runId: `t1-${id}`, taskId: "t1", group: "x" })),
    ...["y1", "y2"].map((id) => ({ runId: `t1-${id}`, taskId: "t1", group: "y" })),
    { runId: "t2-x", taskId: "t2", group: "x" },
    { runId: "t2-x2", taskId: "t2", group: "x" },
  ];

  it("pairs only runs of the same task from different groups, at most n per task", () => {
    const pairs = drawPairs(runs, 4, mulberry32(1));
    expect(pairs).toHaveLength(4);
    for (const p of pairs) {
      expect(p.a.taskId).toBe(p.taskId);
      expect(p.b.taskId).toBe(p.taskId);
      expect(p.a.group).not.toBe(p.b.group);
    }
    // t2 has a single group, so it contributes nothing.
    expect(pairs.every((p) => p.taskId === "t1")).toBe(true);
    // Six cross-group pairs exist in t1; asking for more takes them all once.
    expect(new Set(drawPairs(runs, 99, mulberry32(1)).map((p) => p.id)).size).toBe(6);
  });

  it("draws the same pairs from the same seed, so a comparison resumes", () => {
    expect(drawPairs(runs, 3, mulberry32(7)).map((p) => p.id)).toEqual(drawPairs(runs, 3, mulberry32(7)).map((p) => p.id));
  });
});

describe("tallying", () => {
  it("counts a tie as half a win and leaves errored pairs out", () => {
    const tally = tallyPairs([
      { a: "x", b: "y", winner: "a" },
      { a: "y", b: "x", winner: "b" },
      { a: "x", b: "y", winner: "tie" },
      { a: "x", b: "y", winner: "b", error: "failed" },
    ]);
    expect(tally[0]).toEqual({ group: "x", wins: 2, losses: 0, ties: 1, winRate: 2.5 / 3 });
    expect(tally[1]).toEqual({ group: "y", wins: 0, losses: 2, ties: 1, winRate: 0.5 / 3 });
  });
});
