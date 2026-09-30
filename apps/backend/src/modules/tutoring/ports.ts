import type { Result } from "@/modules/platform/result";

/**
 * AI transport port. The port is deliberately narrow (prompt in, JSON text /
 * embeddings out): all prompt-building, response parsing, retrieval policy
 * and persistence live in tutoring domain/application, where they can later
 * be expressed as Effect programs with retries and timeouts around this port.
 */
export type JsonGenerationRequest = {
  schemaName: string;
  responseSchema: Record<string, unknown>;
};
export type JsonGenerationInput = {
  /** Persistent role/persona for the model (system message). */
  system: string;
  /** Task-specific content (user message). */
  prompt: string;
};

/** Free-text (non-JSON) generation — conversational answers, prose output. */
export type TextGenerationInput = {
  /** Persistent role/persona for the model (system message). */
  system: string;
  /** Task-specific content (user message). */
  prompt: string;
};

/**
 * Token usage as reported by the OpenAI-compatible endpoints. Optional:
 * degrade-never-hang means an adapter that cannot read usage simply omits it.
 */
export type AiUsage = {
  promptTokens: number;
  completionTokens: number;
};

/** One batched embedding call reports a single prompt-token count. */
export type AiEmbeddingUsage = {
  tokens: number;
};

export type TextGenerationResult = {
  /** Raw model output, whitespace-trimmed by the adapter. */
  raw: string;
  /** Billed token usage for this call, when the endpoint reports it. */
  usage?: AiUsage;
};

export type JsonGenerationResult = {
  /** Raw model output, post JSON-extraction. */
  raw: string;
  /** Billed token usage for this call, when the endpoint reports it. */
  usage?: AiUsage;
};

export type EmbeddingGenerationResult = {
  embeddings: number[][];
  /** Billed token usage for the whole batch, when the endpoint reports it. */
  usage?: AiEmbeddingUsage;
};

export type AiError = {
  kind: "AiGenerationFailed";
  detail?: string;
} | {
  kind: "AiResponseInvalid";
  detail?: string;
};

export type AiPort = {
  generateJson(
    input: JsonGenerationInput,
    request: JsonGenerationRequest,
  ): Promise<Result<JsonGenerationResult, AiError>>;
  generateText(
    input: TextGenerationInput,
  ): Promise<Result<TextGenerationResult, AiError>>;
  generateEmbeddings(
    content: string[],
  ): Promise<Result<EmbeddingGenerationResult, AiError>>;
};
