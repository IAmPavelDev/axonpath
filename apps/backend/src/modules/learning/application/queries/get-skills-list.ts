import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";

export type GetSkillsListDeps = { skillRepo: SkillRepository };
export type GetSkillsListOutput = {
  skills: {
    id: number;
    topic: string;
    description: string;
    status: string;
    userId: number;
    lambda: number;
    requestId: number | null;
    createdAt: Date;
    updatedAt: Date;
  }[];
};

export const makeGetSkillsList =
  ({ skillRepo }: GetSkillsListDeps) =>
  async (userId: number): Promise<GetSkillsListOutput> => {
    const skills = await skillRepo.listByUser(userId);
    return { skills };
  };
