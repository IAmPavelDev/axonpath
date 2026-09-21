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

  listBySkill: async (skillId, userId): Promise<ClassListItem[]> => {
    const classes = await prisma.class.findMany({
      where: { skillId },
      select: { id: true, title: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const classIds = classes.map((c) => c.id);

    const [questionCounts, answered] = await Promise.all([
      prisma.question.groupBy({
        by: ["classId"],
        where: { classId: { in: classIds } },
        _count: { _all: true },
      }),
      prisma.answer.groupBy({
        by: ["questionId"],
        where: { userId, question: { classId: { in: classIds } } },
        _max: { createdAt: true },
      }),
    ]);
    const questionById = await prisma.question.findMany({
      where: { classId: { in: classIds } },
      select: { id: true, classId: true },
    });
    const classIdByQuestion = new Map(
      questionById.map((q) => [q.id, q.classId]),
    );

    const questionCountByClass = new Map(
      questionCounts.map((row) => [row.classId, row._count._all]),
    );
    const statsByClass = new Map<number, { learnedPoints: number; lastActivityAt: Date | null }>();
    for (const row of answered) {
      const classId = classIdByQuestion.get(row.questionId);
      if (classId === undefined || classId === null) continue;
      const stats = statsByClass.get(classId) ?? { learnedPoints: 0, lastActivityAt: null };
      stats.learnedPoints += 1;
      if (row._max.createdAt && (stats.lastActivityAt === null || row._max.createdAt > stats.lastActivityAt)) {
        stats.lastActivityAt = row._max.createdAt;
      }
      statsByClass.set(classId, stats);
    }

    return classes.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      questionCount: questionCountByClass.get(c.id) ?? 0,
      learnedPoints: statsByClass.get(c.id)?.learnedPoints ?? 0,
      lastActivityAt: statsByClass.get(c.id)?.lastActivityAt ?? null,
    }));
  },

  findTopBySkill: async (skillId) =>
    prisma.class.findFirst({
      where: { skillId },
      orderBy: { index: "desc" },
      select: { id: true, index: true, title: true },
    }),

  findById: async (id) =>
    prisma.class.findUnique({
      where: { id },
      select: { id: true, skillId: true, title: true, contentMd: true },
    }),
});
