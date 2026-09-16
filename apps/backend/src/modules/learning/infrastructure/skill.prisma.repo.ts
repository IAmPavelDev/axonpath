import { prisma } from "@/modules/platform/infrastructure/prisma";
import { SkillStatus } from "@/prisma/generated";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";

export const makePrismaSkillRepository = (): SkillRepository => ({
  create: (input) =>
    prisma.skill.create({
      data: {
        topic: input.topic,
        userId: input.userId,
        status: SkillStatus.DRAFT,
      },
      select: { id: true, status: true },
    }),

  update: async (id, patch) => {
    const data: { topic?: string; description?: string } = {};
    if (patch.topic !== undefined) data.topic = patch.topic;
    if (patch.description !== undefined) data.description = patch.description;

    return prisma.skill.update({
      where: { id },
      data,
      select: { id: true, topic: true, description: true, status: true },
    });
  },

  findById: async (id) => {
    const skill = await prisma.skill.findFirst({
      where: { id },
      select: { id: true, topic: true, description: true, status: true },
    });
    return skill;
  },

  listByUser: async (userId) => {
    const skills = await prisma.skill.findMany({
      where: { userId },
      select: {
        id: true,
        topic: true,
        description: true,
        status: true,
        userId: true,
        lambda: true,
        requestId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return skills;
  },
});
