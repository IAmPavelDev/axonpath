import { ClassQaStatus } from "@/prisma/generated";
import { prisma } from "@/modules/platform/infrastructure/prisma";
import type { ClassQaEntity } from "@/modules/learning/domain/class-qa/class-qa";
import type { ClassQaRepository } from "@/modules/learning/domain/class-qa/class-qa.repository";

export const makePrismaClassQaRepository = (): ClassQaRepository => ({
  create: async (input) => {
    const created = await prisma.classQaBlock.create({
      data: {
        classId: input.classId,
        userId: input.userId,
        anchorParagraph: input.anchorParagraph,
        anchorText: input.anchorText ?? null,
        question: input.question,
      },
      select: { id: true, status: true },
    });
    return created;
  },

  listByClass: async (classId) =>
    prisma.classQaBlock.findMany({
      where: { classId },
      orderBy: [
        { anchorParagraph: "asc" },
        { createdAt: "asc" },
        { id: "asc" },
      ],
    }),

  listAnsweredByClass: async (classId, limit) =>
    prisma.classQaBlock.findMany({
      where: { classId, status: ClassQaStatus.ANSWERED },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
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

  resetForRetry: async (id) => {
    // Conditional update: only a FAILED block flips. A concurrent ANSWERED
    // transition (lost race with a late job) leaves the row alone.
    const updated = await prisma.classQaBlock.updateMany({
      where: { id, status: ClassQaStatus.FAILED },
      data: {
        status: ClassQaStatus.PENDING,
        answer: null,
        aiModel: null,
        requeueCount: 0,
      },
    });
    return updated.count === 1 ? { id, status: ClassQaStatus.PENDING } : null;
  },

  // Atomic claim of stranded rows in one statement: still PENDING, untouched
  // since `olderThan` (the in-process answer job was lost to a restart or
  // crash), and below the requeue cap. Claiming bumps requeueCount and
  // updatedAt so the next tick only sees the block again if the replayed job
  // never settled it. FOR UPDATE SKIP LOCKED keeps concurrent sweepers
  // (ticks, other backend instances) from claiming the same block.
  claimStranded: ({ olderThan, maxRequeues, limit }) =>
    prisma.$queryRaw<Pick<ClassQaEntity, "id">[]>`
      UPDATE "ClassQaBlock" AS block
      SET "requeueCount" = block."requeueCount" + 1, "updatedAt" = NOW()
      FROM (
        SELECT "id" FROM "ClassQaBlock"
        WHERE "status" = 'PENDING'
          AND "updatedAt" < ${olderThan}
          AND "requeueCount" < ${maxRequeues}
        ORDER BY "id"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      ) AS due
      WHERE block."id" = due."id"
      RETURNING block."id"
    `,

  // Terminal sweep: a block the sweeper requeued maxRequeues times without
  // it ever settling stops burning AI attempts and fails like a generation
  // would — the client re-asks to retry.
  failExhausted: async ({ olderThan, maxRequeues }) => {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      UPDATE "ClassQaBlock"
      SET "status" = 'FAILED', "updatedAt" = NOW()
      WHERE "status" = 'PENDING'
        AND "updatedAt" < ${olderThan}
        AND "requeueCount" >= ${maxRequeues}
      RETURNING "id"
    `;
    return rows.length;
  },
});
