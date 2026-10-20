import { describe, expect, it } from "vitest";
import type { SkillStatus } from "@/prisma/generated";
import type { SkillRepository } from "@/modules/learning/domain/skill/skill.repository";
import type { ClassRepository } from "@/modules/learning/domain/class/class.repository";
import type { QuizRepository } from "@/modules/learning/domain/quiz/quiz.repository";
import type { NextClassJobRepository } from "@/modules/jobs/next-class-job.repository";
import { makeNextClassReconciler } from "./next-class-reconciler";

/** Test seam: one skill per scenario; every interaction captured. */
const makeDeps = ({
  skills = [] as {
    id: number;
    userId: number;
    status: SkillStatus;
  }[],
  topBySkill = {} as Record<
    number,
    { id: number; index: number; title: string } | null
  >,
  answeredIndex = {} as Record<number, number | null>,
  pending = new Set<number>(),
}) => {
  const enqueued: { skillId: number; userId: number }[] = [];
  const statusUpdates: { id: number; patch: Record<string, unknown> }[] = [];

  const notUsed = (method: string) => {
    throw new Error(`${method} not used in reconciler tests`);
  };

  const deps = {
    skillRepo: {
      create: async () => notUsed("create"),
      update: async (id: number, patch: Record<string, unknown>) => {
        statusUpdates.push({ id, patch });
        return {
          id,
          topic: "t",
          description: "",
          status: "ACTIVE",
        };
      },
      findById: async () => notUsed("findById"),
      listByUser: async () => notUsed("listByUser"),
      listByStatus: async (status: SkillStatus) =>
        skills
          .filter((skill) => skill.status === status)
          .map((skill) => ({
            id: skill.id,
            topic: "SQL joins",
            description: "",
            status: skill.status,
            userId: skill.userId,
            requestId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            lessonCount: 0,
            completedLessons: 0,
            learnedPoints: 0,
            lastActivityAt: null,
          })),
      settleStaleGenerating: async () => [],
      claimStaleInit: async () => notUsed("claimStaleInit"),
      claimStaleFirstLesson: async () => notUsed("claimStaleFirstLesson"),
      delete: async () => notUsed("delete"),
    } satisfies SkillRepository,
    classRepo: {
      findQuestionCountsByClassIds: async () =>
        notUsed("findQuestionCountsByClassIds"),
      createWithQuestions: async () => notUsed("createWithQuestions"),
      listBySkill: async () => notUsed("listBySkill"),
      listBySkillByIndex: async () => notUsed("listBySkillByIndex"),
      listByIds: async () => notUsed("listByIds"),
      findTopBySkill: async (skillId: number) => topBySkill[skillId] ?? null,
      findById: async () => notUsed("findById"),
    } satisfies ClassRepository,
    quizRepo: {
      findLatestAttemptResults: async () => notUsed("findLatestAttemptResults"),
      listPendingGradingIds: async () => notUsed("listPendingGradingIds"),
      findWrongAnswersBySkill: async () => notUsed("findWrongAnswersBySkill"),
      findAnswerActivityByUser: async () => notUsed("findAnswerActivityByUser"),
      findByClassId: async () => notUsed("findByClassId"),
      findScoreableByClassId: async () => notUsed("findScoreableByClassId"),
      createAnswers: async () => notUsed("createAnswers"),
      findAnswersByClassAndUser: async () =>
        notUsed("findAnswersByClassAndUser"),
      findAnswerStatsBySkill: async () => notUsed("findAnswerStatsBySkill"),
      findAnswersWithQuestions: async () => notUsed("findAnswersWithQuestions"),
      updateGrades: async () => notUsed("updateGrades"),
      findHighestAnsweredClassIndex: async (skillId: number) =>
        answeredIndex[skillId] ?? null,
      findReviewCandidatesBySkill: async () =>
        notUsed("findReviewCandidatesBySkill"),
    } satisfies QuizRepository,
    nextClassJobs: {
      enqueue: async (input: { skillId: number; userId: number }) => {
        enqueued.push(input);
      },
      claim: async () => notUsed("claim"),
      claimOne: async () => notUsed("claimOne"),
      release: async () => notUsed("release"),
      requeue: async () => notUsed("requeue"),
      existsPending: async (skillId: number) => pending.has(skillId),
    } satisfies NextClassJobRepository,
  };

  return { deps, enqueued, statusUpdates };
};

const ACTIVE_SKILL = { id: 10, userId: 7, status: "ACTIVE" as const };
const NEWEST_CLASS = { id: 5, index: 2, title: "Newest lesson" };

describe("makeNextClassReconciler", () => {
  it("re-arms and flips a due skill: everything answered, no marker, ACTIVE", async () => {
    const { deps, enqueued, statusUpdates } = makeDeps({
      skills: [ACTIVE_SKILL],
      topBySkill: { 10: NEWEST_CLASS },
      answeredIndex: { 10: 2 },
    });

    await makeNextClassReconciler(deps)();

    expect(enqueued).toEqual([{ skillId: 10, userId: 7 }]);
    expect(statusUpdates).toEqual([
      { id: 10, patch: { status: "GENERATING" } },
    ]);
  });

  it("skips a skill whose learner has not finished the newest lesson", async () => {
    const { deps, enqueued, statusUpdates } = makeDeps({
      skills: [ACTIVE_SKILL],
      topBySkill: { 10: NEWEST_CLASS },
      answeredIndex: { 10: 1 },
    });

    await makeNextClassReconciler(deps)();

    expect(enqueued).toEqual([]);
    expect(statusUpdates).toEqual([]);
  });

  it("skips a skill with no recorded answers", async () => {
    const { deps, enqueued, statusUpdates } = makeDeps({
      skills: [ACTIVE_SKILL],
      topBySkill: { 10: NEWEST_CLASS },
    });

    await makeNextClassReconciler(deps)();

    expect(enqueued).toEqual([]);
    expect(statusUpdates).toEqual([]);
  });

  it("skips a skill that already has a marker (queued or in flight)", async () => {
    const { deps, enqueued, statusUpdates } = makeDeps({
      skills: [ACTIVE_SKILL],
      topBySkill: { 10: NEWEST_CLASS },
      answeredIndex: { 10: 2 },
      pending: new Set([10]),
    });

    await makeNextClassReconciler(deps)();

    expect(enqueued).toEqual([]);
    expect(statusUpdates).toEqual([]);
  });

  it("skips a skill with no class yet — init owns that lifecycle", async () => {
    const { deps, enqueued, statusUpdates } = makeDeps({
      skills: [ACTIVE_SKILL],
      topBySkill: {},
      answeredIndex: { 10: null },
    });

    await makeNextClassReconciler(deps)();

    expect(enqueued).toEqual([]);
    expect(statusUpdates).toEqual([]);
  });

  it("only considers ACTIVE skills — a GENERATING skill is never re-armed", async () => {
    const generating = { id: 11, userId: 7, status: "GENERATING" as const };
    const { deps, enqueued, statusUpdates } = makeDeps({
      skills: [ACTIVE_SKILL, generating],
      topBySkill: { 10: NEWEST_CLASS, 11: NEWEST_CLASS },
      answeredIndex: { 10: 2, 11: 2 },
    });

    await makeNextClassReconciler(deps)();

    expect(enqueued).toEqual([{ skillId: 10, userId: 7 }]);
    expect(statusUpdates).toEqual([
      { id: 10, patch: { status: "GENERATING" } },
    ]);
  });

});
