import { describe, expect, it } from "vitest";
import {
  MODELS,
  addUsage,
  costUsd,
  getModel,
  parseEffort,
  parseModelSpec,
  reasoningFor,
  resolveLanguageModel,
  tokenUsage,
  ZERO_USAGE,
} from "./models.js";

describe("model specs", () => {
  it("parses provider:model specs", () => {
    expect(parseModelSpec("anthropic:claude-opus-5")).toEqual({
      provider: "anthropic",
      modelId: "claude-opus-5",
    });
    expect(parseModelSpec("google:some-model-id").provider).toBe("google");
    // A model id containing a colon survives.
    expect(parseModelSpec("openai:gpt:weird").modelId).toBe("gpt:weird");
  });

  it("refuses a spec with no provider", () => {
    expect(() => parseModelSpec("claude-opus-5")).toThrow(/missing a provider/);
    expect(() => parseModelSpec(":model")).toThrow(/missing a provider/);
  });

  it("refuses an unknown provider and an empty model id", () => {
    expect(() => parseModelSpec("acme:thing")).toThrow(/Unknown provider/);
    expect(() => parseModelSpec("openai:")).toThrow(/empty model id/);
  });

  it("resolves a model for every known provider", () => {
    for (const spec of ["anthropic:claude-opus-5", "google:some-model", "openai:some-model"]) {
      expect(resolveLanguageModel(spec)).toBeTruthy();
    }
  });

  it("every listed model names a provider it can be resolved through", () => {
    for (const id of Object.keys(MODELS)) expect(resolveLanguageModel(id)).toBeTruthy();
  });
});

describe("pricing", () => {
  it("prices a listed model", () => {
    const spec = getModel("anthropic:claude-opus-5");
    expect(spec.priced).toBe(true);
    expect(costUsd({ input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0 }, spec)).toBeCloseTo(5, 9);
    expect(costUsd({ input: 0, output: 1e6, cacheRead: 0, cacheWrite: 0 }, spec)).toBeCloseTo(25, 9);
    // Cache reads a tenth of the input rate, writes a quarter more than it.
    expect(costUsd({ input: 0, output: 0, cacheRead: 1e6, cacheWrite: 0 }, spec)).toBeCloseTo(0.5, 9);
    expect(costUsd({ input: 0, output: 0, cacheRead: 0, cacheWrite: 1e6 }, spec)).toBeCloseTo(6.25, 9);
  });

  // An unpriced model still runs. Costing it at zero and saying so is honest;
  // inventing a price is not, and refusing it would block every new model.
  it("costs an unlisted model at zero and says pricing is unknown", () => {
    const spec = getModel("google:not-in-the-table");
    expect(spec.priced).toBe(false);
    expect(costUsd({ input: 1e6, output: 1e6, cacheRead: 0, cacheWrite: 0 }, spec)).toBe(0);
  });

  // A dry run and a test name no real provider at all, and must not throw.
  it("tolerates a spec that names no known provider", () => {
    expect(getModel("scripted").priced).toBe(false);
  });
});

describe("usage accounting", () => {
  it("keeps cached input apart from input billed at full rate", () => {
    expect(
      tokenUsage({
        inputTokens: 1200,
        outputTokens: 50,
        inputTokenDetails: { noCacheTokens: 900, cacheReadTokens: 200, cacheWriteTokens: 100 },
      }),
    ).toEqual({ input: 900, output: 50, cacheRead: 200, cacheWrite: 100 });
  });

  it("falls back to the total when a provider reports no breakdown", () => {
    expect(tokenUsage({ inputTokens: 1200, outputTokens: 50 })).toEqual({
      input: 1200,
      output: 50,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it("adds usage across turns", () => {
    const one = addUsage(ZERO_USAGE, { input: 10, output: 2 });
    expect(addUsage(one, { input: 5, cacheRead: 3 })).toEqual({
      input: 15,
      output: 2,
      cacheRead: 3,
      cacheWrite: 0,
    });
  });
});

describe("effort", () => {
  it("maps onto the SDK's provider-neutral reasoning scale", () => {
    expect(reasoningFor("low")).toBe("low");
    expect(reasoningFor("medium")).toBe("medium");
    expect(reasoningFor("high")).toBe("high");
    // `max` has no counterpart, so it saturates at the top of the shared scale.
    expect(reasoningFor("max")).toBe("xhigh");
    expect(reasoningFor("xhigh")).toBe("xhigh");
    expect(reasoningFor(null)).toBe("provider-default");
  });

  // A typo'd --effort used to reach the API and fail the whole sweep on its
  // first request.
  it("refuses a level nobody defined", () => {
    expect(parseEffort("high")).toBe("high");
    expect(() => parseEffort("highest")).toThrow(/Unknown effort/);
  });
});
