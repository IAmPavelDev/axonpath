import { z } from "zod";

export const GetQuizByClassIdInput = z.object({
  classId: z.number(),
});

export const QuestionType = z.enum([
  "MULTIPLE_CHOICE",
  "TRUE_FALSE",
  "OPEN_ENDED",
]);

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
  /** Question kind — drives the client's verdict vs pending-grading rendering. */
  type: QuestionType,
  /** null = open-ended, grading in flight (null ⇒ pending, never a verdict). */
  isCorrect: z.boolean().nullable(),
  /** Null for OPEN_ENDED forever — the model answer never leaves the server. */
  correctAnswer: z.string().nullable(),
  /** The answer the learner gave for this question, verbatim. */
  userAnswer: z.string(),
});

export const SubmitQuizAnswersOutput = z.object({
  score: z.number(),
  total: z.number(),
  perQuestion: z.array(QuestionResult),
});

export const GetQuizResultInput = z.object({
  classId: z.number(),
});

/** The learner's LATEST attempt for the class; null = never submitted. */
export const GetQuizResultOutput = z.object({
  result: SubmitQuizAnswersOutput.nullable(),
});
