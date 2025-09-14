import { GoogleGenAI } from "@google/genai";
import { prisma } from "@/prisma/index.ts";
import { config } from "@/config.ts";
import { EventType, QuestionType } from "@/prisma/generated/client";
import { AiModelType } from "@/types/AiModels";

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

type NextClassResponse = {
  classContentMd: string;
  questions: string[];
  newContextSnippets: string[];
};

type ContentGenerationResponse = {
  response: string;
  model: AiModelType;
};

const genAI = new GoogleGenAI({
  apiKey: config.ai.AI_API_KEY,
});

const generate = async (
  contents: string,
  model: AiModelType,
  responseSchema: Record<string, any>
): Promise<ContentGenerationResponse> => {
  try {
    const response = await genAI.models.generateContent({
      model,
      contents,
      config: {
        responseMimeType: "application/json",
        responseSchema,
      },
    });

    return {
      response: response.text ?? "",
      model,
    };
  } catch (error) {
    console.error("AI generation failed:", error);
  }

  return {
    response: "",
    model,
  };
};
const weakGeneration = async (
  contents: string,
  responseSchema: Record<string, any>
) => generate(contents, config.ai.models.weak, responseSchema);
const performantGeneration = async (
  contents: string,
  responseSchema: Record<string, any>
) => generate(contents, config.ai.models.pro, responseSchema);

const generateEmbeddings = async (content: string[]): Promise<number[][]> => {
  const response = await genAI.models.embedContent({
    model: config.ai.models.embedding,
    contents: content,
  })

  return response.embeddings?.map(emb => emb.values ?? []) ?? [];
}

const generateInitSkill = async (
  params: InitSkillParams
): Promise<InitSkillResponse | undefined> => {
  const prompt = `Generate initial learning content for topic: ${params.topic}. Include:
      - classTitle: title of the lesson
      - classContentMd: detailed markdown lesson (500-700 words)
      - questions: 5-10 multiple choice questions with answers
      - contextSnippets: 5-10 key context snippets strictly about the user to reference personalized information in the future learning`;

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
    const { response, model } = await performantGeneration(
      prompt,
      responseSchema
    );

    // Log to audit events
    const cleanedText = response.replace(/```json/g, "").replace(/```/g, "");
    const responseData = JSON.parse(cleanedText);

    await prisma.event.create({
      data: {
        type: EventType.SKILL_CREATED,
        skillId: params.skillId,
        userId: params.userId,
        payload: {
          action: "init_skill",
          prompt: prompt.substring(0, 2000),
          model,
          response: cleanedText,
        },
      },
    });

    return {
      classTitle: responseData.classTitle ?? "Unknown title",
      classContentMd: responseData.classContentMd ?? "",
      questions: responseData.questions ?? [],
      contextSnippets: responseData.contextSnippets ?? [],
      model,
    };
  } catch (error) {
    console.error("AI generation failed:", error);
  }
};

// const generateNextClass = async (
//   params: NextClassParams
// ): Promise<NextClassResponse> => {
//   const prompt = `Generate next class based on:
//       - Previous context: ${params.selectedContext.join("\n")}
//       - User answers: ${JSON.stringify(params.answers)}

//       Produce:
//       - Continuation lesson in markdown
//       - 5-10 new context snippets
//       - 5-10 new questions

//       Format as JSON: { "classContentMd": "...", "questions": ["..."], "newContextSnippets": ["..."] }`;

//   try {
//     const { response, model } = await performantGeneration(prompt);

//     const cleanedText = response.replace(/```json/g, "").replace(/```/g, "");

//     await prisma.event.create({
//       data: {
//         type: EventType.CLASS_GENERATED,
//         skillId: params.skillId,
//         payload: {
//           prompt,
//           response: cleanedText,
//           model,
//         },
//       },
//     });

//     return JSON.parse(cleanedText);
//   } catch (error: unknown) {
//     console.error("Next class generation failed:", error);
//     const message = error instanceof Error ? error.message : "Unknown error";
//     throw new Error(`AI service error: ${message}`);
//   }
// };

export interface InitSkillParams {
  userId: number;
  skillId: number;
  topic: string;
}

export interface NextClassParams {
  skillId: number;
  skillTopic: string;
  lastClassIdx: number;
  answers: string[];
  selectedContext: string[];
}

export default { generateInitSkill, generateEmbeddings };
