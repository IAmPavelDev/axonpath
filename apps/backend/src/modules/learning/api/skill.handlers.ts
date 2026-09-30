import type { z } from "zod";
import { schema } from "@axon/api-contract";
import type { OrpcHandler } from "@/modules/platform/api/orpc-handler";
import { toORPCError } from "@/modules/platform/api/error-mapping";
import { isErr } from "@/modules/platform/result";
import { unwrapOrThrow } from "@/modules/platform/result";
import { type CreateSkillDeps, makeCreateSkill } from "@/modules/learning/application/commands/create-skill";
import { makeRetrySkill, type RetrySkillDeps } from "@/modules/learning/application/commands/retry-skill";
import { makeEditSkill, type EditSkillDeps } from "@/modules/learning/application/commands/edit-skill";
import { makeGetSkillById, type GetSkillByIdDeps } from "@/modules/learning/application/queries/get-skill-by-id";
import { makeGetSkillsList, type GetSkillsListDeps } from "@/modules/learning/application/queries/get-skills-list";
import { makeGetSkillProgress, type GetSkillProgressDeps } from "@/modules/learning/application/queries/get-skill-progress";

export type SkillApiDeps = CreateSkillDeps &
  EditSkillDeps &
  GetSkillByIdDeps &
  GetSkillsListDeps &
  RetrySkillDeps &
  GetSkillProgressDeps;

export const makeSkillHandlers = (deps: SkillApiDeps) => {
  const createSkill = makeCreateSkill(deps);
  const editSkill = makeEditSkill(deps);
  const getSkillById = makeGetSkillById(deps);
  const getSkillsList = makeGetSkillsList(deps);
  const retrySkill = makeRetrySkill(deps);
  const getSkillProgress = makeGetSkillProgress(deps);

  return {
    create: (async ({ input, context }) => {
      const result = await createSkill({
        topic: input.topic,
        userId: context.user.id,
      });
      return unwrapOrThrow(result, toORPCError);
    }) satisfies OrpcHandler<
      z.infer<typeof schema.skill.CreateSkillInput>,
      z.infer<typeof schema.skill.CreateSkillOutput>
    >,

    edit: (async ({ input }) => {
      const result = await editSkill(input);
      return unwrapOrThrow(result, toORPCError);
    }) satisfies OrpcHandler<
      z.infer<typeof schema.skill.EditSkillInput>,
      z.infer<typeof schema.skill.StatusOnly>
    >,

    get: (async ({ input }) => {
      const result = await getSkillById({ skillId: input.id });
      if (isErr(result)) {
        throw toORPCError(result.error);
      }
      return result.value;
    }) satisfies OrpcHandler<
      z.infer<typeof schema.skill.SkillIdInput>,
      z.infer<typeof schema.skill.GetSkillByIdOutput>
    >,

    list: (async ({ context }) => {
      const { skills } = await getSkillsList(context.user.id);
      return skills.map((skill) => ({
        id: skill.id,
        topic: skill.topic,
        status: skill.status,
        createdAt: skill.createdAt,
        lessonCount: skill.lessonCount,
        completedLessons: skill.completedLessons,
        learnedPoints: skill.learnedPoints,
        lastActivityAt: skill.lastActivityAt,
      }));
    }) satisfies OrpcHandler<
      unknown,
      z.infer<typeof schema.skill.GetSkillListOutput>
    >,

    retry: (async ({ input, context }) => {
      const result = await retrySkill({
        skillId: input.id,
        userId: context.user.id,
      });
      return unwrapOrThrow(result, toORPCError);
    }) satisfies OrpcHandler<
      z.infer<typeof schema.skill.SkillIdInput>,
      z.infer<typeof schema.skill.StatusOnly>
    >,

    progress: (async ({ input, context }) => {
      const result = await getSkillProgress({
        skillId: input.id,
        userId: context.user.id,
      });
      return unwrapOrThrow(result, toORPCError);
    }) satisfies OrpcHandler<
      z.infer<typeof schema.skill.SkillIdInput>,
      z.infer<typeof schema.skill.SkillProgressOutput>
    >,
  };
};
