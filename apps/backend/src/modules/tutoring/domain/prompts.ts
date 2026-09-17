
/**
 * Pure prompt builders + response schemas. No I/O — the use case composes
 * these with the personas from ../domain/personas, the adapter only transports.
 */

export const buildSkillDescriptionPrompt = (topic: string): string =>
  `Topic: ${topic}`;

export const SKILL_DESCRIPTION_SCHEMA = {
  type: "object",
  properties: {
    description: { type: "string" },
  },
  required: ["description"],
  additionalProperties: false,
} as const;

export const buildInitSkillPrompt = (input: {
  topic: string;
  priorContext: string[];
}): string => {
  let prompt = `Create the first lesson of a learning skill.

Topic: ${input.topic}

Return JSON with:
- classTitle: short lesson title.
- classContentMd: the lesson markdown (see format rules in your instructions).
- questions: 5-10 quiz questions per your instructions.
- contextSnippets: 5-10 atomic facts about this learner per your instructions.`;

  if (input.priorContext.length > 0) {
    const learnedContext = input.priorContext
      .map((hit) => `- ${hit}`)
      .join("\n");
    prompt += `

The learner already knows these facts from previous skills. Build on them; do not re-teach them:
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
          type: { type: "string", enum: ["MULTIPLE_CHOICE", "TRUE_FALSE"] },
          text: { type: "string" },
          choices: { type: "array", items: { type: "string" } },
          answerKey: { type: "string" },
        },
        required: ["type", "text", "choices", "answerKey"],
        additionalProperties: false,
      },
    },
    contextSnippets: { type: "array", items: { type: "string" } },
  },
  required: ["classTitle", "classContentMd", "questions", "contextSnippets"],
  additionalProperties: false,
} as const;
