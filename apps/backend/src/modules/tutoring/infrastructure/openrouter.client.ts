import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import { config } from "@/modules/platform/config";
import { err, ok, type Result } from "@/modules/platform/result";
import type {
  AiError,
  AiPort,
} from "@/modules/tutoring/ports";

const CHAT_MODEL = config.ai.models.chat;
const EMBEDDING_MODEL = config.ai.models.embedding;

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: config.ai.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://axon.app",
    "X-Title": "Axon",
  },
});

const extractJson = (raw: string): string => {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start !== -1 && end > start ? trimmed.slice(start, end + 1) : trimmed;
};

const asAiError = (error: unknown): AiError => ({
  kind: "AiGenerationFailed",
  detail: error instanceof Error ? error.message : String(error),
});

export const makeOpenRouterAi = (): AiPort => ({
  generateJson: async (
    prompt,
    request,
  ): Promise<Result<{ raw: string }, AiError>> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // OpenRouter-only `provider` routing field is not in the openai SDK types yet.
        const params = {
          model: CHAT_MODEL,
          messages: [{ role: "user", content: prompt }],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: request.schemaName,
              strict: true,
              schema: request.responseSchema,
            },
          },
          provider: {
            require_parameters: true,
          },
        } as unknown as ChatCompletionCreateParamsNonStreaming;

        const completion = (await openrouter.chat.completions.create(
          params,
        )) as ChatCompletion;
        const choice = completion.choices[0];
        if (!choice?.message?.content) continue;

        return ok({ raw: extractJson(choice.message.content) });
      } catch (error) {
        // Transport failure: return immediately, the use case decides on retry.
        return err(asAiError(error));
      }
    }

    return err({
      kind: "AiGenerationFailed",
      detail: `generateJson(${request.schemaName}): no parsable completion after retries`,
    });
  },

  generateEmbeddings: async (content) => {
    try {
      const response = await openrouter.embeddings.create({
        model: EMBEDDING_MODEL,
        input: content,
      });
      return ok(response.data.map((item) => item.embedding));
    } catch (error) {
      return err(asAiError(error));
    }
  },
});
