import { z } from "zod";

export const GetQuizByClassIdInput = z.object({
  classId: z.number(),
});

export const QuestionType = z.enum(["MULTIPLE_CHOICE", "TRUE_FALSE", "OPEN_ENDED"]);

export const Question = z.object({
  id: z.number(),
  type: QuestionType,
  text: z.string(),
  choices: z.array(z.string()),
});
export type Question = z.infer<typeof Question>;

export const GetQuizByClassIdOutput = z.array(Question);

export const SubmittedAnswer = z.object({
  questionId: z.number(),
  answer: z.string(),
  timeSpentMs: z.number().optional(),
});

export const SubmitQuizAnswersInput = z.object({
  classId: z.number(),
  answers: z.array(SubmittedAnswer),
});

export const QuestionResult = z.object({
  questionId: z.number(),
  isCorrect: z.boolean(),
  /** Null when the stored answerKey is not a plain string (legacy/JSON keys). */
  correctAnswer: z.string().nullable(),
});

export const SubmitQuizAnswersOutput = z.object({
  score: z.number(),
  total: z.number(),
  perQuestion: z.array(QuestionResult),
});
