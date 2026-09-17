/**
 * Model registry: naming, resolution and pricing.
 *
 * Models are named `provider:modelId` — `anthropic:claude-opus-5`,
 * `google:<model-id>`, `openai:<model-id>` — and every one of them is reached
 * through the Vercel AI SDK. One name, one adapter, one loop: if Claude ran
 * through a hand-written Anthropic loop and Gemini through the SDK, any
 * difference between them could be the harness rather than the model.
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

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export function parseEffort(value: string): Effort {
  if ((EFFORTS as readonly string[]).includes(value)) return value as Effort;
  throw new Error(`Unknown effort '${value}'. Use one of: ${EFFORTS.join(", ")}.`);
}

export const PROVIDER_IDS = ["anthropic", "google", "openai"] as const;
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

const CACHE = { cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1 };

/** A model with no checked price: costed at zero, and flagged as such. */
function unpriced(id: string): ModelSpec {
  return { id, label: id, inputPerMTok: 0, outputPerMTok: 0, ...CACHE, priced: false };
}

type PriceEntry = Pick<ModelSpec, "label" | "inputPerMTok" | "outputPerMTok">;

function table(entries: Record<string, PriceEntry>): Record<string, ModelSpec> {
  return Object.fromEntries(
    Object.entries(entries).map(([id, entry]) => [id, { id, ...entry, ...CACHE, priced: true }]),
  );
}

/**
 * Extra models the operator names at run time, comma-separated:
 *
 *   CANVAS_EXTRA_MODELS='google:<model-id>,openai:<model-id>'
 *
 * The priced table below is Anthropic-only on purpose, for the reason
 * `MODEL_SWEEP` gives. But the table is not only a price list: it is also the
 * live page's model menu and the allowlist `/api/run` checks against. So on a
 * machine with a Google or OpenAI key and no Anthropic one, every model the
 * page can offer belongs to a provider that has no key — and a perfectly good
 * key reports as "no provider API key found" and drops to replay.
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
 * The priced table is spread last so that naming a listed model in
 * `CANVAS_EXTRA_MODELS` cannot quietly drop it to unpriced.
 */
export const MODELS: Record<string, ModelSpec> = {
  ...extraModels(),
  ...table({
    "anthropic:claude-opus-5": { label: "Opus 5", inputPerMTok: 5, outputPerMTok: 25 },
    "anthropic:claude-sonnet-5": { label: "Sonnet 5", inputPerMTok: 2, outputPerMTok: 10 },
    "anthropic:claude-haiku-4-5": { label: "Haiku 4.5", inputPerMTok: 1, outputPerMTok: 5 },
  }),
};

export const DEFAULT_MODEL = "anthropic:claude-opus-5";

/**
 * What `--models sweep` expands to: one model per Claude tier.
 *
 * Deliberately *not* a cross-provider list. Google's and OpenAI's model ids
 * change on their own schedule, and a shorthand that silently points at a
 * retired id would fail a sweep three turns in — or, worse, quietly run a
 * different model than the write-up claims. The cross-provider comparison
 * therefore takes explicit ids:
 *
 *   npm run cli -- run --models 'anthropic:claude-opus-5,google:<id>,openai:<id>'
 */
export const MODEL_SWEEP = [
  "anthropic:claude-opus-5",
  "anthropic:claude-sonnet-5",
  "anthropic:claude-haiku-4-5",
];

/**
 * Environment variable each provider reads, so a missing key fails with
 * something useful instead of a 401 from three turns into a sweep.
 *
 * This is also the list the credential is *taken* from — see
 * `credentialFor` — and the two cannot be allowed to drift. A variable that
 * `hasCredentials` accepts but the adapter does not read is the worst of both
 * worlds: the key reports as found, the run announces itself as live, and the
 * first request 401s. Two of the entries below are exactly that case, so none
 * of them is left to the adapter's own lookup:
 *
 *   - `GEMINI_API_KEY` is Google's own convention — its `genai` SDKs and the
 *     `gemini` CLI both read it — but the AI SDK adapter reads only
 *     `GOOGLE_GENERATIVE_AI_API_KEY`.
 *   - `ANTHROPIC_AUTH_TOKEN` is documented by the Anthropic adapter as an
 *     `authToken` default, but that adapter only reads the constructor
 *     argument; nothing falls back to the environment.
 */
export const PROVIDER_ENV: Record<ProviderId, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
  openai: ["OPENAI_API_KEY"],
};

/** A credential, and the variable it came from. */
export interface Credential {
  env: string;
  value: string;
}

/**
 * The credential a provider will actually be driven with: the first variable
 * in `PROVIDER_ENV` that is set, or null when none is.
 */
export function credentialFor(provider: ProviderId): Credential | null {
  for (const env of PROVIDER_ENV[provider]) {
    const value = process.env[env];
    if (value) return { env, value };
  }
  return null;
}

/** Providers that have a credential set, in registry order. */
export function credentialedProviders(): ProviderId[] {
  return PROVIDER_IDS.filter((p) => credentialFor(p) !== null);
}

export function parseModelSpec(spec: string): { provider: ProviderId; modelId: string } {
  const at = spec.indexOf(":");
  if (at < 1) {
    throw new Error(
      `Model '${spec}' is missing a provider. Use 'provider:model-id', for example ` +
        `anthropic:claude-opus-5, google:<model-id> or openai:<model-id>.`,
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
  return credentialFor(provider) !== null;
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
 * The credential is passed to the adapter rather than left to it, so that
 * every variable `PROVIDER_ENV` accepts is a variable that actually drives a
 * request. With nothing set, the adapter keeps its own lookup and raises its
 * own missing-key error, which names the variable it wanted — better than
 * anything this layer would say about an empty string.
 */
export function resolveLanguageModel(spec: string): LanguageModel {
  const { provider, modelId } = parseModelSpec(spec);
  const credential = credentialFor(provider);
  const auth = credential === null ? {} : { apiKey: credential.value };
  switch (provider) {
    case "anthropic":
      // An auth token goes in `Authorization: Bearer`, not `x-api-key`; the
      // adapter has a separate slot for it, and rejects both at once.
      return createAnthropic(
        credential?.env === "ANTHROPIC_AUTH_TOKEN" ? { authToken: credential.value } : auth,
      )(modelId);
    case "google":
      return createGoogleGenerativeAI(auth)(modelId);
    case "openai":
      return createOpenAI(auth)(modelId);
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
