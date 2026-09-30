/**
 * Price table for `usage.report` — USD per million tokens, keyed by model id
 * exactly as it appears in config.ai.models. Diffable data, not code: update
 * the row when the operator confirms a rate change. A model missing from the
 * table contributes zero cost — spend gaps stay visible through the report's
 * counters instead of being guessed.
 */
export type ModelRates = {
  inputUsdPerMToken: number;
  outputUsdPerMToken: number;
};

export const PRICE_PER_MTOKEN_USD: Record<string, ModelRates> = {
  // Chat: glm-5.3-flash via Z.ai coding endpoint (config.ai.models.chat).
  "glm-5.3-flash": { inputUsdPerMToken: 0.6, outputUsdPerMToken: 2.2 },
  // Embeddings: gemini-embedding-2 has no output tokens.
  "gemini-embedding-2": { inputUsdPerMToken: 0.15, outputUsdPerMToken: 0 },
};

/** Billed cost of one call (or one aggregate bucket), USD. */
export const estimateCostUsd = (
  model: string,
  promptTokens: number,
  completionTokens: number,
): number => {
  const rates = PRICE_PER_MTOKEN_USD[model];
  if (!rates) {
    return 0;
  }
  return (
    (promptTokens / 1_000_000) * rates.inputUsdPerMToken +
    (completionTokens / 1_000_000) * rates.outputUsdPerMToken
  );
};
