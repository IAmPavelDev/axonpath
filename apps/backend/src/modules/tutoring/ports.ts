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

export type JsonGenerationResult = {
  /** Raw model output, post JSON-extraction. */
  raw: string;
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
  generateEmbeddings(
    content: string[],
  ): Promise<Result<number[][], AiError>>;
};
