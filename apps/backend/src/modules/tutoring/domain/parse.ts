import type { QuestionType } from "@/prisma/generated";

/**
 * Defensive parsing of AI responses, shared by every lesson-generation use
 * case: glm-5.3-flash drifts from the requested schema (markdown fences,
 * prose instead of JSON, renamed fields, invented keys).
 */

export type GeneratedQuestion = {
  type: QuestionType;
  text: string;
  choices: string[];
  answerKey: string;
};

/** Strip markdown fences / surrounding prose, then parse. */
export const extractJsonObject = (raw: string): unknown => {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const candidate = start !== -1 && end > start ? raw.slice(start, end + 1) : raw;
  return JSON.parse(candidate);
};

/**
 * Coerce a returned question to GeneratedQuestion; drop anything that does
 * not fit instead of failing the whole quiz insert.
 */
export const toGeneratedQuestion = (value: unknown): GeneratedQuestion | null => {
  if (typeof value !== "object" || value === null) return null;
  // Named cast: untrusted model output, every field re-validated below.
  const q = value as Record<string, unknown>;
  if (
    q.type !== "MULTIPLE_CHOICE" &&
    q.type !== "TRUE_FALSE" &&
    q.type !== "OPEN_ENDED"
  ) {
    return null;
  }
  // The model tends to emit `question` for the schema's `text` field.
  const text = q.text ?? q.question;
  if (typeof text !== "string" || text.length === 0) return null;
  if (typeof q.answerKey !== "string" || q.answerKey.length === 0) return null;
  // OPEN_ENDED drift guard: the model sometimes echoes example choices even
  // though an open-ended question carries none — force the empty list.
  if (q.type === "OPEN_ENDED") {
    return { type: q.type, text, choices: [], answerKey: q.answerKey };
  }
  const rawChoices = Array.isArray(q.choices) ? q.choices : [];
  const choices: string[] = [];
  for (const choice of rawChoices) {
    if (typeof choice !== "string") return null;
    choices.push(choice);
  }
  if (choices.length === 0) return null;
  return { type: q.type, text, choices, answerKey: q.answerKey };
};
