import type { z } from "zod";
import { schema } from "@axon/api-contract";
import type { OrpcHandler } from "@/modules/platform/api/orpc-handler";
import { toORPCError } from "@/modules/platform/api/error-mapping";
import { isErr } from "@/modules/platform/result";
import { unwrapOrThrow } from "@/modules/platform/result";
import { makeCreateSkill, type CreateSkillDeps } from "@/modules/learning/application/commands/create-skill";
import { makeRetrySkill, type RetrySkillDeps } from "@/modules/learning/application/commands/retry-skill";
import { makeSetSkillStatus, type SetSkillStatusDeps } from "@/modules/learning/application/commands/set-skill-status";
import { makeEditSkill, type EditSkillDeps } from "@/modules/learning/application/commands/edit-skill";
import { makeGetSkillById, type GetSkillByIdDeps } from "@/modules/learning/application/queries/get-skill-by-id";
import { makeGetSkillsList, type GetSkillsListDeps } from "@/modules/learning/application/queries/get-skills-list";
import { makeGetSkillProgress, type GetSkillProgressDeps } from "@/modules/learning/application/queries/get-skill-progress";
import { makeGetSkillMistakes, type GetSkillMistakesDeps } from "@/modules/learning/application/queries/get-skill-mistakes";
import { makeSetSkillMode, type SetSkillModeDeps } from "@/modules/learning/application/commands/set-skill-mode";
import { makeCreateClass, type CreateClassDeps } from "@/modules/learning/application/commands/create-class";
import { makeGetClassOptions, type GetClassOptionsDeps } from "@/modules/learning/application/queries/get-class-options";
import { makeRefreshClassOptions, type RefreshClassOptionsDeps } from "@/modules/learning/application/commands/refresh-class-options";

export type SkillApiDeps = CreateSkillDeps &
  EditSkillDeps &
  GetSkillByIdDeps &
  GetSkillsListDeps &
  RetrySkillDeps &
  SetSkillStatusDeps &
  GetSkillProgressDeps &
  GetSkillMistakesDeps &
  SetSkillModeDeps &
  CreateClassDeps &
  GetClassOptionsDeps &
  RefreshClassOptionsDeps;

export const makeSkillHandlers = (deps: SkillApiDeps) => {
  const createSkill = makeCreateSkill(deps);
  const editSkill = makeEditSkill(deps);
  const getSkillById = makeGetSkillById(deps);
  const getSkillsList = makeGetSkillsList(deps);
  const retrySkill = makeRetrySkill(deps);
  const setSkillStatus = makeSetSkillStatus(deps);
  const getSkillProgress = makeGetSkillProgress(deps);
  const getSkillMistakes = makeGetSkillMistakes(deps);
  const setSkillMode = makeSetSkillMode(deps);
  const createClass = makeCreateClass(deps);
  const getClassOptions = makeGetClassOptions(deps);
  const refreshClassOptions = makeRefreshClassOptions(deps);

  return {
    create: (async ({ input, context }) => {
      const result = await createSkill({
        topic: input.topic,
        userId: context.user.id,
        mode: input.mode,
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

    list: (async ({ input, context }) => {
      const { skills } = await getSkillsList(context.user.id, {
        includeArchived: input?.includeArchived ?? false,
      });
      return skills.map((skill) => ({
        id: skill.id,
        topic: skill.topic,
        status: skill.status,
        mode: skill.mode,
        createdAt: skill.createdAt,
        lessonCount: skill.lessonCount,
        completedLessons: skill.completedLessons,
        learnedPoints: skill.learnedPoints,
        lastActivityAt: skill.lastActivityAt,
      }));
    }) satisfies OrpcHandler<
      z.infer<typeof schema.skill.GetSkillListInput>,
      z.infer<typeof schema.skill.GetSkillListOutput>
    >,

    setMode: (async ({ input, context }) => {
      const result = await setSkillMode({
        skillId: input.id,
        userId: context.user.id,
        mode: input.mode,
      });
      return unwrapOrThrow(result, toORPCError);
    }) satisfies OrpcHandler<
      z.infer<typeof schema.skill.SetSkillModeInput>,
      z.infer<typeof schema.skill.StatusOnly>
    >,

    classOptions: (async ({ input, context }) => {
      const result = await getClassOptions({
        skillId: input.id,
        userId: context.user.id,
      });
      return unwrapOrThrow(result, toORPCError);
    }) satisfies OrpcHandler<
      z.infer<typeof schema.skill.SkillIdInput>,
      z.infer<typeof schema.skill.GetClassOptionsOutput>
    >,

    refreshClassOptions: (async ({ input, context }) => {
      const result = await refreshClassOptions({
        skillId: input.id,
        userId: context.user.id,
      });
      return unwrapOrThrow(result, toORPCError);
    }) satisfies OrpcHandler<
      z.infer<typeof schema.skill.RefreshClassOptionsInput>,
      z.infer<typeof schema.skill.GetClassOptionsOutput>
    >,

    createClass: (async ({ input, context }) => {
      const result = await createClass({
        skillId: input.id,
        userId: context.user.id,
        target: input.target,
      });
      return unwrapOrThrow(result, toORPCError);
    }) satisfies OrpcHandler<
      z.infer<typeof schema.skill.CreateClassInput>,
      z.infer<typeof schema.skill.StatusOnly>
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

    updateStatus: (async ({ input, context }) => {
      const result = await setSkillStatus({
        skillId: input.id,
        userId: context.user.id,
        status: input.status,
      });
      return unwrapOrThrow(result, toORPCError);
    }) satisfies OrpcHandler<
      z.infer<typeof schema.skill.UpdateSkillStatusInput>,
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

    mistakes: (async ({ input, context }) => {
      const result = await getSkillMistakes({
        skillId: input.id,
        userId: context.user.id,
      });
      return unwrapOrThrow(result, toORPCError);
    }) satisfies OrpcHandler<
      z.infer<typeof schema.skill.SkillIdInput>,
      z.infer<typeof schema.skill.SkillMistakesOutput>
    >,
  };
};
