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
          // No client-side cap: this is the API's maximum (GLM-5.3 supports
          // 128k output, and reasoning_content shares it — reasoning once ate
          // 7.4k of an 8k budget and truncated the JSON). Desired length is a
          // soft limit enforced by the prompts (TUTOR_SYSTEM), not here.
          max_tokens: 131072,
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
        // "length" means the budget cut the output mid-JSON; parsing it would
        // only die later with a confusing "Unterminated string" error. Retry.
        if (!choice?.message?.content || choice.finish_reason === "length")
          continue;

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

  generateText: async (input) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // Same no-cap stance as generateJson: GLM-5.3's reasoning_content
        // shares the output budget, so a tight client-side cap truncates
        // answers mid-thought; brevity is enforced by QA_TUTOR_SYSTEM.
        const completion = (await zai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.prompt },
          ],
          max_tokens: 131072,
        })) as ChatCompletion;
        const choice = completion.choices[0];
        // "length" cut the answer mid-sentence; a half answer is worse than
        // a failure — the use case marks the block FAILED and the learner
        // re-asks. Retry once in case the budget fluke repeats.
        if (!choice?.message?.content || choice.finish_reason === "length")
          continue;

        return ok({ raw: choice.message.content.trim() });
      } catch (error) {
        return err(asAiError(error));
      }
    }

    return err({
      kind: "AiGenerationFailed",
      detail: "generateText: no usable completion after retries",
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
