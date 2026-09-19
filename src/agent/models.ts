/**
 * Model registry: naming, resolution and pricing.
 *
 * Models are named `provider:modelId` — `anthropic:claude-opus-5`,
 * `google:gemini-3.8-flash`, `togetherai:deepseek-ai/DeepSeek-V4.1-Flash` — and
 * every one of them is reached through the Vercel AI SDK. One name, one
 * adapter, one loop: if Claude ran through a hand-written Anthropic loop and
 * Gemini through the SDK, any difference between them could be the harness
 * rather than the model. Only the first colon splits the name, so a provider
 * whose own ids contain slashes and colons still fits.
 *
 * Pricing lives here so every run carries a cost, not just a score. Cost is
 * not a footnote in this study: document-as-code spends few turns and many
 * tokens per turn, the incremental surfaces do the reverse, and a result that
 * ignores that is only half an answer. "Which surface wins per dollar" is a
 * different question from "which surface wins", and both get reported.
 *
 * Note on determinism: `temperature` was removed from the current models, so
 * runs cannot be pinned to a fixed sample. Variance is handled by repeating
 * each cell instead — see `docs/PREREGISTRATION.md`.
 */

import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { togetherai } from "@ai-sdk/togetherai";
import { xai } from "@ai-sdk/xai";
import { zai } from "@ai-sdk/zai";
import type { LanguageModel } from "ai";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export function parseEffort(value: string): Effort {
  if ((EFFORTS as readonly string[]).includes(value)) return value as Effort;
  throw new Error(`Unknown effort '${value}'. Use one of: ${EFFORTS.join(", ")}.`);
}

export const PROVIDER_IDS = ["anthropic", "google", "openai", "xai", "zai", "togetherai"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** The AI SDK's provider-neutral reasoning scale. */
export type ReasoningLevel = "provider-default" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ModelSpec {
  /** The full `provider:modelId` spec. */
  id: string;
  label: string;
  /** USD per million input tokens. */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
  /** Cache writes cost this multiple of the input rate. */
  cacheWriteMultiplier: number;
  /** Cache reads cost this multiple of the input rate. */
  cacheReadMultiplier: number;
  /** False when the id is absent from the table; cost is then 0 and meaningless. */
  priced: boolean;
}

/**
 * What it costs to *create* a cache entry, as a multiple of the input rate.
 *
 * A provider-level billing model rather than a per-model rate. Anthropic
 * charges a surcharge to write a prompt-cache entry; the others here cache
 * implicitly at no write cost, or bill cache storage by the hour, which a
 * per-request token count cannot express either way. Stated per provider
 * because a single hard-coded pair used to apply Anthropic's surcharge to
 * every model in the table — harmless while the table was Anthropic-only, and
 * wrong the moment it was not.
 */
const CACHE_WRITE_MULTIPLIER: Record<ProviderId, number> = {
  anthropic: 1.25,
  google: 0,
  openai: 0,
  xai: 0,
  zai: 0,
  togetherai: 0,
};

/**
 * A model with no checked price: costed at zero, and flagged as such. The
 * cache multipliers are zero for the same reason the rates are — there is
 * nothing to be a multiple of.
 */
function unpriced(id: string): ModelSpec {
  return {
    id,
    label: id,
    inputPerMTok: 0,
    outputPerMTok: 0,
    cacheWriteMultiplier: 0,
    cacheReadMultiplier: 0,
    priced: false,
  };
}

type PriceEntry = Pick<ModelSpec, "label" | "inputPerMTok" | "outputPerMTok"> & {
  /**
   * USD per million tokens read back from cache, exactly as the provider's
   * pricing page states it — that is the number published, and deriving the
   * multiple here keeps the table checkable line by line against the page.
   * Omitted when a provider publishes no cached rate, which is costed as no
   * discount: it overstates spend rather than understating it.
   */
  cachedInputPerMTok?: number;
};

function table(entries: Record<string, PriceEntry>): Record<string, ModelSpec> {
  return Object.fromEntries(
    Object.entries(entries).map(([id, entry]) => {
      const { cachedInputPerMTok, ...rest } = entry;
      const { provider } = parseModelSpec(id);
      return [
        id,
        {
          id,
          ...rest,
          cacheWriteMultiplier: CACHE_WRITE_MULTIPLIER[provider],
          cacheReadMultiplier:
            cachedInputPerMTok !== undefined && rest.inputPerMTok > 0
              ? cachedInputPerMTok / rest.inputPerMTok
              : 1,
          priced: true,
        },
      ];
    }),
  );
}

/**
 * Extra models the operator names at run time, comma-separated:
 *
 *   CANVAS_EXTRA_MODELS='google:<model-id>,openai:<model-id>'
 *
 * The table below is not only a price list: it is also the live page's model
 * menu and the allowlist `/api/run` checks against. A model it has never heard
 * of is therefore unreachable, however good the key sitting in the
 * environment — and provider ids move faster than this file does.
 *
 * Naming the id here fixes that without this file guessing one: the operator
 * knows which id is current, and the allowlist stays operator-controlled
 * rather than caller-controlled. Extras are unpriced, so their runs cost zero
 * and say so — add a checked price to the table to cost them for real.
 */
export const EXTRA_MODELS_ENV = "CANVAS_EXTRA_MODELS";

function extraModels(): Record<string, ModelSpec> {
  const raw = process.env[EXTRA_MODELS_ENV];
  if (!raw) return {};
  const out: Record<string, ModelSpec> = {};
  for (const spec of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    try {
      parseModelSpec(spec);
    } catch (err) {
      throw new Error(
        `${EXTRA_MODELS_ENV} lists '${spec}', which is not a usable model spec: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
    out[spec] = unpriced(spec);
  }
  return out;
}

/**
 * Prices, in USD per million tokens.
 *
 * Only models whose prices have been checked are listed. An unlisted model
 * still runs — it is reported with `pricingKnown: false` and costed at zero,
 * which the report footnotes, rather than being silently priced wrong. Add
 * entries here from the provider's own pricing page; nothing infers them.
 *
 * Two entries are priced by prompt length, and both are listed at their
 * short-context tier: `google:gemini-3.1-pro-preview` and `xai:grok-4.6`
 * charge double above 200k input tokens. A run here is a brief, a document and
 * at most a few dozen screenshots, so it sits well inside that tier — but a
 * task set with far longer context would need the other rate.
 *
 * `openai:gpt-5.6-sol` is listed at a promotional rate the page dates to
 * November 2026. It is the one entry here with a known expiry.
 *
 * The priced table is spread last so that naming a listed model in
 * `CANVAS_EXTRA_MODELS` cannot quietly drop it to unpriced.
 */
export const MODELS: Record<string, ModelSpec> = {
  ...extraModels(),
  ...table({
    "anthropic:claude-opus-5": { label: "Opus 5", inputPerMTok: 5, cachedInputPerMTok: 0.5, outputPerMTok: 25 },
    "anthropic:claude-sonnet-5": { label: "Sonnet 5", inputPerMTok: 2, cachedInputPerMTok: 0.2, outputPerMTok: 10 },
    "anthropic:claude-haiku-4-5": { label: "Haiku 4.5", inputPerMTok: 1, cachedInputPerMTok: 0.1, outputPerMTok: 5 },

    "google:gemini-3.8-flash": { label: "Gemini 3.8 Flash", inputPerMTok: 0.75, cachedInputPerMTok: 0.075, outputPerMTok: 3.75 },
    "google:gemini-3.7-flash": { label: "Gemini 3.7 Flash", inputPerMTok: 0.75, cachedInputPerMTok: 0.075, outputPerMTok: 3.75 },
    "google:gemini-3.1-pro-preview": { label: "Gemini 3.1 Pro", inputPerMTok: 2, cachedInputPerMTok: 0.2, outputPerMTok: 12 },

    "openai:gpt-5.6-sol": { label: "GPT-5.6 Sol", inputPerMTok: 4, cachedInputPerMTok: 0.4, outputPerMTok: 20 },
    "openai:gpt-5.6-terra": { label: "GPT-5.6 Terra", inputPerMTok: 2, cachedInputPerMTok: 0.2, outputPerMTok: 12 },
    "openai:gpt-5.6-luna": { label: "GPT-5.6 Luna", inputPerMTok: 0.2, cachedInputPerMTok: 0.02, outputPerMTok: 1.2 },

    "xai:grok-4.6": { label: "Grok 4.6", inputPerMTok: 2, cachedInputPerMTok: 0.5, outputPerMTok: 6 },

    "zai:glm-5.3": { label: "GLM-5.3", inputPerMTok: 1.4, cachedInputPerMTok: 0.26, outputPerMTok: 4.4 },

    // Together publishes no cached-input rate for its serverless endpoints, so
    // this one is costed with no cache discount.
    "togetherai:deepseek-ai/DeepSeek-V4.1-Flash": {
      label: "DeepSeek V4.1 Flash",
      inputPerMTok: 0.3,
      outputPerMTok: 1.2,
    },
  }),
};

/**
 * How many times a request is retried before the turn is given up as an
 * `api_error`.
 *
 * The SDK's default is two, with delays of two and four seconds, which is the
 * right default for an interactive call and the wrong one for a sweep: at
 * twelve workers against one provider a rate limit is a matter of when, and a
 * cell that dies six seconds into a 429 burst forfeits every turn it had
 * already paid for and goes back in the queue to pay for them again. Six
 * retries back off to just over two minutes in total, and the SDK honours a
 * `retry-after` header inside that, so a burst is waited out rather than
 * turned into attrition. Only retryable failures are retried — 408, 409, 429
 * and 5xx — so a bad key or a malformed request still fails at once.
 *
 * Shared with the judge, whose one call per cell lands on the same provider at
 * the same moment the sweep's other workers do.
 */
export const MAX_RETRIES = 6;

export const DEFAULT_MODEL = "anthropic:claude-opus-5";

/**
 * What `--models sweep` expands to: one model per Claude tier.
 *
 * A capability ladder inside one family, which is the comparison that isolates
 * "does a weaker model need a better tool surface?" from every other way two
 * models differ. Kept as its own shorthand now that `--models all` exists,
 * because the two answer different questions and the full registry is a much
 * larger bill.
 */
export const MODEL_SWEEP = [
  "anthropic:claude-opus-5",
  "anthropic:claude-sonnet-5",
  "anthropic:claude-haiku-4-5",
];

/** Every model in the registry, in table order. What `--models all` expands to. */
export function allModels(): string[] {
  return Object.keys(MODELS);
}

/**
 * Every registry model whose provider has a key set here.
 *
 * `--models all` on a machine with one key is a sweep that dies on its first
 * cell; this is the same list narrowed to what can actually run, which is what
 * anyone wants from a leaderboard on a laptop with two keys in the shell.
 */
export function runnableModels(): string[] {
  return allModels().filter((id) => hasCredentials(parseModelSpec(id).provider));
}

/**
 * Environment variable each provider reads, so a missing key fails with
 * something useful instead of a 401 from three turns into a sweep.
 *
 * Exactly the variable the AI SDK adapter reads, one per provider, because
 * the adapter is what actually authenticates: it resolves the key itself, per
 * request, from this name alone. Anything else listed here would be checked
 * and then ignored — the key would report as found, the run would announce
 * itself as live, and the first request would 401. So an alias such as
 * Google's own `GEMINI_API_KEY` is deliberately *not* accepted; point the
 * variable below at it instead. `models.test.ts` holds the adapters to this.
 */
export const PROVIDER_ENV: Record<ProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  openai: "OPENAI_API_KEY",
  xai: "XAI_API_KEY",
  zai: "ZAI_API_KEY",
  // Not `TOGETHER_AI_API_KEY`: the adapter still reads that one, but warns
  // that it is deprecated, and this list has to name what it prefers.
  togetherai: "TOGETHER_API_KEY",
};

export function parseModelSpec(spec: string): { provider: ProviderId; modelId: string } {
  const at = spec.indexOf(":");
  if (at < 1) {
    throw new Error(
      `Model '${spec}' is missing a provider. Use 'provider:model-id', for example ` +
        `anthropic:claude-opus-5, google:gemini-3.8-flash or xai:grok-4.6. ` +
        `Known providers: ${PROVIDER_IDS.join(", ")}.`,
    );
  }
  const provider = spec.slice(0, at) as ProviderId;
  const modelId = spec.slice(at + 1);
  if (!PROVIDER_IDS.includes(provider)) {
    throw new Error(`Unknown provider '${provider}'. Known: ${PROVIDER_IDS.join(", ")}.`);
  }
  if (!modelId) throw new Error(`Model '${spec}' has an empty model id.`);
  return { provider, modelId };
}

export function hasCredentials(provider: ProviderId): boolean {
  return Boolean(process.env[PROVIDER_ENV[provider]]);
}

/** Providers that have a key set, in registry order. */
export function credentialedProviders(): ProviderId[] {
  return PROVIDER_IDS.filter(hasCredentials);
}

/**
 * Pricing for a model spec.
 *
 * Never throws. An id this table has never heard of is usually a model newer
 * than the table, and a run against an injected model (a replay, a dry run, a
 * test) names no real provider at all. Both are costed at zero and say so,
 * rather than being refused or invented a price for.
 */
export function getModel(id: string): ModelSpec {
  return MODELS[id] ?? unpriced(id);
}

/**
 * The language model behind a spec. Throws when the provider is unknown.
 *
 * Authentication is left entirely to the adapter, which reads
 * `PROVIDER_ENV`'s variable itself and raises its own missing-key error
 * naming it.
 */
export function resolveLanguageModel(spec: string): LanguageModel {
  const { provider, modelId } = parseModelSpec(spec);
  switch (provider) {
    case "anthropic":
      return anthropic(modelId);
    case "google":
      return google(modelId);
    case "openai":
      return openai(modelId);
    case "xai":
      return xai(modelId);
    case "zai":
      return zai(modelId);
    case "togetherai":
      return togetherai(modelId);
  }
}

/**
 * Map this project's effort levels onto the AI SDK's reasoning scale.
 *
 * Matching "effort" across providers is the obvious validity hole — Claude has
 * `effort`, others have token budgets or their own enums, and any mapping
 * invented here would be a criticism vector. The SDK exposes one `reasoning`
 * scale and each provider maps it, so the mapping is documented and maintained
 * upstream. The two scales line up one-to-one except that the SDK also offers
 * `minimal`, and that `max` has no counterpart — `xhigh` is the top of the
 * shared scale, so `max` saturates there. Stated here rather than buried in
 * the loop, because it is a design decision the write-up has to defend.
 */
export function reasoningFor(effort: Effort | null): ReasoningLevel {
  switch (effort) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "xhigh":
    case "max":
      return "xhigh";
    default:
      return "provider-default";
  }
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const ZERO_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** The part of the SDK's usage report that pricing depends on. */
export interface UsageReport {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  inputTokenDetails?: {
    noCacheTokens?: number | undefined;
    cacheReadTokens?: number | undefined;
    cacheWriteTokens?: number | undefined;
  };
}

/**
 * A usage report reduced to the four numbers the cost table prices.
 *
 * `inputTokens` is the total; `noCacheTokens` is the part actually billed at
 * the full input rate, and cached reads and writes are billed at their own
 * multiples — so they are tracked apart rather than summed.
 */
export function tokenUsage(usage: UsageReport): TokenUsage {
  const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  return {
    // Falling straight back to the total would bill the cached tokens twice —
    // once at the full input rate inside the total, and again at their own
    // rate below. The three providers here all report `noCacheTokens`; a model
    // adapted from an older spec version may report only the total.
    input:
      usage.inputTokenDetails?.noCacheTokens ??
      Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite),
    output: usage.outputTokens ?? 0,
    cacheRead,
    cacheWrite,
  };
}

export function addUsage(a: TokenUsage, b: Partial<TokenUsage>): TokenUsage {
  return {
    input: a.input + (b.input ?? 0),
    output: a.output + (b.output ?? 0),
    cacheRead: a.cacheRead + (b.cacheRead ?? 0),
    cacheWrite: a.cacheWrite + (b.cacheWrite ?? 0),
  };
}

export function costUsd(usage: TokenUsage, spec: ModelSpec): number {
  const m = 1e-6;
  return (
    usage.input * spec.inputPerMTok * m +
    usage.output * spec.outputPerMTok * m +
    usage.cacheWrite * spec.inputPerMTok * spec.cacheWriteMultiplier * m +
    usage.cacheRead * spec.inputPerMTok * spec.cacheReadMultiplier * m
  );
}
