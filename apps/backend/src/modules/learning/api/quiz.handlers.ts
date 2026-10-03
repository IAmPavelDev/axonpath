import type { z } from "zod";
import { schema } from "@axon/api-contract";
import type { OrpcHandler } from "@/modules/platform/api/orpc-handler";
import { toORPCError } from "@/modules/platform/api/error-mapping";
import { unwrapOrThrow } from "@/modules/platform/result";
import {
  makeGetQuiz,
  type GetQuizDeps,
} from "@/modules/learning/application/queries/get-quiz";
import {
  makeGetQuizResult,
  type GetQuizResultDeps,
} from "@/modules/learning/application/queries/get-quiz-result";
import {
  makeSubmitQuiz,
  type SubmitQuizDeps,
} from "@/modules/learning/application/commands/submit-quiz";

export type QuizApiDeps = GetQuizDeps & SubmitQuizDeps & GetQuizResultDeps;

export const makeQuizHandlers = (deps: QuizApiDeps) => {
  const getQuiz = makeGetQuiz(deps);
  const submitQuiz = makeSubmitQuiz(deps);
  const getQuizResult = makeGetQuizResult(deps);

  return {
    get: (async ({ input }) => {
      const questions = await getQuiz(input.classId);
      return questions;
    }) satisfies OrpcHandler<
      z.infer<typeof schema.quiz.GetQuizByClassIdInput>,
      z.infer<typeof schema.quiz.GetQuizByClassIdOutput>
    >,

    submit: (async ({ input, context }) => {
      const result = await submitQuiz({
        classId: input.classId,
        userId: context.user.id,
        answers: input.answers,
      });
      return unwrapOrThrow(result, toORPCError);
    }) satisfies OrpcHandler<
      z.infer<typeof schema.quiz.SubmitQuizAnswersInput>,
      z.infer<typeof schema.quiz.SubmitQuizAnswersOutput>
    >,

    result: (async ({ input, context }) => {
      return {
        result: await getQuizResult({
          classId: input.classId,
          userId: context.user.id,
        }),
      };
    }) satisfies OrpcHandler<
      z.infer<typeof schema.quiz.GetQuizResultInput>,
      z.infer<typeof schema.quiz.GetQuizResultOutput>
    >,
  };
};
