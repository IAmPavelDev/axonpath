import type { z } from "zod";
import { schema } from "@axon/api-contract";
import type { ApiHandler } from "@/modules/platform/api/handler";
import { toHttpError } from "@/modules/platform/api/error-mapping";
import { isErr } from "@/modules/platform/result";
import { unwrapOrThrow } from "@/modules/platform/result";
import { makeCreateSkill, type CreateSkillDeps } from "@/modules/learning/application/commands/create-skill";
import { makeRetrySkill, type RetrySkillDeps } from "@/modules/learning/application/commands/retry-skill";
import { makeSetSkillStatus, type SetSkillStatusDeps } from "@/modules/learning/application/commands/set-skill-status";
import { makeEditSkill, type EditSkillDeps } from "@/modules/learning/application/commands/edit-skill";
import { makeDeleteSkill, type DeleteSkillDeps } from "@/modules/learning/application/commands/delete-skill";
import { makeGetSkillById, type GetSkillByIdDeps } from "@/modules/learning/application/queries/get-skill-by-id";
import { makeGetSkillsList, type GetSkillsListDeps } from "@/modules/learning/application/queries/get-skills-list";
import { makeGetSkillProgress, type GetSkillProgressDeps } from "@/modules/learning/application/queries/get-skill-progress";
import { makeGetSkillMistakes, type GetSkillMistakesDeps } from "@/modules/learning/application/queries/get-skill-mistakes";

export type SkillApiDeps = CreateSkillDeps &
  EditSkillDeps &
  GetSkillByIdDeps &
  GetSkillsListDeps &
  RetrySkillDeps &
  SetSkillStatusDeps &
  DeleteSkillDeps &
  GetSkillProgressDeps &
  GetSkillMistakesDeps;

export const makeSkillHandlers = (deps: SkillApiDeps) => {
  const createSkill = makeCreateSkill(deps);
  const editSkill = makeEditSkill(deps);
  const getSkillById = makeGetSkillById(deps);
  const getSkillsList = makeGetSkillsList(deps);
  const retrySkill = makeRetrySkill(deps);
  const setSkillStatus = makeSetSkillStatus(deps);
  const getSkillProgress = makeGetSkillProgress(deps);
  const getSkillMistakes = makeGetSkillMistakes(deps);
  const deleteSkill = makeDeleteSkill(deps);

  return {
    create: (async (input, context) => {
      const result = await createSkill({
        prompt: input.prompt,
        userId: context.user.id,
      });
      return unwrapOrThrow(result, toHttpError);
    }) satisfies ApiHandler<
      z.infer<typeof schema.skill.CreateSkillInput>,
      z.infer<typeof schema.skill.CreateSkillOutput>
    >,

    edit: (async (input, context) => {
      const result = await editSkill({
        id: input.id,
        userId: context.user.id,
        topic: input.topic,
        description: input.description,
      });
      return unwrapOrThrow(result, toHttpError);
    }) satisfies ApiHandler<
      z.infer<typeof schema.skill.EditSkillInput>,
      z.infer<typeof schema.skill.StatusOnly>
    >,


    get: (async (input) => {
      const result = await getSkillById({ skillId: input.id });
      if (isErr(result)) {
        throw toHttpError(result.error);
      }
      return result.value;
    }) satisfies ApiHandler<
      z.infer<typeof schema.skill.SkillIdInput>,
      z.infer<typeof schema.skill.GetSkillByIdOutput>
    >,

    list: (async (input, context) => {
      const { skills } = await getSkillsList(context.user.id, {
        includeArchived: input?.includeArchived ?? false,
      });
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
    }) satisfies ApiHandler<
      z.infer<typeof schema.skill.GetSkillListInput>,
      z.infer<typeof schema.skill.GetSkillListOutput>
    >,

    retry: (async (input, context) => {
      const result = await retrySkill({
        skillId: input.id,
        userId: context.user.id,
      });
      return unwrapOrThrow(result, toHttpError);
    }) satisfies ApiHandler<
      z.infer<typeof schema.skill.SkillIdInput>,
      z.infer<typeof schema.skill.StatusOnly>
    >,

    updateStatus: (async (input, context) => {
      const result = await setSkillStatus({
        skillId: input.id,
        userId: context.user.id,
        status: input.status,
      });
      return unwrapOrThrow(result, toHttpError);
    }) satisfies ApiHandler<
      z.infer<typeof schema.skill.UpdateSkillStatusInput>,
      z.infer<typeof schema.skill.StatusOnly>
    >,

    progress: (async (input, context) => {
      const result = await getSkillProgress({
        skillId: input.id,
        userId: context.user.id,
      });
      return unwrapOrThrow(result, toHttpError);
    }) satisfies ApiHandler<
      z.infer<typeof schema.skill.SkillIdInput>,
      z.infer<typeof schema.skill.SkillProgressOutput>
    >,

    mistakes: (async (input, context) => {
      const result = await getSkillMistakes({
        skillId: input.id,
        userId: context.user.id,
      });
      return unwrapOrThrow(result, toHttpError);
    }) satisfies ApiHandler<
      z.infer<typeof schema.skill.SkillIdInput>,
      z.infer<typeof schema.skill.SkillMistakesOutput>
    >,

    delete: (async (input, context) => {
      const result = await deleteSkill({
        skillId: input.id,
        userId: context.user.id,
      });
      return unwrapOrThrow(result, toHttpError);
    }) satisfies ApiHandler<
      z.infer<typeof schema.skill.SkillIdInput>,
      z.infer<typeof schema.skill.DeleteSkillOutput>
    >,
  };
};
