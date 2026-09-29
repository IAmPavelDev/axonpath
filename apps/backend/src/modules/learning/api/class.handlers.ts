import type { z } from "zod";
import { schema } from "@axon/api-contract";
import type { OrpcHandler } from "@/modules/platform/api/orpc-handler";
import { toORPCError } from "@/modules/platform/api/error-mapping";
import { isErr } from "@/modules/platform/result";
import {
  makeGetClassById,
  makeGetClassList,
  type GetClassByIdDeps,
  type GetClassListDeps,
} from "@/modules/learning/application/queries/get-class-list";
import {
  makeAskClassQuestion,
  type AskClassQuestionDeps,
} from "@/modules/learning/application/commands/ask-class-question";
import {
  makeListClassQa,
  type ListClassQaDeps,
} from "@/modules/learning/application/queries/list-class-qa";

export type ClassApiDeps = GetClassListDeps &
  GetClassByIdDeps &
  AskClassQuestionDeps &
  ListClassQaDeps;

export const makeClassHandlers = (deps: ClassApiDeps) => {
  const getClassList = makeGetClassList(deps);
  const getClassById = makeGetClassById(deps);
  const askClassQuestion = makeAskClassQuestion(deps);
  const listClassQa = makeListClassQa(deps);

  return {
    list: (async ({ input, context }) => {
      return getClassList(input.skillId, context.user.id);
    }) satisfies OrpcHandler<
      z.infer<typeof schema.class.GetClassListInput>,
      z.infer<typeof schema.class.GetClassListOutput>
    >,

    get: (async ({ input }) => {
      const result = await getClassById({ classId: input.id });
      if (isErr(result)) {
        throw toORPCError(result.error);
      }
      return result.value;
    }) satisfies OrpcHandler<
      z.infer<typeof schema.class.GetClassByIdInput>,
      z.infer<typeof schema.class.GetClassByIdOutput>
    >,

    qa: {
      ask: (async ({ input, context }) => {
        const result = await askClassQuestion({
          classId: input.classId,
          userId: context.user.id,
          anchorParagraph: input.anchorParagraph,
          question: input.question,
        });
        if (isErr(result)) {
          throw toORPCError(result.error);
        }
        return result.value;
      }) satisfies OrpcHandler<
        z.infer<typeof schema.class.AskClassQuestionInput>,
        z.infer<typeof schema.class.AskClassQuestionOutput>
      >,

      list: (async ({ input, context }) => {
        const result = await listClassQa({
          classId: input.classId,
          userId: context.user.id,
        });
        if (isErr(result)) {
          throw toORPCError(result.error);
        }
        return result.value.map((block) => ({
          id: block.id,
          classId: block.classId,
          anchorParagraph: block.anchorParagraph,
          question: block.question,
          answer: block.answer,
          status: block.status,
          createdAt: block.createdAt,
        }));
      }) satisfies OrpcHandler<
        z.infer<typeof schema.class.ListClassQaInput>,
        z.infer<typeof schema.class.ListClassQaOutput>
      >,
    },
  };
};
