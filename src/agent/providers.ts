/**
 * Cross-provider model resolution.
 *
 * Models are named `provider:modelId` — `anthropic:claude-opus-5`,
 * `google:<model-id>`, `openai:<model-id>`. One adapter instead of three SDKs.
 *
 * Two things this buys the study, beyond convenience:
 *
 * **One loop for every provider.** If Claude ran through the native Anthropic
 * loop and Gemini through a different one, any difference between them could
 * be the loop rather than the model. The cross-model comparison therefore runs
 * *every* model through `src/agent/aisdk-loop.ts`, Claude included, and
 * `docs/PREREGISTRATION.md` requires a cross-loop check on Claude to bound how
 * much the harness itself contributes.
 *
 * **A reasoning setting somebody else maintains.** Matching "effort" across
 * providers is the obvious validity hole — Claude has `effort`, others have
 * token budgets or their own enums, and any mapping invented here would be a
 * criticism vector. The AI SDK exposes one `reasoning` scale and each provider
 * maps it, so the mapping is documented and maintained upstream rather than
 * guessed at here.
 */

import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { Effort } from "./models.js";

export const PROVIDER_IDS = ["anthropic", "google", "openai"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** The AI SDK's provider-neutral reasoning scale. */
export type ReasoningLevel = "provider-default" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface Pricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadMultiplier: number;
  cacheWriteMultiplier: number;
}

export interface ResolvedModel {
  /** The full `provider:modelId` spec. */
  spec: string;
  provider: ProviderId;
  modelId: string;
  model: LanguageModel;
  /** Null when this model is not in the pricing table; cost is then unknown. */
  pricing: Pricing | null;
}

/**
 * Prices, in USD per million tokens.
 *
 * Only models whose prices have been checked are listed. An unlisted model
 * still runs — it is reported with `pricingKnown: false` and costed at zero,
 * which the report footnotes, rather than being silently priced wrong. Add
 * entries here from the provider's own pricing page; nothing infers them.
 */
export const PRICING: Record<string, Pricing> = {
  "anthropic:claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25, cacheReadMultiplier: 0.1, cacheWriteMultiplier: 1.25 },
  "anthropic:claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10, cacheReadMultiplier: 0.1, cacheWriteMultiplier: 1.25 },
  "anthropic:claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5, cacheReadMultiplier: 0.1, cacheWriteMultiplier: 1.25 },
};

/**
 * Environment variable each provider reads, so a missing key fails with
 * something useful instead of a 401 from three turns into a sweep.
 */
export const PROVIDER_ENV: Record<ProviderId, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY"],
  openai: ["OPENAI_API_KEY"],
};

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
  return PROVIDER_ENV[provider].some((name) => Boolean(process.env[name]));
}

const warned = new Set<string>();

export function resolveModel(spec: string): ResolvedModel {
  const { provider, modelId } = parseModelSpec(spec);

  const model: LanguageModel =
    provider === "anthropic" ? anthropic(modelId) : provider === "google" ? google(modelId) : openai(modelId);

  const pricing = PRICING[spec] ?? null;
  if (!pricing && !warned.has(spec)) {
    warned.add(spec);
    console.warn(
      `Note: no pricing for '${spec}', so its cost is reported as unknown. ` +
        `Add it to PRICING in src/agent/providers.ts to include it in cost comparisons.`,
    );
  }

  return { spec, provider, modelId, model, pricing };
}

/**
 * Map this project's effort levels onto the AI SDK's reasoning scale.
 *
 * They line up one-to-one except that the SDK also offers `minimal`, and that
 * `max` has no counterpart — `xhigh` is the top of the shared scale, so `max`
 * saturates there. Stated here rather than buried in the loop, because it is a
 * design decision the write-up has to defend.
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

/**
 * What `--models sweep` expands to on the `aisdk` runner: one model per Claude
 * tier, the AI SDK equivalent of `MODEL_SWEEP`.
 *
 * Deliberately *not* a cross-provider list, despite this runner existing for
 * the cross-provider check. Google's and OpenAI's model ids change on their own
 * schedule, and a shorthand that silently points at a retired id would fail a
 * sweep three turns in — or, worse, quietly run a different model than the
 * write-up claims. The cross-provider comparison therefore takes explicit ids:
 *
 *   npm run cli -- run --runner aisdk --models anthropic:claude-opus-5,google:<id>,openai:<id>
 *
 * Any spec runs; one missing from `PRICING` is costed as unknown and footnoted
 * in the report rather than silently costed wrong.
 */
export const CLAUDE_TIER_SWEEP = [
  "anthropic:claude-opus-5",
  "anthropic:claude-sonnet-5",
  "anthropic:claude-haiku-4-5",
];
