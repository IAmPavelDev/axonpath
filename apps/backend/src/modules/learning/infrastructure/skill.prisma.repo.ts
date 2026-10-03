import { prisma } from "@/modules/platform/infrastructure/prisma";
import { NextClassOptionsState, SkillStatus } from "@/prisma/generated";
import type { SkillMode } from "@/prisma/generated";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";

export const makePrismaSkillRepository = (): SkillRepository => ({
  create: (input) =>
    prisma.skill.create({
      data: {
        topic: input.topic,
        userId: input.userId,
        status: input.status,
        mode: input.mode,
      },
      select: { id: true, status: true },
    }),

  update: async (id, patch) => {
    const data: {
      topic?: string;
      description?: string;
      status?: SkillStatus;
      mode?: SkillMode;
      optionsState?: NextClassOptionsState;
      optionsStateAt?: Date | null;
    } = {};
    if (patch.topic !== undefined) data.topic = patch.topic;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.mode !== undefined) data.mode = patch.mode;
    if (patch.optionsState !== undefined)
      data.optionsState = patch.optionsState;
    if (patch.optionsStateAt !== undefined)
      data.optionsStateAt = patch.optionsStateAt;

    return prisma.skill.update({
      where: { id },
      data,
      select: {
        id: true,
        topic: true,
        description: true,
        status: true,
        mode: true,
        optionsState: true,
        optionsStateAt: true,
      },
    });
  },

  findById: async (id) => {
    const skill = await prisma.skill.findFirst({
      where: { id },
      select: {
        id: true,
        topic: true,
        description: true,
        status: true,
        mode: true,
        optionsState: true,
        optionsStateAt: true,
        userId: true,
      },
    });
    return skill;
  },

  listByUser: async (userId, options) => {
    const skills = await prisma.skill.findMany({
      where: {
        userId,
        // Archived skills disappear from the list unless explicitly
        // included; skill.get by id still reaches them (deep link).
        ...(options?.includeArchived
          ? {}
          : { status: { not: SkillStatus.ARCHIVED } }),
      },
      select: {
        id: true,
        topic: true,
        description: true,
        status: true,
        mode: true,
        userId: true,
        requestId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { classes: true } },
      },
    });
    const skillIds = skills.map((s) => s.id);

    const [answered, questions] = await Promise.all([
      prisma.answer.groupBy({
        by: ["questionId"],
        where: { userId, question: { skillId: { in: skillIds } } },
        _max: { createdAt: true },
      }),
      prisma.question.findMany({
        where: { skillId: { in: skillIds }, classId: { not: null } },
        select: { id: true, skillId: true, classId: true },
      }),
    ]);

    const questionCountByClass = new Map<number, number>();
    const skillByQuestion = new Map<number, number>();
    const classByQuestion = new Map<number, number>();
    for (const question of questions) {
      questionCountByClass.set(
        question.classId!,
        (questionCountByClass.get(question.classId!) ?? 0) + 1,
      );
      skillByQuestion.set(question.id, question.skillId);
      classByQuestion.set(question.id, question.classId!);
    }

    const skillByClass = new Map<number, number>();
    for (const question of questions) {
      skillByClass.set(question.classId!, question.skillId);
    }
    // One group row per distinct answered question.
    const learnedBySkill = new Map<number, number>();
    const lastActivityBySkill = new Map<number, Date>();
    const answeredByClass = new Map<number, number>();
    const lastActivityByClass = new Map<number, Date>();
    for (const row of answered) {
      const skillId = skillByQuestion.get(row.questionId);
      const classId = classByQuestion.get(row.questionId);
      if (skillId !== undefined) {
        learnedBySkill.set(skillId, (learnedBySkill.get(skillId) ?? 0) + 1);
        const prev = lastActivityBySkill.get(skillId);
        if (row._max.createdAt && (!prev || row._max.createdAt > prev)) {
          lastActivityBySkill.set(skillId, row._max.createdAt);
        }
      }
      if (classId !== undefined) {
        answeredByClass.set(classId, (answeredByClass.get(classId) ?? 0) + 1);
        const prev = lastActivityByClass.get(classId);
        if (row._max.createdAt && (!prev || row._max.createdAt > prev)) {
          lastActivityByClass.set(classId, row._max.createdAt);
        }
      }
    }

    const completedBySkill = new Map<number, number>();
    for (const [classId, count] of questionCountByClass) {
      const skillId = skillByClass.get(classId);
      if (skillId === undefined) continue;
      if (count > 0 && (answeredByClass.get(classId) ?? 0) >= count) {
        completedBySkill.set(skillId, (completedBySkill.get(skillId) ?? 0) + 1);
      }
    }

    return skills.map((skill) => {
      return {
        id: skill.id,
        topic: skill.topic,
        description: skill.description,
        status: skill.status,
        mode: skill.mode,
        userId: skill.userId,
        requestId: skill.requestId,
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt,
        lessonCount: skill._count.classes,
        completedLessons: completedBySkill.get(skill.id) ?? 0,
        learnedPoints: learnedBySkill.get(skill.id) ?? 0,
        lastActivityAt: lastActivityBySkill.get(skill.id) ?? null,
      };
    });
  },

  listByStatus: async (status) => {
    // Lean read for the cron's reconciliation sweep: identity + ownership +
    // lifecycle only. The per-skill aggregates listByUser computes are not
    // needed to decide "due for its next lesson".
    const skills = await prisma.skill.findMany({
      where: { status },
      select: {
        id: true,
        topic: true,
        description: true,
        status: true,
        mode: true,
        userId: true,
        requestId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { classes: true } },
      },
    });
    return skills.map((skill) => ({
      id: skill.id,
      topic: skill.topic,
      description: skill.description,
      status: skill.status,
      mode: skill.mode,
      userId: skill.userId,
      requestId: skill.requestId,
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
      lessonCount: skill._count.classes,
      completedLessons: 0,
      learnedPoints: 0,
      lastActivityAt: null,
    }));
  },
  claimStaleInit: (olderThan) =>
    prisma.$queryRaw<Array<{ id: number; userId: number; topic: string }>>`
      UPDATE "Skill" AS skill
      SET "updatedAt" = NOW()
      WHERE skill."status" = 'GENERATING'
        AND skill."updatedAt" < ${olderThan}
        AND NOT EXISTS (SELECT 1 FROM "Class" AS klass WHERE klass."skillId" = skill."id")
      RETURNING skill."id", skill."userId", skill."topic"
    `,

  listStalePendingOptions: (olderThan) =>
    prisma.skill.findMany({
      where: {
        optionsState: NextClassOptionsState.PENDING,
        optionsStateAt: { lt: olderThan },
      },
      select: { id: true, userId: true },
    }),
});
