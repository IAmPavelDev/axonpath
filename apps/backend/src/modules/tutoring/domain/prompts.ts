import { QuestionType } from "@/prisma/generated";

/**
 * Pure prompt builders + response schemas. No I/O, no imports outside the
 * generated enums — the use case composes these, the adapter only transports.
 * Prompt text is copied verbatim from the old ai.service.ts.
 */

export const buildSkillDescriptionPrompt = (topic: string): string =>
  `Write a concise description (about 50 tokens, 1-2 sentences) for a learning skill about: ${topic}. The description should state what the learner will learn and why it matters. Do not use markdown formatting.`;

export const SKILL_DESCRIPTION_SCHEMA = {
  type: "object",
  properties: {
    description: { type: "string" },
  },
  required: ["description"],
} as const;

export const buildInitSkillPrompt = (input: {
  topic: string;
  priorContext: string[];
}): string => {
  let prompt = `Generate initial learning content for topic: ${input.topic}. Include:
      - classTitle: title of the lesson
      - classContentMd: detailed markdown lesson (500-700 words)
      - questions: 5-10 multiple choice questions with answers
      - contextSnippets: 5-10 key context snippets strictly about the user to reference personalized information in the future learning`;

  if (input.priorContext.length > 0) {
    const learnedContext = input.priorContext
      .map((hit) => `- ${hit}`)
      .join("\n");
    prompt += `

      The learner already knows these related facts from previous skills. Do not repeat them verbatim; build on them:
      ${learnedContext}
    `;
  }

  return prompt;
};

export const INIT_SKILL_SCHEMA = {
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
} as const;
