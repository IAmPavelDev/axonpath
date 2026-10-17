import { prisma } from "@/modules/platform/infrastructure/prisma";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { Class, ClassListItem } from "@/modules/learning/domain/class/class";

export const makePrismaClassRepository = (): ClassRepository => ({
  createWithQuestions: async (cls, questions): Promise<Pick<Class, "id">> =>
    // Explicit budget: the default 5 s expired in prod (Neon HTTP latency
    // spike, 10.3 s) AFTER the inserts landed, killing the generation
    // pipeline between class-create and settle. 30 s keeps a cold connection
    // from stranding a generated lesson.
    prisma.$transaction(
      async (tx) => {
        const created = await tx.class.create({
          data: {
            skillId: cls.skillId,
            index: cls.index,
            title: cls.title,
            contentMd: cls.contentMd,
            baseLanguage: cls.baseLanguage,
            aiModel: cls.aiModel,
            clipStatus: "PENDING",
          },
          select: { id: true },
        });
        if (questions.length > 0) {
          await tx.question.createMany({
            data: questions.map((question) => ({
              skillId: cls.skillId,
              classId: created.id,
              type: question.type,
              text: question.text,
              choices: question.choices,
              answerKey: question.answerKey,
              aiModel: question.aiModel,
            })),
          });
        }
        return created;
      },
      { timeout: 30_000, maxWait: 10_000 },
    ),

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

  listBySkillByIndex: async (skillId) => {
    const classes = await prisma.class.findMany({
      where: { skillId },
      select: { id: true, index: true, title: true },
      orderBy: { index: "asc" },
    });
    const classIds = classes.map((c) => c.id);

    const questionCounts = await prisma.question.groupBy({
      by: ["classId"],
      where: { classId: { in: classIds } },
      _count: { _all: true },
    });
    const questionCountByClass = new Map(
      questionCounts.map((row) => [row.classId, row._count._all]),
    );

    return classes.map((c) => ({
      id: c.id,
      index: c.index,
      title: c.title,
      questionCount: questionCountByClass.get(c.id) ?? 0,
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
      select: { id: true, skillId: true, index: true, title: true, contentMd: true, baseLanguage: true },
    }),
  listByIds: async (ids) => {
    if (ids.length === 0) {
      return [];
    }
    return prisma.class.findMany({
      where: { id: { in: ids } },
      select: { id: true, index: true, title: true },
    });
  },

  findQuestionCountsByClassIds: async (classIds) => {
    if (classIds.length === 0) {
      return [];
    }
    const counts = await prisma.question.groupBy({
      by: ["classId"],
      where: { classId: { in: classIds } },
      _count: { _all: true },
    });
    return counts.map((row) => ({
      classId: row.classId!,
      questionCount: row._count._all,
    }));
  },
});
