import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
import {
  MODELS,
  PROVIDER_ENV,
  PROVIDER_IDS,
  addUsage,
  costUsd,
  credentialFor,
  credentialedProviders,
  getModel,
  hasCredentials,
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

  // Falling straight back to the total would bill the cached part twice: at the
  // full input rate inside the total, and again at the cache rate.
  it("derives uncached input when a provider reports only the total", () => {
    expect(
      tokenUsage({
        inputTokens: 1200,
        outputTokens: 50,
        inputTokenDetails: { cacheReadTokens: 200, cacheWriteTokens: 100 },
      }),
    ).toEqual({ input: 900, output: 50, cacheRead: 200, cacheWrite: 100 });
  });

  it("never reports negative input, however a provider adds up", () => {
    expect(tokenUsage({ inputTokens: 100, inputTokenDetails: { cacheReadTokens: 500 } }).input).toBe(0);
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

/**
 * Every variable in `PROVIDER_ENV`, with nothing else set. The suite inherits
 * the operator's real environment, and a key sitting in it would otherwise
 * decide these results.
 */
function onlySet(name: string, value: string): void {
  for (const names of Object.values(PROVIDER_ENV)) {
    for (const env of names) vi.stubEnv(env, undefined);
  }
  vi.stubEnv(name, value);
}

/** The auth headers the first request would actually carry. */
async function authHeaders(spec: string): Promise<Record<string, string>> {
  let seen: Headers | null = null;
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    seen = new Headers(init?.headers ?? {});
    return new Response(JSON.stringify({ error: { message: "stubbed" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  });
  await generateText({ model: resolveLanguageModel(spec), prompt: "hi" }).catch(() => {});
  if (seen === null) throw new Error(`No request was sent for '${spec}'.`);
  return Object.fromEntries(
    [...(seen as Headers).entries()].filter(([k]) => /key|authorization/i.test(k)),
  );
}

describe("credentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // The reported bug: `GEMINI_API_KEY` is what Google's own genai SDKs and
  // the `gemini` CLI read, and a machine that had one still reported "no
  // provider API key found".
  it("accepts GEMINI_API_KEY for google", () => {
    onlySet("GEMINI_API_KEY", "k");
    expect(hasCredentials("google")).toBe(true);
    expect(credentialFor("google")).toEqual({ env: "GEMINI_API_KEY", value: "k" });
    expect(credentialedProviders()).toEqual(["google"]);
  });

  it("prefers the adapter's own variable when both are set", () => {
    onlySet("GOOGLE_GENERATIVE_AI_API_KEY", "native");
    vi.stubEnv("GEMINI_API_KEY", "alias");
    expect(credentialFor("google")?.value).toBe("native");
  });

  it("reports no credential when nothing is set", () => {
    onlySet("GEMINI_API_KEY", "");
    for (const provider of PROVIDER_IDS) {
      expect(credentialFor(provider)).toBeNull();
      expect(hasCredentials(provider)).toBe(false);
    }
    expect(credentialedProviders()).toEqual([]);
  });

  /**
   * The drift guard, and the reason this file resolves credentials itself.
   *
   * `hasCredentials` reading a wider list than the adapter does is worse than
   * not reading it at all: the key reports as found, the run says it is live,
   * and the first request 401s. So every variable the check accepts has to
   * reach a request header. Both alias entries — `GEMINI_API_KEY` and
   * `ANTHROPIC_AUTH_TOKEN` — failed this before.
   */
  describe("every accepted variable reaches the request", () => {
    for (const provider of PROVIDER_IDS) {
      for (const env of PROVIDER_ENV[provider]) {
        it(`${env} authenticates ${provider}`, async () => {
          const secret = `secret-via-${env}`;
          onlySet(env, secret);
          const headers = await authHeaders(`${provider}:some-model-id`);
          // Which header and which scheme is the adapter's business — an
          // `x-api-key`, an `x-goog-api-key` or a bearer token. That the
          // secret is in one of them at all is this layer's business.
          expect(Object.values(headers).some((v) => v.includes(secret))).toBe(true);
        });
      }
    }
  });
});

describe("operator-named models", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function reload(extra: string | undefined) {
    vi.resetModules();
    vi.stubEnv("CANVAS_EXTRA_MODELS", extra);
    return import("./models.js");
  }

  // Without this, a machine holding only a Google or OpenAI key has no model
  // on the page's list that its key can drive, so the key is unusable.
  it("adds a named model to the registry, unpriced", async () => {
    const { MODELS: withExtra, getModel: get } = await reload("google:some-gemini-id");
    expect(Object.hasOwn(withExtra, "google:some-gemini-id")).toBe(true);
    expect(get("google:some-gemini-id").priced).toBe(false);
  });

  it("keeps the checked price when an extra names a listed model", async () => {
    const { getModel: get } = await reload("anthropic:claude-opus-5");
    expect(get("anthropic:claude-opus-5").priced).toBe(true);
    expect(get("anthropic:claude-opus-5").inputPerMTok).toBe(5);
  });

  it("leaves the registry alone when unset, and tolerates stray commas", async () => {
    const { MODELS: bare } = await reload(undefined);
    // Spelled out rather than compared against the imported `MODELS`, which
    // would already carry extras on a machine that has the variable set.
    expect(Object.keys(bare)).toEqual([
      "anthropic:claude-opus-5",
      "anthropic:claude-sonnet-5",
      "anthropic:claude-haiku-4-5",
    ]);
    const { MODELS: spaced } = await reload(" google:a , , openai:b ");
    expect(Object.hasOwn(spaced, "google:a")).toBe(true);
    expect(Object.hasOwn(spaced, "openai:b")).toBe(true);
  });

  // A typo here would otherwise surface as a 400 from the page, long after
  // the operator set it.
  it("refuses a malformed entry at startup, naming the variable", async () => {
    await expect(reload("gemini-2.5-pro")).rejects.toThrow(
      /CANVAS_EXTRA_MODELS lists 'gemini-2.5-pro'.*missing a provider/s,
    );
  });
});
