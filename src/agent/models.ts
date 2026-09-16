/**
 * Model registry.
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

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelSpec {
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
  contextWindow: number;
  /** `output_config.effort` is accepted. */
  supportsEffort: boolean;
  /**
   * How to ask for thinking. "adaptive" takes `{type:"adaptive"}`;
   * "budget" is the older `{type:"enabled", budget_tokens}` form.
   */
  thinking: "adaptive" | "budget";
}

const DEFAULTS = { cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.1 };

export const MODELS: Record<string, ModelSpec> = {
  "claude-opus-5": {
    id: "claude-opus-5",
    label: "Opus 5",
    inputPerMTok: 5,
    outputPerMTok: 25,
    contextWindow: 1_000_000,
    supportsEffort: true,
    thinking: "adaptive",
    ...DEFAULTS,
  },
  "claude-sonnet-5": {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    inputPerMTok: 2,
    outputPerMTok: 10,
    contextWindow: 1_000_000,
    supportsEffort: true,
    thinking: "adaptive",
    ...DEFAULTS,
  },
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    inputPerMTok: 1,
    outputPerMTok: 5,
    contextWindow: 200_000,
    supportsEffort: false,
    thinking: "budget",
    ...DEFAULTS,
  },
};

export const DEFAULT_MODEL = "claude-opus-5";

/** The sweep in week four: one model per tier. */
export const MODEL_SWEEP = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"];

export function getModel(id: string): ModelSpec {
  const spec = MODELS[id];
  if (spec) return spec;
  // An unknown id is usually a model newer than this table. Run it, but cost
  // it at zero and say so, rather than refusing or inventing a price.
  return {
    id,
    label: id,
    inputPerMTok: 0,
    outputPerMTok: 0,
    contextWindow: 200_000,
    supportsEffort: false,
    thinking: "adaptive",
    ...DEFAULTS,
  };
}

export function isKnownModel(id: string): boolean {
  return id in MODELS;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const ZERO_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

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
