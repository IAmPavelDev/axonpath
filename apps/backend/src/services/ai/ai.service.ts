import OpenAI from "openai";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { prisma } from "@/prisma/index.ts";
import { config } from "@/config.ts";
import { EventType, QuestionType } from "@/prisma/generated/client";
import { AiModelType } from "@/types/AiModels";
import VectorService from "@/services/vector/vector.service.ts";

type QuestionResponse = {
  type: QuestionType;
  text: string;
  choices: string[];
  answerKey: string;
};

type InitSkillResponse = {
  classTitle: string;
  classContentMd: string;
  questions: QuestionResponse[];
  contextSnippets: string[];
  model: AiModelType;
};

type SkillDescriptionResponse = {
  description: string;
  model: AiModelType;
};

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
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start !== -1 && end > start ? trimmed.slice(start, end + 1) : trimmed;
};

const generateJson = async (
  contents: string,
  schemaName: string,
  responseSchema: Record<string, any>
): Promise<string> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    // OpenRouter-only `provider` routing field is not in the openai SDK types yet.
    const params = {
      model: CHAT_MODEL,
      messages: [{ role: "user", content: contents }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: schemaName,
          strict: true,
          schema: responseSchema,
        },
      },
      provider: {
        require_parameters: true,
      },
    } as unknown as ChatCompletionCreateParamsNonStreaming;
    const completion = await openrouter.chat.completions.create(params) as ChatCompletion;
    const choice = completion.choices[0];
    if (!choice?.message?.content) continue;

    return extractJson(choice.message.content);
  }

  throw new Error(`generateJson(${schemaName}): no parsable completion after retries`);
};

const generateSkillDescription = async (
  topic: string
): Promise<SkillDescriptionResponse> => {
  const prompt = `Write a concise description (about 50 tokens, 1-2 sentences) for a learning skill about: ${topic}. The description should state what the learner will learn and why it matters. Do not use markdown formatting.`;

  const responseSchema = {
    type: "object",
    properties: {
      description: { type: "string" },
    },
    required: ["description"],
  };

  try {
    const raw = await generateJson(prompt, "skill_description", responseSchema);
    const parsed = JSON.parse(raw);

    return {
      description: parsed.description ?? "",
      model: CHAT_MODEL,
    };
  } catch (error) {
    console.error("Skill description generation failed:", error);
  }

  return {
    description: "",
    model: CHAT_MODEL,
  };
};

const generateEmbeddings = async (content: string[]): Promise<number[][]> => {
  const response = await openrouter.embeddings.create({
    model: EMBEDDING_MODEL,
    input: content,
  });

  return response.data.map((item) => item.embedding);
};

const generateInitSkill = async (
  params: InitSkillParams
): Promise<InitSkillResponse | undefined> => {
  // Retrieve the user's prior learned context to personalize this skill.
  const queryEmbedding = (await generateEmbeddings([params.topic]))[0];
  const priorContext = queryEmbedding
    ? await VectorService.searchSimilar({
        userId: params.userId,
        embedding: queryEmbedding,
        topK: 5,
        excludeSkillId: params.skillId,
      })
    : [];

  let prompt = `Generate initial learning content for topic: ${params.topic}. Include:
      - classTitle: title of the lesson
      - classContentMd: detailed markdown lesson (500-700 words)
      - questions: 5-10 multiple choice questions with answers
      - contextSnippets: 5-10 key context snippets strictly about the user to reference personalized information in the future learning`;

  if (priorContext.length > 0) {
    const learnedContext = priorContext
      .map((hit) => `- ${hit.textSnippet}`)
      .join("\n");
    prompt += `

The learner already knows these related facts from previous skills. Do not repeat them verbatim; build on them:
${learnedContext}`;
  }

  const responseSchema = {
    type: "object",
    properties: {
      classTitle: { type: "string" },
      classContentMd: { type: "string" },
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: Object.values(QuestionType) },
            text: { type: "string" },
            choices: { type: "array", items: { type: "string" } },
            answerKey: { type: "string" },
          },
          required: ["type", "text", "choices", "answerKey"],
        },
      },
      contextSnippets: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    required: ["classTitle", "classContentMd", "questions", "contextSnippets"],
  };

  try {
    const raw = await generateJson(prompt, "init_skill", responseSchema);
    const responseData = JSON.parse(raw);

    await prisma.event.create({
      data: {
        type: EventType.SKILL_CREATED,
        skillId: params.skillId,
        userId: params.userId,
        payload: {
          action: "init_skill",
          prompt: prompt.substring(0, 2000),
          model: CHAT_MODEL,
          response: raw,
        },
      },
    });

    return {
      classTitle: responseData.classTitle ?? "Unknown title",
      classContentMd: responseData.classContentMd ?? "",
      questions: responseData.questions ?? [],
      contextSnippets: responseData.contextSnippets ?? [],
      model: CHAT_MODEL,
    };
  } catch (error) {
    console.error("AI generation failed:", error);
  }
};

export interface InitSkillParams {
  userId: number;
  skillId: number;
  topic: string;
}

export default {
  generateInitSkill,
  generateSkillDescription,
  generateEmbeddings,
};
