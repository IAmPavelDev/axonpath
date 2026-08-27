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

export const SubmitQuizAnswersInput = z.object({
  answers: z.array(z.object({ questionId: z.number(), answer: z.string() })),
});

export const SubmitQuizAnswersOutput = z.array(Question);
