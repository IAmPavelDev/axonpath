import type { z } from "zod";
import { schema } from "@axon/api-contract";
import type { OrpcHandler } from "@/modules/platform/api/orpc-handler";
import { makeGetQuiz, type GetQuizDeps } from "@/modules/learning/application/queries/get-quiz";

export type QuizApiDeps = GetQuizDeps;

export const makeQuizHandlers = (deps: QuizApiDeps) => {
  const getQuiz = makeGetQuiz(deps);

  return {
    get: (async ({ input }) => {
      const questions = await getQuiz(input.classId);
      return questions;
    }) satisfies OrpcHandler<
      z.infer<typeof schema.quiz.GetQuizByClassIdInput>,
      z.infer<typeof schema.quiz.GetQuizByClassIdOutput>
    >,
  };
};
