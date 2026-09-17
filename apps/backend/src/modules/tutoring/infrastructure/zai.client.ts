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

// Chat runs on Z.ai's OpenAI-compatible endpoint; embeddings run on Gemini's
// OpenAI-compatible endpoint (Z.ai ships no embedding model). Same OpenAI SDK.
const zai = new OpenAI({
  baseURL: config.ai.chatBaseUrl,
  apiKey: config.ai.ZAI_API_KEY ?? "",
});

const gemini = new OpenAI({
  baseURL: config.ai.embeddingBaseUrl,
  apiKey: config.ai.GEMINI_API_KEY ?? "",
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

export const makeZaiAi = (): AiPort => ({
  generateJson: async (
    input,
    request,
  ): Promise<Result<{ raw: string }, AiError>> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // glm-5.3-flash treats json_schema as guidance, not a hard contract;
        // extractJson strips fences and the parse side tolerates drift.
        const params = {
          model: CHAT_MODEL,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.prompt },
          ],
          // Reasoning model: headroom for reasoning_content + the JSON body.
          max_tokens: 8192,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: request.schemaName,
              strict: true,
              schema: request.responseSchema,
            },
          },
        } as unknown as ChatCompletionCreateParamsNonStreaming;

        const completion = (await zai.chat.completions.create(
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
      const response = await gemini.embeddings.create({
        model: EMBEDDING_MODEL,
        input: content,
      });
      return ok(response.data.map((item) => item.embedding));
    } catch (error) {
      return err(asAiError(error));
    }
  },
});
