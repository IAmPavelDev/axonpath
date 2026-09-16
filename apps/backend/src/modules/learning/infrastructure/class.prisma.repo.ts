import { prisma } from "@/modules/platform/infrastructure/prisma";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { Class, ClassListItem } from "@/modules/learning/domain/class/class";

export const makePrismaClassRepository = (): ClassRepository => ({
  create: async (input): Promise<Pick<Class, "id">> => {
    const created = await prisma.class.create({
      data: {
        skillId: input.skillId,
        index: input.index,
        title: input.title,
        contentMd: input.contentMd,
        aiModel: input.aiModel,
      },
      select: { id: true },
    });
    return created;
  },

  listBySkill: async (skillId): Promise<ClassListItem[]> =>
    prisma.class.findMany({
      where: { skillId },
      select: { id: true, title: true },
    }),

  findById: async (id) =>
    prisma.class.findUnique({
      where: { id },
      select: { id: true, title: true, contentMd: true },
    }),
});
