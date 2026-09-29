import { ClassQaStatus } from "@/prisma/generated";
import { prisma } from "@/modules/platform/infrastructure/prisma";
import type { ClassQaRepository } from "@/modules/learning/domain/class-qa/class-qa.repository";

export const makePrismaClassQaRepository = (): ClassQaRepository => ({
  create: async (input) => {
    const created = await prisma.classQaBlock.create({
      data: {
        classId: input.classId,
        userId: input.userId,
        anchorParagraph: input.anchorParagraph,
        question: input.question,
      },
      select: { id: true, status: true },
    });
    return created;
  },

  listByClass: async (classId) =>
    prisma.classQaBlock.findMany({
      where: { classId },
      orderBy: [{ anchorParagraph: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }),

  findById: async (id) => prisma.classQaBlock.findUnique({ where: { id } }),

  answer: async (id, input) => {
    await prisma.classQaBlock.update({
      where: { id },
      data: {
        answer: input.answer,
        aiModel: input.aiModel,
        status: ClassQaStatus.ANSWERED,
      },
    });
  },

  markFailed: async (id) => {
    await prisma.classQaBlock.update({
      where: { id },
      data: { status: ClassQaStatus.FAILED },
    });
  },
});
