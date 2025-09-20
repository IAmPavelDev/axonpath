import { OrpcHandler } from "@/types/OrpcHandler";
import { schema } from "@axon/api-contract";
import z from "zod";
import QuizService from "@/services/quiz/quiz.service";

const {
  GetQuizByClassIdInput,
  GetQuizByClassIdOutput,
  SubmitQuizAnswersInput,
  SubmitQuizAnswersOutput,
} = schema.quiz;

export const getQuizHandler: OrpcHandler<
  z.infer<typeof GetQuizByClassIdInput>,
  z.infer<typeof GetQuizByClassIdOutput>
> = async ({ input }) => {
  const { questions } = await QuizService.getQuestionsByClassId(input);

  return questions;
};

export const submitQuizHandler: OrpcHandler<
  z.infer<typeof SubmitQuizAnswersInput>,
  z.infer<typeof SubmitQuizAnswersOutput>
> = async ({ input }) => {
  const { answers } = input;
  const questions = await QuizService.submitAnswers(answers);
  return questions;
};
