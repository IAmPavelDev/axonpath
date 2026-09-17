import type { SkillListItem, SkillRepository } from "@/modules/learning/domain/skill/skill.repository";

export type GetSkillsListDeps = { skillRepo: SkillRepository };
export type GetSkillsListOutput = { skills: SkillListItem[] };

export const makeGetSkillsList =
  ({ skillRepo }: GetSkillsListDeps) =>
  async (userId: number): Promise<GetSkillsListOutput> => {
    const skills = await skillRepo.listByUser(userId);
    return { skills };
  };
