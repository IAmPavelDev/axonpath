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

export type ClassApiDeps = GetClassListDeps & GetClassByIdDeps;

export const makeClassHandlers = (deps: ClassApiDeps) => {
  const getClassList = makeGetClassList(deps);
  const getClassById = makeGetClassById(deps);

  return {
    list: (async ({ input }) => {
      return getClassList(input.skillId);
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
  };
};
