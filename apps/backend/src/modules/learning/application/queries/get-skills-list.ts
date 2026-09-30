import type { SkillListItem, SkillRepository } from "@/modules/learning/domain/skill/skill.repository";

export type GetSkillsListDeps = { skillRepo: SkillRepository };
export type GetSkillsListOptions = { includeArchived?: boolean };
export type GetSkillsListOutput = { skills: SkillListItem[] };

export const makeGetSkillsList =
  ({ skillRepo }: GetSkillsListDeps) =>
  async (
    userId: number,
    options?: GetSkillsListOptions,
  ): Promise<GetSkillsListOutput> => {
    const skills = await skillRepo.listByUser(userId, options);
    return { skills };
  };
