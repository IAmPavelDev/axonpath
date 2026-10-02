import { prisma } from "@/modules/platform/infrastructure/prisma";
import type {
  NextClassOptionRepository,
} from "@/modules/learning/domain/skill/next-class-option.repository";

export const makePrismaNextClassOptionRepository = (): NextClassOptionRepository => ({
  replaceForSkill: async (skillId, options) => {
    await prisma.$transaction([
      prisma.nextClassOption.deleteMany({ where: { skillId } }),
      prisma.nextClassOption.createMany({
        data: options.map((option) => ({
          skillId,
          rank: option.rank,
          text: option.text,
        })),
      }),
    ]);
  },

  clearForSkill: async (skillId) => {
    await prisma.nextClassOption.deleteMany({ where: { skillId } });
  },

  listBySkill: async (skillId) =>
    prisma.nextClassOption.findMany({
      where: { skillId },
      orderBy: { rank: "asc" },
      select: { id: true, rank: true, text: true },
    }),
});
